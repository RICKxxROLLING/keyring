// server/domain/projects/repo.ts
import { getDb } from "../../db/index.js";
import { camelRow, camelRows } from "../../lib/rowmap.js";
import { notFound } from "../../lib/errors.js";
import { userRef } from "../common/access.js";
import { listAttachmentsFor } from "../../uploads/storage.js";
import type { Project, ProjectLine, ProjectView } from "../../../shared/types.js";

export function getProjectRow(id: string): Project {
  const row = getDb().prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Project");
  return camelRow<Project>(row);
}

export function listProjectLines(projectId: string): ProjectLine[] {
  const rows = getDb()
    .prepare(`SELECT * FROM project_lines WHERE project_id = ? ORDER BY kind, created_at`)
    .all(projectId) as Record<string, unknown>[];
  return camelRows<ProjectLine>(rows);
}

export function toProjectView(project: Project): ProjectView {
  const lines = listProjectLines(project.id);
  const budgetTotalCents = lines.filter((l) => l.kind === "budget").reduce((s, l) => s + l.amountCents, 0);
  const actualTotalCents = lines.filter((l) => l.kind === "expense").reduce((s, l) => s + l.amountCents, 0);
  return {
    ...project,
    owner: userRef(project.ownerId),
    lines,
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
  return rows.map((r) => toProjectView(camelRow<Project>(r)));
}
