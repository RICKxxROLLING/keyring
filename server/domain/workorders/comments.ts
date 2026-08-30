// server/domain/workorders/comments.ts — work order comment thread.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import { parseBody, parseParams, zText, zVersion, IdParamSchema } from "../../lib/validate.js";
import { ok, deleted, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { onePage } from "../../lib/paging.js";
import { mapRow } from "../common/rowmap.js";
import { userRef } from "../common/access.js";
import { listAttachmentsFor } from "../../uploads/storage.js";
import {
  patchWithVersionGuard,
  assertVersionMatch,
  recordMutation,
  recordDelete,
  publishAfterCommit,
} from "../common/crud.js";
import { getWorkOrderRow } from "./repo.js";
import { notifyMentions } from "../../seams.js";
import type { AppContext } from "../../context.js";
import type { WorkOrderComment, WorkOrderCommentView } from "../../../shared/types.js";

const CreateCommentSchema = z.object({ body: zText(20000) }).strict();
const PatchCommentSchema = z.object({ body: zText(20000), expectedVersion: zVersion }).strict();

function getCommentRow(id: string): WorkOrderComment {
  const row = getDb().prepare(`SELECT * FROM work_order_comments WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Comment");
  return mapRow<WorkOrderComment>(row);
}

function toView(c: WorkOrderComment): WorkOrderCommentView {
  return {
    ...c,
    author: userRef(c.createdBy),
    attachments: listAttachmentsFor("work_order", c.workOrderId),
  };
}

export function registerCommentRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/work-orders/:id/comments", { preHandler: [requireAuth] }, async (req) => {
    const { id } = parseParams(req, IdParamSchema);
    getWorkOrderRow(id);
    const rows = db
      .prepare(`SELECT * FROM work_order_comments WHERE work_order_id = ? ORDER BY created_at`)
      .all(id) as Record<string, unknown>[];
    return ok(onePage(rows.map((r) => toView(mapRow<WorkOrderComment>(r)))));
  });

  app.post("/api/work-orders/:id/comments", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { id: workOrderId } = parseParams(req, IdParamSchema);
    const wo = getWorkOrderRow(workOrderId);
    const body = parseBody(req, CreateCommentSchema);
    const id = newId("woc");
    const at = nowIso();
    const view = tx(() => {
      db.prepare(
        `INSERT INTO work_order_comments (id, work_order_id, body, created_at, updated_at,
           created_by, updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(id, workOrderId, body.body, at, at, user.id, user.id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "work_order_comment",
          entityId: id,
          propertyId: wo.propertyId,
          summary: `commented on "${wo.title}"`,
          after: { body: body.body },
        },
        {
          entityType: "work_order_comment",
          entityId: id,
          propertyId: wo.propertyId,
          title: `Comment on WO-${wo.number}`,
          body: body.body,
          url: `/p/${wo.propertyId}/maintenance?wo=${workOrderId}`,
          updatedAt: at,
        },
      );
      return toView(getCommentRow(id));
    });
    publishAfterCommit({
      action: "created",
      entityType: "work_order_comment",
      entityId: id,
      propertyId: wo.propertyId,
      version: 1,
      actorId: user.id,
      data: view,
    });
    notifyMentions({
      actorUserId: user.id,
      actorLabel: user.displayName,
      bodyText: view.body,
      propertyId: wo.propertyId,
      entityType: "work_order_comment",
      entityId: id,
      contextTitle: wo.title,
      url: `/p/${wo.propertyId}/maintenance?wo=${workOrderId}`,
    });
    return reply.code(201).send(ok(view));
  });

  app.patch("/api/work-order-comments/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchCommentSchema);
    const existing = getCommentRow(id);
    const wo = getWorkOrderRow(existing.workOrderId);
    const view = tx(() => {
      const changes = patchWithVersionGuard({
        table: "work_order_comments",
        id,
        patch: { body: body.body },
        expectedVersion: body.expectedVersion,
        actorId: user.id,
      });
      assertVersionMatch({
        table: "work_order_comments",
        id,
        changes,
        what: "Comment",
        currentView: () => toView(getCommentRow(id)),
      });
      const row = getCommentRow(id);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "work_order_comment",
          entityId: id,
          propertyId: wo.propertyId,
          summary: `edited a comment on "${wo.title}"`,
          after: { body: body.body },
        },
        {
          entityType: "work_order_comment",
          entityId: id,
          propertyId: wo.propertyId,
          title: `Comment on WO-${wo.number}`,
          body: row.body,
          url: `/p/${wo.propertyId}/maintenance?wo=${wo.id}`,
          updatedAt: nowIso(),
        },
      );
      return toView(row);
    });
    publishAfterCommit({
      action: "updated",
      entityType: "work_order_comment",
      entityId: id,
      propertyId: wo.propertyId,
      version: view.version,
      actorId: user.id,
      data: view,
    });
    notifyMentions({
      actorUserId: user.id,
      actorLabel: user.displayName,
      bodyText: view.body,
      propertyId: wo.propertyId,
      entityType: "work_order_comment",
      entityId: id,
      contextTitle: wo.title,
      url: `/p/${wo.propertyId}/maintenance?wo=${wo.id}`,
    });
    return ok(view);
  });

  app.delete("/api/work-order-comments/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getCommentRow(id);
    const wo = getWorkOrderRow(existing.workOrderId);
    tx(() => {
      const info = db.prepare(`DELETE FROM work_order_comments WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Comment");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "work_order_comment",
          entityId: id,
          propertyId: wo.propertyId,
          summary: `deleted a comment on "${wo.title}"`,
        },
        { entityType: "work_order_comment", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "work_order_comment",
      entityId: id,
      propertyId: wo.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });
}
