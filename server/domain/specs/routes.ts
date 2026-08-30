// server/domain/specs/routes.ts — building spec vault, including secret gate/lockbox codes.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import { parseBody, parseParams, parseQuery, zId, zOptText, zText, zIsoDate, IdParamSchema } from "../../lib/validate.js";
import { ok, deleted, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { onePage } from "../../lib/paging.js";
import { snakeKeys } from "../../lib/rowmap.js";
import { requirePropertyExists } from "../common/access.js";
import { patchWithVersionGuard, assertVersionMatch, recordMutation, recordDelete, publishAfterCommit } from "../common/crud.js";
import { writeAudit } from "../../audit/audit.js";
import { getSpecRow, toSpecView, listSpecs } from "./repo.js";
import { zVersion } from "../../lib/validate.js";
import type { AppContext } from "../../context.js";

const CATEGORIES = ["appliance", "filter", "paint", "shutoff", "code", "warranty", "utility", "other"] as const;

const CreateSpecSchema = z
  .object({
    unitId: zId.nullable().optional(),
    category: z.enum(CATEGORIES),
    label: zText(120),
    make: zOptText(100),
    model: zOptText(100),
    serial: zOptText(100),
    value: zOptText(2000),
    location: zOptText(200),
    isSecret: z.boolean().default(false),
    installedOn: zIsoDate.nullable().optional(),
    warrantyExpiresOn: zIsoDate.nullable().optional(),
    vendorId: zId.nullable().optional(),
    notes: zOptText(20000),
  })
  .strict();

// See properties/routes.ts for why defaulted fields must be re-declared without a default here.
const PatchSpecSchema = CreateSpecSchema.partial()
  .extend({ isSecret: z.boolean().optional(), expectedVersion: zVersion })
  .strict();

/** Never let a secret's value leak into an audit payload. */
function auditSafe(body: Record<string, unknown>, isSecret: boolean): Record<string, unknown> {
  if (!isSecret) return body;
  const { value: _value, ...rest } = body;
  return rest;
}

export function registerSpecRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:propertyId/specs", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const q = parseQuery(req, z.object({ category: z.string().max(200).optional(), unitId: zId.optional() }).strict());
    return ok(onePage(listSpecs(propertyId, q.category?.split(",").filter(Boolean), q.unitId)));
  });

  app.post("/api/properties/:propertyId/specs", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, CreateSpecSchema);
    const id = newId("spc");
    const at = nowIso();
    const view = tx(() => {
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO spec_entries (id, property_id, unit_id, category, label, make, model,
           serial, value, location, is_secret, installed_on, warranty_expires_on, vendor_id,
           notes, created_at, updated_at, created_by, updated_by, version)
         VALUES (@id,@property_id,@unit_id,@category,@label,@make,@model,@serial,@value,
           @location,@is_secret,@installed_on,@warranty_expires_on,@vendor_id,@notes,
           @created_at,@updated_at,@created_by,@updated_by,1)`,
      ).run({
        id,
        property_id: propertyId,
        unit_id: snake.unit_id ?? null,
        category: snake.category,
        label: snake.label,
        make: snake.make ?? null,
        model: snake.model ?? null,
        serial: snake.serial ?? null,
        value: snake.value ?? null,
        location: snake.location ?? null,
        is_secret: body.isSecret ? 1 : 0,
        installed_on: snake.installed_on ?? null,
        warranty_expires_on: snake.warranty_expires_on ?? null,
        vendor_id: snake.vendor_id ?? null,
        notes: snake.notes ?? null,
        created_at: at,
        updated_at: at,
        created_by: user.id,
        updated_by: user.id,
      });
      const spec = getSpecRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "spec_entry",
          entityId: id,
          propertyId,
          summary: `added spec "${spec.label}"${body.isSecret ? " (secret)" : ""}`,
          after: auditSafe(body as Record<string, unknown>, body.isSecret),
        },
        {
          entityType: "spec_entry",
          entityId: id,
          propertyId,
          title: spec.label,
          body: `${spec.category} ${spec.make ?? ""} ${spec.model ?? ""} ${spec.location ?? ""} ${body.isSecret ? "" : (spec.value ?? "")}`,
          url: `/p/${propertyId}/specs?spec=${id}`,
          updatedAt: at,
        },
      );
      return toSpecView(spec);
    });
    publishAfterCommit({
      action: "created",
      entityType: "spec_entry",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: view,
    });
    return reply.code(201).send(ok(view));
  });

  app.patch("/api/specs/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchSpecSchema);
    const { expectedVersion, ...patch } = body;
    const before = getSpecRow(id);
    const isSecretAfter = patch.isSecret ?? before.isSecret;
    const view = tx(() => {
      const changes = patchWithVersionGuard({ table: "spec_entries", id, patch, expectedVersion, actorId: user.id });
      assertVersionMatch({
        table: "spec_entries",
        id,
        changes,
        what: "Spec entry",
        currentView: () => toSpecView(getSpecRow(id)),
      });
      const spec = getSpecRow(id);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "spec_entry",
          entityId: id,
          propertyId: spec.propertyId,
          summary: `updated spec "${spec.label}"`,
          after: auditSafe(patch as Record<string, unknown>, isSecretAfter),
        },
        {
          entityType: "spec_entry",
          entityId: id,
          propertyId: spec.propertyId,
          title: spec.label,
          body: `${spec.category} ${spec.make ?? ""} ${spec.model ?? ""} ${spec.location ?? ""} ${isSecretAfter ? "" : (spec.value ?? "")}`,
          url: `/p/${spec.propertyId}/specs?spec=${id}`,
          updatedAt: nowIso(),
        },
      );
      return toSpecView(spec);
    });
    publishAfterCommit({
      action: "updated",
      entityType: "spec_entry",
      entityId: id,
      propertyId: view.propertyId,
      version: view.version,
      actorId: user.id,
      data: view,
    });
    return ok(view);
  });

  app.delete("/api/specs/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getSpecRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM spec_entries WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Spec entry");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "spec_entry",
          entityId: id,
          propertyId: existing.propertyId,
          summary: `deleted spec "${existing.label}"`,
        },
        { entityType: "spec_entry", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "spec_entry",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });

  app.post("/api/specs/:id/reveal", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const spec = getSpecRow(id);
    tx(() => {
      writeAudit({
        actorUserId: user.id,
        actorLabel: user.displayName,
        action: "secret_revealed",
        entityType: "spec_entry",
        entityId: id,
        propertyId: spec.propertyId,
        summary: `revealed secret value for "${spec.label}"`,
        // Deliberately no before/after payload: the revealed value must never appear in audit_log.
      });
    });
    return ok({ id, value: spec.value ?? "" });
  });
}
