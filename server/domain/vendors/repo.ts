// server/domain/vendors/repo.ts
import { getDb } from "../../db/index.js";
import { mapRow } from "../common/rowmap.js";
import { notFound } from "../../lib/errors.js";
import type { Vendor } from "../../../shared/types.js";

export function getVendorRow(id: string): Vendor {
  const row = getDb().prepare(`SELECT * FROM vendors WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Vendor");
  return mapRow<Vendor>(row);
}

export function getVendorRowOrNull(id: string | null): Vendor | null {
  if (!id) return null;
  const row = getDb().prepare(`SELECT * FROM vendors WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapRow<Vendor>(row) : null;
}

export function listVendors(opts: { q?: string; trade?: string; includeArchived: boolean }): Vendor[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!opts.includeArchived) clauses.push("archived_at IS NULL");
  if (opts.trade) {
    clauses.push("trade = ?");
    params.push(opts.trade);
  }
  if (opts.q) {
    clauses.push("(name LIKE ? OR company LIKE ? OR trade LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(`SELECT * FROM vendors ${where} ORDER BY archived_at, name`)
    .all(...params) as Record<string, unknown>[];
  return rows.map((r) => mapRow<Vendor>(r));
}
