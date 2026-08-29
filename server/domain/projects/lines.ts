// server/domain/projects/lines.ts — budget/actual line items on a project.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import { parseBody, parseParams, zId, zOptText, zText, zIsoDate, zCents, zVersion, IdParamSchema } from "../../lib/validate.js";
import { ok, deleted, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { camelRow, snakeKeys } from "../../lib/rowmap.js";
import { patchWithVersionGuard, assertVersionMatch, recordMutation, recordDelete, publishAfterCommit } from "../common/crud.js";
import { getProjectRow } from "./repo.js";
import type { AppContext } from "../../context.js";
import type { ProjectLine } from "../../../shared/types.js";

const CATEGORIES = ["repair", "capex", "utility", "insurance", "tax", "management", "supplies", "legal", "landscaping", "other"] as const;

const CreateLineSchema = z
  .object({
    kind: z.enum(["budget", "expense"]),
    label: zText(200),
    category: z.enum(CATEGORIES).nullable().optional(),
    amountCents: zCents,
    incurredOn: zIsoDate.nullable().optional(),
    vendorId: zId.nullable().optional(),
    note: zOptText(2000),
  })
  .strict();

const PatchLineSchema = CreateLineSchema.partial().extend({ expectedVersion: zVersion }).strict();

function getLineRow(id: string): ProjectLine {
  const row = getDb().prepare(`SELECT * FROM project_lines WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Project line");
  return camelRow<ProjectLine>(row);
}

export function registerProjectLineRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.post("/api/projects/:id/lines", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { id: projectId } = parseParams(req, IdParamSchema);
    const project = getProjectRow(projectId);
    const body = parseBody(req, CreateLineSchema);
    const id = newId("pln");
    const at = nowIso();
    const line = tx(() => {
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO project_lines (id, project_id, kind, label, category, amount_cents,
           incurred_on, vendor_id, note, created_at, updated_at, created_by, updated_by, version)
         VALUES (@id,@project_id,@kind,@label,@category,@amount_cents,@incurred_on,@vendor_id,
           @note,@created_at,@updated_at,@created_by,@updated_by,1)`,
      ).run({
        id,
        project_id: projectId,
        kind: snake.kind,
        label: snake.label,
        category: snake.category ?? null,
        amount_cents: snake.amount_cents,
        incurred_on: snake.incurred_on ?? null,
        vendor_id: snake.vendor_id ?? null,
        note: snake.note ?? null,
        created_at: at,
        updated_at: at,
        created_by: user.id,
        updated_by: user.id,
      });
      const row = getLineRow(id);
      recordMutation(req, {
        action: "create",
        entityType: "project_line",
        entityId: id,
        propertyId: project.propertyId,
        summary: `added a ${row.kind} line "${row.label}" to project "${project.title}"`,
        after: body as Record<string, unknown>,
      });
      return row;
    });
    publishAfterCommit({
      action: "created",
      entityType: "project_line",
      entityId: id,
      propertyId: project.propertyId,
      version: 1,
      actorId: user.id,
      data: line,
    });
    return reply.code(201).send(ok(line));
  });

  app.patch("/api/project-lines/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchLineSchema);
    const { expectedVersion, ...patch } = body;
    const existing = getLineRow(id);
    const project = getProjectRow(existing.projectId);
    const result = tx(() => {
      const changes = patchWithVersionGuard({ table: "project_lines", id, patch, expectedVersion, actorId: user.id });
      assertVersionMatch({ table: "project_lines", id, changes, what: "Project line", currentView: () => getLineRow(id) });
      const row = getLineRow(id);
      recordMutation(req, {
        action: "update",
        entityType: "project_line",
        entityId: id,
        propertyId: project.propertyId,
        summary: `updated line "${row.label}" on project "${project.title}"`,
        after: patch as Record<string, unknown>,
      });
      return row;
    });
    publishAfterCommit({
      action: "updated",
      entityType: "project_line",
      entityId: id,
      propertyId: project.propertyId,
      version: result.version,
      actorId: user.id,
      data: result,
    });
    return ok(result);
  });

  app.delete("/api/project-lines/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getLineRow(id);
    const project = getProjectRow(existing.projectId);
    tx(() => {
      const info = db.prepare(`DELETE FROM project_lines WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Project line");
      recordDelete(req, {
        action: "delete",
        entityType: "project_line",
        entityId: id,
        propertyId: project.propertyId,
        summary: `deleted line "${existing.label}" from project "${project.title}"`,
      });
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "project_line",
      entityId: id,
      propertyId: project.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });
}
