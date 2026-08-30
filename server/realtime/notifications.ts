// server/realtime/notifications.ts — notification inbox store + the Notifier seam
// implementation (notifyMentions / notifyUsers, installed via setNotifier in register.ts).

import { getDb } from "../db/index.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { buildPage, decodeCursor } from "../lib/paging.js";
import { ApiError } from "../lib/errors.js";
import * as hub from "./hub.js";
import { extractHandles } from "./mentions.js";
import { userChannel } from "../../shared/realtime.js";
import type { NotifyMentionsInput, NotifyUsersInput } from "../seams.js";
import type { Notification, Page, UserRef } from "../../shared/types.js";

interface NotificationRow {
  id: string;
  user_id: string;
  type: Notification["type"];
  title: string;
  body: string;
  property_id: string | null;
  entity_type: Notification["entityType"];
  entity_id: string | null;
  url: string | null;
  actor_user_id: string | null;
  actor_handle: string | null;
  actor_display_name: string | null;
  actor_avatar_color: string | null;
  created_at: string;
  read_at: string | null;
}

const SELECT_WITH_ACTOR = `
  SELECT n.id, n.user_id, n.type, n.title, n.body, n.property_id, n.entity_type, n.entity_id,
         n.url, n.actor_user_id, n.created_at, n.read_at,
         au.handle AS actor_handle, au.display_name AS actor_display_name,
         au.avatar_color AS actor_avatar_color
    FROM notifications n
    LEFT JOIN users au ON au.id = n.actor_user_id
`;

function mapRow(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    propertyId: row.property_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    url: row.url,
    actor: row.actor_user_id
      ? {
          id: row.actor_user_id,
          handle: row.actor_handle ?? "",
          displayName: row.actor_display_name ?? "",
          avatarColor: row.actor_avatar_color ?? "#888888",
        }
      : null,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

function lookupUserRef(userId: string): UserRef | null {
  const row = getDb()
    .prepare(`SELECT id, handle, display_name, avatar_color FROM users WHERE id = ?`)
    .get(userId) as
    | { id: string; handle: string; display_name: string; avatar_color: string }
    | undefined;
  if (!row) return null;
  return { id: row.id, handle: row.handle, displayName: row.display_name, avatarColor: row.avatar_color };
}

function unreadCountFor(userId: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`)
    .get(userId) as { n: number };
  return row.n;
}

function pushNotification(n: Notification): void {
  hub.broadcast(userChannel(n.userId), {
    t: "notification",
    notification: n,
    unread: unreadCountFor(n.userId),
  });
}

/* ------------------------------------------------------------ Notifier seam */

export function notifyMentionsImpl(input: NotifyMentionsInput): void {
  const handles = extractHandles(input.bodyText);
  if (handles.length === 0) return;
  const db = getDb();
  const placeholders = handles.map(() => "?").join(",");
  const users = db
    .prepare(
      `SELECT id, handle, display_name, avatar_color FROM users
        WHERE is_active = 1 AND lower(handle) IN (${placeholders})`,
    )
    .all(...handles) as { id: string; handle: string; display_name: string; avatar_color: string }[];
  if (users.length === 0) return;

  const actorRef = lookupUserRef(input.actorUserId);
  for (const u of users) {
    if (u.id === input.actorUserId) continue; // never notify the actor about their own action
    const id = newId("ntf");
    const createdAt = nowIso();
    const title = `${input.actorLabel} mentioned you`;
    const info = db
      .prepare(
        `INSERT OR IGNORE INTO notifications
           (id, user_id, type, title, body, property_id, entity_type, entity_id, url,
            actor_user_id, created_at, read_at)
         VALUES (?, ?, 'mention', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        u.id,
        title,
        input.contextTitle,
        input.propertyId,
        input.entityType,
        input.entityId,
        input.url,
        input.actorUserId,
        createdAt,
      );
    if (info.changes === 0) continue; // already notified this handle for this entity — no re-notify
    pushNotification({
      id,
      userId: u.id,
      type: "mention",
      title,
      body: input.contextTitle,
      propertyId: input.propertyId,
      entityType: input.entityType,
      entityId: input.entityId,
      url: input.url,
      actor: actorRef,
      createdAt,
      readAt: null,
    });
  }
}

export function notifyUsersImpl(input: NotifyUsersInput): void {
  const db = getDb();
  const actorRef = input.actorUserId ? lookupUserRef(input.actorUserId) : null;
  for (const userId of input.userIds) {
    if (input.actorUserId && userId === input.actorUserId) continue; // never notify the actor
    const id = newId("ntf");
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO notifications
         (id, user_id, type, title, body, property_id, entity_type, entity_id, url,
          actor_user_id, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      id,
      userId,
      input.type,
      input.title,
      input.body,
      input.propertyId,
      input.entityType,
      input.entityId,
      input.url,
      input.actorUserId,
      createdAt,
    );
    pushNotification({
      id,
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      propertyId: input.propertyId,
      entityType: input.entityType,
      entityId: input.entityId,
      url: input.url,
      actor: actorRef,
      createdAt,
      readAt: null,
    });
  }
}

/* ---------------------------------------------------------------- HTTP-facing store */

export function listNotifications(
  userId: string,
  opts: { unreadOnly?: boolean; limit: number; cursor?: string },
): Page<Notification> {
  const db = getDb();
  const cursor = decodeCursor(opts.cursor);
  const params: unknown[] = [userId];
  let where = "n.user_id = ?";
  if (opts.unreadOnly) where += " AND n.read_at IS NULL";
  if (cursor) {
    where += " AND (n.created_at < ? OR (n.created_at = ? AND n.id < ?))";
    params.push(cursor.sort, cursor.sort, cursor.id);
  }
  const rows = db
    .prepare(`${SELECT_WITH_ACTOR} WHERE ${where} ORDER BY n.created_at DESC, n.id DESC LIMIT ?`)
    .all(...params, opts.limit + 1) as NotificationRow[];
  const items = rows.map(mapRow);
  return buildPage(items, opts.limit, (n) => n.createdAt);
}

export function getUnreadCount(userId: string): number {
  return unreadCountFor(userId);
}

function getOwned(userId: string, id: string): Notification {
  const row = getDb().prepare(`${SELECT_WITH_ACTOR} WHERE n.id = ? AND n.user_id = ?`).get(id, userId) as
    | NotificationRow
    | undefined;
  if (!row) throw new ApiError("NOT_FOUND", "Notification not found.");
  return mapRow(row);
}

export function markRead(userId: string, id: string): Notification {
  const current = getOwned(userId, id);
  if (!current.readAt) {
    getDb()
      .prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?`)
      .run(nowIso(), id, userId);
  }
  return getOwned(userId, id);
}

export function markAllRead(userId: string): number {
  const info = getDb()
    .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`)
    .run(nowIso(), userId);
  return info.changes;
}

export function deleteNotification(userId: string, id: string): void {
  getOwned(userId, id); // throws NOT_FOUND if missing or not owned
  getDb().prepare(`DELETE FROM notifications WHERE id = ? AND user_id = ?`).run(id, userId);
}
