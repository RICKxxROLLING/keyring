// server/domain/workorders/routes.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import {
  parseBody,
  parseParams,
  parseQuery,
  zId,
  zOptText,
  zText,
  zIsoDate,
  zCents,
  zVersion,
  IdParamSchema,
} from "../../lib/validate.js";
import { ok, deleted, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { onePage } from "../../lib/paging.js";
import { snakeKeys } from "../../lib/rowmap.js";
import { requirePropertyExists } from "../common/access.js";
import {
  patchWithVersionGuard,
  assertVersionMatch,
  recordMutation,
  recordDelete,
  publishAfterCommit,
} from "../common/crud.js";
import { getWorkOrderRow, toWorkOrderView, listWorkOrders, nextWorkOrderNumber } from "./repo.js";
import { notifyMentions, notifyUsers } from "../../seams.js";
import { registerCommentRoutes } from "./comments.js";
import { registerPmRoutes } from "./pm.js";
import type { AppContext } from "../../context.js";
import type { WorkOrderStatus } from "../../../shared/types.js";

const StatusEnum = z.enum(["new", "triaged", "scheduled", "in_progress", "done", "cancelled"]);
const PriorityEnum = z.enum(["low", "normal", "high", "urgent"]);

const CreateWorkOrderSchema = z
  .object({
    unitId: zId.nullable().optional(),
    title: zText(200),
    description: zOptText(20000),
    status: StatusEnum.default("new"),
    priority: PriorityEnum.default("normal"),
    assigneeId: zId.nullable().optional(),
    vendorId: zId.nullable().optional(),
    dueDate: zIsoDate.nullable().optional(),
    scheduledFor: zIsoDate.nullable().optional(),
    completedAt: z.string().nullable().optional(),
    estimateCents: zCents.nullable().optional(),
    costCents: zCents.nullable().optional(),
  })
  .strict();

// See properties/routes.ts for why defaulted fields must be re-declared without a default here.
const PatchWorkOrderSchema = CreateWorkOrderSchema.partial()
  .extend({ status: StatusEnum.optional(), priority: PriorityEnum.optional(), expectedVersion: zVersion })
  .strict();

const ListQuerySchema = z
  .object({
    propertyId: zId.optional(),
    unitId: zId.optional(),
    status: z.string().max(200).optional(),
    priority: z.string().max(100).optional(),
    assigneeId: zId.optional(),
    overdue: z.coerce.boolean().optional(),
    q: z.string().trim().max(200).optional(),
  })
  .strict();

function summarizeChange(before: WorkOrderStatus, after: WorkOrderStatus): string {
  return `changed status ${before} -> ${after}`;
}

export function registerWorkOrderRoutes(app: FastifyInstance, ctx: AppContext): void {
  const db = getDb();

  app.get("/api/work-orders", { preHandler: [requireAuth] }, async (req) => {
    const q = parseQuery(req, ListQuerySchema);
    return ok(
      onePage(
        listWorkOrders({
          propertyId: q.propertyId,
          unitId: q.unitId,
          status: q.status?.split(",").filter(Boolean),
          priority: q.priority?.split(",").filter(Boolean),
          assigneeId: q.assigneeId,
          overdue: q.overdue,
          q: q.q,
        }),
      ),
    );
  });

  app.post(
    "/api/properties/:propertyId/work-orders",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = requireUser(req);
      const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
      requirePropertyExists(propertyId);
      const body = parseBody(req, CreateWorkOrderSchema);
      const id = newId("wo");
      const at = nowIso();
      const view = tx(() => {
        const number = nextWorkOrderNumber(propertyId);
        const snake = snakeKeys(body);
        const status = (snake.status as WorkOrderStatus | undefined) ?? "new";
        db.prepare(
          `INSERT INTO work_orders (id, property_id, unit_id, number, title, description, status,
             priority, assignee_id, vendor_id, due_date, scheduled_for, completed_at,
             estimate_cents, cost_cents, source, pm_template_id, created_at, updated_at,
             created_by, updated_by, version)
           VALUES (@id,@property_id,@unit_id,@number,@title,@description,@status,@priority,
             @assignee_id,@vendor_id,@due_date,@scheduled_for,@completed_at,@estimate_cents,
             @cost_cents,'manual',NULL,@created_at,@updated_at,@created_by,@updated_by,1)`,
        ).run({
          id,
          property_id: propertyId,
          unit_id: snake.unit_id ?? null,
          number,
          title: snake.title,
          description: snake.description ?? null,
          status,
          priority: snake.priority ?? "normal",
          assignee_id: snake.assignee_id ?? null,
          vendor_id: snake.vendor_id ?? null,
          due_date: snake.due_date ?? null,
          scheduled_for: snake.scheduled_for ?? null,
          completed_at: status === "done" ? at : null,
          estimate_cents: snake.estimate_cents ?? null,
          cost_cents: snake.cost_cents ?? null,
          created_at: at,
          updated_at: at,
          created_by: user.id,
          updated_by: user.id,
        });
        const wo = getWorkOrderRow(id);
        recordMutation(
          req,
          {
            action: "create",
            entityType: "work_order",
            entityId: id,
            propertyId,
            summary: `created work order "${wo.title}" (WO-${wo.number})`,
            after: body as Record<string, unknown>,
          },
          {
            entityType: "work_order",
            entityId: id,
            propertyId,
            title: `WO-${wo.number} ${wo.title}`,
            body: wo.description ?? "",
            url: `/p/${propertyId}/maintenance?wo=${id}`,
            updatedAt: at,
          },
        );
        return toWorkOrderView(wo);
      });
      publishAfterCommit({
        action: "created",
        entityType: "work_order",
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
          entityType: "work_order",
          entityId: id,
          contextTitle: view.title,
          url: `/p/${propertyId}/maintenance?wo=${id}`,
        });
      }
      if (view.assigneeId && view.assigneeId !== user.id) {
        notifyUsers({
          userIds: [view.assigneeId],
          type: "assignment",
          title: "Assigned to a work order",
          body: view.title,
          actorUserId: user.id,
          propertyId,
          entityType: "work_order",
          entityId: id,
          url: `/p/${propertyId}/maintenance?wo=${id}`,
        });
      }
      return reply.code(201).send(ok(view));
    },
  );

  app.get("/api/work-orders/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = parseParams(req, IdParamSchema);
    return ok(toWorkOrderView(getWorkOrderRow(id)));
  });

  app.patch("/api/work-orders/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchWorkOrderSchema);
    const { expectedVersion, ...patch } = body;
    const before = getWorkOrderRow(id);

    // status -> completedAt rules are server-enforced, not client-supplied.
    const effectivePatch: Record<string, unknown> = { ...patch };
    if (patch.status !== undefined) {
      effectivePatch.completedAt = patch.status === "done" ? nowIso() : null;
    }

    const view = tx(() => {
      const changes = patchWithVersionGuard({
        table: "work_orders",
        id,
        patch: effectivePatch,
        expectedVersion,
        actorId: user.id,
      });
      assertVersionMatch({
        table: "work_orders",
        id,
        changes,
        what: "Work order",
        currentView: () => toWorkOrderView(getWorkOrderRow(id)),
      });
      const wo = getWorkOrderRow(id);
      const summaryParts: string[] = [];
      if (patch.status !== undefined && patch.status !== before.status) {
        summaryParts.push(summarizeChange(before.status, wo.status));
      }
      if (summaryParts.length === 0) summaryParts.push(`updated work order "${wo.title}"`);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "work_order",
          entityId: id,
          propertyId: wo.propertyId,
          summary: `${summaryParts.join("; ")} on "${wo.title}"`,
          before: patch.status !== undefined ? { status: before.status } : null,
          after: patch as Record<string, unknown>,
        },
        {
          entityType: "work_order",
          entityId: id,
          propertyId: wo.propertyId,
          title: `WO-${wo.number} ${wo.title}`,
          body: wo.description ?? "",
          url: `/p/${wo.propertyId}/maintenance?wo=${id}`,
          updatedAt: nowIso(),
        },
      );
      return toWorkOrderView(wo);
    });
    publishAfterCommit({
      action: "updated",
      entityType: "work_order",
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
        entityType: "work_order",
        entityId: id,
        contextTitle: view.title,
        url: `/p/${view.propertyId}/maintenance?wo=${id}`,
      });
    }
    if (patch.assigneeId !== undefined && view.assigneeId && view.assigneeId !== before.assigneeId && view.assigneeId !== user.id) {
      notifyUsers({
        userIds: [view.assigneeId],
        type: "assignment",
        title: "Assigned to a work order",
        body: view.title,
        actorUserId: user.id,
        propertyId: view.propertyId,
        entityType: "work_order",
        entityId: id,
        url: `/p/${view.propertyId}/maintenance?wo=${id}`,
      });
    }
    if (
      patch.status !== undefined &&
      patch.status !== before.status &&
      view.assigneeId &&
      view.assigneeId !== user.id
    ) {
      notifyUsers({
        userIds: [view.assigneeId],
        type: "work_order_status",
        title: `Work order status: ${view.status}`,
        body: view.title,
        actorUserId: user.id,
        propertyId: view.propertyId,
        entityType: "work_order",
        entityId: id,
        url: `/p/${view.propertyId}/maintenance?wo=${id}`,
      });
    }
    return ok(view);
  });

  app.delete("/api/work-orders/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getWorkOrderRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM work_orders WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Work order");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "work_order",
          entityId: id,
          propertyId: existing.propertyId,
          summary: `deleted work order "${existing.title}" (WO-${existing.number})`,
        },
        { entityType: "work_order", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "work_order",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });

  registerCommentRoutes(app, ctx);
  registerPmRoutes(app, ctx);
}
