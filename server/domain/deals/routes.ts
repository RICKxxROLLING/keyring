// server/domain/deals/routes.ts — GET/PUT the deal analysis for one property.
//
// The Outer Banks analyzer (invest.hireclan.org), merged in so a deal is worked
// out on the prospect itself instead of in a second tab with the numbers
// retyped. The arithmetic lives in shared/deal-analysis.ts; this file only
// stores the inputs and hands back the computed result with them.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, tx } from "../../db/index.js";
import { requireAuth, requireUser } from "../../auth/middleware.js";
import { parseBody, parseParams, zId, zVersion } from "../../lib/validate.js";
import { ok, versionConflict } from "../../lib/errors.js";
import { nowIso } from "../../lib/time.js";
import { mapRow } from "../common/rowmap.js";
import { requirePropertyExists } from "../common/access.js";
import { recordMutation, publishAfterCommit } from "../common/crud.js";
import { analyzeDeal, defaultDealInputs, type DealInputs, type DealScenario } from "../../../shared/deal-analysis.js";
import type { AppContext } from "../../context.js";

/** Every stored column, camelCased. The analysis inputs plus the row's identity. */
interface DealRow extends DealInputs {
  propertyId: string;
  scenario: DealScenario;
  version: number;
  updatedAt: string;
}

const pct = z.number().min(-1000).max(1000);
const cents = z.number().int().min(0).max(1_000_000_000_00);

const DealInputSchema = z
  .object({
    priceCents: cents,
    closingCostsCents: cents,
    rehabCents: cents,
    arvCents: cents.nullable(),
    arvMode: z.enum(["fixed", "conservative", "aggressive"]),
    downPaymentMode: z.enum(["percent", "amount"]),
    downPayment: z.number().min(0).max(1_000_000_000_00),
    interestRatePct: z.number().min(0).max(100),
    termYears: z.number().int().min(1).max(50),
    financeCosts: z.boolean(),
    monthlyRentCents: cents,
    monthlyOtherIncomeCents: cents,
    vacancyPct: pct,
    taxRatePct: pct,
    insuranceAnnualCents: cents.nullable(),
    baseHazardCents: cents,
    windPerSqftCents: cents,
    floodAnnualCents: cents,
    sqft: z.number().int().min(0).max(1_000_000),
    monthlyHoaCents: cents,
    monthlyUtilitiesCents: cents,
    maintenancePct: pct,
    capexPct: pct,
    managementPct: pct,
    taxBracketPct: pct,
    landPct: pct,
    appreciationPct: pct,
    rentGrowthPct: pct,
    expenseGrowthPct: pct,
    sellingCostPct: pct,
    scenario: z.enum(["financed", "cash"]),
    /** Absent on the first save, when there is no row to conflict with. */
    expectedVersion: zVersion.optional(),
  })
  .strict();

const COLUMNS = [
  ["price_cents", "priceCents"],
  ["closing_costs_cents", "closingCostsCents"],
  ["rehab_cents", "rehabCents"],
  ["arv_cents", "arvCents"],
  ["arv_mode", "arvMode"],
  ["down_payment_mode", "downPaymentMode"],
  ["down_payment", "downPayment"],
  ["interest_rate_pct", "interestRatePct"],
  ["term_years", "termYears"],
  ["finance_costs", "financeCosts"],
  ["monthly_rent_cents", "monthlyRentCents"],
  ["monthly_other_income_cents", "monthlyOtherIncomeCents"],
  ["vacancy_pct", "vacancyPct"],
  ["tax_rate_pct", "taxRatePct"],
  ["insurance_annual_cents", "insuranceAnnualCents"],
  ["base_hazard_cents", "baseHazardCents"],
  ["wind_per_sqft_cents", "windPerSqftCents"],
  ["flood_annual_cents", "floodAnnualCents"],
  ["sqft", "sqft"],
  ["monthly_hoa_cents", "monthlyHoaCents"],
  ["monthly_utilities_cents", "monthlyUtilitiesCents"],
  ["maintenance_pct", "maintenancePct"],
  ["capex_pct", "capexPct"],
  ["management_pct", "managementPct"],
  ["tax_bracket_pct", "taxBracketPct"],
  ["land_pct", "landPct"],
  ["appreciation_pct", "appreciationPct"],
  ["rent_growth_pct", "rentGrowthPct"],
  ["expense_growth_pct", "expenseGrowthPct"],
  ["selling_cost_pct", "sellingCostPct"],
  ["scenario", "scenario"],
] as const;

function readRow(propertyId: string): DealRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM property_deal_inputs WHERE property_id = ?`)
    .get(propertyId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const mapped = mapRow<DealRow & { financeCosts: unknown }>(row);
  // SQLite has no boolean; the column is 0/1.
  return { ...mapped, financeCosts: Boolean(mapped.financeCosts) };
}

/**
 * The stored inputs, or sensible starting values when nothing is saved yet.
 *
 * Seeding the price from the property's own purchase price means opening the
 * tab on a prospect you have already priced shows a real analysis rather than
 * a wall of zeroes.
 */
function inputsFor(propertyId: string): { inputs: DealInputs; scenario: DealScenario; version: number } {
  const row = readRow(propertyId);
  if (row) {
    const { propertyId: _p, version, scenario, updatedAt: _u, ...inputs } = row;
    return { inputs, scenario, version };
  }
  const property = getDb()
    .prepare(`SELECT purchase_price_cents, sqft FROM properties WHERE id = ?`)
    .get(propertyId) as { purchase_price_cents: number | null; sqft: number | null } | undefined;
  const defaults = defaultDealInputs(property?.purchase_price_cents ?? 0);
  return {
    inputs: { ...defaults, sqft: property?.sqft ?? 0 },
    scenario: "financed",
    version: 0,
  };
}

export function registerDealRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:propertyId/deal", { preHandler: [requireAuth] }, async (req) => {
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const { inputs, scenario, version } = inputsFor(propertyId);
    return ok({
      propertyId,
      inputs,
      scenario,
      version,
      /** version 0 means nothing has been saved for this property yet. */
      saved: version > 0,
      analysis: analyzeDeal(inputs, scenario),
    });
  });

  /**
   * PUT rather than PATCH: the analysis is one coherent set of assumptions, and
   * a half-applied change would produce a number nobody meant. The whole set is
   * sent each time, guarded by the same expectedVersion contract as every other
   * mutable row here.
   */
  app.put("/api/properties/:propertyId/deal", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { propertyId } = parseParams(req, z.object({ propertyId: zId }).strict());
    requirePropertyExists(propertyId);
    const body = parseBody(req, DealInputSchema);
    // scenario is written via COLUMNS with the rest; only pulled out here so
    // the audit payload records the assumptions rather than the whole envelope.
    const { expectedVersion, scenario: _scenario, ...inputs } = body;

    const saved = tx(() => {
      const existing = readRow(propertyId);
      if (existing && expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw versionConflict(
          "This deal analysis changed while you were editing it.",
          { ...existing, analysis: analyzeDeal(existing, existing.scenario) },
        );
      }

      const at = nowIso();
      const values: Record<string, unknown> = { property_id: propertyId, updated_at: at, updated_by: user.id };
      for (const [col, key] of COLUMNS) {
        const v = (body as Record<string, unknown>)[key];
        values[col] = typeof v === "boolean" ? (v ? 1 : 0) : v;
      }

      if (existing) {
        const sets = COLUMNS.map(([col]) => `${col} = @${col}`).join(", ");
        db.prepare(
          `UPDATE property_deal_inputs
              SET ${sets}, updated_at = @updated_at, updated_by = @updated_by, version = version + 1
            WHERE property_id = @property_id`,
        ).run(values);
      } else {
        const cols = COLUMNS.map(([col]) => col).join(", ");
        const marks = COLUMNS.map(([col]) => `@${col}`).join(", ");
        db.prepare(
          `INSERT INTO property_deal_inputs (property_id, ${cols}, created_at, updated_at,
             created_by, updated_by, version)
           VALUES (@property_id, ${marks}, @updated_at, @updated_at, @updated_by, @updated_by, 1)`,
        ).run(values);
      }

      const row = readRow(propertyId)!;
      recordMutation(req, {
        action: existing ? "update" : "create",
        entityType: "property",
        entityId: propertyId,
        propertyId,
        summary: existing ? "updated the deal analysis" : "started a deal analysis",
        after: inputs as unknown as Record<string, unknown>,
      });
      return row;
    });

    publishAfterCommit({
      action: "updated",
      entityType: "property",
      entityId: propertyId,
      propertyId,
      version: saved.version,
      actorId: user.id,
    });

    const { propertyId: _p, version, scenario: savedScenario, updatedAt: _u, ...savedInputs } = saved;
    return ok({
      propertyId,
      inputs: savedInputs,
      scenario: savedScenario,
      version,
      saved: true,
      analysis: analyzeDeal(savedInputs, savedScenario),
    });
  });
}
