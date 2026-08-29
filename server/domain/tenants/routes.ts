// server/domain/tenants/routes.ts
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
import { getTenantRow, listTenants } from "./repo.js";
import { registerLeaseRoutes } from "./leases.js";
import type { AppContext } from "../../context.js";
import { zVersion } from "../../lib/validate.js";

const CreateTenantSchema = z
  .object({
    unitId: zId.nullable().optional(),
    firstName: zText(100),
    lastName: zText(100),
    email: zOptText(200),
    phone: zOptText(40),
    emergencyContactName: zOptText(100),
    emergencyContactPhone: zOptText(40),
    notes: zOptText(20000),
    isPrimary: z.boolean().default(true),
    movedInAt: zIsoDate.nullable().optional(),
    movedOutAt: zIsoDate.nullable().optional(),
  })
  .strict();

const PatchTenantSchema = CreateTenantSchema.partial().extend({ expectedVersion: zVersion }).strict();

export function registerTenantRoutes(app: FastifyInstance, ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:propertyId/tenants", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const q = parseQuery(req, z.object({ unitId: zId.optional(), current: z.coerce.boolean().optional() }).strict());
    return ok(onePage(listTenants(propertyId, q.unitId, q.current)));
  });

  app.post("/api/properties/:propertyId/tenants", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, CreateTenantSchema);
    const id = newId("ten");
    const at = nowIso();
    const tenant = tx(() => {
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO tenants (id, property_id, unit_id, first_name, last_name, email, phone,
           emergency_contact_name, emergency_contact_phone, notes, is_primary, moved_in_at,
           moved_out_at, created_at, updated_at, created_by, updated_by, version)
         VALUES (@id,@property_id,@unit_id,@first_name,@last_name,@email,@phone,
           @emergency_contact_name,@emergency_contact_phone,@notes,@is_primary,@moved_in_at,
           @moved_out_at,@created_at,@updated_at,@created_by,@updated_by,1)`,
      ).run({
        id,
        property_id: propertyId,
        unit_id: snake.unit_id ?? null,
        first_name: snake.first_name,
        last_name: snake.last_name,
        email: snake.email ?? null,
        phone: snake.phone ?? null,
        emergency_contact_name: snake.emergency_contact_name ?? null,
        emergency_contact_phone: snake.emergency_contact_phone ?? null,
        notes: snake.notes ?? null,
        is_primary: snake.is_primary === false ? 0 : 1,
        moved_in_at: snake.moved_in_at ?? null,
        moved_out_at: snake.moved_out_at ?? null,
        created_at: at,
        updated_at: at,
        created_by: user.id,
        updated_by: user.id,
      });
      const row = getTenantRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "tenant",
          entityId: id,
          propertyId,
          summary: `added tenant ${row.firstName} ${row.lastName}`,
          after: { firstName: row.firstName, lastName: row.lastName },
        },
        {
          entityType: "tenant",
          entityId: id,
          propertyId,
          title: `${row.firstName} ${row.lastName}`,
          body: `${row.email ?? ""} ${row.phone ?? ""}`,
          url: `/p/${propertyId}/tenants?tenant=${id}`,
          updatedAt: at,
        },
      );
      return row;
    });
    publishAfterCommit({
      action: "created",
      entityType: "tenant",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: tenant,
    });
    return reply.code(201).send(ok(tenant));
  });

  app.patch("/api/tenants/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchTenantSchema);
    const { expectedVersion, ...patch } = body;
    const result = tx(() => {
      const changes = patchWithVersionGuard({ table: "tenants", id, patch, expectedVersion, actorId: user.id });
      assertVersionMatch({ table: "tenants", id, changes, what: "Tenant", currentView: () => getTenantRow(id) });
      const row = getTenantRow(id);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "tenant",
          entityId: id,
          propertyId: row.propertyId,
          summary: `updated tenant ${row.firstName} ${row.lastName}`,
          after: patch as Record<string, unknown>,
        },
        {
          entityType: "tenant",
          entityId: id,
          propertyId: row.propertyId,
          title: `${row.firstName} ${row.lastName}`,
          body: `${row.email ?? ""} ${row.phone ?? ""}`,
          url: `/p/${row.propertyId}/tenants?tenant=${id}`,
          updatedAt: nowIso(),
        },
      );
      return row;
    });
    publishAfterCommit({
      action: "updated",
      entityType: "tenant",
      entityId: id,
      propertyId: result.propertyId,
      version: result.version,
      actorId: user.id,
      data: result,
    });
    return ok(result);
  });

  app.delete("/api/tenants/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getTenantRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM tenants WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Tenant");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "tenant",
          entityId: id,
          propertyId: existing.propertyId,
          summary: `deleted tenant ${existing.firstName} ${existing.lastName}`,
        },
        { entityType: "tenant", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "tenant",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });

  registerLeaseRoutes(app, ctx);
}
