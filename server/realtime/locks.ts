// server/realtime/locks.ts — soft field locks. Advisory, in-memory, never gate the API.
//
// Note on channel scoping: LockKey (entityType/entityId/field) carries no propertyId, and T2
// has no visibility into T3's domain tables to look one up. We scope a lock's `lock.state`/
// `lock.granted`/`lock.denied`/`lock.released` broadcasts to whichever `property:<id>` channel(s)
// the acquiring connection is subscribed to at acquire time (normally exactly one, since a field
// editor only exists while its property dossier is open). Flagged in the T2 handoff report.

import * as hub from "./hub.js";
import { nowIso } from "../lib/time.js";
import {
  LOCK_TTL_MS,
  LOCK_IDLE_TAKEOVER_MS,
  lockKeyString,
  type Channel,
  type LockKey,
  type LockState,
} from "../../shared/realtime.js";
import type { UserRef } from "../../shared/types.js";

interface LockRecord {
  key: LockKey;
  connId: string;
  holder: UserRef;
  acquiredAt: string;
  expiresAt: string;
  lastActivityAt: string;
  channels: Set<Channel>;
}

const locks = new Map<string, LockRecord>();

export function resetLocks(): void {
  locks.clear();
}

function propertyChannelsOf(connId: string): Channel[] {
  const rec = hub.getConnection(connId);
  if (!rec) return [];
  return [...rec.channels].filter((c) => c.startsWith("property:"));
}

function toLockState(r: LockRecord): LockState {
  return {
    key: r.key,
    holder: r.holder,
    connId: r.connId,
    acquiredAt: r.acquiredAt,
    expiresAt: r.expiresAt,
    lastActivityAt: r.lastActivityAt,
  };
}

export function locksForChannel(channel: Channel): LockState[] {
  const out: LockState[] = [];
  for (const rec of locks.values()) {
    if (rec.channels.has(channel)) out.push(toLockState(rec));
  }
  return out;
}

export function broadcastLockState(channel: Channel): void {
  hub.broadcast(channel, { t: "lock.state", channel, locks: locksForChannel(channel) });
}

export function sendLockStateTo(connId: string, channel: Channel): void {
  hub.send(connId, { t: "lock.state", channel, locks: locksForChannel(channel) });
}

export function acquireLock(connId: string, key: LockKey, force: boolean): void {
  const conn = hub.getConnection(connId);
  if (!conn) return;
  const keyStr = lockKeyString(key);
  const existing = locks.get(keyStr);
  const nowMs = Date.now();

  if (existing && existing.connId !== connId) {
    const canTakeoverAt = new Date(
      Date.parse(existing.lastActivityAt) + LOCK_IDLE_TAKEOVER_MS,
    ).toISOString();
    if (!force) {
      hub.send(connId, {
        t: "lock.denied",
        key,
        holder: existing.holder,
        expiresAt: existing.expiresAt,
        canTakeoverAt,
      });
      return;
    }
    if (nowMs < Date.parse(canTakeoverAt)) {
      hub.send(connId, {
        t: "lock.denied",
        key,
        holder: existing.holder,
        expiresAt: existing.expiresAt,
        canTakeoverAt,
      });
      return;
    }
    // Takeover succeeds.
    const oldConnId = existing.connId;
    const newExpiresAt = new Date(nowMs + LOCK_TTL_MS).toISOString();
    existing.connId = connId;
    existing.holder = conn.user;
    existing.acquiredAt = nowIso();
    existing.expiresAt = newExpiresAt;
    existing.lastActivityAt = nowIso();
    for (const ch of propertyChannelsOf(connId)) existing.channels.add(ch);
    hub.send(oldConnId, { t: "lock.released", key, by: conn.user, reason: "takeover" });
    hub.send(connId, { t: "lock.granted", key, holder: conn.user, expiresAt: newExpiresAt });
    for (const ch of existing.channels) broadcastLockState(ch);
    return;
  }

  // Free, or the same connection re-acquiring its own lock.
  const channels = new Set(propertyChannelsOf(connId));
  const expiresAt = new Date(nowMs + LOCK_TTL_MS).toISOString();
  if (existing) {
    existing.expiresAt = expiresAt;
    existing.lastActivityAt = nowIso();
    for (const ch of channels) existing.channels.add(ch);
  } else {
    locks.set(keyStr, {
      key,
      connId,
      holder: conn.user,
      acquiredAt: nowIso(),
      expiresAt,
      lastActivityAt: nowIso(),
      channels,
    });
  }
  const rec = locks.get(keyStr)!;
  hub.send(connId, { t: "lock.granted", key, holder: conn.user, expiresAt });
  for (const ch of rec.channels) broadcastLockState(ch);
}

export function heartbeatLock(connId: string, key: LockKey): void {
  const rec = locks.get(lockKeyString(key));
  if (!rec || rec.connId !== connId) return;
  rec.expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  rec.lastActivityAt = nowIso();
  for (const ch of rec.channels) broadcastLockState(ch);
}

/** Called on `draft` frames — counts as activity but does not spam a full lock.state broadcast. */
export function touchLockActivity(connId: string, key: LockKey): void {
  const rec = locks.get(lockKeyString(key));
  if (!rec || rec.connId !== connId) return;
  rec.expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  rec.lastActivityAt = nowIso();
}

export function releaseLock(
  connId: string,
  key: LockKey,
  reason: "released" | "expired" | "disconnected" | "takeover" = "released",
): void {
  const keyStr = lockKeyString(key);
  const rec = locks.get(keyStr);
  if (!rec || rec.connId !== connId) return;
  locks.delete(keyStr);
  const channels = rec.channels;
  for (const ch of channels) {
    hub.broadcast(ch, { t: "lock.released", key, by: rec.holder, reason });
    broadcastLockState(ch);
  }
}

/** Called from the socket close handler: release every lock this connection held. */
export function releaseAllForConnection(connId: string): void {
  for (const [keyStr, rec] of [...locks.entries()]) {
    if (rec.connId !== connId) continue;
    locks.delete(keyStr);
    for (const ch of rec.channels) {
      hub.broadcast(ch, { t: "lock.released", key: rec.key, by: rec.holder, reason: "disconnected" });
      broadcastLockState(ch);
    }
  }
}

/** Periodic sweep (registered as a scheduler job). Releases TTL-expired locks. */
export function sweepExpiredLocks(): void {
  const nowMs = Date.now();
  for (const [keyStr, rec] of [...locks.entries()]) {
    if (Date.parse(rec.expiresAt) > nowMs) continue;
    locks.delete(keyStr);
    for (const ch of rec.channels) {
      hub.broadcast(ch, { t: "lock.released", key: rec.key, by: rec.holder, reason: "expired" });
      broadcastLockState(ch);
    }
  }
}
