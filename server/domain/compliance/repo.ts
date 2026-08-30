// server/domain/compliance/repo.ts
import { getDb } from "../../db/index.js";
import { mapRow } from "../common/rowmap.js";
import { notFound } from "../../lib/errors.js";
import { todayLocal, daysBetween, addMonths } from "../../lib/time.js";
import { getEnv } from "../../config/env.js";
import { listAttachmentsFor } from "../../uploads/storage.js";
import type { ComplianceItem, ComplianceItemView, ComplianceStatus } from "../../../shared/types.js";

export function getComplianceRow(id: string): ComplianceItem {
  const row = getDb().prepare(`SELECT * FROM compliance_items WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Compliance item");
  return mapRow<ComplianceItem>(row);
}

export function deriveComplianceStatus(item: ComplianceItem, today: string): { status: ComplianceStatus; daysOut: number } {
  const daysOut = daysBetween(today, item.dueDate);
  if (item.state === "waived") return { status: "waived", daysOut };
  if (item.state === "done") return { status: "done", daysOut };
  if (daysOut < 0) return { status: "overdue", daysOut };
  if (daysOut <= item.leadDays) return { status: "due_soon", daysOut };
  return { status: "ok", daysOut };
}

export function toComplianceView(item: ComplianceItem): ComplianceItemView {
  const today = todayLocal(getEnv().APP_TIMEZONE);
  const { status, daysOut } = deriveComplianceStatus(item, today);
  return {
    ...item,
    status,
    daysOut,
    attachments: listAttachmentsFor("compliance_item", item.id),
  };
}

export function listCompliance(propertyId: string, state?: string[], kind?: string[]): ComplianceItemView[] {
  const clauses = ["property_id = ?"];
  const params: unknown[] = [propertyId];
  if (state && state.length) {
    clauses.push(`state IN (${state.map(() => "?").join(",")})`);
    params.push(...state);
  }
  if (kind && kind.length) {
    clauses.push(`kind IN (${kind.map(() => "?").join(",")})`);
    params.push(...kind);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM compliance_items WHERE ${clauses.join(" AND ")} ORDER BY due_date`)
    .all(...params) as Record<string, unknown>[];
  return rows.map((r) => toComplianceView(mapRow<ComplianceItem>(r)));
}

export function advanceComplianceDate(date: string, recurrence: ComplianceItem["recurrence"]): string {
  switch (recurrence) {
    case "monthly":
      return addMonths(date, 1);
    case "quarterly":
      return addMonths(date, 3);
    case "semiannual":
      return addMonths(date, 6);
    case "annual":
      return addMonths(date, 12);
    case "none":
    default:
      return date;
  }
}
