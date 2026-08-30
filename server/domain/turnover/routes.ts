// server/domain/turnover/routes.ts
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
import { mapRow } from "../common/rowmap.js";
import { requirePropertyExists, requireUnitExists, unitLabel } from "../common/access.js";
import { patchWithVersionGuard, assertVersionMatch, recordMutation, recordDelete, publishAfterCommit } from "../common/crud.js";
import { getTurnoverRow, toTurnoverView, listTurnovers, DEFAULT_TURNOVER_ITEMS } from "./repo.js";
import type { AppContext } from "../../context.js";
import type { TurnoverItem } from "../../../shared/types.js";

const PHASES = ["move_out", "make_ready", "move_in", "complete"] as const;

const CreateTurnoverSchema = z
  .object({
    unitId: zId,
    phase: z.enum(PHASES).default("move_out"),
    moveOutDate: zIsoDate.nullable().optional(),
    targetReadyDate: zIsoDate.nullable().optional(),
    moveInDate: zIsoDate.nullable().optional(),
    outgoingLeaseId: zId.nullable().optional(),
    incomingLeaseId: zId.nullable().optional(),
    depositHeldCents: zCents.default(0),
    depositWithheldCents: zCents.default(0),
    depositReturnedCents: zCents.default(0),
    depositReturnedOn: zIsoDate.nullable().optional(),
    depositNotes: zOptText(20000),
    conditionNotes: zOptText(20000),
    closedAt: z.string().nullable().optional(),
  })
  .strict();

// See properties/routes.ts for why defaulted fields must be re-declared without a default here.
const PatchTurnoverSchema = CreateTurnoverSchema.partial()
  .extend({
    phase: z.enum(PHASES).optional(),
    depositHeldCents: zCents.optional(),
    depositWithheldCents: zCents.optional(),
    depositReturnedCents: zCents.optional(),
    expectedVersion: zVersion,
  })
  .strict();

const CreateItemSchema = z
  .object({
    phase: z.enum(PHASES),
    label: zText(300),
    done: z.boolean().default(false),
    costCents: zCents.nullable().optional(),
    note: zOptText(2000),
    workOrderId: zId.nullable().optional(),
    sortOrder: z.number().int().default(0),
  })
  .strict();

const PatchItemSchema = z
  .object({
    phase: z.enum(PHASES).optional(),
    label: zText(300).optional(),
    done: z.boolean().optional(),
    costCents: zCents.nullable().optional(),
    note: zOptText(2000),
    workOrderId: zId.nullable().optional(),
    sortOrder: z.number().int().optional(),
    expectedVersion: zVersion,
  })
  .strict();

function getItemRow(id: string): TurnoverItem {
  const row = getDb().prepare(`SELECT * FROM turnover_items WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Turnover item");
  return mapRow<TurnoverItem>(row);
}

export function registerTurnoverRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:propertyId/turnovers", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const q = parseQuery(req, z.object({ unitId: zId.optional(), open: z.coerce.boolean().optional() }).strict());
    return ok(onePage(listTurnovers(propertyId, q.unitId, q.open)));
  });

  app.post("/api/properties/:propertyId/turnovers", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, CreateTurnoverSchema);
    requireUnitExists(body.unitId, propertyId);
    const id = newId("trn");
    const at = nowIso();
    const view = tx(() => {
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO turnovers (id, property_id, unit_id, phase, move_out_date,
           target_ready_date, move_in_date, outgoing_lease_id, incoming_lease_id,
           deposit_held_cents, deposit_withheld_cents, deposit_returned_cents,
           deposit_returned_on, deposit_notes, condition_notes, closed_at, created_at,
           updated_at, created_by, updated_by, version)
         VALUES (@id,@property_id,@unit_id,@phase,@move_out_date,@target_ready_date,
           @move_in_date,@outgoing_lease_id,@incoming_lease_id,@deposit_held_cents,
           @deposit_withheld_cents,@deposit_returned_cents,@deposit_returned_on,
           @deposit_notes,@condition_notes,@closed_at,@created_at,@updated_at,@created_by,
           @updated_by,1)`,
      ).run({
        id,
        property_id: propertyId,
        unit_id: body.unitId,
        phase: body.phase,
        move_out_date: snake.move_out_date ?? null,
        target_ready_date: snake.target_ready_date ?? null,
        move_in_date: snake.move_in_date ?? null,
        outgoing_lease_id: snake.outgoing_lease_id ?? null,
        incoming_lease_id: snake.incoming_lease_id ?? null,
        deposit_held_cents: body.depositHeldCents,
        deposit_withheld_cents: body.depositWithheldCents,
        deposit_returned_cents: body.depositReturnedCents,
        deposit_returned_on: snake.deposit_returned_on ?? null,
        deposit_notes: snake.deposit_notes ?? null,
        condition_notes: snake.condition_notes ?? null,
        closed_at: snake.closed_at ?? null,
        created_at: at,
        updated_at: at,
        created_by: user.id,
        updated_by: user.id,
      });
      const itemStmt = db.prepare(
        `INSERT INTO turnover_items (id, turnover_id, phase, label, done, done_at, done_by,
           cost_cents, note, work_order_id, sort_order, created_at, updated_at, created_by,
           updated_by, version)
         VALUES (?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, 1)`,
      );
      DEFAULT_TURNOVER_ITEMS.forEach((item, idx) => {
        itemStmt.run(newId("tri"), id, item.phase, item.label, idx, at, at, user.id, user.id);
      });
      const turnover = getTurnoverRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "turnover",
          entityId: id,
          propertyId,
          summary: `started a turnover for ${unitLabel(body.unitId)}`,
          after: { unitId: body.unitId, phase: body.phase },
        },
        {
          entityType: "turnover",
          entityId: id,
          propertyId,
          title: `Turnover: ${unitLabel(body.unitId)}`,
          body: body.conditionNotes ?? "",
          url: `/p/${propertyId}/turnover?turnover=${id}`,
          updatedAt: at,
        },
      );
      return toTurnoverView(turnover);
    });
    publishAfterCommit({
      action: "created",
      entityType: "turnover",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: view,
    });
    return reply.code(201).send(ok(view));
  });

  app.get("/api/turnovers/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = parseParams(req, IdParamSchema);
    return ok(toTurnoverView(getTurnoverRow(id)));
  });

  app.patch("/api/turnovers/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchTurnoverSchema);
    const { expectedVersion, ...patch } = body;
    const view = tx(() => {
      const changes = patchWithVersionGuard({ table: "turnovers", id, patch, expectedVersion, actorId: user.id });
      assertVersionMatch({
        table: "turnovers",
        id,
        changes,
        what: "Turnover",
        currentView: () => toTurnoverView(getTurnoverRow(id)),
      });
      const t = getTurnoverRow(id);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "turnover",
          entityId: id,
          propertyId: t.propertyId,
          summary: `updated turnover for ${unitLabel(t.unitId)}`,
          after: patch as Record<string, unknown>,
        },
        {
          entityType: "turnover",
          entityId: id,
          propertyId: t.propertyId,
          title: `Turnover: ${unitLabel(t.unitId)}`,
          body: t.conditionNotes ?? "",
          url: `/p/${t.propertyId}/turnover?turnover=${id}`,
          updatedAt: nowIso(),
        },
      );
      return toTurnoverView(t);
    });
    publishAfterCommit({
      action: "updated",
      entityType: "turnover",
      entityId: id,
      propertyId: view.propertyId,
      version: view.version,
      actorId: user.id,
      data: view,
    });
    return ok(view);
  });

  app.delete("/api/turnovers/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getTurnoverRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM turnovers WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Turnover");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "turnover",
          entityId: id,
          propertyId: existing.propertyId,
          summary: `deleted turnover for ${unitLabel(existing.unitId)}`,
        },
        { entityType: "turnover", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "turnover",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });

  app.post("/api/turnovers/:id/items", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { id: turnoverId } = parseParams(req, IdParamSchema);
    const turnover = getTurnoverRow(turnoverId);
    const body = parseBody(req, CreateItemSchema);
    const id = newId("tri");
    const at = nowIso();
    const item = tx(() => {
      db.prepare(
        `INSERT INTO turnover_items (id, turnover_id, phase, label, done, done_at, done_by,
           cost_cents, note, work_order_id, sort_order, created_at, updated_at, created_by,
           updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(
        id,
        turnoverId,
        body.phase,
        body.label,
        body.done ? 1 : 0,
        body.done ? at : null,
        body.done ? user.id : null,
        body.costCents ?? null,
        body.note ?? null,
        body.workOrderId ?? null,
        body.sortOrder,
        at,
        at,
        user.id,
        user.id,
      );
      recordMutation(req, {
        action: "create",
        entityType: "turnover_item",
        entityId: id,
        propertyId: turnover.propertyId,
        summary: `added checklist item "${body.label}"`,
        after: body as Record<string, unknown>,
      });
      return getItemRow(id);
    });
    publishAfterCommit({
      action: "created",
      entityType: "turnover_item",
      entityId: id,
      propertyId: turnover.propertyId,
      version: 1,
      actorId: user.id,
      data: item,
    });
    return reply.code(201).send(ok(item));
  });

  app.patch("/api/turnover-items/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchItemSchema);
    const { expectedVersion, done, ...rest } = body;
    const existing = getItemRow(id);
    const turnover = getTurnoverRow(existing.turnoverId);
    const effectivePatch: Record<string, unknown> = { ...rest };
    if (done !== undefined) {
      effectivePatch.done = done;
      effectivePatch.doneAt = done ? nowIso() : null;
      effectivePatch.doneBy = done ? user.id : null;
    }
    const result = tx(() => {
      const changes = patchWithVersionGuard({ table: "turnover_items", id, patch: effectivePatch, expectedVersion, actorId: user.id });
      assertVersionMatch({ table: "turnover_items", id, changes, what: "Turnover item", currentView: () => getItemRow(id) });
      const row = getItemRow(id);
      recordMutation(req, {
        action: "update",
        entityType: "turnover_item",
        entityId: id,
        propertyId: turnover.propertyId,
        summary: `updated checklist item "${row.label}"`,
        after: body as Record<string, unknown>,
      });
      return row;
    });
    publishAfterCommit({
      action: "updated",
      entityType: "turnover_item",
      entityId: id,
      propertyId: turnover.propertyId,
      version: result.version,
      actorId: user.id,
      data: result,
    });
    return ok(result);
  });

  app.delete("/api/turnover-items/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getItemRow(id);
    const turnover = getTurnoverRow(existing.turnoverId);
    tx(() => {
      const info = db.prepare(`DELETE FROM turnover_items WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Turnover item");
      recordDelete(req, {
        action: "delete",
        entityType: "turnover_item",
        entityId: id,
        propertyId: turnover.propertyId,
        summary: `deleted checklist item "${existing.label}"`,
      });
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "turnover_item",
      entityId: id,
      propertyId: turnover.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });
}
