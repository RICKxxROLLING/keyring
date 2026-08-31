// server/domain/dashboard/routes.ts — GET /api/dashboard and GET /api/attention.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db/index.js";
import { requireAuth } from "../../auth/middleware.js";
import { parseQuery, zId } from "../../lib/validate.js";
import { ok } from "../../lib/errors.js";
import { nowIso, todayLocal, periodOf } from "../../lib/time.js";
import { getEnv } from "../../config/env.js";
import { onePage } from "../../lib/paging.js";
import { listProperties, coverUrlFor } from "../properties/repo.js";
import { computeAttention } from "../common/attention.js";
import type { AppContext } from "../../context.js";
import type { DashboardPayload, PropertyCard } from "../../../shared/types.js";

export function registerDashboardRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/dashboard", { preHandler: [requireAuth] }, async () => {
    const properties = listProperties(false);
    const needsAttention = computeAttention(null);
    const attentionByProperty = new Map<string, number>();
    for (const item of needsAttention) {
      attentionByProperty.set(item.propertyId, (attentionByProperty.get(item.propertyId) ?? 0) + 1);
    }

    const cards: PropertyCard[] = properties.map((p) => ({
      id: p.id,
      name: p.name,
      addressLine1: p.addressLine1,
      city: p.city,
      state: p.state,
      status: p.status,
      coverUrl: coverUrlFor(p.coverUploadId),
      quickFacts: p.quickFacts,
      attentionCount: attentionByProperty.get(p.id) ?? 0,
      heroColor: p.heroColor,
    }));

    const unitTotals = db
      .prepare(
        `SELECT COUNT(*) AS units,
                SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occupied,
                SUM(CASE WHEN status = 'vacant' THEN 1 ELSE 0 END) AS vacant
           FROM units u JOIN properties p ON p.id = u.property_id WHERE p.archived_at IS NULL`,
      )
      .get() as { units: number; occupied: number | null; vacant: number | null };

    const openWorkOrders = db
      .prepare(
        `SELECT COUNT(*) AS n FROM work_orders w JOIN properties p ON p.id = w.property_id
          WHERE p.archived_at IS NULL AND w.status NOT IN ('done','cancelled')`,
      )
      .get() as { n: number };

    const monthlyRent = db
      .prepare(
        `SELECT COALESCE(SUM(l.rent_cents), 0) AS total FROM leases l
           JOIN properties p ON p.id = l.property_id
          WHERE p.archived_at IS NULL AND l.status = 'active'`,
      )
      .get() as { total: number };

    const thisPeriod = periodOf(todayLocal(getEnv().APP_TIMEZONE));
    const collectedThisMonth = db
      .prepare(
        `SELECT COALESCE(SUM(r.amount_received_cents), 0) AS total FROM rent_entries r
           JOIN properties p ON p.id = r.property_id
          WHERE p.archived_at IS NULL AND r.period = ?`,
      )
      .get(thisPeriod) as { total: number };

    const payload: DashboardPayload = {
      properties: cards,
      needsAttention,
      totals: {
        properties: properties.length,
        units: unitTotals.units,
        occupied: unitTotals.occupied ?? 0,
        vacant: unitTotals.vacant ?? 0,
        openWorkOrders: openWorkOrders.n,
        monthlyRentCents: monthlyRent.total,
        rentCollectedThisMonthCents: collectedThisMonth.total,
      },
      generatedAt: nowIso(),
    };
    return ok(payload);
  });

  app.get("/api/attention", { preHandler: [requireAuth] }, async (req) => {
    const q = parseQuery(req, z.object({ propertyId: zId.optional() }).strict());
    return ok(onePage(computeAttention(q.propertyId ?? null)));
  });
}
