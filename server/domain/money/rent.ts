// server/domain/money/rent.ts — rent roll: per-unit-per-period rent entries.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import { parseBody, parseParams, parseQuery, zId, zOptText, zPeriod, zIsoDate, zCents, zVersion, IdParamSchema } from "../../lib/validate.js";
import { ok, deleted, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso, todayLocal, periodOf } from "../../lib/time.js";
import { getEnv } from "../../config/env.js";
import { onePage, buildPage } from "../../lib/paging.js";
import { snakeKeys } from "../../lib/rowmap.js";
import { mapRow, mapRows } from "../common/rowmap.js";
import { requirePropertyExists } from "../common/access.js";
import { patchWithVersionGuard, assertVersionMatch, recordMutation, recordDelete, publishAfterCommit } from "../common/crud.js";
import { writeAudit } from "../../audit/audit.js";
import { registerJob } from "../../lib/scheduler.js";
import type { AppContext } from "../../context.js";
import type { RentEntry, RentStatus } from "../../../shared/types.js";

function getRentRow(id: string): RentEntry {
  const row = getDb().prepare(`SELECT * FROM rent_entries WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Rent entry");
  return mapRow<RentEntry>(row);
}

export function deriveRentStatus(
  dueCents: number,
  receivedCents: number,
  period: string,
  today: string,
  explicitWaived: boolean,
): RentStatus {
  if (explicitWaived) return "waived";
  if (receivedCents >= dueCents && dueCents > 0) return "paid";
  if (receivedCents > 0) return "partial";
  return period < periodOf(today) ? "late" : "unpaid";
}

const CreateRentSchema = z
  .object({
    unitId: zId,
    leaseId: zId.nullable().optional(),
    period: zPeriod,
    amountDueCents: zCents,
    amountReceivedCents: zCents.default(0),
    receivedOn: zIsoDate.nullable().optional(),
    method: zOptText(60),
    /** Check number, confirmation code, money-order stub — whatever you would
     *  search for when reconciling a bank statement. */
    reference: zOptText(120),
    status: z.enum(["unpaid", "partial", "paid", "late", "waived"]).optional(),
    note: zOptText(2000),
  })
  .strict();

// See properties/routes.ts for why defaulted fields must be re-declared without a default here.
const PatchRentSchema = CreateRentSchema.partial()
  .extend({ amountReceivedCents: zCents.optional(), expectedVersion: zVersion })
  .strict();

/** Idempotent per (unit, period) via ux_rent_unit_period. Used by POST {P}/rent/generate and
 * the monthly `rent-roll` job. Returns every row for that period (created + already existing). */
export function generateRentRoll(propertyId: string, period: string, actorId: string): RentEntry[] {
  const db = getDb();
  const activeLeases = db
    .prepare(
      `SELECT l.id AS lease_id, l.unit_id, l.rent_cents
         FROM leases l
        WHERE l.property_id = ? AND l.status = 'active'`,
    )
    .all(propertyId) as { lease_id: string; unit_id: string; rent_cents: number }[];

  for (const lease of activeLeases) {
    const existing = db
      .prepare(`SELECT id FROM rent_entries WHERE unit_id = ? AND period = ?`)
      .get(lease.unit_id, period);
    if (existing) continue;
    const id = newId("rnt");
    const at = nowIso();
    db.prepare(
      `INSERT INTO rent_entries (id, property_id, unit_id, lease_id, period, amount_due_cents,
         amount_received_cents, received_on, method, reference, status, note, created_at, updated_at,
         created_by, updated_by, version)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, 'unpaid', NULL, ?, ?, ?, ?, 1)`,
    ).run(id, propertyId, lease.unit_id, lease.lease_id, period, lease.rent_cents, at, at, actorId, actorId);
    writeAudit({
      actorUserId: actorId,
      actorLabel: "system",
      action: "create",
      entityType: "rent_entry",
      entityId: id,
      propertyId,
      summary: `generated rent roll entry for ${period}`,
      after: { period, amountDueCents: lease.rent_cents },
    });
  }
  const rows = db
    .prepare(`SELECT * FROM rent_entries WHERE property_id = ? AND period = ? ORDER BY unit_id`)
    .all(propertyId, period) as Record<string, unknown>[];
  return mapRows<RentEntry>(rows);
}

export function registerRentRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  registerJob({
    name: "rent-roll",
    dailyAt: "04:00",
    fn: () => {
      const tz = getEnv().APP_TIMEZONE;
      const period = periodOf(todayLocal(tz));
      const properties = db.prepare(`SELECT id, created_by FROM properties WHERE archived_at IS NULL`).all() as {
        id: string;
        created_by: string;
      }[];
      for (const p of properties) {
        tx(() => generateRentRoll(p.id, period, p.created_by));
      }
    },
  });

  app.get("/api/properties/:propertyId/rent", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const q = parseQuery(
      req,
      z.object({ from: zPeriod.optional(), to: zPeriod.optional(), unitId: zId.optional(), limit: z.coerce.number().int().min(1).max(200).default(200) }).strict(),
    );
    const clauses = ["property_id = ?"];
    const params: unknown[] = [propertyId];
    if (q.from) {
      clauses.push("period >= ?");
      params.push(q.from);
    }
    if (q.to) {
      clauses.push("period <= ?");
      params.push(q.to);
    }
    if (q.unitId) {
      clauses.push("unit_id = ?");
      params.push(q.unitId);
    }
    const rows = db
      .prepare(`SELECT * FROM rent_entries WHERE ${clauses.join(" AND ")} ORDER BY period DESC, unit_id LIMIT ?`)
      .all(...params, q.limit + 1) as Record<string, unknown>[];
    const entries = mapRows<RentEntry>(rows);
    return ok(buildPage(entries, q.limit, (r) => r.period));
  });

  app.post("/api/properties/:propertyId/rent", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, CreateRentSchema);
    const id = newId("rnt");
    const at = nowIso();
    const today = todayLocal(getEnv().APP_TIMEZONE);
    const entry = tx(() => {
      const status =
        body.status ?? deriveRentStatus(body.amountDueCents, body.amountReceivedCents, body.period, today, false);
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO rent_entries (id, property_id, unit_id, lease_id, period, amount_due_cents,
           amount_received_cents, received_on, method, reference, status, note, created_at, updated_at,
           created_by, updated_by, version)
         VALUES (@id,@property_id,@unit_id,@lease_id,@period,@amount_due_cents,
           @amount_received_cents,@received_on,@method,@reference,@status,@note,@created_at,@updated_at,
           @created_by,@updated_by,1)`,
      ).run({
        id,
        property_id: propertyId,
        unit_id: snake.unit_id,
        lease_id: snake.lease_id ?? null,
        period: snake.period,
        amount_due_cents: snake.amount_due_cents,
        amount_received_cents: snake.amount_received_cents ?? 0,
        received_on: snake.received_on ?? null,
        method: snake.method ?? null,
        reference: snake.reference ?? null,
        status,
        note: snake.note ?? null,
        created_at: at,
        updated_at: at,
        created_by: user.id,
        updated_by: user.id,
      });
      const row = getRentRow(id);
      recordMutation(req, {
        action: "create",
        entityType: "rent_entry",
        entityId: id,
        propertyId,
        summary: `added rent entry for ${row.period}`,
        after: body as Record<string, unknown>,
      });
      return row;
    });
    publishAfterCommit({
      action: "created",
      entityType: "rent_entry",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: entry,
    });
    return reply.code(201).send(ok(entry));
  });

  app.patch("/api/rent/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchRentSchema);
    const { expectedVersion, ...patch } = body;
    const existing = getRentRow(id);
    const today = todayLocal(getEnv().APP_TIMEZONE);
    const effectivePatch: Record<string, unknown> = { ...patch };
    if (patch.status === undefined && (patch.amountReceivedCents !== undefined || patch.amountDueCents !== undefined)) {
      const due = patch.amountDueCents ?? existing.amountDueCents;
      const received = patch.amountReceivedCents ?? existing.amountReceivedCents;
      effectivePatch.status = deriveRentStatus(due, received, existing.period, today, false);
    }
    const result = tx(() => {
      const changes = patchWithVersionGuard({ table: "rent_entries", id, patch: effectivePatch, expectedVersion, actorId: user.id });
      assertVersionMatch({ table: "rent_entries", id, changes, what: "Rent entry", currentView: () => getRentRow(id) });
      const row = getRentRow(id);
      recordMutation(req, {
        action: "update",
        entityType: "rent_entry",
        entityId: id,
        propertyId: row.propertyId,
        summary: `updated rent entry for ${row.period}`,
        after: patch as Record<string, unknown>,
      });
      return row;
    });
    publishAfterCommit({
      action: "updated",
      entityType: "rent_entry",
      entityId: id,
      propertyId: result.propertyId,
      version: result.version,
      actorId: user.id,
      data: result,
    });
    return ok(result);
  });

  app.delete("/api/rent/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getRentRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM rent_entries WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Rent entry");
      recordDelete(req, {
        action: "delete",
        entityType: "rent_entry",
        entityId: id,
        propertyId: existing.propertyId,
        summary: `deleted rent entry for ${existing.period}`,
      });
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "rent_entry",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });

  app.post("/api/properties/:propertyId/rent/generate", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, z.object({ period: zPeriod }).strict());
    const entries = tx(() => generateRentRoll(propertyId, body.period, user.id));
    for (const e of entries) {
      publishAfterCommit({
        action: "created",
        entityType: "rent_entry",
        entityId: e.id,
        propertyId,
        version: e.version,
        actorId: user.id,
      });
    }
    return ok(onePage(entries));
  });
}
