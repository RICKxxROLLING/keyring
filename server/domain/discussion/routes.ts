// server/domain/discussion/routes.ts — the property discussion thread.
//
// Deliberately thinner than notes. A message has a body, optionally a plus or a
// minus, and an author; it does not have a title, a pin, a unit, or an
// attachment. Everything a note can do that this cannot is a thing that turns a
// conversation into a filing system.
//
// The one rule that is not obvious: you may edit and delete your OWN messages,
// and an owner may delete anyone's. Editing someone else's words in a thread
// that records who said what is not a permission worth having — an owner who
// disagrees can reply.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import { parseBody, parseParams, parseQuery, zId, zText, zVersion, IdParamSchema } from "../../lib/validate.js";
import { ok, deleted, notFound, forbidden } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { onePage } from "../../lib/paging.js";
import { requirePropertyExists, propertyName } from "../common/access.js";
import {
  patchWithVersionGuard,
  assertVersionMatch,
  recordMutation,
  recordDelete,
  publishAfterCommit,
} from "../common/crud.js";
import { getCommentRow, toCommentView, listDiscussion } from "./repo.js";
import { notifyMentions } from "../../seams.js";
import type { AppContext } from "../../context.js";

const zSentiment = z.enum(["like", "dislike"]).nullable().optional();

const CreateCommentSchema = z
  .object({
    body: zText(8000).min(1, "Say something."),
    sentiment: zSentiment,
  })
  .strict();

const PatchCommentSchema = z
  .object({
    body: zText(8000).min(1, "Say something.").optional(),
    sentiment: zSentiment,
    expectedVersion: zVersion,
  })
  .strict();

export function registerDiscussionRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:propertyId/discussion", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const q = parseQuery(
      req,
      z.object({ limit: z.coerce.number().int().min(1).max(500).default(500) }).strict(),
    );
    return ok(onePage(listDiscussion(propertyId, q.limit)));
  });

  app.post("/api/properties/:propertyId/discussion", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, CreateCommentSchema);
    const id = newId("pcm");
    const at = nowIso();
    const url = `/p/${propertyId}/discussion?message=${id}`;

    const view = tx(() => {
      db.prepare(
        `INSERT INTO property_comments (id, property_id, body, sentiment, created_at, updated_at,
           created_by, updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(id, propertyId, body.body, body.sentiment ?? null, at, at, user.id, user.id);
      const row = getCommentRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "property_comment",
          entityId: id,
          propertyId,
          summary: sentimentSummary(row.sentiment, propertyName(propertyId)),
          after: body as Record<string, unknown>,
        },
        {
          entityType: "property_comment",
          entityId: id,
          propertyId,
          title: `Discussion — ${propertyName(propertyId)}`,
          body: row.body,
          url,
          updatedAt: at,
        },
      );
      return toCommentView(row);
    });

    publishAfterCommit({
      action: "created",
      entityType: "property_comment",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: view,
    });
    notifyMentions({
      actorUserId: user.id,
      actorLabel: user.displayName,
      bodyText: view.body,
      propertyId,
      entityType: "property_comment",
      entityId: id,
      contextTitle: "the discussion",
      url,
    });
    return reply.code(201).send(ok(view));
  });

  app.patch("/api/property-comments/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getCommentRow(id);
    // Not even an owner. See the header.
    if (existing.createdBy !== user.id) {
      throw forbidden("You can only edit your own messages.");
    }
    const { expectedVersion, ...patch } = parseBody(req, PatchCommentSchema);

    const view = tx(() => {
      const changes = patchWithVersionGuard({
        table: "property_comments",
        id,
        patch,
        expectedVersion,
        actorId: user.id,
      });
      assertVersionMatch({
        table: "property_comments",
        id,
        changes,
        what: "Comment",
        currentView: () => toCommentView(getCommentRow(id)),
      });
      const row = getCommentRow(id);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "property_comment",
          entityId: id,
          propertyId: row.propertyId,
          summary: `edited a message in the discussion on "${propertyName(row.propertyId)}"`,
          after: patch as Record<string, unknown>,
        },
        {
          entityType: "property_comment",
          entityId: id,
          propertyId: row.propertyId,
          title: `Discussion — ${propertyName(row.propertyId)}`,
          body: row.body,
          url: `/p/${row.propertyId}/discussion?message=${id}`,
          updatedAt: nowIso(),
        },
      );
      return toCommentView(row);
    });

    publishAfterCommit({
      action: "updated",
      entityType: "property_comment",
      entityId: id,
      propertyId: view.propertyId,
      version: view.version,
      actorId: user.id,
      data: view,
    });
    if (patch.body !== undefined) {
      notifyMentions({
        actorUserId: user.id,
        actorLabel: user.displayName,
        bodyText: view.body,
        propertyId: view.propertyId,
        entityType: "property_comment",
        entityId: id,
        contextTitle: "the discussion",
        url: `/p/${view.propertyId}/discussion?message=${id}`,
      });
    }
    return ok(view);
  });

  app.delete("/api/property-comments/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getCommentRow(id);
    if (existing.createdBy !== user.id && user.role !== "owner") {
      throw forbidden("You can only delete your own messages.");
    }
    tx(() => {
      const info = db.prepare(`DELETE FROM property_comments WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Comment");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "property_comment",
          entityId: id,
          propertyId: existing.propertyId,
          summary: `deleted a message from the discussion on "${propertyName(existing.propertyId)}"`,
        },
        { entityType: "property_comment", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "property_comment",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });
}

function sentimentSummary(sentiment: string | null, name: string): string {
  if (sentiment === "like") return `noted something they like about "${name}"`;
  if (sentiment === "dislike") return `noted a concern about "${name}"`;
  return `posted in the discussion on "${name}"`;
}
