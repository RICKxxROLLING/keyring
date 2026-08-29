// server/domain/properties/routes.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireRole, requireUser } from "../../auth/middleware.js";
import {
  parseBody,
  parseParams,
  parseQuery,
  zId,
  zIsoDate,
  zIsoDateTime,
  zCents,
  zOptText,
  zText,
  zVersion,
  IdParamSchema,
} from "../../lib/validate.js";
import { ok, deleted, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { onePage } from "../../lib/paging.js";
import { snakeKeys, camelRows } from "../../lib/rowmap.js";
import {
  patchWithVersionGuard,
  assertVersionMatch,
  recordMutation,
  recordDelete,
  publishAfterCommit,
} from "../common/crud.js";
import { getPropertyRow, toPropertyView, listProperties, listUnits } from "./repo.js";
import { requireUploadBelongsTo } from "../../uploads/routes.uploads.js";
import type { AppContext } from "../../context.js";
import type { Unit } from "../../../shared/types.js";

const PropertyTypeEnum = z.enum([
  "single_family",
  "duplex",
  "triplex",
  "fourplex",
  "condo",
  "townhouse",
  "other",
]);

const CreatePropertySchema = z
  .object({
    name: zText(200),
    addressLine1: zText(200),
    addressLine2: zOptText(200),
    city: zText(100),
    state: zText(50),
    postalCode: zText(20),
    country: zText(2).default("US"),
    propertyType: PropertyTypeEnum,
    yearBuilt: z.number().int().min(1600).max(2100).nullable().optional(),
    sqft: z.number().int().nonnegative().nullable().optional(),
    lotSqft: z.number().int().nonnegative().nullable().optional(),
    parcelNumber: zOptText(100),
    purchaseDate: zIsoDate.nullable().optional(),
    purchasePriceCents: zCents.nullable().optional(),
    mortgageLender: zOptText(200),
    mortgagePaymentCents: zCents.nullable().optional(),
    insuranceCarrier: zOptText(200),
    insurancePolicyNumber: zOptText(100),
    coverUploadId: zId.nullable().optional(),
    notes: zOptText(20000),
    sortOrder: z.number().int().default(0),
    archivedAt: zIsoDateTime.nullable().optional(),
  })
  .strict();

const PatchPropertySchema = CreatePropertySchema.partial()
  .extend({ expectedVersion: zVersion })
  .strict();

const ListQuerySchema = z.object({ includeArchived: z.coerce.boolean().default(false) }).strict();

const CreateUnitSchema = z
  .object({
    label: zText(50),
    bedrooms: z.number().int().nonnegative().nullable().optional(),
    bathrooms: z.number().nonnegative().nullable().optional(),
    sqft: z.number().int().nonnegative().nullable().optional(),
    floor: zOptText(30),
    marketRentCents: zCents.nullable().optional(),
    status: z.enum(["occupied", "vacant", "make_ready", "offline"]).default("vacant"),
    notes: zOptText(20000),
    sortOrder: z.number().int().default(0),
  })
  .strict();

const PatchUnitSchema = CreateUnitSchema.partial().extend({ expectedVersion: zVersion }).strict();

export function registerPropertyRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties", { preHandler: [requireAuth] }, async (req) => {
    const q = parseQuery(req, ListQuerySchema);
    return ok(onePage(listProperties(q.includeArchived)));
  });

  app.post("/api/properties", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const body = parseBody(req, CreatePropertySchema);
    const id = newId("prp");
    const at = nowIso();
    const view = tx(() => {
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO properties (id, name, address_line1, address_line2, city, state, postal_code,
           country, property_type, year_built, sqft, lot_sqft, parcel_number, purchase_date,
           purchase_price_cents, mortgage_lender, mortgage_payment_cents, insurance_carrier,
           insurance_policy_number, cover_upload_id, notes, sort_order, archived_at,
           created_at, updated_at, created_by, updated_by, version)
         VALUES (@id, @name, @address_line1, @address_line2, @city, @state, @postal_code,
           @country, @property_type, @year_built, @sqft, @lot_sqft, @parcel_number, @purchase_date,
           @purchase_price_cents, @mortgage_lender, @mortgage_payment_cents, @insurance_carrier,
           @insurance_policy_number, @cover_upload_id, @notes, @sort_order, @archived_at,
           @created_at, @updated_at, @created_by, @updated_by, 1)`,
      ).run({
        id,
        name: snake.name,
        address_line1: snake.address_line1,
        address_line2: snake.address_line2 ?? null,
        city: snake.city,
        state: snake.state,
        postal_code: snake.postal_code,
        country: snake.country ?? "US",
        property_type: snake.property_type,
        year_built: snake.year_built ?? null,
        sqft: snake.sqft ?? null,
        lot_sqft: snake.lot_sqft ?? null,
        parcel_number: snake.parcel_number ?? null,
        purchase_date: snake.purchase_date ?? null,
        purchase_price_cents: snake.purchase_price_cents ?? null,
        mortgage_lender: snake.mortgage_lender ?? null,
        mortgage_payment_cents: snake.mortgage_payment_cents ?? null,
        insurance_carrier: snake.insurance_carrier ?? null,
        insurance_policy_number: snake.insurance_policy_number ?? null,
        cover_upload_id: snake.cover_upload_id ?? null,
        notes: snake.notes ?? null,
        sort_order: snake.sort_order ?? 0,
        archived_at: snake.archived_at ?? null,
        created_at: at,
        updated_at: at,
        created_by: user.id,
        updated_by: user.id,
      });
      const property = getPropertyRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "property",
          entityId: id,
          propertyId: id,
          summary: `created property "${property.name}"`,
          after: body as Record<string, unknown>,
        },
        {
          entityType: "property",
          entityId: id,
          propertyId: id,
          title: property.name,
          body: `${property.addressLine1} ${property.city} ${property.state} ${property.postalCode}`,
          url: `/p/${id}`,
          updatedAt: at,
        },
      );
      return toPropertyView(property);
    });
    publishAfterCommit({
      action: "created",
      entityType: "property",
      entityId: id,
      propertyId: id,
      version: 1,
      actorId: user.id,
      data: view,
    });
    return reply.code(201).send(ok(view));
  });

  app.get("/api/properties/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = parseParams(req, IdParamSchema);
    return ok(toPropertyView(getPropertyRow(id)));
  });

  app.patch("/api/properties/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchPropertySchema);
    const { expectedVersion, ...patch } = body;
    if (patch.coverUploadId) requireUploadBelongsTo(patch.coverUploadId, "property", id);
    const result = tx(() => {
      const changes = patchWithVersionGuard({
        table: "properties",
        id,
        patch,
        expectedVersion,
        actorId: user.id,
      });
      assertVersionMatch({
        table: "properties",
        id,
        changes,
        what: "Property",
        currentView: () => toPropertyView(getPropertyRow(id)),
      });
      const property = getPropertyRow(id);
      const at = nowIso();
      recordMutation(
        req,
        {
          action: "update",
          entityType: "property",
          entityId: id,
          propertyId: id,
          summary: `updated property "${property.name}"`,
          before: null,
          after: patch as Record<string, unknown>,
        },
        {
          entityType: "property",
          entityId: id,
          propertyId: id,
          title: property.name,
          body: `${property.addressLine1} ${property.city} ${property.state} ${property.postalCode}`,
          url: `/p/${id}`,
          updatedAt: at,
        },
      );
      return toPropertyView(property);
    });
    publishAfterCommit({
      action: "updated",
      entityType: "property",
      entityId: id,
      propertyId: id,
      version: result.version,
      actorId: user.id,
      data: result,
    });
    return ok(result);
  });

  app.delete(
    "/api/properties/:id",
    { preHandler: [requireAuth, requireRole("owner")] },
    async (req) => {
      const user = requireUser(req);
      const { id } = parseParams(req, IdParamSchema);
      tx(() => {
        const property = getPropertyRow(id);
        const info = db.prepare(`DELETE FROM properties WHERE id = ?`).run(id);
        if (info.changes === 0) throw notFound("Property");
        recordDelete(
          req,
          {
            action: "delete",
            entityType: "property",
            entityId: id,
            propertyId: id,
            summary: `deleted property "${property.name}"`,
            before: { name: property.name },
          },
          { entityType: "property", entityId: id },
        );
      });
      publishAfterCommit({
        action: "deleted",
        entityType: "property",
        entityId: id,
        propertyId: id,
        version: 0,
        actorId: user.id,
      });
      return deleted(id);
    },
  );

  app.get("/api/properties/:propertyId/units", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    getPropertyRow(propertyId);
    return ok(onePage(listUnits(propertyId)));
  });

  app.post("/api/properties/:propertyId/units", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    getPropertyRow(propertyId);
    const body = parseBody(req, CreateUnitSchema);
    const id = newId("unt");
    const at = nowIso();
    const unit = tx(() => {
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO units (id, property_id, label, bedrooms, bathrooms, sqft, floor,
           market_rent_cents, status, notes, sort_order, created_at, updated_at, created_by,
           updated_by, version)
         VALUES (@id, @property_id, @label, @bedrooms, @bathrooms, @sqft, @floor,
           @market_rent_cents, @status, @notes, @sort_order, @created_at, @updated_at,
           @created_by, @updated_by, 1)`,
      ).run({
        id,
        property_id: propertyId,
        label: snake.label,
        bedrooms: snake.bedrooms ?? null,
        bathrooms: snake.bathrooms ?? null,
        sqft: snake.sqft ?? null,
        floor: snake.floor ?? null,
        market_rent_cents: snake.market_rent_cents ?? null,
        status: snake.status ?? "vacant",
        notes: snake.notes ?? null,
        sort_order: snake.sort_order ?? 0,
        created_at: at,
        updated_at: at,
        created_by: user.id,
        updated_by: user.id,
      });
      const row = camelRows<Unit>(
        db.prepare(`SELECT * FROM units WHERE id = ?`).all(id) as Record<string, unknown>[],
      )[0]!;
      recordMutation(req, {
        action: "create",
        entityType: "unit",
        entityId: id,
        propertyId,
        summary: `added unit "${row.label}"`,
        after: body as Record<string, unknown>,
      });
      return row;
    });
    publishAfterCommit({
      action: "created",
      entityType: "unit",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: unit,
    });
    return reply.code(201).send(ok(unit));
  });

  app.patch("/api/units/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchUnitSchema);
    const { expectedVersion, ...patch } = body;
    const existing = db.prepare(`SELECT property_id FROM units WHERE id = ?`).get(id) as
      | { property_id: string }
      | undefined;
    if (!existing) throw notFound("Unit");
    const getView = (): Unit =>
      camelRows<Unit>(
        db.prepare(`SELECT * FROM units WHERE id = ?`).all(id) as Record<string, unknown>[],
      )[0]!;
    const result = tx(() => {
      const changes = patchWithVersionGuard({
        table: "units",
        id,
        patch,
        expectedVersion,
        actorId: user.id,
      });
      assertVersionMatch({ table: "units", id, changes, what: "Unit", currentView: getView });
      const row = getView();
      recordMutation(req, {
        action: "update",
        entityType: "unit",
        entityId: id,
        propertyId: existing.property_id,
        summary: `updated unit "${row.label}"`,
        after: patch as Record<string, unknown>,
      });
      return row;
    });
    publishAfterCommit({
      action: "updated",
      entityType: "unit",
      entityId: id,
      propertyId: existing.property_id,
      version: result.version,
      actorId: user.id,
      data: result,
    });
    return ok(result);
  });

  app.delete("/api/units/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = db.prepare(`SELECT property_id, label FROM units WHERE id = ?`).get(id) as
      | { property_id: string; label: string }
      | undefined;
    if (!existing) throw notFound("Unit");
    tx(() => {
      const info = db.prepare(`DELETE FROM units WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Unit");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "unit",
          entityId: id,
          propertyId: existing.property_id,
          summary: `deleted unit "${existing.label}"`,
        },
        { entityType: "unit", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "unit",
      entityId: id,
      propertyId: existing.property_id,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });
}
