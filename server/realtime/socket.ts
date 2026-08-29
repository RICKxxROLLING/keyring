// server/realtime/socket.ts — per-connection handshake and frame dispatch.

import { randomUUID } from "node:crypto";
import * as hub from "./hub.js";
import * as presence from "./presence.js";
import * as locks from "./locks.js";
import * as drafts from "./drafts.js";
import { nowIso } from "../lib/time.js";
import type { ResolvedSession } from "../auth/middleware.js";
import {
  RT_PROTOCOL_VERSION,
  GLOBAL_CHANNEL,
  userChannel,
  type Channel,
  type ClientMessage,
  type ServerMessage,
} from "../../shared/realtime.js";
import type { UserRef } from "../../shared/types.js";

const HELLO_TIMEOUT_MS = 5000;

export interface WsLike {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  readyState: number;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
}

function sendRaw(socket: WsLike, msg: ServerMessage): void {
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    /* ignore — socket is going away */
  }
}

export function handleConnection(socket: WsLike, session: ResolvedSession): void {
  const connId = randomUUID();
  let helloReceived = false;

  const helloTimer = setTimeout(() => {
    if (helloReceived) return;
    sendRaw(socket, { t: "error", code: "FORBIDDEN", message: "hello timeout", fatal: true });
    socket.close(1008, "hello timeout");
  }, HELLO_TIMEOUT_MS);

  function completeHello(): void {
    helloReceived = true;
    clearTimeout(helloTimer);
    const userRef: UserRef = {
      id: session.user.id,
      handle: session.user.handle,
      displayName: session.user.displayName,
      avatarColor: session.user.avatarColor,
    };
    hub.addConnection({
      connId,
      socket,
      userId: session.user.id,
      user: userRef,
      sessionId: session.sessionId,
      channels: new Set(),
      page: null,
      status: "active",
      since: nowIso(),
    });
    hub.subscribe(connId, GLOBAL_CHANNEL);
    hub.subscribe(connId, userChannel(session.user.id));
    presence.broadcastPresence(GLOBAL_CHANNEL);
    hub.send(connId, {
      t: "ready",
      v: RT_PROTOCOL_VERSION,
      connId,
      user: userRef,
      serverTime: nowIso(),
    });
  }

  function handleSub(channels: Channel[]): void {
    const conn = hub.getConnection(connId);
    if (!conn) return;
    for (const ch of channels) {
      if (ch.startsWith("user:") && ch !== userChannel(conn.userId)) {
        hub.send(connId, {
          t: "error",
          code: "FORBIDDEN",
          message: `Cannot subscribe to ${ch}.`,
          fatal: false,
        });
        continue;
      }
      hub.subscribe(connId, ch);
      if (ch.startsWith("property:")) {
        presence.broadcastPresence(ch);
        locks.sendLockStateTo(connId, ch);
      }
    }
    hub.send(connId, { t: "subbed", channels: [...conn.channels] });
  }

  function handleUnsub(channels: Channel[]): void {
    const conn = hub.getConnection(connId);
    if (!conn) return;
    const removed: Channel[] = [];
    for (const ch of channels) {
      if (conn.channels.has(ch)) {
        hub.unsubscribe(connId, ch);
        removed.push(ch);
      }
    }
    hub.send(connId, { t: "unsubbed", channels: removed });
    for (const ch of removed) {
      if (ch === GLOBAL_CHANNEL || ch.startsWith("property:")) presence.broadcastPresence(ch);
    }
  }

  function dispatch(msg: ClientMessage): void {
    switch (msg.t) {
      case "hello":
        return; // duplicate hello after handshake; ignore
      case "sub":
        return handleSub(msg.channels);
      case "unsub":
        return handleUnsub(msg.channels);
      case "presence":
        return presence.updatePresence(connId, msg.channel, msg.page, msg.status);
      case "lock.acquire":
        return locks.acquireLock(connId, msg.key, !!msg.force);
      case "lock.heartbeat":
        return locks.heartbeatLock(connId, msg.key);
      case "lock.release":
        return locks.releaseLock(connId, msg.key, "released");
      case "draft":
        return drafts.handleDraft(connId, msg.key, msg.value, msg.seq);
      case "ping":
        hub.send(connId, { t: "pong", serverTime: nowIso() });
        return;
      default:
        return;
    }
  }

  socket.on("message", (...args: unknown[]) => {
    const raw = args[0];
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return; // malformed frame — ignore
    }
    if (!helloReceived) {
      if (msg.t !== "hello") return; // server sends nothing before hello; ignore anything else
      if (msg.csrf !== session.csrfToken) {
        sendRaw(socket, { t: "error", code: "FORBIDDEN", message: "invalid CSRF token", fatal: true });
        socket.close(1008, "invalid csrf");
        return;
      }
      completeHello();
      return;
    }
    dispatch(msg);
  });

  socket.on("close", () => {
    clearTimeout(helloTimer);
    if (!helloReceived) return;
    locks.releaseAllForConnection(connId);
    const conn = hub.getConnection(connId);
    const channels = conn ? [...conn.channels] : [];
    hub.removeConnection(connId);
    for (const ch of channels) {
      if (ch === GLOBAL_CHANNEL || ch.startsWith("property:")) presence.broadcastPresence(ch);
    }
  });
}
