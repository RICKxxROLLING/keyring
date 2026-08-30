// server/domain/compliance/routes.ts
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
import { getComplianceRow, toComplianceView, listCompliance, advanceComplianceDate } from "./repo.js";
import type { AppContext } from "../../context.js";

const KINDS = ["insurance", "tax", "inspection", "license", "hoa", "permit", "other"] as const;
const RECURRENCE = ["none", "monthly", "quarterly", "semiannual", "annual"] as const;

const CreateComplianceSchema = z
  .object({
    unitId: zId.nullable().optional(),
    kind: z.enum(KINDS),
    title: zText(200),
    authority: zOptText(200),
    reference: zOptText(200),
    dueDate: zIsoDate,
    leadDays: z.number().int().nonnegative().default(30),
    recurrence: z.enum(RECURRENCE).default("none"),
    state: z.enum(["open", "done", "waived"]).default("open"),
    completedOn: zIsoDate.nullable().optional(),
    costCents: zCents.nullable().optional(),
    vendorId: zId.nullable().optional(),
    notes: zOptText(20000),
  })
  .strict();

const PatchComplianceSchema = CreateComplianceSchema.partial().extend({ expectedVersion: zVersion }).strict();

const CompleteSchema = z
  .object({ completedOn: zIsoDate, costCents: zCents.optional(), expectedVersion: zVersion })
  .strict();

export function registerComplianceRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:propertyId/compliance", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const q = parseQuery(req, z.object({ state: z.string().max(200).optional(), kind: z.string().max(200).optional() }).strict());
    return ok(onePage(listCompliance(propertyId, q.state?.split(",").filter(Boolean), q.kind?.split(",").filter(Boolean))));
  });

  app.post("/api/properties/:propertyId/compliance", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, CreateComplianceSchema);
    const id = newId("cmp");
    const at = nowIso();
    const view = tx(() => {
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO compliance_items (id, property_id, unit_id, kind, title, authority,
           reference, due_date, lead_days, recurrence, state, completed_on, cost_cents,
           vendor_id, notes, created_at, updated_at, created_by, updated_by, version)
         VALUES (@id,@property_id,@unit_id,@kind,@title,@authority,@reference,@due_date,
           @lead_days,@recurrence,@state,@completed_on,@cost_cents,@vendor_id,@notes,
           @created_at,@updated_at,@created_by,@updated_by,1)`,
      ).run({
        id,
        property_id: propertyId,
        unit_id: snake.unit_id ?? null,
        kind: snake.kind,
        title: snake.title,
        authority: snake.authority ?? null,
        reference: snake.reference ?? null,
        due_date: snake.due_date,
        lead_days: snake.lead_days ?? 30,
        recurrence: snake.recurrence ?? "none",
        state: snake.state ?? "open",
        completed_on: snake.completed_on ?? null,
        cost_cents: snake.cost_cents ?? null,
        vendor_id: snake.vendor_id ?? null,
        notes: snake.notes ?? null,
        created_at: at,
        updated_at: at,
        created_by: user.id,
        updated_by: user.id,
      });
      const item = getComplianceRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "compliance_item",
          entityId: id,
          propertyId,
          summary: `added compliance item "${item.title}"`,
          after: body as Record<string, unknown>,
        },
        {
          entityType: "compliance_item",
          entityId: id,
          propertyId,
          title: item.title,
          body: `${item.kind} ${item.authority ?? ""} ${item.reference ?? ""}`,
          url: `/p/${propertyId}/compliance?item=${id}`,
          updatedAt: at,
        },
      );
      return toComplianceView(item);
    });
    publishAfterCommit({
      action: "created",
      entityType: "compliance_item",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: view,
    });
    return reply.code(201).send(ok(view));
  });

  app.patch("/api/compliance/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchComplianceSchema);
    const { expectedVersion, ...patch } = body;
    const view = tx(() => {
      const changes = patchWithVersionGuard({ table: "compliance_items", id, patch, expectedVersion, actorId: user.id });
      assertVersionMatch({
        table: "compliance_items",
        id,
        changes,
        what: "Compliance item",
        currentView: () => toComplianceView(getComplianceRow(id)),
      });
      const item = getComplianceRow(id);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "compliance_item",
          entityId: id,
          propertyId: item.propertyId,
          summary: `updated compliance item "${item.title}"`,
          after: patch as Record<string, unknown>,
        },
        {
          entityType: "compliance_item",
          entityId: id,
          propertyId: item.propertyId,
          title: item.title,
          body: `${item.kind} ${item.authority ?? ""} ${item.reference ?? ""}`,
          url: `/p/${item.propertyId}/compliance?item=${id}`,
          updatedAt: nowIso(),
        },
      );
      return toComplianceView(item);
    });
    publishAfterCommit({
      action: "updated",
      entityType: "compliance_item",
      entityId: id,
      propertyId: view.propertyId,
      version: view.version,
      actorId: user.id,
      data: view,
    });
    return ok(view);
  });

  app.delete("/api/compliance/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getComplianceRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM compliance_items WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Compliance item");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "compliance_item",
          entityId: id,
          propertyId: existing.propertyId,
          summary: `deleted compliance item "${existing.title}"`,
        },
        { entityType: "compliance_item", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "compliance_item",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });

  app.post("/api/compliance/:id/complete", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, CompleteSchema);
    let nextId: string | null = null;
    const view = tx(() => {
      const changes = patchWithVersionGuard({
        table: "compliance_items",
        id,
        patch: { state: "done", completedOn: body.completedOn, costCents: body.costCents ?? null },
        expectedVersion: body.expectedVersion,
        actorId: user.id,
      });
      assertVersionMatch({
        table: "compliance_items",
        id,
        changes,
        what: "Compliance item",
        currentView: () => toComplianceView(getComplianceRow(id)),
      });
      const item = getComplianceRow(id);
      recordMutation(req, {
        action: "update",
        entityType: "compliance_item",
        entityId: id,
        propertyId: item.propertyId,
        summary: `completed compliance item "${item.title}"`,
        after: { state: "done", completedOn: body.completedOn },
      });

      if (item.recurrence !== "none") {
        const newDueDate = advanceComplianceDate(item.dueDate, item.recurrence);
        nextId = newId("cmp");
        const at = nowIso();
        db.prepare(
          `INSERT INTO compliance_items (id, property_id, unit_id, kind, title, authority,
             reference, due_date, lead_days, recurrence, state, completed_on, cost_cents,
             vendor_id, notes, created_at, updated_at, created_by, updated_by, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, ?, ?, ?, ?, ?, ?, 1)`,
        ).run(
          nextId,
          item.propertyId,
          item.unitId,
          item.kind,
          item.title,
          item.authority,
          item.reference,
          newDueDate,
          item.leadDays,
          item.recurrence,
          item.vendorId,
          item.notes,
          at,
          at,
          user.id,
          user.id,
        );
        recordMutation(
          req,
          {
            action: "create",
            entityType: "compliance_item",
            entityId: nextId,
            propertyId: item.propertyId,
            summary: `next occurrence of "${item.title}" due ${newDueDate}`,
            after: { dueDate: newDueDate, recurrence: item.recurrence },
          },
          {
            entityType: "compliance_item",
            entityId: nextId,
            propertyId: item.propertyId,
            title: item.title,
            body: `${item.kind} ${item.authority ?? ""} ${item.reference ?? ""}`,
            url: `/p/${item.propertyId}/compliance?item=${nextId}`,
            updatedAt: at,
          },
        );
      }
      return toComplianceView(item);
    });
    publishAfterCommit({
      action: "updated",
      entityType: "compliance_item",
      entityId: id,
      propertyId: view.propertyId,
      version: view.version,
      actorId: user.id,
      data: view,
    });
    if (nextId) {
      publishAfterCommit({
        action: "created",
        entityType: "compliance_item",
        entityId: nextId,
        propertyId: view.propertyId,
        version: 1,
        actorId: user.id,
      });
    }
    return ok(view);
  });
}
