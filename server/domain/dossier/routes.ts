// server/domain/dossier/routes.ts — GET /api/properties/:id/dossier, the single-request
// payload the property page (and the offline cache) loads.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db/index.js";
import { requireAuth } from "../../auth/middleware.js";
import { parseParams, zId } from "../../lib/validate.js";
import { ok } from "../../lib/errors.js";
import { nowIso, todayLocal, addMonths, periodOf } from "../../lib/time.js";
import { getEnv } from "../../config/env.js";
import { mapRows } from "../common/rowmap.js";
import { getPropertyRow, toPropertyView } from "../properties/repo.js";
import { listNotes } from "../notes/repo.js";
import { listWorkOrders } from "../workorders/repo.js";
import { listProjects } from "../projects/repo.js";
import { listTenants, listLeases } from "../tenants/repo.js";
import { listSpecs } from "../specs/repo.js";
import { listCompliance } from "../compliance/repo.js";
import { listTurnovers } from "../turnover/repo.js";
import { listVendors } from "../vendors/repo.js";
import { computeMoneySummary } from "../money/routes.js";
import { computeAttention } from "../common/attention.js";
import { listAttachmentsForProperty } from "../../uploads/storage.js";
import type { AppContext } from "../../context.js";
import type { PmTemplate, PropertyDossier, PropertyExpense, RentEntry } from "../../../shared/types.js";

export function registerDossierRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:id/dossier", { preHandler: [requireAuth] }, async (req) => {
    const { id: propertyId } = parseParams(req, z.object({ id: zId }).strict());
    const property = getPropertyRow(propertyId);
    const tz = getEnv().APP_TIMEZONE;
    const today = todayLocal(tz);
    const toPeriod = periodOf(today);
    const fromPeriod = periodOf(addMonths(`${toPeriod}-01`, -11));

    const pmTemplates = mapRows<PmTemplate>(
      db.prepare(`SELECT * FROM pm_templates WHERE property_id = ? ORDER BY next_due_date`).all(propertyId) as Record<
        string,
        unknown
      >[],
    );
    const rentEntries = mapRows<RentEntry>(
      db
        .prepare(`SELECT * FROM rent_entries WHERE property_id = ? ORDER BY period DESC, unit_id LIMIT 400`)
        .all(propertyId) as Record<string, unknown>[],
    );
    const expenses = mapRows<PropertyExpense>(
      db
        .prepare(`SELECT * FROM property_expenses WHERE property_id = ? ORDER BY incurred_on DESC LIMIT 200`)
        .all(propertyId) as Record<string, unknown>[],
    );

    const dossier: PropertyDossier = {
      property: toPropertyView(property),
      notes: listNotes(propertyId),
      workOrders: listWorkOrders({ propertyId }),
      pmTemplates,
      projects: listProjects(propertyId),
      tenants: listTenants(propertyId),
      leases: listLeases(propertyId),
      rentEntries,
      expenses,
      money: computeMoneySummary(propertyId, fromPeriod, toPeriod),
      specs: listSpecs(propertyId),
      compliance: listCompliance(propertyId),
      turnovers: listTurnovers(propertyId),
      vendors: listVendors({ includeArchived: false }),
      attachments: listAttachmentsForProperty(propertyId),
      attention: computeAttention(propertyId),
      generatedAt: nowIso(),
    };
    return ok(dossier);
  });
}
