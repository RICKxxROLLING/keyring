// server/domain/notes/routes.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import { parseBody, parseParams, parseQuery, zId, zOptText, zText, zVersion, IdParamSchema } from "../../lib/validate.js";
import { ok, deleted, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { onePage } from "../../lib/paging.js";
import { snakeKeys } from "../../lib/rowmap.js";
import { requirePropertyExists } from "../common/access.js";
import { patchWithVersionGuard, assertVersionMatch, recordMutation, recordDelete, publishAfterCommit } from "../common/crud.js";
import { getNoteRow, toNoteView, listNotes } from "./repo.js";
import { notifyMentions } from "../../seams.js";
import type { AppContext } from "../../context.js";

const CreateNoteSchema = z
  .object({
    unitId: zId.nullable().optional(),
    title: zOptText(200),
    body: zText(20000),
    pinned: z.boolean().default(false),
  })
  .strict();

// See properties/routes.ts for why defaulted fields must be re-declared without a default here.
const PatchNoteSchema = CreateNoteSchema.partial()
  .extend({ pinned: z.boolean().optional(), expectedVersion: zVersion })
  .strict();

const ListQuerySchema = z
  .object({
    unitId: zId.optional(),
    pinned: z.coerce.boolean().optional(),
  })
  .strict();

export function registerNoteRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:propertyId/notes", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const q = parseQuery(req, ListQuerySchema);
    return ok(onePage(listNotes(propertyId, q.unitId, q.pinned)));
  });

  app.post("/api/properties/:propertyId/notes", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, CreateNoteSchema);
    const id = newId("not");
    const at = nowIso();
    const view = tx(() => {
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO notes (id, property_id, unit_id, title, body, pinned, created_at, updated_at,
           created_by, updated_by, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(
        id,
        propertyId,
        snake.unit_id ?? null,
        snake.title ?? null,
        snake.body,
        snake.pinned ? 1 : 0,
        at,
        at,
        user.id,
        user.id,
      );
      const note = getNoteRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "note",
          entityId: id,
          propertyId,
          summary: `added a note${note.title ? ` "${note.title}"` : ""}`,
          after: body as Record<string, unknown>,
        },
        {
          entityType: "note",
          entityId: id,
          propertyId,
          title: note.title ?? "Note",
          body: note.body,
          url: `/p/${propertyId}/notes?note=${id}`,
          updatedAt: at,
        },
      );
      return toNoteView(note);
    });
    publishAfterCommit({
      action: "created",
      entityType: "note",
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
      entityType: "note",
      entityId: id,
      contextTitle: view.title ?? "a note",
      url: `/p/${propertyId}/notes?note=${id}`,
    });
    return reply.code(201).send(ok(view));
  });

  app.patch("/api/notes/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchNoteSchema);
    const { expectedVersion, ...patch } = body;
    const view = tx(() => {
      const changes = patchWithVersionGuard({ table: "notes", id, patch, expectedVersion, actorId: user.id });
      assertVersionMatch({
        table: "notes",
        id,
        changes,
        what: "Note",
        currentView: () => toNoteView(getNoteRow(id)),
      });
      const note = getNoteRow(id);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "note",
          entityId: id,
          propertyId: note.propertyId,
          summary: `updated note${note.title ? ` "${note.title}"` : ""}`,
          after: patch as Record<string, unknown>,
        },
        {
          entityType: "note",
          entityId: id,
          propertyId: note.propertyId,
          title: note.title ?? "Note",
          body: note.body,
          url: `/p/${note.propertyId}/notes?note=${id}`,
          updatedAt: nowIso(),
        },
      );
      return toNoteView(note);
    });
    publishAfterCommit({
      action: "updated",
      entityType: "note",
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
        entityType: "note",
        entityId: id,
        contextTitle: view.title ?? "a note",
        url: `/p/${view.propertyId}/notes?note=${id}`,
      });
    }
    return ok(view);
  });

  app.delete("/api/notes/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getNoteRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Note");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "note",
          entityId: id,
          propertyId: existing.propertyId,
          summary: `deleted note${existing.title ? ` "${existing.title}"` : ""}`,
        },
        { entityType: "note", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "note",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });
}
