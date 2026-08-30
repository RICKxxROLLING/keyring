// server/domain/common/access.ts — property/unit existence checks shared by every module.
// There is no per-property ACL (§C5.12): every session may see every property. These helpers
// only check existence (404 for unknown ids), never permission.

import { getDb } from "../../db/index.js";
import { notFound } from "../../lib/errors.js";
import type { UserRef } from "../../../shared/types.js";

/** Looks up the UserRef embedded shape for audit/comment/assignment display. Null if unknown. */
export function userRef(id: string | null): UserRef | null {
  if (!id) return null;
  const row = getDb()
    .prepare(`SELECT id, handle, display_name, avatar_color FROM users WHERE id = ?`)
    .get(id) as { id: string; handle: string; display_name: string; avatar_color: string } | undefined;
  if (!row) return null;
  return { id: row.id, handle: row.handle, displayName: row.display_name, avatarColor: row.avatar_color };
}

export function requirePropertyExists(propertyId: string): void {
  const row = getDb()
    .prepare(`SELECT 1 FROM properties WHERE id = ?`)
    .get(propertyId);
  if (!row) throw notFound("Property");
}

export function requireUnitExists(unitId: string, propertyId?: string): void {
  const row = propertyId
    ? getDb().prepare(`SELECT 1 FROM units WHERE id = ? AND property_id = ?`).get(unitId, propertyId)
    : getDb().prepare(`SELECT 1 FROM units WHERE id = ?`).get(unitId);
  if (!row) throw notFound("Unit");
}

/** Looks up a unit's label, or null if it has none / is not set. */
export function unitLabel(unitId: string | null): string | null {
  if (!unitId) return null;
  const row = getDb().prepare(`SELECT label FROM units WHERE id = ?`).get(unitId) as
    | { label: string }
    | undefined;
  return row?.label ?? null;
}

export function propertyName(propertyId: string): string {
  const row = getDb().prepare(`SELECT name FROM properties WHERE id = ?`).get(propertyId) as
    | { name: string }
    | undefined;
  return row?.name ?? "";
}
