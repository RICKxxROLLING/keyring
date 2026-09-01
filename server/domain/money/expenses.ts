// server/domain/money/expenses.ts — property expense log.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import { parseBody, parseParams, parseQuery, zId, zOptText, zText, zIsoDate, zCents, zVersion, IdParamSchema } from "../../lib/validate.js";
import { ok, deleted, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { nowIso } from "../../lib/time.js";
import { buildPage } from "../../lib/paging.js";
import { snakeKeys } from "../../lib/rowmap.js";
import { mapRow } from "../common/rowmap.js";
import { requirePropertyExists } from "../common/access.js";
import { patchWithVersionGuard, assertVersionMatch, recordMutation, recordDelete, publishAfterCommit } from "../common/crud.js";
import type { AppContext } from "../../context.js";
import type { PropertyExpense } from "../../../shared/types.js";

const CATEGORIES = ["repair", "capex", "utility", "insurance", "tax", "management", "supplies", "legal", "landscaping", "other"] as const;

const CreateExpenseSchema = z
  .object({
    unitId: zId.nullable().optional(),
    category: z.enum(CATEGORIES),
    description: zText(300),
    amountCents: zCents,
    incurredOn: zIsoDate,
    vendorId: zId.nullable().optional(),
    workOrderId: zId.nullable().optional(),
    projectId: zId.nullable().optional(),
    note: zOptText(2000),
  })
  .strict();

const PatchExpenseSchema = CreateExpenseSchema.partial().extend({ expectedVersion: zVersion }).strict();

/**
 * SQLite has no boolean type, so is_recurring arrives as 0 or 1 while
 * shared/types declares it `boolean`. Coerce in one place rather than leaving
 * every consumer on truthiness — the moment something does `=== true` it
 * silently stops matching.
 */
function toExpense(row: Record<string, unknown>): PropertyExpense {
  const e = mapRow<PropertyExpense>(row);
  return { ...e, isRecurring: Boolean(row["is_recurring"]) };
}

function getExpenseRow(id: string): PropertyExpense {
  const row = getDb().prepare(`SELECT * FROM property_expenses WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound("Expense");
  return mapRow<PropertyExpense>(row);
}

export function registerExpenseRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:propertyId/expenses", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const q = parseQuery(
      req,
      z
        .object({
          from: zIsoDate.optional(),
          to: zIsoDate.optional(),
          category: z.string().max(200).optional(),
          unitId: zId.optional(),
          limit: z.coerce.number().int().min(1).max(200).default(200),
        })
        .strict(),
    );
    const clauses = ["property_id = ?"];
    const params: unknown[] = [propertyId];
    if (q.from) {
      clauses.push("incurred_on >= ?");
      params.push(q.from);
    }
    if (q.to) {
      clauses.push("incurred_on <= ?");
      params.push(q.to);
    }
    if (q.unitId) {
      clauses.push("unit_id = ?");
      params.push(q.unitId);
    }
    const categories = q.category?.split(",").filter(Boolean);
    if (categories && categories.length) {
      clauses.push(`category IN (${categories.map(() => "?").join(",")})`);
      params.push(...categories);
    }
    const rows = db
      .prepare(`SELECT * FROM property_expenses WHERE ${clauses.join(" AND ")} ORDER BY incurred_on DESC LIMIT ?`)
      .all(...params, q.limit + 1) as Record<string, unknown>[];
    const expenses = (rows as Record<string, unknown>[]).map(toExpense);
    return ok(buildPage(expenses, q.limit, (e) => e.incurredOn));
  });

  app.post("/api/properties/:propertyId/expenses", { preHandler: [requireAuth] }, async (req, reply) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, CreateExpenseSchema);
    const id = newId("exp");
    const at = nowIso();
    const expense = tx(() => {
      const snake = snakeKeys(body);
      db.prepare(
        `INSERT INTO property_expenses (id, property_id, unit_id, category, description,
           amount_cents, incurred_on, vendor_id, work_order_id, project_id, note, created_at,
           updated_at, created_by, updated_by, version)
         VALUES (@id,@property_id,@unit_id,@category,@description,@amount_cents,@incurred_on,
           @vendor_id,@work_order_id,@project_id,@note,@created_at,@updated_at,@created_by,
           @updated_by,1)`,
      ).run({
        id,
        property_id: propertyId,
        unit_id: snake.unit_id ?? null,
        category: snake.category,
        description: snake.description,
        amount_cents: snake.amount_cents,
        incurred_on: snake.incurred_on,
        vendor_id: snake.vendor_id ?? null,
        work_order_id: snake.work_order_id ?? null,
        project_id: snake.project_id ?? null,
        note: snake.note ?? null,
        created_at: at,
        updated_at: at,
        created_by: user.id,
        updated_by: user.id,
      });
      const row = getExpenseRow(id);
      recordMutation(
        req,
        {
          action: "create",
          entityType: "property_expense",
          entityId: id,
          propertyId,
          summary: `added expense "${row.description}"`,
          after: body as Record<string, unknown>,
        },
        {
          entityType: "property_expense",
          entityId: id,
          propertyId,
          title: row.description,
          body: `${row.category} ${row.incurredOn}`,
          url: `/p/${propertyId}/money?expense=${id}`,
          updatedAt: at,
        },
      );
      return row;
    });
    publishAfterCommit({
      action: "created",
      entityType: "property_expense",
      entityId: id,
      propertyId,
      version: 1,
      actorId: user.id,
      data: expense,
    });
    return reply.code(201).send(ok(expense));
  });

  app.patch("/api/expenses/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const body = parseBody(req, PatchExpenseSchema);
    const { expectedVersion, ...patch } = body;
    const result = tx(() => {
      const changes = patchWithVersionGuard({ table: "property_expenses", id, patch, expectedVersion, actorId: user.id });
      assertVersionMatch({
        table: "property_expenses",
        id,
        changes,
        what: "Expense",
        currentView: () => getExpenseRow(id),
      });
      const row = getExpenseRow(id);
      recordMutation(
        req,
        {
          action: "update",
          entityType: "property_expense",
          entityId: id,
          propertyId: row.propertyId,
          summary: `updated expense "${row.description}"`,
          after: patch as Record<string, unknown>,
        },
        {
          entityType: "property_expense",
          entityId: id,
          propertyId: row.propertyId,
          title: row.description,
          body: `${row.category} ${row.incurredOn}`,
          url: `/p/${row.propertyId}/money?expense=${id}`,
          updatedAt: nowIso(),
        },
      );
      return row;
    });
    publishAfterCommit({
      action: "updated",
      entityType: "property_expense",
      entityId: id,
      propertyId: result.propertyId,
      version: result.version,
      actorId: user.id,
      data: result,
    });
    return ok(result);
  });

  app.delete("/api/expenses/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    const existing = getExpenseRow(id);
    tx(() => {
      const info = db.prepare(`DELETE FROM property_expenses WHERE id = ?`).run(id);
      if (info.changes === 0) throw notFound("Expense");
      recordDelete(
        req,
        {
          action: "delete",
          entityType: "property_expense",
          entityId: id,
          propertyId: existing.propertyId,
          summary: `deleted expense "${existing.description}"`,
        },
        { entityType: "property_expense", entityId: id },
      );
    });
    publishAfterCommit({
      action: "deleted",
      entityType: "property_expense",
      entityId: id,
      propertyId: existing.propertyId,
      version: 0,
      actorId: user.id,
    });
    return deleted(id);
  });

}
