// server/domain/properties/repo.ts
import { getDb } from "../../db/index.js";
import { mapRow, mapRows } from "../common/rowmap.js";
import { toBool } from "../../lib/rowmap.js";
import { todayLocal, daysBetween } from "../../lib/time.js";
import { getEnv } from "../../config/env.js";
import { computeAttention } from "../common/attention.js";
import { notFound } from "../../lib/errors.js";
import type {
  Property,
  PropertyQuickFacts,
  PropertyStatus,
  PropertyView,
  Unit,
} from "../../../shared/types.js";

/**
 * A property row as the API describes it.
 *
 * mapRow only renames columns, so is_demo arrives as SQLite's 0 or 1 while the
 * type says boolean — a lie that survives typechecking and reaches the client
 * as a number. Coerced here, at the one place every property row is read, so no
 * caller has to remember.
 */
function mapProperty(row: Record<string, unknown>): Property {
  const mapped = mapRow<Property>(row);
  return { ...mapped, isDemo: toBool(row.is_demo) };
}

export function getPropertyRow(id: string): Property {
  const row = getDb().prepare(`SELECT * FROM properties WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Property");
  return mapProperty(row);
}

export function getPropertyRowOrNull(id: string): Property | null {
  const row = getDb().prepare(`SELECT * FROM properties WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapProperty(row) : null;
}

export function listUnits(propertyId: string): Unit[] {
  const rows = getDb()
    .prepare(`SELECT * FROM units WHERE property_id = ? ORDER BY sort_order, label`)
    .all(propertyId) as Record<string, unknown>[];
  return mapRows<Unit>(rows);
}

export function computeQuickFacts(propertyId: string): PropertyQuickFacts {
  const db = getDb();
  const tz = getEnv().APP_TIMEZONE;
  const today = todayLocal(tz);
  const year = today.slice(0, 4);

  const unitStats = db
    .prepare(
      `SELECT COUNT(*) AS unit_count,
              SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occupied,
              SUM(CASE WHEN status = 'vacant' THEN 1 ELSE 0 END) AS vacant
         FROM units WHERE property_id = ?`,
    )
    .get(propertyId) as { unit_count: number; occupied: number | null; vacant: number | null };

  const monthlyRent = db
    .prepare(
      `SELECT COALESCE(SUM(l.rent_cents), 0) AS total
         FROM leases l
        WHERE l.property_id = ? AND l.status = 'active'`,
    )
    .get(propertyId) as { total: number };

  const woStats = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS open_wo,
         SUM(CASE WHEN status NOT IN ('done','cancelled') AND priority = 'urgent' THEN 1 ELSE 0 END) AS urgent_wo,
         SUM(CASE WHEN status NOT IN ('done','cancelled') AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue_wo
       FROM work_orders WHERE property_id = ?`,
    )
    .get(today, propertyId) as { open_wo: number | null; urgent_wo: number | null; overdue_wo: number | null };

  const activeProjects = db
    .prepare(
      `SELECT COUNT(*) AS n FROM projects
        WHERE property_id = ? AND status IN ('planning','quoted','approved','in_progress','blocked')`,
    )
    .get(propertyId) as { n: number };

  const nextLease = db
    .prepare(
      `SELECT l.unit_id, u.label AS unit_label, l.end_date
         FROM leases l JOIN units u ON u.id = l.unit_id
        WHERE l.property_id = ? AND l.status = 'active' AND l.end_date IS NOT NULL
        ORDER BY l.end_date ASC LIMIT 1`,
    )
    .get(propertyId) as { unit_id: string; unit_label: string; end_date: string } | undefined;

  const nextCompliance = db
    .prepare(
      `SELECT id, title, due_date FROM compliance_items
        WHERE property_id = ? AND state = 'open'
        ORDER BY due_date ASC LIMIT 1`,
    )
    .get(propertyId) as { id: string; title: string; due_date: string } | undefined;

  const ytdExpense = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM property_expenses
        WHERE property_id = ? AND incurred_on >= ? || '-01-01' AND incurred_on <= ?`,
    )
    .get(propertyId, year, today) as { total: number };

  const ytdRentReceived = db
    .prepare(
      `SELECT COALESCE(SUM(amount_received_cents), 0) AS total FROM rent_entries
        WHERE property_id = ? AND period >= ? || '-01' AND period <= ?`,
    )
    .get(propertyId, year, today.slice(0, 7)) as { total: number };

  const lastActivity = db
    .prepare(`SELECT MAX(at) AS at FROM audit_log WHERE property_id = ?`)
    .get(propertyId) as { at: string | null };

  return {
    unitCount: unitStats.unit_count,
    occupiedUnits: unitStats.occupied ?? 0,
    vacantUnits: unitStats.vacant ?? 0,
    monthlyRentCents: monthlyRent.total,
    openWorkOrders: woStats.open_wo ?? 0,
    urgentWorkOrders: woStats.urgent_wo ?? 0,
    overdueWorkOrders: woStats.overdue_wo ?? 0,
    activeProjects: activeProjects.n,
    nextLeaseExpiry: nextLease
      ? {
          unitId: nextLease.unit_id,
          unitLabel: nextLease.unit_label,
          endDate: nextLease.end_date,
          daysOut: daysBetween(today, nextLease.end_date),
        }
      : null,
    nextComplianceDue: nextCompliance
      ? {
          id: nextCompliance.id,
          title: nextCompliance.title,
          dueDate: nextCompliance.due_date,
          daysOut: daysBetween(today, nextCompliance.due_date),
        }
      : null,
    ytdExpenseCents: ytdExpense.total,
    ytdRentReceivedCents: ytdRentReceived.total,
    lastActivityAt: lastActivity.at,
  };
}

export function computePropertyStatus(propertyId: string): PropertyStatus {
  const attention = computeAttention(propertyId);
  if (attention.some((a) => a.severity === "urgent")) return "urgent";
  if (attention.length > 0) return "attention";
  return "stable";
}

export function coverUrlFor(coverUploadId: string | null): string | null {
  return coverUploadId ? `/api/uploads/${coverUploadId}/raw` : null;
}

export function toPropertyView(property: Property): PropertyView {
  return {
    ...property,
    units: listUnits(property.id),
    quickFacts: computeQuickFacts(property.id),
    status: computePropertyStatus(property.id),
    coverUrl: coverUrlFor(property.coverUploadId),
  };
}

export function listProperties(includeArchived: boolean): PropertyView[] {
  const rows = getDb()
    .prepare(
      includeArchived
        ? `SELECT * FROM properties ORDER BY sort_order, name`
        : `SELECT * FROM properties WHERE archived_at IS NULL ORDER BY sort_order, name`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapProperty).map(toPropertyView);
}
