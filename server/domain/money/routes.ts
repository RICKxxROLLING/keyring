// server/domain/money/routes.ts — mounts rent + expenses, and the money summary aggregate.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db/index.js";
import { requireAuth } from "../../auth/middleware.js";
import { parseParams, parseQuery, zId, zPeriod } from "../../lib/validate.js";
import { ok } from "../../lib/errors.js";
import { todayLocal, addMonths, periodOf } from "../../lib/time.js";
import { getEnv } from "../../config/env.js";
import { requirePropertyExists } from "../common/access.js";
import { registerRentRoutes } from "./rent.js";
import { registerExpenseRoutes } from "./expenses.js";
import type { AppContext } from "../../context.js";
import type { ExpenseCategory, MoneySummary } from "../../../shared/types.js";

function monthsBetween(fromPeriod: string, toPeriod: string): string[] {
  const out: string[] = [];
  let cur = `${fromPeriod}-01`;
  const end = `${toPeriod}-01`;
  let guard = 0;
  while (cur <= end && guard < 240) {
    out.push(periodOf(cur));
    cur = addMonths(cur, 1);
    guard++;
  }
  return out;
}

function computeMoneySummary(propertyId: string, fromPeriod: string, toPeriod: string): MoneySummary {
  const db = getDb();
  const fromDate = `${fromPeriod}-01`;
  const toDate = addMonths(`${toPeriod}-01`, 1); // exclusive upper bound, then step back a day via <=
  const toDateInclusive = `${toPeriod}-${new Date(Date.UTC(Number(toPeriod.slice(0, 4)), Number(toPeriod.slice(5, 7)), 0)).getUTCDate()}`;

  const rentTotals = db
    .prepare(
      `SELECT COALESCE(SUM(amount_due_cents),0) AS due, COALESCE(SUM(amount_received_cents),0) AS received
         FROM rent_entries WHERE property_id = ? AND period >= ? AND period <= ?`,
    )
    .get(propertyId, fromPeriod, toPeriod) as { due: number; received: number };

  const expenseTotal = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents),0) AS total FROM property_expenses
        WHERE property_id = ? AND incurred_on >= ? AND incurred_on <= ?`,
    )
    .get(propertyId, fromDate, toDateInclusive) as { total: number };

  const byCategoryRows = db
    .prepare(
      `SELECT category, COALESCE(SUM(amount_cents),0) AS total FROM property_expenses
        WHERE property_id = ? AND incurred_on >= ? AND incurred_on <= ?
        GROUP BY category ORDER BY category`,
    )
    .all(propertyId, fromDate, toDateInclusive) as { category: ExpenseCategory; total: number }[];

  const months = monthsBetween(fromPeriod, toPeriod);
  const byMonth = months.map((period) => {
    const rent = db
      .prepare(`SELECT COALESCE(SUM(amount_received_cents),0) AS r FROM rent_entries WHERE property_id = ? AND period = ?`)
      .get(propertyId, period) as { r: number };
    const monthStart = `${period}-01`;
    const monthEnd = `${period}-${new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate()}`;
    const exp = db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents),0) AS e FROM property_expenses
          WHERE property_id = ? AND incurred_on >= ? AND incurred_on <= ?`,
      )
      .get(propertyId, monthStart, monthEnd) as { e: number };
    return { period, rentReceivedCents: rent.r, expenseCents: exp.e };
  });

  void toDate;
  return {
    propertyId,
    period: { from: fromDate, to: toDateInclusive },
    rentDueCents: rentTotals.due,
    rentReceivedCents: rentTotals.received,
    rentOutstandingCents: rentTotals.due - rentTotals.received,
    expenseCents: expenseTotal.total,
    netCents: rentTotals.received - expenseTotal.total,
    byCategory: byCategoryRows.map((r) => ({ category: r.category, amountCents: r.total })),
    byMonth,
  };
}

export function registerMoneyRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerRentRoutes(app, ctx);
  registerExpenseRoutes(app, ctx);

  app.get("/api/properties/:propertyId/money/summary", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const q = parseQuery(req, z.object({ from: zPeriod.optional(), to: zPeriod.optional() }).strict());
    const today = todayLocal(getEnv().APP_TIMEZONE);
    const to = q.to ?? periodOf(today);
    const from = q.from ?? periodOf(addMonths(`${to}-01`, -11));
    return ok(computeMoneySummary(propertyId, from, to));
  });
}

export { computeMoneySummary };
