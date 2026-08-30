// server/domain/tenants/repo.ts
import { getDb } from "../../db/index.js";
import { mapRow, mapRows } from "../common/rowmap.js";
import { notFound } from "../../lib/errors.js";
import { todayLocal, daysBetween } from "../../lib/time.js";
import { getEnv } from "../../config/env.js";
import { unitLabel } from "../common/access.js";
import { listAttachmentsFor } from "../../uploads/storage.js";
import type { Lease, LeaseView, Tenant } from "../../../shared/types.js";

export function getTenantRow(id: string): Tenant {
  const row = getDb().prepare(`SELECT * FROM tenants WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Tenant");
  return mapRow<Tenant>(row);
}

export function listTenants(propertyId: string, unitId?: string, current?: boolean): Tenant[] {
  const clauses = ["property_id = ?"];
  const params: unknown[] = [propertyId];
  if (unitId) {
    clauses.push("unit_id = ?");
    params.push(unitId);
  }
  if (current) clauses.push("moved_out_at IS NULL");
  const rows = getDb()
    .prepare(`SELECT * FROM tenants WHERE ${clauses.join(" AND ")} ORDER BY is_primary DESC, last_name`)
    .all(...params) as Record<string, unknown>[];
  return mapRows<Tenant>(rows);
}

export function getLeaseRow(id: string): Lease {
  const row = getDb().prepare(`SELECT * FROM leases WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Lease");
  return mapRow<Lease>(row);
}

export function tenantsForLease(leaseId: string): Tenant[] {
  const rows = getDb()
    .prepare(
      `SELECT t.* FROM tenants t
         JOIN lease_tenants lt ON lt.tenant_id = t.id
        WHERE lt.lease_id = ? ORDER BY t.is_primary DESC, t.last_name`,
    )
    .all(leaseId) as Record<string, unknown>[];
  return mapRows<Tenant>(rows);
}

export function toLeaseView(lease: Lease): LeaseView {
  const today = todayLocal(getEnv().APP_TIMEZONE);
  return {
    ...lease,
    unitLabel: unitLabel(lease.unitId) ?? "",
    tenants: tenantsForLease(lease.id),
    daysUntilExpiry: lease.endDate ? daysBetween(today, lease.endDate) : null,
    attachments: listAttachmentsFor("lease", lease.id),
  };
}

export function listLeases(propertyId: string, unitId?: string, status?: string[]): LeaseView[] {
  const clauses = ["property_id = ?"];
  const params: unknown[] = [propertyId];
  if (unitId) {
    clauses.push("unit_id = ?");
    params.push(unitId);
  }
  if (status && status.length) {
    clauses.push(`status IN (${status.map(() => "?").join(",")})`);
    params.push(...status);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM leases WHERE ${clauses.join(" AND ")} ORDER BY start_date DESC`)
    .all(...params) as Record<string, unknown>[];
  return rows.map((r) => toLeaseView(mapRow<Lease>(r)));
}

function setUnitStatus(unitId: string, status: string, actorId: string): boolean {
  const db = getDb();
  const unit = db.prepare(`SELECT status FROM units WHERE id = ?`).get(unitId) as
    | { status: string }
    | undefined;
  if (!unit || unit.status === status) return false;
  db.prepare(
    `UPDATE units SET status = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`,
  ).run(status, new Date().toISOString(), actorId, unitId);
  return true;
}

/** Creating/reactivating an active lease: force the unit to 'occupied'. Returns true if changed. */
export function markUnitOccupied(unitId: string, actorId: string): boolean {
  return setUnitStatus(unitId, "occupied", actorId);
}

/** Ending/terminating a lease: if no active lease remains on the unit, mark it 'vacant'. */
export function markUnitVacantIfNoActiveLease(unitId: string, actorId: string): boolean {
  const stillActive = getDb()
    .prepare(`SELECT 1 FROM leases WHERE unit_id = ? AND status = 'active' LIMIT 1`)
    .get(unitId);
  if (stillActive) return false;
  return setUnitStatus(unitId, "vacant", actorId);
}
