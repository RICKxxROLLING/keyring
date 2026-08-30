// server/domain/tenants/leases.ts — leases + tenant linkage + unit occupancy side-effects.
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
import { requirePropertyExists, requireUnitExists, unitLabel } from "../common/access.js";
import { requireUploadBelongsTo } from "../../uploads/routes.uploads.js";
import {
  patchWithVersionGuard,
  assertVersionMatch,
  recordMutation,
  recordDelete,
  publishAfterCommit,
} from "../common/crud.js";
import { getLeaseRow, toLeaseView, listLeases, markUnitOccupied, markUnitVacantIfNoActiveLease } from "./repo.js";
import type { AppContext } from "../../context.js";

const CreateLeaseSchema = z
  .object({
    unitId: zId,
    startDate: zIsoDate,
    endDate: zIsoDate.nullable().optional(),
    rentCents: zCents,
    depositCents: zCents.default(0),
    dueDay: z.number().int().min(1).max(28).default(1),
    status: z.enum(["upcoming", "active", "ended", "terminated"]).default("active"),
    renewalNoticeDays: z.number().int().nonnegative().default(60),
    documentUploadId: zId.nullable().optional(),
    notes: zOptText(20000),
    tenantIds: z.array(zId).default([]),
  })
  .strict();

// zod re-applies a field's .default(...) for any omitted key even through .partial()'s
// .optional() wrapper, which would otherwise silently reset depositCents/dueDay/status/
// renewalNoticeDays/tenantIds to their create-time defaults on every unrelated PATCH (for
// tenantIds specifically: unlinking every tenant from the lease). Re-declare each without a
// default so an omitted key truly stays untouched, per §C4's PatchInput contract.
const PatchLeaseSchema = CreateLeaseSchema.partial()
  .extend({
    depositCents: zCents.optional(),
    dueDay: z.number().int().min(1).max(28).optional(),
    status: z.enum(["upcoming", "active", "ended", "terminated"]).optional(),
    renewalNoticeDays: z.number().int().nonnegative().optional(),
    tenantIds: z.array(zId).optional(),
    expectedVersion: zVersion,
  })
  .strict();

function setLeaseTenants(leaseId: string, tenantIds: string[]): void {
  const db = getDb();
  db.prepare(`DELETE FROM lease_tenants WHERE lease_id = ?`).run(leaseId);
  const stmt = db.prepare(`INSERT INTO lease_tenants (lease_id, tenant_id) VALUES (?, ?)`);
  for (const tid of tenantIds) stmt.run(leaseId, tid);
}

/** Publishes the unit's own entity event after a lease-driven occupancy change. */
function publishUnitChange(unitId: string, propertyId: string, actorId: string): void {
  const db = getDb();
  const unit = db.prepare(`SELECT version FROM units WHERE id = ?`).get(unitId) as
    | { version: number }
    | undefined;
  publishAfterCommit({
    action: "updated",
    entityType: "unit",
    entityId: unitId,
    propertyId,
    version: unit?.version ?? 0,
    actorId,
  });
}

export function registerLeaseRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:propertyId/leases", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const q = parseQuery(req, z.object({ unitId: zId.optional(), status: z.string().max(200).optional() }).strict());
    return ok(onePage(listLeases(propertyId, q.unitId, q.status?.split(",").filter(Boolean))));
  });

  app.post("/api/properties/:propertyId/leases", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, CreateLeaseSchema);
    requireUnitExists(body.unitId, propertyId);
    const id = newId("lse");
    if (body.documentUploadId) requireUploadBelongsTo(body.documentUploadId, "lease", id);
    const at = nowIso();
    let unitChanged = false;
    const view = tx(() => {
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO leases (id, property_id, unit_id, start_date, end_date, rent_cents,
           deposit_cents, due_day, status, renewal_notice_days, document_upload_id, notes,
           created_at, updated_at, created_by, updated_by, version)
         VALUES (@id,@property_id,@unit_id,@start_date,@end_date,@rent_cents,@deposit_cents,
           @due_day,@status,@renewal_notice_days,@document_upload_id,@notes,@created_at,
           @updated_at,@created_by,@updated_by,1)`,
      ).run({
        id,
        property_id: propertyId,
        unit_id: body.unitId,
        start_date: body.startDate,
        end_date: body.endDate ?? null,
        rent_cents: body.rentCents,
        deposit_cents: body.depositCents,
        due_day: body.dueDay,
        status: body.status,
        renewal_notice_days: body.renewalNoticeDays,
        document_upload_id: body.documentUploadId ?? null,
        notes: snake.notes ?? null,
        created_at: at,
        updated_at: at,
        created_by: user.id,
        updated_by: user.id,
      });
      setLeaseTenants(id, body.tenantIds);
      if (body.status === "active") {
        unitChanged = markUnitOccupied(body.unitId, user.id);
      }
      const lease = getLeaseRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "lease",
          entityId: id,
          propertyId,
          summary: `created a lease for ${unitLabel(body.unitId)}`,
          after: { unitId: body.unitId, startDate: body.startDate, status: body.status },
        },
        {
          entityType: "lease",
          entityId: id,
          propertyId,
          title: `Lease: ${unitLabel(body.unitId)}`,
          body: `${body.startDate} to ${body.endDate ?? "month-to-month"}`,
          url: `/p/${propertyId}/tenants?lease=${id}`,
          updatedAt: at,
        },
      );
      return toLeaseView(lease);
    });
    publishAfterCommit({
      action: "created",
      entityType: "lease",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: view,
    });
    if (unitChanged) publishUnitChange(body.unitId, propertyId, user.id);
    return reply.code(201).send(ok(view));
  });

  app.get("/api/leases/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = parseParams(req, IdParamSchema);
    return ok(toLeaseView(getLeaseRow(id)));
  });

  app.patch("/api/leases/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchLeaseSchema);
    const { expectedVersion, tenantIds, ...patch } = body;
    const before = getLeaseRow(id);
    if (patch.documentUploadId) requireUploadBelongsTo(patch.documentUploadId, "lease", id);
    let unitChanged = false;
    const view = tx(() => {
      const changes = patchWithVersionGuard({
        table: "leases",
        id,
        patch,
        expectedVersion,
        actorId: user.id,
      });
      assertVersionMatch({
        table: "leases",
        id,
        changes,
        what: "Lease",
        currentView: () => toLeaseView(getLeaseRow(id)),
      });
      if (tenantIds !== undefined) setLeaseTenants(id, tenantIds);
      const lease = getLeaseRow(id);
      if (patch.status !== undefined && patch.status !== before.status) {
        if (patch.status === "active") {
          unitChanged = markUnitOccupied(lease.unitId, user.id);
        } else if (before.status === "active") {
          unitChanged = markUnitVacantIfNoActiveLease(lease.unitId, user.id);
        }
      }
      recordMutation(
        req,
        {
          action: "update",
          entityType: "lease",
          entityId: id,
          propertyId: lease.propertyId,
          summary: `updated lease for ${unitLabel(lease.unitId)}`,
          after: patch as Record<string, unknown>,
        },
        {
          entityType: "lease",
          entityId: id,
          propertyId: lease.propertyId,
          title: `Lease: ${unitLabel(lease.unitId)}`,
          body: `${lease.startDate} to ${lease.endDate ?? "month-to-month"}`,
          url: `/p/${lease.propertyId}/tenants?lease=${id}`,
          updatedAt: nowIso(),
        },
      );
      return lease;
    });
    const fullView = toLeaseView(view);
    publishAfterCommit({
      action: "updated",
      entityType: "lease",
      entityId: id,
      propertyId: view.propertyId,
      version: view.version,
      actorId: user.id,
      data: fullView,
    });
    if (unitChanged) publishUnitChange(view.unitId, view.propertyId, user.id);
    return ok(fullView);
  });

  app.delete("/api/leases/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getLeaseRow(id);
    let unitChanged = false;
    tx(() => {
      const info = db.prepare(`DELETE FROM leases WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Lease");
      if (existing.status === "active") {
        unitChanged = markUnitVacantIfNoActiveLease(existing.unitId, user.id);
      }
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "lease",
          entityId: id,
          propertyId: existing.propertyId,
          summary: `deleted lease for ${unitLabel(existing.unitId)}`,
        },
        { entityType: "lease", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "lease",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    if (unitChanged) publishUnitChange(existing.unitId, existing.propertyId, user.id);
    return deleted(id);
  });

}
