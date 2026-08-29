// web/lib/realtime.ts — the T2 -> T4 seam. Owner: T2. See design §C10.4 for the pinned API.
//
// This file is deliberately plain TypeScript (not .tsx) because its path is pinned exactly as
// `web/lib/realtime.ts`. RealtimeProvider therefore builds its element with `createElement`
// rather than JSX syntax.
//
// Architecture: one module-level singleton `store` (a small external-store class) owns the
// WebSocket connection, channel ref-counts, presence/lock/notification state and listener sets.
// RealtimeProvider only starts/stops it; every hook (and the non-hook `subscribeRaw` escape
// hatch) reads directly from the same singleton via `useSyncExternalStore`. This matches the
// "mount once, above every route" usage note in §C10.4 and lets `subscribeRaw` work outside a
// component (it is not a hook).

import {
  createElement,
  Fragment,
  useEffect,
  useRef,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from "react";
import type { Notification, UserRef } from "../../shared/types";
import {
  DRAFT_THROTTLE_MS,
  GLOBAL_CHANNEL,
  LOCK_HEARTBEAT_MS,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  RT_PROTOCOL_VERSION,
  lockKeyString,
  propertyChannel,
  type Channel,
  type ClientMessage,
  type LockKey,
  type LockState,
  type PresenceUser,
  type ServerMessage,
} from "../../shared/realtime";

export type ConnectionState = "connecting" | "open" | "offline";

export interface EntityEvent {
  action: "created" | "updated" | "deleted";
  entityType: string;
  entityId: string;
  propertyId: string | null;
  version: number;
  actorId: string | null;
  at: string;
  data?: unknown;
}

/* ------------------------------------------------------------------ helpers */

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const c = part.trim();
    if (c.startsWith(prefix)) return decodeURIComponent(c.slice(prefix.length));
  }
  return "";
}

function wsUrl(): string {
  const origin = typeof location !== "undefined" ? location.origin : "http://localhost";
  return `${origin.replace(/^http/, "ws")}/ws`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      "content-type": "application/json",
      "x-csrf-token": readCookie("stoop_csrf"),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? `Request to ${path} failed`);
  return body.data as T;
}

/* --------------------------------------------------------------- local lock */

interface LocalLock {
  status: "idle" | "held" | "denied";
  holder: UserRef | null;
  canTakeoverAt: string | null;
  remoteDraft: string | null;
}

const IDLE_LOCK: LocalLock = { status: "idle", holder: null, canTakeoverAt: null, remoteDraft: null };

interface DraftThrottleState {
  seq: number;
  lastSentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  pending: string | null;
}

/* ------------------------------------------------------------------- store */

type Listener = () => void;

class RealtimeStore {
  state: ConnectionState = "connecting";
  lastConnectedAt: string | null = null;
  reconnectAttempts = 0;
  connId: string | null = null;
  user: UserRef | null = null;

  presence = new Map<Channel, PresenceUser[]>();
  locks = new Map<Channel, LockState[]>();
  notifications: Notification[] = [];
  unread = 0;
  notificationsHydrated = false;

  version = 0;

  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private started = false;
  private everConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private channelRefCounts = new Map<Channel, number>();
  private entityListeners = new Set<(e: EntityEvent) => void>();
  private resyncListeners = new Set<() => void>();
  private rawListeners = new Set<(m: ServerMessage) => void>();
  private localLocks = new Map<string, LocalLock>();
  private heldBeforeDisconnect = new Set<string>();
  private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  private draftThrottle = new Map<string, DraftThrottleState>();
  private visibilityHiddenSince: number | null = null;
  private visibilityInterval: ReturnType<typeof setInterval> | null = null;

  subscribeStore = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      this.visibilityInterval = setInterval(this.checkVisibilityIdle, 15_000);
    }
  }

  stop(): void {
    this.started = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.visibilityInterval) clearInterval(this.visibilityInterval);
    this.visibilityInterval = null;
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    for (const t of this.heartbeatTimers.values()) clearInterval(t);
    this.heartbeatTimers.clear();
    for (const s of this.draftThrottle.values()) if (s.timer) clearTimeout(s.timer);
    this.draftThrottle.clear();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  private onVisibilityChange = (): void => {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      this.visibilityHiddenSince = Date.now();
    } else {
      this.visibilityHiddenSince = null;
      this.announceStatus("active");
    }
  };

  private checkVisibilityIdle = (): void => {
    if (this.visibilityHiddenSince === null) return;
    if (Date.now() - this.visibilityHiddenSince >= 60_000) {
      this.announceStatus("idle");
    }
  };

  private announceStatus(status: "active" | "idle"): void {
    for (const ch of [...this.channelRefCounts.keys(), GLOBAL_CHANNEL]) {
      this.send({ t: "presence", channel: ch, status });
    }
  }

  private connect(): void {
    if (!this.started) return;
    this.state = this.everConnected ? "connecting" : "connecting";
    this.emit();
    const WSCtor = (globalThis as unknown as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WSCtor) {
      // No WebSocket implementation available (e.g. unconfigured test environment). Stay offline.
      this.state = "offline";
      this.emit();
      this.scheduleReconnect();
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WSCtor(wsUrl());
    } catch {
      this.state = "offline";
      this.emit();
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: "hello", v: RT_PROTOCOL_VERSION, csrf: readCookie("stoop_csrf") });
    };
    ws.onmessage = (ev: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handleMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // stale handle from a previous connect() call
      this.ws = null;
      this.state = "offline";
      this.dropLocksOnDisconnect();
      this.emit();
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose always follows; nothing else to do here */
    };
  }

  private scheduleReconnect(): void {
    if (!this.started) return;
    if (this.reconnectTimer) return;
    const attempt = this.reconnectAttempts;
    const cap = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
    const delay = Math.random() * cap;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts += 1;
      this.connect();
    }, delay);
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  private dropLocksOnDisconnect(): void {
    this.heldBeforeDisconnect.clear();
    for (const [ks, l] of this.localLocks) {
      if (l.status === "held") this.heldBeforeDisconnect.add(ks);
    }
    for (const t of this.heartbeatTimers.values()) clearInterval(t);
    this.heartbeatTimers.clear();
    this.localLocks.clear();
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case "ready": {
        this.connId = msg.connId;
        this.user = msg.user;
        this.state = "open";
        this.lastConnectedAt = new Date().toISOString();
        this.reconnectAttempts = 0;
        this.everConnected = true;
        const channels = [...this.channelRefCounts.keys()];
        if (channels.length > 0) this.send({ t: "sub", channels });
        // Best-effort: re-acquire locks that were held right before the disconnect.
        for (const ks of this.heldBeforeDisconnect) {
          const [entityType, entityId, field] = ks.split(":");
          if (entityType && entityId && field) {
            this.send({ t: "lock.acquire", key: { entityType: entityType as never, entityId, field } });
          }
        }
        this.heldBeforeDisconnect.clear();
        this.emit();
        for (const fn of this.resyncListeners) fn();
        break;
      }
      case "presence":
        this.presence.set(msg.channel, msg.users);
        this.emit();
        break;
      case "lock.state":
        this.locks.set(msg.channel, msg.locks);
        this.emit();
        break;
      case "lock.granted":
        this.setLocalLock(msg.key, { status: "held", holder: msg.holder, canTakeoverAt: null, remoteDraft: null });
        break;
      case "lock.denied":
        this.setLocalLock(msg.key, {
          status: "denied",
          holder: msg.holder,
          canTakeoverAt: msg.canTakeoverAt,
          remoteDraft: this.localLocks.get(lockKeyString(msg.key))?.remoteDraft ?? null,
        });
        break;
      case "lock.released":
        this.setLocalLock(msg.key, IDLE_LOCK);
        break;
      case "draft": {
        const ks = lockKeyString(msg.key);
        const prev = this.localLocks.get(ks) ?? IDLE_LOCK;
        this.localLocks.set(ks, { ...prev, remoteDraft: msg.value });
        this.emit();
        break;
      }
      case "notification":
        this.notifications = [msg.notification, ...this.notifications];
        this.unread = msg.unread;
        this.emit();
        break;
      case "subbed":
      case "unsubbed":
      case "pong":
      case "error":
        break;
      default:
        break;
    }

    for (const fn of this.rawListeners) fn(msg);

    if (msg.t === "entity") {
      const e: EntityEvent = {
        action: msg.action,
        entityType: msg.entityType,
        entityId: msg.entityId,
        propertyId: msg.propertyId,
        version: msg.version,
        actorId: msg.actorId,
        at: msg.at,
        data: msg.data,
      };
      for (const fn of this.entityListeners) fn(e);
    }
  }

  private setLocalLock(key: LockKey, val: LocalLock): void {
    const ks = lockKeyString(key);
    this.localLocks.set(ks, val);
    if (val.status === "held") {
      if (!this.heartbeatTimers.has(ks)) {
        const t = setInterval(() => this.send({ t: "lock.heartbeat", key }), LOCK_HEARTBEAT_MS);
        this.heartbeatTimers.set(ks, t);
      }
    } else {
      const t = this.heartbeatTimers.get(ks);
      if (t) {
        clearInterval(t);
        this.heartbeatTimers.delete(ks);
      }
    }
    this.emit();
  }

  getLocalLock(key: LockKey): LocalLock {
    return this.localLocks.get(lockKeyString(key)) ?? IDLE_LOCK;
  }

  /* --------------------------------------------------------- channel refcount */

  subscribeChannel(channel: Channel): void {
    const n = (this.channelRefCounts.get(channel) ?? 0) + 1;
    this.channelRefCounts.set(channel, n);
    if (n === 1 && this.state === "open") this.send({ t: "sub", channels: [channel] });
  }

  unsubscribeChannel(channel: Channel): void {
    const n = (this.channelRefCounts.get(channel) ?? 1) - 1;
    if (n <= 0) {
      this.channelRefCounts.delete(channel);
      if (this.state === "open") this.send({ t: "unsub", channels: [channel] });
    } else {
      this.channelRefCounts.set(channel, n);
    }
  }

  /* ---------------------------------------------------------------- drafts */

  sendDraft(key: LockKey, value: string): void {
    const ks = lockKeyString(key);
    let st = this.draftThrottle.get(ks);
    if (!st) {
      st = { seq: 0, lastSentAt: 0, timer: null, pending: null };
      this.draftThrottle.set(ks, st);
    }
    const emitNow = (v: string): void => {
      st!.seq += 1;
      st!.lastSentAt = Date.now();
      st!.pending = null;
      this.send({ t: "draft", key, value: v, seq: st!.seq });
    };
    const elapsed = Date.now() - st.lastSentAt;
    if (elapsed >= DRAFT_THROTTLE_MS) {
      if (st.timer) {
        clearTimeout(st.timer);
        st.timer = null;
      }
      emitNow(value);
      return;
    }
    st.pending = value;
    if (!st.timer) {
      st.timer = setTimeout(() => {
        st!.timer = null;
        if (st!.pending !== null) emitNow(st!.pending);
      }, DRAFT_THROTTLE_MS - elapsed);
    }
  }

  /* ------------------------------------------------------------ listeners */

  addEntityListener(fn: (e: EntityEvent) => void): () => void {
    this.entityListeners.add(fn);
    return () => this.entityListeners.delete(fn);
  }
  addResyncListener(fn: () => void): () => void {
    this.resyncListeners.add(fn);
    return () => this.resyncListeners.delete(fn);
  }
  addRawListener(fn: (m: ServerMessage) => void): () => void {
    this.rawListeners.add(fn);
    return () => this.rawListeners.delete(fn);
  }

  /* --------------------------------------------------------- notifications */

  async hydrateNotifications(): Promise<void> {
    if (this.notificationsHydrated) return;
    this.notificationsHydrated = true;
    try {
      const [list, count] = await Promise.all([
        fetchJson<{ items: Notification[] }>("/api/notifications?limit=50"),
        fetchJson<{ unread: number }>("/api/notifications/unread-count"),
      ]);
      this.notifications = list.items;
      this.unread = count.unread;
      this.emit();
    } catch {
      /* leave empty on failure; the caller can retry by remounting */
    }
  }

  async markRead(id: string): Promise<void> {
    this.notifications = this.notifications.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n));
    this.unread = Math.max(0, this.notifications.filter((n) => !n.readAt).length);
    this.emit();
    try {
      await fetchJson(`/api/notifications/${id}/read`, { method: "POST" });
    } catch {
      /* optimistic update stands; a future hydrate/reconnect reconciles */
    }
  }

  async markAllRead(): Promise<void> {
    const now = new Date().toISOString();
    this.notifications = this.notifications.map((n) => (n.readAt ? n : { ...n, readAt: now }));
    this.unread = 0;
    this.emit();
    try {
      await fetchJson("/api/notifications/read-all", { method: "POST" });
    } catch {
      /* optimistic update stands */
    }
  }
}

const store = new RealtimeStore();

/* ------------------------------------------------------------------- React */

export function RealtimeProvider(props: { children: ReactNode }): JSX.Element {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, []);
  return createElement(Fragment, null, props.children);
}

function useStoreVersion(): number {
  return useSyncExternalStore(store.subscribeStore, store.getSnapshot, store.getSnapshot);
}

export function useConnectionState(): {
  state: ConnectionState;
  lastConnectedAt: string | null;
  reconnectAttempts: number;
} {
  useStoreVersion();
  return {
    state: store.state,
    lastConnectedAt: store.lastConnectedAt,
    reconnectAttempts: store.reconnectAttempts,
  };
}

export function usePropertyChannel(propertyId: string | null): void {
  useEffect(() => {
    if (!propertyId) return;
    const ch = propertyChannel(propertyId);
    store.subscribeChannel(ch);
    return () => store.unsubscribeChannel(ch);
  }, [propertyId]);
}

export function usePresence(propertyId: string | null): PresenceUser[] {
  useStoreVersion();
  useEffect(() => {
    if (!propertyId) return;
    const ch = propertyChannel(propertyId);
    store.subscribeChannel(ch);
    return () => store.unsubscribeChannel(ch);
  }, [propertyId]);
  if (!propertyId) return [];
  return store.presence.get(propertyChannel(propertyId)) ?? [];
}

export function useGlobalPresence(): PresenceUser[] {
  useStoreVersion();
  return store.presence.get(GLOBAL_CHANNEL) ?? [];
}

export function useAnnouncePage(page: string): void {
  useEffect(() => {
    const channels = new Set<Channel>([GLOBAL_CHANNEL]);
    // Announce to every property channel this connection currently cares about too, so the
    // global "who's here" bar and per-property presence both reflect the current route.
    store.presence.forEach((_users, ch) => channels.add(ch));
    for (const ch of channels) {
      store.send({ t: "presence", channel: ch, page, status: "active" });
    }
  }, [page]);
}

export function useEntityEvents(handler: (e: EntityEvent) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    return store.addEntityListener((e) => handlerRef.current(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function useResync(handler: () => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    return store.addResyncListener(() => handlerRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export interface FieldLock {
  status: "idle" | "held" | "denied";
  holder: UserRef | null;
  canTakeoverAt: string | null;
  remoteDraft: string | null;
  acquire: () => void;
  release: () => void;
  takeover: () => void;
  sendDraft: (value: string) => void;
}

export function useFieldLock(key: LockKey | null): FieldLock {
  useStoreVersion();
  const keyStr = key ? lockKeyString(key) : null;

  useEffect(() => {
    return () => {
      // Best-effort release on unmount if this component still held it.
      if (key && store.getLocalLock(key).status === "held") {
        store.send({ t: "lock.release", key });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyStr]);

  if (!key) {
    return {
      status: "idle",
      holder: null,
      canTakeoverAt: null,
      remoteDraft: null,
      acquire: () => {},
      release: () => {},
      takeover: () => {},
      sendDraft: () => {},
    };
  }

  const local = store.getLocalLock(key);
  return {
    status: local.status,
    holder: local.holder,
    canTakeoverAt: local.canTakeoverAt,
    remoteDraft: local.remoteDraft,
    acquire: () => store.send({ t: "lock.acquire", key }),
    release: () => store.send({ t: "lock.release", key }),
    takeover: () => store.send({ t: "lock.acquire", key, force: true }),
    sendDraft: (value: string) => store.sendDraft(key, value),
  };
}

export function usePropertyLocks(propertyId: string | null): LockState[] {
  useStoreVersion();
  useEffect(() => {
    if (!propertyId) return;
    const ch = propertyChannel(propertyId);
    store.subscribeChannel(ch);
    return () => store.unsubscribeChannel(ch);
  }, [propertyId]);
  if (!propertyId) return [];
  return store.locks.get(propertyChannel(propertyId)) ?? [];
}

export interface NotificationsApi {
  items: Notification[];
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

export function useNotifications(): NotificationsApi {
  useStoreVersion();
  useEffect(() => {
    void store.hydrateNotifications();
  }, []);
  return {
    items: store.notifications,
    unread: store.unread,
    markRead: (id: string) => void store.markRead(id),
    markAllRead: () => void store.markAllRead(),
  };
}

export function subscribeRaw(handler: (msg: ServerMessage) => void): () => void {
  return store.addRawListener(handler);
}
