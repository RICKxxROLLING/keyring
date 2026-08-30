// server/domain/projects/routes.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import { parseBody, parseParams, parseQuery, zId, zOptText, zText, zIsoDate, zCents, zVersion, IdParamSchema } from "../../lib/validate.js";
import { ok, deleted, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { onePage } from "../../lib/paging.js";
import { snakeKeys } from "../../lib/rowmap.js";
import { requirePropertyExists } from "../common/access.js";
import { patchWithVersionGuard, assertVersionMatch, recordMutation, recordDelete, publishAfterCommit } from "../common/crud.js";
import { getProjectRow, toProjectView, listProjects } from "./repo.js";
import { registerProjectLineRoutes } from "./lines.js";
import { notifyMentions } from "../../seams.js";
import type { AppContext } from "../../context.js";

const StatusEnum = z.enum(["idea", "planning", "quoted", "approved", "in_progress", "blocked", "done", "cancelled"]);
const PriorityEnum = z.enum(["low", "normal", "high", "urgent"]);

const CreateProjectSchema = z
  .object({
    title: zText(200),
    description: zOptText(20000),
    status: StatusEnum.default("idea"),
    priority: PriorityEnum.default("normal"),
    ownerId: zId.nullable().optional(),
    targetStart: zIsoDate.nullable().optional(),
    targetEnd: zIsoDate.nullable().optional(),
    actualStart: zIsoDate.nullable().optional(),
    actualEnd: zIsoDate.nullable().optional(),
    budgetCents: zCents.nullable().optional(),
  })
  .strict();

// See properties/routes.ts for why defaulted fields must be re-declared without a default here.
const PatchProjectSchema = CreateProjectSchema.partial()
  .extend({ status: StatusEnum.optional(), priority: PriorityEnum.optional(), expectedVersion: zVersion })
  .strict();

export function registerProjectRoutes(app: FastifyInstance, ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:propertyId/projects", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const q = parseQuery(req, z.object({ status: z.string().max(200).optional() }).strict());
    return ok(onePage(listProjects(propertyId, q.status?.split(",").filter(Boolean))));
  });

  app.post("/api/properties/:propertyId/projects", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, CreateProjectSchema);
    const id = newId("prj");
    const at = nowIso();
    const view = tx(() => {
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO projects (id, property_id, title, description, status, priority, owner_id,
           target_start, target_end, actual_start, actual_end, budget_cents, created_at,
           updated_at, created_by, updated_by, version)
         VALUES (@id,@property_id,@title,@description,@status,@priority,@owner_id,@target_start,
           @target_end,@actual_start,@actual_end,@budget_cents,@created_at,@updated_at,
           @created_by,@updated_by,1)`,
      ).run({
        id,
        property_id: propertyId,
        title: snake.title,
        description: snake.description ?? null,
        status: snake.status ?? "idea",
        priority: snake.priority ?? "normal",
        owner_id: snake.owner_id ?? null,
        target_start: snake.target_start ?? null,
        target_end: snake.target_end ?? null,
        actual_start: snake.actual_start ?? null,
        actual_end: snake.actual_end ?? null,
        budget_cents: snake.budget_cents ?? null,
        created_at: at,
        updated_at: at,
        created_by: user.id,
        updated_by: user.id,
      });
      const project = getProjectRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "project",
          entityId: id,
          propertyId,
          summary: `created project "${project.title}"`,
          after: body as Record<string, unknown>,
        },
        {
          entityType: "project",
          entityId: id,
          propertyId,
          title: project.title,
          body: project.description ?? "",
          url: `/p/${propertyId}/projects?project=${id}`,
          updatedAt: at,
        },
      );
      return toProjectView(project);
    });
    publishAfterCommit({
      action: "created",
      entityType: "project",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: view,
    });
    if (view.description) {
      notifyMentions({
        actorUserId: user.id,
        actorLabel: user.displayName,
        bodyText: view.description,
        propertyId,
        entityType: "project",
        entityId: id,
        contextTitle: view.title,
        url: `/p/${propertyId}/projects?project=${id}`,
      });
    }
    return reply.code(201).send(ok(view));
  });

  app.get("/api/projects/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = parseParams(req, IdParamSchema);
    return ok(toProjectView(getProjectRow(id)));
  });

  app.patch("/api/projects/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchProjectSchema);
    const { expectedVersion, ...patch } = body;
    const view = tx(() => {
      const changes = patchWithVersionGuard({ table: "projects", id, patch, expectedVersion, actorId: user.id });
      assertVersionMatch({
        table: "projects",
        id,
        changes,
        what: "Project",
        currentView: () => toProjectView(getProjectRow(id)),
      });
      const project = getProjectRow(id);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "project",
          entityId: id,
          propertyId: project.propertyId,
          summary: `updated project "${project.title}"`,
          after: patch as Record<string, unknown>,
        },
        {
          entityType: "project",
          entityId: id,
          propertyId: project.propertyId,
          title: project.title,
          body: project.description ?? "",
          url: `/p/${project.propertyId}/projects?project=${id}`,
          updatedAt: nowIso(),
        },
      );
      return toProjectView(project);
    });
    publishAfterCommit({
      action: "updated",
      entityType: "project",
      entityId: id,
      propertyId: view.propertyId,
      version: view.version,
      actorId: user.id,
      data: view,
    });
    if (patch.description !== undefined && view.description) {
      notifyMentions({
        actorUserId: user.id,
        actorLabel: user.displayName,
        bodyText: view.description,
        propertyId: view.propertyId,
        entityType: "project",
        entityId: id,
        contextTitle: view.title,
        url: `/p/${view.propertyId}/projects?project=${id}`,
      });
    }
    return ok(view);
  });

  app.delete("/api/projects/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getProjectRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Project");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "project",
          entityId: id,
          propertyId: existing.propertyId,
          summary: `deleted project "${existing.title}"`,
        },
        { entityType: "project", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "project",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });

  registerProjectLineRoutes(app, ctx);
}
