// server/domain/deals/layout-utilities.test.ts — bedrooms, bathrooms and the
// utility estimate, through the real routes.
//
// The route validates against its own zod schema, which the DealInputs type
// cannot see: a field added to one and not the other compiles cleanly and then
// fails every save with a 422. The round trip here is what catches that.
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../../testing/harness.js";
import { getDb } from "../../db/index.js";
import { defaultDealInputs, type DealAnalysis, type DealInputs } from "../../../shared/deal-analysis.js";
import { estimateUtilities } from "../../../shared/utility-estimate.js";
import type { PropertyView } from "../../../shared/types.js";

interface DealPayload {
  inputs: DealInputs;
  version: number;
  analysis: DealAnalysis;
  variant: { analysis: DealAnalysis } | null;
}

describe("deal layout and utilities", () => {
  let testApp: TestApp | null = null;

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  async function prospect(postalCode = "27948"): Promise<{ headers: Record<string, string>; id: string }> {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const p = unwrap<PropertyView>(
      await testApp.app.inject({
        method: "POST",
        url: "/api/properties",
        headers: user.headers,
        payload: {
          name: "Layout test",
          addressLine1: "1 Test St",
          city: "Kill Devil Hills",
          state: "NC",
          postalCode,
          propertyType: "single_family",
          stage: "prospect",
          sqft: 1_600,
        },
      }),
    );
    return { headers: user.headers, id: p.id };
  }

  const get = async (headers: Record<string, string>, id: string) =>
    unwrap<DealPayload>(
      await testApp!.app.inject({ method: "GET", url: `/api/properties/${id}/deal`, headers }),
    );

  const put = (headers: Record<string, string>, id: string, over: Partial<DealInputs>, expectedVersion?: number) =>
    testApp!.app.inject({
      method: "PUT",
      url: `/api/properties/${id}/deal`,
      headers,
      payload: {
        ...defaultDealInputs(400_000_00),
        sqft: 1_600,
        monthlyRentCents: 3_000_00,
        ...over,
        scenario: "cash",
        ...(expectedVersion ? { expectedVersion } : {}),
      },
    });

  it("saves and re-reads bedrooms, bathrooms and the utility settings", async () => {
    const { headers, id } = await prospect();
    const res = await put(headers, id, {
      bedrooms: 4,
      bathrooms: 2.5,
      utilitiesAuto: true,
      utilityPayer: "owner_all",
    });
    expect(res.statusCode).toBe(200);

    const back = await get(headers, id);
    expect(back.inputs.bedrooms).toBe(4);
    expect(back.inputs.bathrooms).toBe(2.5);
    expect(back.inputs.utilitiesAuto).toBe(true);
    expect(back.inputs.utilityPayer).toBe("owner_all");
  });

  it("rejects a bathroom count that is not a whole or a half", async () => {
    const { headers, id } = await prospect();
    expect((await put(headers, id, { bathrooms: 2.37 })).statusCode).toBe(422);
  });

  it("analyses with the estimate for this ZIP when the estimate is on", async () => {
    const { headers, id } = await prospect("27948");
    await put(headers, id, {
      bedrooms: 3,
      bathrooms: 2,
      utilitiesAuto: true,
      utilityPayer: "owner_all",
      monthlyUtilitiesCents: 5_00,
    });
    const deal = await get(headers, id);
    const expected = estimateUtilities(deal.inputs, "27948").ownerMonthlyCents * 12;
    // Computed on the server from the property's own ZIP; the stored $5 is ignored.
    expect(deal.analysis.cash.utilitiesCents).toBe(expected);
  });

  it("uses the typed figure when the estimate is off", async () => {
    const { headers, id } = await prospect();
    await put(headers, id, { utilitiesAuto: false, monthlyUtilitiesCents: 250_00 });
    expect((await get(headers, id)).analysis.cash.utilitiesCents).toBe(3_000_00);
  });

  it("charges plan B's extra bedroom to plan B's utilities", async () => {
    const { headers, id } = await prospect();
    await put(headers, id, { bedrooms: 3, utilitiesAuto: true, utilityPayer: "owner_all" });
    const res = await testApp!.app.inject({
      method: "PUT",
      url: `/api/properties/${id}/deal/variant`,
      headers,
      payload: { label: "Add a bedroom", overrides: { bedrooms: 4 } },
    });
    expect(res.statusCode).toBe(200);

    const deal = await get(headers, id);
    expect(deal.variant!.analysis.cash.utilitiesCents).toBeGreaterThan(deal.analysis.cash.utilitiesCents);
  });

  it("starts from the property's own units when it has them", async () => {
    const { headers, id } = await prospect();
    const at = new Date().toISOString();
    const user = getDb().prepare(`SELECT created_by FROM properties WHERE id = ?`).get(id) as {
      created_by: string;
    };
    const insert = getDb().prepare(
      `INSERT INTO units (id, property_id, label, bedrooms, bathrooms, sort_order, created_at,
         updated_at, created_by, updated_by, version)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1)`,
    );
    insert.run("unt_01J0000000000000000000000A", id, "Up", 2, 1, at, at, user.created_by, user.created_by);
    insert.run("unt_01J0000000000000000000000B", id, "Down", 2, 1.5, at, at, user.created_by, user.created_by);

    const deal = await get(headers, id);
    expect(deal.inputs.bedrooms).toBe(4);
    expect(deal.inputs.bathrooms).toBe(2.5);
  });

  it("leaves an analysis saved before this change on its typed utilities", async () => {
    const { headers, id } = await prospect();
    await put(headers, id, { utilitiesAuto: true, monthlyUtilitiesCents: 180_00 });
    // What migration 2009 does to a row that existed before it.
    getDb().prepare(`UPDATE property_deal_inputs SET utilities_auto = 0 WHERE property_id = ?`).run(id);

    const deal = await get(headers, id);
    expect(deal.inputs.utilitiesAuto).toBe(false);
    // The saved cash flow did not move because a feature shipped.
    expect(deal.analysis.cash.utilitiesCents).toBe(180_00 * 12);
  });
});
