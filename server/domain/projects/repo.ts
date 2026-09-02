// server/domain/projects/repo.ts
import { getDb } from "../../db/index.js";
import { mapRow, mapRows } from "../common/rowmap.js";
import { notFound } from "../../lib/errors.js";
import { userRef } from "../common/access.js";
import { listAttachmentsFor } from "../../uploads/storage.js";
import type { Project, ProjectLine, ProjectView, PropertyExpense } from "../../../shared/types.js";

export function getProjectRow(id: string): Project {
  const row = getDb().prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Project");
  return mapRow<Project>(row);
}

export function listProjectLines(projectId: string): ProjectLine[] {
  const rows = getDb()
    .prepare(`SELECT * FROM project_lines WHERE project_id = ? ORDER BY kind, created_at`)
    .all(projectId) as Record<string, unknown>[];
  return mapRows<ProjectLine>(rows);
}

/**
 * What has actually been spent on this project, out of the property ledger.
 *
 * property_expenses.project_id has existed since migration 2001 and nothing
 * ever wrote to it, so a renovation's cost lived only inside the project and
 * never reached the money page. It does now: logging a renovation cost writes
 * ONE ledger row tagged to the project, which both views then read.
 *
 * Single-entry on purpose. The alternative — a project expense line here and a
 * matching ledger row there — is two numbers for one payment, and they only
 * have to disagree once to make both untrustworthy.
 */
export function listProjectLedgerCosts(projectId: string): PropertyExpense[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM property_expenses WHERE project_id = ? ORDER BY incurred_on DESC, id DESC`,
    )
    .all(projectId) as Record<string, unknown>[];
  // is_recurring is 0/1 in SQLite but `boolean` in shared/types; coerce here
  // rather than leave consumers on truthiness. See money/expenses.ts.
  return rows.map((row) => ({
    ...mapRow<PropertyExpense>(row),
    isRecurring: Boolean(row["is_recurring"]),
  }));
}

export function toProjectView(project: Project): ProjectView {
  const lines = listProjectLines(project.id);
  const ledgerCosts = listProjectLedgerCosts(project.id);
  const budgetTotalCents = lines.filter((l) => l.kind === "budget").reduce((s, l) => s + l.amountCents, 0);
  // Legacy `expense` lines still count. Nothing creates them any more — the UI
  // logs costs to the ledger — but silently dropping spend somebody recorded
  // before the change would make old projects look under budget.
  const lineCostsCents = lines.filter((l) => l.kind === "expense").reduce((s, l) => s + l.amountCents, 0);
  const actualTotalCents = lineCostsCents + ledgerCosts.reduce((s, e) => s + e.amountCents, 0);
  return {
    ...project,
    owner: userRef(project.ownerId),
    lines,
    ledgerCosts,
    budgetTotalCents,
    actualTotalCents,
    varianceCents: budgetTotalCents - actualTotalCents,
    attachments: listAttachmentsFor("project", project.id),
  };
}

export function listProjects(propertyId: string, status?: string[]): ProjectView[] {
  const clauses = ["property_id = ?"];
  const params: unknown[] = [propertyId];
  if (status && status.length) {
    clauses.push(`status IN (${status.map(() => "?").join(",")})`);
    params.push(...status);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM projects WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`)
    .all(...params) as Record<string, unknown>[];
  return rows.map((r) => toProjectView(mapRow<Project>(r)));
}
