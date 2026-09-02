// server/domain/diligence/routes.ts — the pre-purchase checklist.
//
// The interesting endpoint is POST .../diligence/checklist, which applies the
// suggested starting list. It is idempotent BY LABEL: applying it twice does
// not duplicate anything, and applying it to a property where someone already
// added "Elevation certificate" by hand leaves their item — with whatever they
// have already written on it — alone.
//
// That matters more than it looks. The obvious implementation ("only seed if
// the list is empty") fails the case people actually hit: they add two items
// themselves, then want the rest of the standard list. This one adds the rest.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import {
  parseBody,
  parseParams,
  zId,
  zIsoDate,
  zOptText,
  zText,
  zVersion,
  IdParamSchema,
} from "../../lib/validate.js";
import { ok, deleted, notFound, conflict } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { onePage } from "../../lib/paging.js";
import { snakeKeys } from "../../lib/rowmap.js";
import { requirePropertyExists, propertyName } from "../common/access.js";
import {
  patchWithVersionGuard,
  assertVersionMatch,
  recordMutation,
  recordDelete,
  publishAfterCommit,
} from "../common/crud.js";
import { getUploadRow } from "../../uploads/storage.js";
import { getDiligenceRow, toDiligenceView, listDiligence, nextSortOrder } from "./repo.js";
import { DILIGENCE_TEMPLATE } from "../../../shared/diligence-checklist.js";
import type { AppContext } from "../../context.js";
import type { DiligenceItemView } from "../../../shared/types.js";

const CATEGORIES = ["permits", "land", "structure", "financial", "legal", "other"] as const;
const STATUSES = [
  "todo",
  "requested",
  "received",
  "verified",
  "blocked",
  "not_applicable",
] as const;

const CreateSchema = z
  .object({
    label: zText(200).min(1, "Give it a name."),
    category: z.enum(CATEGORIES).default("other"),
    status: z.enum(STATUSES).default("todo"),
    detail: zOptText(4000),
    finding: zOptText(4000),
    sourceUrl: zOptText(600),
    dueDate: zIsoDate.nullable().optional(),
    assigneeId: zId.nullable().optional(),
    uploadId: zId.nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

// Defaulted fields are re-declared without their defaults: a PATCH that omits
// `status` must leave it alone, not reset it to 'todo'.
const PatchSchema = CreateSchema.partial()
  .extend({
    category: z.enum(CATEGORIES).optional(),
    status: z.enum(STATUSES).optional(),
    expectedVersion: zVersion,
  })
  .strict();

export function registerDiligenceRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  /** An attached document must exist and belong to this property. */
  function checkUpload(uploadId: string | null | undefined, propertyId: string): void {
    if (!uploadId) return;
    const row = getUploadRow(uploadId);
    if (!row) throw notFound("Upload");
    if (row.propertyId !== propertyId) {
      throw conflict("That document belongs to a different property.");
    }
  }

  app.get("/api/properties/:propertyId/diligence", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    return ok(onePage(listDiligence(propertyId)));
  });

  app.post("/api/properties/:propertyId/diligence", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, CreateSchema);
    checkUpload(body.uploadId, propertyId);

    const id = newId("dil");
    const at = nowIso();
    const view = tx(() => {
      const snake = snakeKeys(body);
      insertItem(db, {
        id,
        property_id: propertyId,
        label: snake.label as string,
        category: snake.category as string,
        status: snake.status as string,
        detail: (snake.detail as string | undefined) ?? null,
        finding: (snake.finding as string | undefined) ?? null,
        source_url: (snake.source_url as string | undefined) ?? null,
        due_date: (snake.due_date as string | undefined) ?? null,
        assignee_id: (snake.assignee_id as string | undefined) ?? null,
        upload_id: (snake.upload_id as string | undefined) ?? null,
        sort_order: (snake.sort_order as number | undefined) ?? nextSortOrder(propertyId),
        at,
        actor: user.id,
      });
      const row = getDiligenceRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "diligence_item",
          entityId: id,
          propertyId,
          summary: `added "${row.label}" to the checklist for "${propertyName(propertyId)}"`,
          after: body as Record<string, unknown>,
        },
        {
          entityType: "diligence_item",
          entityId: id,
          propertyId,
          title: row.label,
          body: [row.detail, row.finding].filter(Boolean).join(" "),
          url: `/p/${propertyId}/diligence?item=${id}`,
          updatedAt: at,
        },
      );
      return toDiligenceView(row);
    });

    publishAfterCommit({
      action: "created",
      entityType: "diligence_item",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: view,
    });
    return reply.code(201).send(ok(view));
  });

  /**
   * Apply the suggested checklist, adding only what is missing.
   *
   * Matching is on the trimmed, case-folded label. Not an id: the template is
   * source code that will be edited, and pinning saved rows to template ids
   * would mean a reworded line silently reappears as a duplicate.
   */
  app.post(
    "/api/properties/:propertyId/diligence/checklist",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = requireUser(req);
      const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
      requirePropertyExists(propertyId);

      const at = nowIso();
      const result = tx(() => {
        const existing = new Set(
          listDiligence(propertyId).map((i) => i.label.trim().toLowerCase()),
        );
        let order = nextSortOrder(propertyId);
        const added: DiligenceItemView[] = [];

        for (const t of DILIGENCE_TEMPLATE) {
          if (existing.has(t.label.trim().toLowerCase())) continue;
          const id = newId("dil");
          insertItem(db, {
            id,
            property_id: propertyId,
            label: t.label,
            category: t.category,
            status: "todo",
            detail: t.detail,
            finding: null,
            source_url: null,
            due_date: null,
            assignee_id: null,
            upload_id: null,
            sort_order: order++,
            at,
            actor: user.id,
          });
          added.push(toDiligenceView(getDiligenceRow(id)));
        }

        if (added.length > 0) {
          // One audit entry for the batch. Twenty near-identical rows would
          // bury whatever else happened that afternoon.
          recordMutation(req, {
            action: "create",
            entityType: "diligence_item",
            entityId: propertyId,
            propertyId,
            summary: `added ${added.length} standard checklist ${
              added.length === 1 ? "item" : "items"
            } to "${propertyName(propertyId)}"`,
            after: { labels: added.map((i) => i.label) },
          });
        }
        return { added, skipped: DILIGENCE_TEMPLATE.length - added.length };
      });

      for (const item of result.added) {
        publishAfterCommit({
          action: "created",
          entityType: "diligence_item",
          entityId: item.id,
          propertyId,
          version: 1,
          actorId: user.id,
          data: item,
        });
      }
      return reply.code(201).send(ok(result));
    },
  );

  app.patch("/api/diligence-items/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getDiligenceRow(id);
    const { expectedVersion, ...patch } = parseBody(req, PatchSchema);
    checkUpload(patch.uploadId, existing.propertyId);

    const view = tx(() => {
      const changes = patchWithVersionGuard({
        table: "diligence_items",
        id,
        patch,
        expectedVersion,
        actorId: user.id,
      });
      assertVersionMatch({
        table: "diligence_items",
        id,
        changes,
        what: "Checklist item",
        currentView: () => toDiligenceView(getDiligenceRow(id)),
      });
      const row = getDiligenceRow(id);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "diligence_item",
          entityId: id,
          propertyId: row.propertyId,
          summary:
            patch.status && patch.status !== existing.status
              ? `moved "${row.label}" to ${patch.status.replace("_", " ")}`
              : `updated "${row.label}" on the checklist`,
          after: patch as Record<string, unknown>,
        },
        {
          entityType: "diligence_item",
          entityId: id,
          propertyId: row.propertyId,
          title: row.label,
          body: [row.detail, row.finding].filter(Boolean).join(" "),
          url: `/p/${row.propertyId}/diligence?item=${id}`,
          updatedAt: nowIso(),
        },
      );
      return toDiligenceView(row);
    });

    publishAfterCommit({
      action: "updated",
      entityType: "diligence_item",
      entityId: id,
      propertyId: view.propertyId,
      version: view.version,
      actorId: user.id,
      data: view,
    });
    return ok(view);
  });

  app.delete("/api/diligence-items/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getDiligenceRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM diligence_items WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Checklist item");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "diligence_item",
          entityId: id,
          propertyId: existing.propertyId,
          summary: `removed "${existing.label}" from the checklist`,
        },
        { entityType: "diligence_item", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "diligence_item",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });
}

interface InsertArgs {
  id: string;
  property_id: string;
  label: string;
  category: string;
  status: string;
  detail: string | null;
  finding: string | null;
  source_url: string | null;
  due_date: string | null;
  assignee_id: string | null;
  upload_id: string | null;
  sort_order: number;
  at: string;
  actor: string;
}

function insertItem(db: ReturnType<typeof getDb>, a: InsertArgs): void {
  db.prepare(
    `INSERT INTO diligence_items (id, property_id, label, category, status, detail, finding,
       source_url, due_date, assignee_id, upload_id, sort_order, created_at, updated_at,
       created_by, updated_by, version)
     VALUES (@id,@property_id,@label,@category,@status,@detail,@finding,@source_url,@due_date,
       @assignee_id,@upload_id,@sort_order,@at,@at,@actor,@actor,1)`,
  ).run(a as unknown as Record<string, unknown>);
}
