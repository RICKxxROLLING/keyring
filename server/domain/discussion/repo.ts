// server/domain/discussion/repo.ts — the property thread.
import { getDb } from "../../db/index.js";
import { mapRow, mapRows } from "../common/rowmap.js";
import { notFound } from "../../lib/errors.js";
import { userRef } from "../common/access.js";
import type { PropertyComment, PropertyCommentView } from "../../../shared/types.js";

export function getCommentRow(id: string): PropertyComment {
  const row = getDb().prepare(`SELECT * FROM property_comments WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Comment");
  return mapRow<PropertyComment>(row);
}

export function toCommentView(c: PropertyComment): PropertyCommentView {
  return {
    ...c,
    author: userRef(c.createdBy),
    lastEditor: userRef(c.updatedBy),
    // Timestamps, not versions: a version bump means "a write happened", which
    // includes writes that changed nothing. "(edited)" next to a message that
    // was never edited is a small lie the reader has no way to check.
    edited: c.updatedAt !== c.createdAt,
  };
}

/**
 * Oldest first, unlike notes.
 *
 * A note is a document you go back to, so the newest is the most useful. A
 * conversation is read in the order it was said, and jumping to the bottom is
 * something the UI does, not the query.
 */
export function listDiscussion(propertyId: string, limit = 500): PropertyCommentView[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM property_comments WHERE property_id = ?
        ORDER BY created_at ASC, id ASC LIMIT ?`,
    )
    .all(propertyId, limit) as Record<string, unknown>[];
  return mapRows<PropertyComment>(rows).map(toCommentView);
}
