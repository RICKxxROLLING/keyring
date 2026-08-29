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

const noopNotifier: Notifier = { notifyMentions: () => {}, notifyUsers: () => {} };

let publisher: (e: EntityEventInput) => void = () => {};
let notifier: Notifier = noopNotifier;

/** Installed by T2 inside registerRealtime(). */
export function setPublisher(fn: (e: EntityEventInput) => void): void {
  publisher = fn;
}
export function setNotifier(n: Notifier): void {
  notifier = n;
}
export function resetSeams(): void {
  publisher = () => {};
  notifier = noopNotifier;
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
