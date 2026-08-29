// server/domain/vendors/routes.ts — portfolio-wide (propertyId: null on audit/publish).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import { parseBody, parseParams, parseQuery, zOptText, zText, zIsoDate, zVersion, IdParamSchema } from "../../lib/validate.js";
import { ok, deleted, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { onePage } from "../../lib/paging.js";
import { snakeKeys } from "../../lib/rowmap.js";
import { patchWithVersionGuard, assertVersionMatch, recordMutation, recordDelete, publishAfterCommit } from "../common/crud.js";
import { getVendorRow, listVendors } from "./repo.js";
import type { AppContext } from "../../context.js";

const CreateVendorSchema = z
  .object({
    name: zText(200),
    company: zOptText(200),
    trade: zText(100),
    phone: zOptText(40),
    email: zOptText(200),
    website: zOptText(300),
    address: zOptText(300),
    notes: zOptText(20000),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    preferred: z.boolean().default(false),
    licenseNumber: zOptText(100),
    insuranceExpiresOn: zIsoDate.nullable().optional(),
    archivedAt: z.string().nullable().optional(),
  })
  .strict();

const PatchVendorSchema = CreateVendorSchema.partial().extend({ expectedVersion: zVersion }).strict();

const ListQuerySchema = z
  .object({ q: z.string().trim().max(200).optional(), trade: z.string().trim().max(100).optional(), includeArchived: z.coerce.boolean().default(false) })
  .strict();

export function registerVendorRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/vendors", { preHandler: [requireAuth] }, async (req) => {
    const q = parseQuery(req, ListQuerySchema);
    return ok(onePage(listVendors(q)));
  });

  app.post("/api/vendors", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const body = parseBody(req, CreateVendorSchema);
    const id = newId("ven");
    const at = nowIso();
    const vendor = tx(() => {
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO vendors (id, name, company, trade, phone, email, website, address, notes,
           rating, preferred, license_number, insurance_expires_on, archived_at, created_at,
           updated_at, created_by, updated_by, version)
         VALUES (@id,@name,@company,@trade,@phone,@email,@website,@address,@notes,@rating,
           @preferred,@license_number,@insurance_expires_on,@archived_at,@created_at,@updated_at,
           @created_by,@updated_by,1)`,
      ).run({
        id,
        name: snake.name,
        company: snake.company ?? null,
        trade: snake.trade,
        phone: snake.phone ?? null,
        email: snake.email ?? null,
        website: snake.website ?? null,
        address: snake.address ?? null,
        notes: snake.notes ?? null,
        rating: snake.rating ?? null,
        preferred: snake.preferred ? 1 : 0,
        license_number: snake.license_number ?? null,
        insurance_expires_on: snake.insurance_expires_on ?? null,
        archived_at: snake.archived_at ?? null,
        created_at: at,
        updated_at: at,
        created_by: user.id,
        updated_by: user.id,
      });
      const row = getVendorRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "vendor",
          entityId: id,
          propertyId: null,
          summary: `added vendor "${row.name}"`,
          after: body as Record<string, unknown>,
        },
        {
          entityType: "vendor",
          entityId: id,
          propertyId: null,
          title: row.name,
          body: `${row.trade} ${row.company ?? ""}`,
          url: `/vendors?vendor=${id}`,
          updatedAt: at,
        },
      );
      return row;
    });
    publishAfterCommit({
      action: "created",
      entityType: "vendor",
      entityId: id,
      propertyId: null,
      version: 1,
      actorId: user.id,
      data: vendor,
    });
    return reply.code(201).send(ok(vendor));
  });

  app.get("/api/vendors/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = parseParams(req, IdParamSchema);
    return ok(getVendorRow(id));
  });

  app.patch("/api/vendors/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchVendorSchema);
    const { expectedVersion, ...patch } = body;
    const result = tx(() => {
      const changes = patchWithVersionGuard({ table: "vendors", id, patch, expectedVersion, actorId: user.id });
      assertVersionMatch({ table: "vendors", id, changes, what: "Vendor", currentView: () => getVendorRow(id) });
      const row = getVendorRow(id);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "vendor",
          entityId: id,
          propertyId: null,
          summary: `updated vendor "${row.name}"`,
          after: patch as Record<string, unknown>,
        },
        {
          entityType: "vendor",
          entityId: id,
          propertyId: null,
          title: row.name,
          body: `${row.trade} ${row.company ?? ""}`,
          url: `/vendors?vendor=${id}`,
          updatedAt: nowIso(),
        },
      );
      return row;
    });
    publishAfterCommit({
      action: "updated",
      entityType: "vendor",
      entityId: id,
      propertyId: null,
      version: result.version,
      actorId: user.id,
      data: result,
    });
    return ok(result);
  });

  app.delete("/api/vendors/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getVendorRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM vendors WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Vendor");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "vendor",
          entityId: id,
          propertyId: null,
          summary: `deleted vendor "${existing.name}"`,
        },
        { entityType: "vendor", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "vendor",
      entityId: id,
      propertyId: null,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });
}
