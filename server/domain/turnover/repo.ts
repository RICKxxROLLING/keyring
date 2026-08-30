// server/domain/turnover/repo.ts
import { getDb } from "../../db/index.js";
import { camelRow, camelRows } from "../../lib/rowmap.js";
import { notFound } from "../../lib/errors.js";
import { unitLabel } from "../common/access.js";
import { listAttachmentsFor } from "../../uploads/storage.js";
import type { Turnover, TurnoverItem, TurnoverPhase, TurnoverView } from "../../../shared/types.js";

export function getTurnoverRow(id: string): Turnover {
  const row = getDb().prepare(`SELECT * FROM turnovers WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Turnover");
  return camelRow<Turnover>(row);
}

export function listTurnoverItems(turnoverId: string): TurnoverItem[] {
  const rows = getDb()
    .prepare(`SELECT * FROM turnover_items WHERE turnover_id = ? ORDER BY phase, sort_order`)
    .all(turnoverId) as Record<string, unknown>[];
  return camelRows<TurnoverItem>(rows);
}

export function toTurnoverView(t: Turnover): TurnoverView {
  const items = listTurnoverItems(t.id);
  const done = items.filter((i) => i.done).length;
  return {
    ...t,
    unitLabel: unitLabel(t.unitId) ?? "",
    items,
    progress: { done, total: items.length },
    attachments: listAttachmentsFor("turnover", t.id),
  };
}

export function listTurnovers(propertyId: string, unitId?: string, open?: boolean): TurnoverView[] {
  const clauses = ["property_id = ?"];
  const params: unknown[] = [propertyId];
  if (unitId) {
    clauses.push("unit_id = ?");
    params.push(unitId);
  }
  if (open) clauses.push("closed_at IS NULL");
  const rows = getDb()
    .prepare(`SELECT * FROM turnovers WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`)
    .all(...params) as Record<string, unknown>[];
  return rows.map((r) => toTurnoverView(camelRow<Turnover>(r)));
}

/** T3-authored default checklist: at least 4 items per phase for move_out/make_ready/move_in. */
export const DEFAULT_TURNOVER_ITEMS: { phase: TurnoverPhase; label: string }[] = [
  { phase: "move_out", label: "Schedule move-out walkthrough" },
  { phase: "move_out", label: "Collect keys, fobs, and remotes" },
  { phase: "move_out", label: "Document unit condition with photos" },
  { phase: "move_out", label: "Calculate security deposit deductions" },
  { phase: "make_ready", label: "Deep clean unit" },
  { phase: "make_ready", label: "Patch and paint walls as needed" },
  { phase: "make_ready", label: "Service HVAC filter" },
  { phase: "make_ready", label: "Test smoke and CO detectors" },
  { phase: "move_in", label: "Schedule move-in walkthrough" },
  { phase: "move_in", label: "Confirm utilities transferred to tenant" },
  { phase: "move_in", label: "Provide welcome packet and keys" },
  { phase: "move_in", label: "Collect signed lease and deposit" },
];
