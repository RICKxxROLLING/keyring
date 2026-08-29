// server/search/index-entity.ts — writes/removes rows in search_index (search_fts is kept in
// sync by SQL triggers, see 2001_domain.sql). Callers must invoke these INSIDE the same
// transaction as the entity write (§C5.1 / §C9 non-negotiables).

import { getDb } from "../db/index.js";
import type { EntityType } from "../../shared/types.js";

export interface SearchDoc {
  entityType: EntityType;
  entityId: string;
  propertyId: string | null;
  title: string;
  body: string;
  url: string;
  updatedAt: string;
}

/** HTML-escapes so a search_fts snippet() is always safe to render with dangerouslySetInnerHTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function indexEntity(input: SearchDoc): void {
  getDb()
    .prepare(
      `INSERT INTO search_index (entity_type, entity_id, property_id, title, body, url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET
         property_id = excluded.property_id,
         title = excluded.title,
         body = excluded.body,
         url = excluded.url,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.entityType,
      input.entityId,
      input.propertyId,
      escapeHtml(input.title),
      escapeHtml(input.body),
      input.url,
      input.updatedAt,
    );
}

export function removeFromIndex(entityType: EntityType, entityId: string): void {
  getDb()
    .prepare(`DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?`)
    .run(entityType, entityId);
}
