import type { Page } from "../../shared/types.js";

export interface Paging {
  limit: number;
  cursor: { sort: string; id: string } | null;
}

export function encodeCursor(sort: string, id: string): string {
  return Buffer.from(`${sort}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): Paging["cursor"] {
  if (!cursor) return null;
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const idx = raw.lastIndexOf("|");
  if (idx < 0) return null;
  return { sort: raw.slice(0, idx), id: raw.slice(idx + 1) };
}

export function parsePaging(q: { limit?: number; cursor?: string }): Paging {
  return { limit: q.limit ?? 50, cursor: decodeCursor(q.cursor) };
}

/**
 * Call with limit+1 rows fetched. Trims the extra row and derives the cursor.
 * keyFn returns the value of the primary sort column for a row.
 */
export function buildPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  keyFn: (row: T) => string,
  total: number | null = null,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(keyFn(last), last.id) : null,
    total,
  };
}

/** Single-page helper for endpoints that always return everything. */
export function onePage<T>(items: T[]): Page<T> {
  return { items, nextCursor: null, total: items.length };
}
