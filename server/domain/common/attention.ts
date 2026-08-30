// server/domain/common/attention.ts — the cross-property "needs attention" feed.
// Used by GET /api/attention, GET /api/dashboard and GET {P}/dossier.

import { getDb } from "../../db/index.js";
import { getEnv } from "../../config/env.js";
import { todayLocal, daysBetween } from "../../lib/time.js";
import type { AttentionItem, AttentionKind } from "../../../shared/types.js";

function propertyFilter(propertyId: string | null, column = "p.id"): { sql: string; params: unknown[] } {
  return propertyId ? { sql: `AND ${column} = ?`, params: [propertyId] } : { sql: "", params: [] };
}

/** Computes the full needs-attention feed, optionally scoped to one property. */
export function computeAttention(propertyId: string | null): AttentionItem[] {
  const db = getDb();
  const today = todayLocal(getEnv().APP_TIMEZONE);
  const items: AttentionItem[] = [];
  const pf = propertyFilter(propertyId);

  // work_order_overdue / work_order_urgent
  const woRows = db
    .prepare(
      `SELECT w.id, w.title, w.due_date, w.priority, w.property_id, w.unit_id,
              p.name AS property_name, u.label AS unit_label
         FROM work_orders w
         JOIN properties p ON p.id = w.property_id
         LEFT JOIN units u ON u.id = w.unit_id
        WHERE w.status NOT IN ('done','cancelled') ${pf.sql.replace("p.id", "w.property_id")}`,
    )
    .all(...pf.params) as {
    id: string;
    title: string;
    due_date: string | null;
    priority: string;
    property_id: string;
    unit_id: string | null;
    property_name: string;
    unit_label: string | null;
  }[];
  for (const w of woRows) {
    const overdue = w.due_date !== null && w.due_date < today;
    const daysOut = w.due_date ? daysBetween(today, w.due_date) : null;
    if (overdue) {
      items.push(
        mkItem(
          "work_order_overdue",
          "urgent",
          w.property_id,
          w.property_name,
          w.unit_id,
          w.unit_label,
          "work_order",
          w.id,
          `Overdue: ${w.title}`,
          `Due ${w.due_date}, ${Math.abs(daysOut ?? 0)} day(s) overdue.`,
          w.due_date,
          daysOut,
          `/p/${w.property_id}/maintenance?wo=${w.id}`,
        ),
      );
    } else if (w.priority === "urgent") {
      items.push(
        mkItem(
          "work_order_urgent",
          "urgent",
          w.property_id,
          w.property_name,
          w.unit_id,
          w.unit_label,
          "work_order",
          w.id,
          `Urgent: ${w.title}`,
          `Marked urgent priority.`,
          w.due_date,
          daysOut,
          `/p/${w.property_id}/maintenance?wo=${w.id}`,
        ),
      );
    }
  }

  // compliance_overdue / compliance_due
  const compRows = db
    .prepare(
      `SELECT c.id, c.title, c.due_date, c.lead_days, c.property_id, c.unit_id,
              p.name AS property_name, u.label AS unit_label
         FROM compliance_items c
         JOIN properties p ON p.id = c.property_id
         LEFT JOIN units u ON u.id = c.unit_id
        WHERE c.state = 'open' ${pf.sql.replace("p.id", "c.property_id")}`,
    )
    .all(...pf.params) as {
    id: string;
    title: string;
    due_date: string;
    lead_days: number;
    property_id: string;
    unit_id: string | null;
    property_name: string;
    unit_label: string | null;
  }[];
  for (const c of compRows) {
    const daysOut = daysBetween(today, c.due_date);
    if (daysOut < 0) {
      items.push(
        mkItem(
          "compliance_overdue",
          "urgent",
          c.property_id,
          c.property_name,
          c.unit_id,
          c.unit_label,
          "compliance_item",
          c.id,
          `Overdue: ${c.title}`,
          `Due ${c.due_date}, ${Math.abs(daysOut)} day(s) overdue.`,
          c.due_date,
          daysOut,
          `/p/${c.property_id}/compliance?item=${c.id}`,
        ),
      );
    } else if (daysOut <= c.lead_days) {
      items.push(
        mkItem(
          "compliance_due",
          "warning",
          c.property_id,
          c.property_name,
          c.unit_id,
          c.unit_label,
          "compliance_item",
          c.id,
          `Due soon: ${c.title}`,
          `Due ${c.due_date}, in ${daysOut} day(s).`,
          c.due_date,
          daysOut,
          `/p/${c.property_id}/compliance?item=${c.id}`,
        ),
      );
    }
  }

  // lease_expiring
  const leaseRows = db
    .prepare(
      `SELECT l.id, l.end_date, l.renewal_notice_days, l.property_id, l.unit_id,
              p.name AS property_name, u.label AS unit_label
         FROM leases l
         JOIN properties p ON p.id = l.property_id
         JOIN units u ON u.id = l.unit_id
        WHERE l.status = 'active' AND l.end_date IS NOT NULL ${pf.sql.replace("p.id", "l.property_id")}`,
    )
    .all(...pf.params) as {
    id: string;
    end_date: string;
    renewal_notice_days: number;
    property_id: string;
    unit_id: string;
    property_name: string;
    unit_label: string;
  }[];
  for (const l of leaseRows) {
    const daysOut = daysBetween(today, l.end_date);
    if (daysOut <= l.renewal_notice_days) {
      items.push(
        mkItem(
          "lease_expiring",
          daysOut < 0 ? "urgent" : "warning",
          l.property_id,
          l.property_name,
          l.unit_id,
          l.unit_label,
          "lease",
          l.id,
          `Lease ${daysOut < 0 ? "expired" : "expiring"}: ${l.unit_label}`,
          `Ends ${l.end_date}.`,
          l.end_date,
          daysOut,
          `/p/${l.property_id}/tenants?lease=${l.id}`,
        ),
      );
    }
  }

  // unit_vacant
  const vacantRows = db
    .prepare(
      `SELECT u.id, u.label, u.property_id, p.name AS property_name
         FROM units u
         JOIN properties p ON p.id = u.property_id
        WHERE u.status = 'vacant' ${pf.sql.replace("p.id", "u.property_id")}`,
    )
    .all(...pf.params) as { id: string; label: string; property_id: string; property_name: string }[];
  for (const u of vacantRows) {
    items.push(
      mkItem(
        "unit_vacant",
        "info",
        u.property_id,
        u.property_name,
        u.id,
        u.label,
        "unit",
        u.id,
        `Vacant: ${u.label}`,
        `Unit is currently vacant.`,
        null,
        null,
        `/p/${u.property_id}`,
      ),
    );
  }

  // rent_unpaid
  const rentRows = db
    .prepare(
      `SELECT r.id, r.period, r.unit_id, r.property_id, r.amount_due_cents, r.amount_received_cents,
              p.name AS property_name, u.label AS unit_label
         FROM rent_entries r
         JOIN properties p ON p.id = r.property_id
         JOIN units u ON u.id = r.unit_id
        WHERE r.status IN ('unpaid','partial','late') ${pf.sql.replace("p.id", "r.property_id")}`,
    )
    .all(...pf.params) as {
    id: string;
    period: string;
    unit_id: string;
    property_id: string;
    amount_due_cents: number;
    amount_received_cents: number;
    property_name: string;
    unit_label: string;
  }[];
  for (const r of rentRows) {
    const outstanding = r.amount_due_cents - r.amount_received_cents;
    items.push(
      mkItem(
        "rent_unpaid",
        "warning",
        r.property_id,
        r.property_name,
        r.unit_id,
        r.unit_label,
        "rent_entry",
        r.id,
        `Rent unpaid: ${r.unit_label}`,
        `${r.period}: $${(outstanding / 100).toFixed(2)} outstanding.`,
        null,
        null,
        `/p/${r.property_id}/money?period=${r.period}`,
      ),
    );
  }

  // turnover_stalled
  const turnoverRows = db
    .prepare(
      `SELECT t.id, t.target_ready_date, t.property_id, t.unit_id,
              p.name AS property_name, u.label AS unit_label
         FROM turnovers t
         JOIN properties p ON p.id = t.property_id
         JOIN units u ON u.id = t.unit_id
        WHERE t.closed_at IS NULL AND t.target_ready_date IS NOT NULL AND t.target_ready_date < ?
          ${pf.sql.replace("p.id", "t.property_id")}`,
    )
    .all(today, ...pf.params) as {
    id: string;
    target_ready_date: string;
    property_id: string;
    unit_id: string;
    property_name: string;
    unit_label: string;
  }[];
  for (const t of turnoverRows) {
    const daysOut = daysBetween(today, t.target_ready_date);
    items.push(
      mkItem(
        "turnover_stalled",
        "warning",
        t.property_id,
        t.property_name,
        t.unit_id,
        t.unit_label,
        "turnover",
        t.id,
        `Turnover stalled: ${t.unit_label}`,
        `Target ready date ${t.target_ready_date} has passed.`,
        t.target_ready_date,
        daysOut,
        `/p/${t.property_id}/turnover?turnover=${t.id}`,
      ),
    );
  }

  // pm_due
  const pmRows = db
    .prepare(
      `SELECT m.id, m.title, m.next_due_date, m.lead_days, m.property_id, m.unit_id,
              p.name AS property_name, u.label AS unit_label
         FROM pm_templates m
         JOIN properties p ON p.id = m.property_id
         LEFT JOIN units u ON u.id = m.unit_id
        WHERE m.active = 1 ${pf.sql.replace("p.id", "m.property_id")}`,
    )
    .all(...pf.params) as {
    id: string;
    title: string;
    next_due_date: string;
    lead_days: number;
    property_id: string;
    unit_id: string | null;
    property_name: string;
    unit_label: string | null;
  }[];
  for (const m of pmRows) {
    const daysOut = daysBetween(today, m.next_due_date);
    if (daysOut <= m.lead_days) {
      items.push(
        mkItem(
          "pm_due",
          "info",
          m.property_id,
          m.property_name,
          m.unit_id,
          m.unit_label,
          "pm_template",
          m.id,
          `PM due: ${m.title}`,
          `Next due ${m.next_due_date}.`,
          m.next_due_date,
          daysOut,
          `/p/${m.property_id}/maintenance?pm=${m.id}`,
        ),
      );
    }
  }

  items.sort((a, b) => {
    const rank = { urgent: 0, warning: 1, info: 2 } as const;
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return (a.daysOut ?? 0) - (b.daysOut ?? 0);
  });
  return items;
}

function mkItem(
  kind: AttentionKind,
  severity: AttentionItem["severity"],
  propertyId: string,
  propertyName: string,
  unitId: string | null,
  unitLabel: string | null,
  entityType: AttentionItem["entityType"],
  entityId: string,
  title: string,
  detail: string,
  date: string | null,
  daysOut: number | null,
  url: string,
): AttentionItem {
  return {
    id: `${kind}:${entityId}`,
    kind,
    severity,
    propertyId,
    propertyName,
    unitId,
    unitLabel,
    entityType,
    entityId,
    title,
    detail,
    date,
    daysOut,
    url,
  };
}
