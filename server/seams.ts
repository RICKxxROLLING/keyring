import type { EntityType, NotificationType } from "../shared/types.js";

export interface EntityEventInput {
  action: "created" | "updated" | "deleted";
  entityType: EntityType;
  entityId: string;
  /** null only for portfolio-wide entities (vendor, user). Selects the channel. */
  propertyId: string | null;
  /** Row version AFTER the write. 0 for deletes. */
  version: number;
  actorId: string | null;
  /** Optional inline payload; omit for large entities and let clients refetch. */
  data?: unknown;
}

export interface NotifyMentionsInput {
  actorUserId: string;
  actorLabel: string;
  /** Raw text; the notifier parses @handle tokens out of it. */
  bodyText: string;
  propertyId: string | null;
  entityType: EntityType;
  entityId: string;
  contextTitle: string;
  url: string;
}

export interface NotifyUsersInput {
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  actorUserId: string | null;
  propertyId: string | null;
  entityType: EntityType | null;
  entityId: string | null;
  url: string | null;
}

export interface Notifier {
  notifyMentions: (input: NotifyMentionsInput) => void;
  notifyUsers: (input: NotifyUsersInput) => void;
}

/**
 * Closing live sockets when a session or account is revoked.
 *
 * This exists because revoking a session in the database only stopped its HTTP
 * requests. A WebSocket authenticates once, in the /ws preValidation hook, and
 * was never re-checked — so a revoked session's socket kept receiving `entity`
 * frames carrying whole rows (tenant names, phones, emails, lease terms) and
 * `draft` frames carrying in-flight text, indefinitely.
 *
 * That made three separate remediations half-effective: changing a password
 * after a suspected compromise, resetting a user's TOTP, and deactivating a
 * departing manager. Each cut off HTTP and left the live feed running.
 *
 * Auth (T1) must not import realtime (T2), so it goes through the seam like
 * every other cross-workstream call.
 */
export interface SocketCloser {
  /** Close every socket belonging to one session. */
  closeSession: (sessionId: string) => void;
  /** Close every socket belonging to a user, across all their devices. */
  closeUser: (userId: string) => void;
}

const noopNotifier: Notifier = { notifyMentions: () => {}, notifyUsers: () => {} };
const noopSocketCloser: SocketCloser = { closeSession: () => {}, closeUser: () => {} };

let publisher: (e: EntityEventInput) => void = () => {};
let notifier: Notifier = noopNotifier;
let socketCloser: SocketCloser = noopSocketCloser;

/** Installed by T2 inside registerRealtime(). */
export function setPublisher(fn: (e: EntityEventInput) => void): void {
  publisher = fn;
}
export function setNotifier(n: Notifier): void {
  notifier = n;
}
export function setSocketCloser(c: SocketCloser): void {
  socketCloser = c;
}
export function resetSeams(): void {
  publisher = () => {};
  notifier = noopNotifier;
  socketCloser = noopSocketCloser;
}

/** Called by T3 AFTER the write transaction commits. Never throws. */
export function publishEntity(e: EntityEventInput): void {
  try {
    publisher(e);
  } catch {
    /* realtime is best-effort; never fail a request because of it */
  }
}

export function notifyMentions(input: NotifyMentionsInput): void {
  try {
    notifier.notifyMentions(input);
  } catch {
    /* ignore */
  }
}

export function notifyUsers(input: NotifyUsersInput): void {
  try {
    notifier.notifyUsers(input);
  } catch {
    /* ignore */
  }
}

/**
 * Called by auth after marking a session revoked. Never throws: a socket that
 * cannot be closed must not fail the request that revoked the session — the
 * database revocation is the source of truth, this is enforcement of it.
 */
export function closeSocketsForSession(sessionId: string): void {
  try {
    socketCloser.closeSession(sessionId);
  } catch {
    /* best effort */
  }
}

/** Called by auth when every session for a user is revoked (deactivate, TOTP reset). */
export function closeSocketsForUser(userId: string): void {
  try {
    socketCloser.closeUser(userId);
  } catch {
    /* best effort */
  }
}
