// server/domain/workorders/repo.ts
import { getDb } from "../../db/index.js";
import { camelRow } from "../../lib/rowmap.js";
import { todayLocal } from "../../lib/time.js";
import { getEnv } from "../../config/env.js";
import { notFound } from "../../lib/errors.js";
import { userRef, propertyName, unitLabel } from "../common/access.js";
import { getVendorRowOrNull } from "../vendors/repo.js";
import { listAttachmentsFor } from "../../uploads/storage.js";
import type { WorkOrder, WorkOrderView } from "../../../shared/types.js";

export function getWorkOrderRow(id: string): WorkOrder {
  const row = getDb().prepare(`SELECT * FROM work_orders WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Work order");
  return camelRow<WorkOrder>(row);
}

export function toWorkOrderView(wo: WorkOrder): WorkOrderView {
  const today = todayLocal(getEnv().APP_TIMEZONE);
  const commentCount = (
    getDb().prepare(`SELECT COUNT(*) AS n FROM work_order_comments WHERE work_order_id = ?`).get(wo.id) as {
      n: number;
    }
  ).n;
  return {
    ...wo,
    unitLabel: unitLabel(wo.unitId),
    propertyName: propertyName(wo.propertyId),
    assignee: userRef(wo.assigneeId),
    vendor: getVendorRowOrNull(wo.vendorId),
    commentCount,
    attachments: listAttachmentsFor("work_order", wo.id),
    isOverdue: wo.status !== "done" && wo.status !== "cancelled" && wo.dueDate !== null && wo.dueDate < today,
  };
}

export function nextWorkOrderNumber(propertyId: string): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(number), 0) AS n FROM work_orders WHERE property_id = ?`)
    .get(propertyId) as { n: number };
  return row.n + 1;
}

export interface WorkOrderFilters {
  propertyId?: string;
  unitId?: string;
  status?: string[];
  priority?: string[];
  assigneeId?: string;
  overdue?: boolean;
  q?: string;
}

export function listWorkOrders(filters: WorkOrderFilters): WorkOrderView[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.propertyId) {
    clauses.push("property_id = ?");
    params.push(filters.propertyId);
  }
  if (filters.unitId) {
    clauses.push("unit_id = ?");
    params.push(filters.unitId);
  }
  if (filters.status && filters.status.length) {
    clauses.push(`status IN (${filters.status.map(() => "?").join(",")})`);
    params.push(...filters.status);
  }
  if (filters.priority && filters.priority.length) {
    clauses.push(`priority IN (${filters.priority.map(() => "?").join(",")})`);
    params.push(...filters.priority);
  }
  if (filters.assigneeId) {
    clauses.push("assignee_id = ?");
    params.push(filters.assigneeId);
  }
  if (filters.q) {
    clauses.push("(title LIKE ? OR description LIKE ?)");
    const like = `%${filters.q}%`;
    params.push(like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(`SELECT * FROM work_orders ${where} ORDER BY created_at DESC`)
    .all(...params) as Record<string, unknown>[];
  let views = rows.map((r) => toWorkOrderView(camelRow<WorkOrder>(r)));
  if (filters.overdue) views = views.filter((v) => v.isOverdue);
  return views;
}
