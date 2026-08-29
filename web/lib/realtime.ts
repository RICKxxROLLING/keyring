// web/lib/realtime.ts — Category B stub (§C1.2 / §C10.4). Owner: T2.
// T4 builds against this exact exported API. T2's real implementation replaces this file
// wholesale at integration. Do not extend the exported surface from outside this file.
import { Fragment, createElement, type ReactNode, type ReactElement } from "react";
import type { Notification, UserRef } from "../../shared/types";
import type { LockKey, LockState, PresenceUser, ServerMessage } from "../../shared/realtime";

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

/** Mount once, inside the authenticated shell, above every route. */
export function RealtimeProvider(props: { children: ReactNode }): ReactElement {
  return createElement(Fragment, null, props.children);
}

export function useConnectionState(): {
  state: ConnectionState;
  lastConnectedAt: string | null;
  reconnectAttempts: number;
} {
  return { state: "offline", lastConnectedAt: null, reconnectAttempts: 0 };
}

/** Subscribes on mount, unsubscribes on unmount. Pass null to subscribe to nothing. */
export function usePropertyChannel(_propertyId: string | null): void {
  // stub: no-op
}

/** Presence for one property channel, de-duplicated by user id by the caller. */
export function usePresence(_propertyId: string | null): PresenceUser[] {
  return [];
}

/** Everyone currently connected anywhere — the dashboard "who's here now" bar. */
export function useGlobalPresence(): PresenceUser[] {
  return [];
}

/** Tell the server which route this connection is looking at. */
export function useAnnouncePage(_page: string): void {
  // stub: no-op
}

/** Fires for every entity broadcast on any subscribed channel. Handler must be stable. */
export function useEntityEvents(_handler: (e: EntityEvent) => void): void {
  // stub: no-op
}

/** Fires after every (re)connect. T4 uses it to invalidate all queries. */
export function useResync(_handler: () => void): void {
  // stub: no-op
}

export interface FieldLock {
  /** 'idle' = nobody holds it; 'held' = you hold it; 'denied' = someone else does. */
  status: "idle" | "held" | "denied";
  holder: UserRef | null;
  canTakeoverAt: string | null;
  /** The other user's live text while they type. null when you hold the lock. */
  remoteDraft: string | null;
  acquire: () => void;
  release: () => void;
  takeover: () => void;
  /** Call on every change while holding the lock; throttled internally. */
  sendDraft: (value: string) => void;
}

/** One hook per editable text field. Heartbeats and cleanup are automatic. */
export function useFieldLock(_key: LockKey | null): FieldLock {
  return {
    status: "idle",
    holder: null,
    canTakeoverAt: null,
    remoteDraft: null,
    acquire() {},
    release() {},
    takeover() {},
    sendDraft() {},
  };
}

/** Every lock currently held on a property, for badges in list views. */
export function usePropertyLocks(_propertyId: string | null): LockState[] {
  return [];
}

export interface NotificationsApi {
  items: Notification[];
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
}
export function useNotifications(): NotificationsApi {
  return { items: [], unread: 0, markRead() {}, markAllRead() {} };
}

/** Escape hatch for anything the hooks do not cover. */
export function subscribeRaw(_handler: (msg: ServerMessage) => void): () => void {
  return () => {};
}
