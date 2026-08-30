// server/domain/specs/repo.ts
import { getDb } from "../../db/index.js";
import { camelRow } from "../../lib/rowmap.js";
import { notFound } from "../../lib/errors.js";
import { toBool } from "../../lib/rowmap.js";
import { listAttachmentsFor } from "../../uploads/storage.js";
import type { SpecEntry, SpecEntryView } from "../../../shared/types.js";

export function getSpecRow(id: string): SpecEntry {
  const row = getDb().prepare(`SELECT * FROM spec_entries WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Spec entry");
  return camelRow<SpecEntry>(row);
}

/** Masks the value for isSecret rows. Never call with the true value already revealed. */
export function toSpecView(spec: SpecEntry): SpecEntryView {
  const masked = toBool(spec.isSecret);
  const { value, ...rest } = spec;
  return {
    ...rest,
    value: masked ? null : value,
    valueMasked: masked,
    attachments: listAttachmentsFor("spec_entry", spec.id),
  };
}

export function listSpecs(propertyId: string, category?: string[], unitId?: string): SpecEntryView[] {
  const clauses = ["property_id = ?"];
  const params: unknown[] = [propertyId];
  if (category && category.length) {
    clauses.push(`category IN (${category.map(() => "?").join(",")})`);
    params.push(...category);
  }
  if (unitId) {
    clauses.push("unit_id = ?");
    params.push(unitId);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM spec_entries WHERE ${clauses.join(" AND ")} ORDER BY category, label`)
    .all(...params) as Record<string, unknown>[];
  return rows.map((r) => toSpecView(camelRow<SpecEntry>(r)));
}
