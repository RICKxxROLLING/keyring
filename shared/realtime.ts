import type { EntityType, Id, ISODateTime, Notification, UserRef } from "./types.js";

export const RT_PROTOCOL_VERSION = 1 as const;

/** A lock lives this long without a heartbeat. */
export const LOCK_TTL_MS = 30_000;
/** Holder re-asserts at this cadence. */
export const LOCK_HEARTBEAT_MS = 10_000;
/** After this much idleness another user may force a takeover. */
export const LOCK_IDLE_TAKEOVER_MS = 60_000;
/** Client coalesces keystrokes into at most one draft frame per this window. */
export const DRAFT_THROTTLE_MS = 150;
/** Client ping cadence; server closes a socket silent for 2.5x this. */
export const CLIENT_PING_MS = 25_000;
export const SERVER_IDLE_TIMEOUT_MS = 65_000;
/** Reconnect backoff bounds (client applies full jitter between them). */
export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 15_000;

export type Channel = string;
export const GLOBAL_CHANNEL: Channel = "global";
export function propertyChannel(propertyId: Id): Channel {
  return `property:${propertyId}`;
}
export function userChannel(userId: Id): Channel {
  return `user:${userId}`;
}

export interface PresenceUser {
  connId: string;
  user: UserRef;
  /** Client route currently viewed, e.g. '/p/prp_x/maintenance'. */
  page: string | null;
  status: "active" | "idle";
  since: ISODateTime;
}

export interface LockKey {
  entityType: EntityType;
  entityId: Id;
  /** Column name in camelCase, e.g. 'body', 'description', 'conditionNotes'. */
  field: string;
}

export function lockKeyString(k: LockKey): string {
  return `${k.entityType}:${k.entityId}:${k.field}`;
}

export interface LockState {
  key: LockKey;
  holder: UserRef;
  connId: string;
  acquiredAt: ISODateTime;
  expiresAt: ISODateTime;
  /** Last draft or heartbeat from the holder. Drives takeover eligibility. */
  lastActivityAt: ISODateTime;
}

export type EntityAction = "created" | "updated" | "deleted";

export type ClientMessage =
  | { t: "hello"; v: number; csrf: string }
  | { t: "sub"; channels: Channel[] }
  | { t: "unsub"; channels: Channel[] }
  | { t: "presence"; channel: Channel; page?: string | null; status?: "active" | "idle" }
  | { t: "lock.acquire"; key: LockKey; force?: boolean }
  | { t: "lock.heartbeat"; key: LockKey }
  | { t: "lock.release"; key: LockKey }
  | { t: "draft"; key: LockKey; value: string; seq: number }
  | { t: "ping" };

export type ServerMessage =
  | { t: "ready"; v: number; connId: string; user: UserRef; serverTime: ISODateTime }
  | { t: "subbed"; channels: Channel[] }
  | { t: "unsubbed"; channels: Channel[] }
  | {
      t: "entity";
      channel: Channel;
      action: EntityAction;
      entityType: EntityType;
      entityId: Id;
      propertyId: Id | null;
      /** Row version after the write; 0 for deletes. */
      version: number;
      actorId: Id | null;
      at: ISODateTime;
      data?: unknown;
    }
  | { t: "presence"; channel: Channel; users: PresenceUser[] }
  | { t: "lock.state"; channel: Channel; locks: LockState[] }
  | { t: "lock.granted"; key: LockKey; holder: UserRef; expiresAt: ISODateTime }
  | {
      t: "lock.denied";
      key: LockKey;
      holder: UserRef;
      expiresAt: ISODateTime;
      canTakeoverAt: ISODateTime;
    }
  | {
      t: "lock.released";
      key: LockKey;
      by: UserRef | null;
      reason: "released" | "expired" | "disconnected" | "takeover";
    }
  | { t: "draft"; key: LockKey; from: UserRef; value: string; seq: number }
  | { t: "notification"; notification: Notification; unread: number }
  | { t: "pong"; serverTime: ISODateTime }
  | { t: "error"; code: string; message: string; fatal: boolean };
