// server/domain/deals/routes.test.ts — storing and re-reading a deal analysis.
//
// The arithmetic is proved in shared/deal-analysis.test.ts. What matters here is
// the round trip: that only inputs are persisted, that the server computes the
// result itself rather than trusting the client, and that two people editing
// the same analysis cannot silently overwrite each other.
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../../testing/harness.js";
import { defaultDealInputs } from "../../../shared/deal-analysis.js";
import type { DealAnalysis, DealInputs } from "../../../shared/deal-analysis.js";
import type { PropertyView } from "../../../shared/types.js";

interface DealPayload {
  inputs: DealInputs;
  scenario: "financed" | "cash";
  version: number;
  saved: boolean;
  analysis: DealAnalysis;
}

async function makeProspect(testApp: TestApp, headers: Record<string, string>): Promise<PropertyView> {
  const res = await testApp.app.inject({
    method: "POST",
    url: "/api/properties",
    headers,
    payload: {
      name: "Considering this one",
      addressLine1: "9 Ocean Ave",
      city: "Kill Devil Hills",
      state: "NC",
      postalCode: "27948",
      propertyType: "single_family",
      stage: "prospect",
      purchasePriceCents: 450_000_00,
    },
  });
  expect(res.statusCode).toBe(201);
  return unwrap<PropertyView>(res);
}

function body(over: Partial<DealInputs> = {}): Record<string, unknown> {
  return { ...defaultDealInputs(300_000_00), ...over, scenario: "financed" };
}

describe("deal analysis routes", () => {
  let testApp: TestApp | null = null;

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  it("starts from the property's own price when nothing is saved", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const p = await makeProspect(testApp, user.headers);

    const res = await testApp.app.inject({
      method: "GET",
      url: `/api/properties/${p.id}/deal`,
      headers: user.headers,
    });
    const payload = unwrap<DealPayload>(res);
    expect(payload.saved).toBe(false);
    expect(payload.version).toBe(0);
    // Seeded from the property, so the tab opens on a real analysis rather than
    // a wall of zeroes.
    expect(payload.inputs.priceCents).toBe(450_000_00);
    expect(payload.analysis.financed).toBeDefined();
  });

  it("saves the inputs and computes the analysis server-side", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const p = await makeProspect(testApp, user.headers);

    const res = await testApp.app.inject({
      method: "PUT",
      url: `/api/properties/${p.id}/deal`,
      headers: user.headers,
      payload: body({ monthlyRentCents: 3_200_00, insuranceAnnualCents: 2_400_00 }),
    });
    expect(res.statusCode).toBe(200);
    const saved = unwrap<DealPayload>(res);
    expect(saved.saved).toBe(true);
    expect(saved.version).toBe(1);
    expect(saved.inputs.monthlyRentCents).toBe(3_200_00);
    // 3,200 x 12 = 38,400 gross, computed here and not sent by the caller.
    expect(saved.analysis.financed.grossAnnualCents).toBe(38_400_00);

    const reread = await testApp.app.inject({
      method: "GET",
      url: `/api/properties/${p.id}/deal`,
      headers: user.headers,
    });
    const again = unwrap<DealPayload>(reread);
    expect(again.inputs.monthlyRentCents).toBe(3_200_00);
    expect(again.analysis.financed.noiCents).toBe(saved.analysis.financed.noiCents);
  });

  it("bumps the version on each save and rejects a stale one", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const p = await makeProspect(testApp, user.headers);

    const first = unwrap<DealPayload>(
      await testApp.app.inject({
        method: "PUT",
        url: `/api/properties/${p.id}/deal`,
        headers: user.headers,
        payload: body({ monthlyRentCents: 3_000_00 }),
      }),
    );
    expect(first.version).toBe(1);

    const second = unwrap<DealPayload>(
      await testApp.app.inject({
        method: "PUT",
        url: `/api/properties/${p.id}/deal`,
        headers: user.headers,
        payload: { ...body({ monthlyRentCents: 3_100_00 }), expectedVersion: 1 },
      }),
    );
    expect(second.version).toBe(2);

    // Someone still holding version 1 must not clobber version 2.
    const stale = await testApp.app.inject({
      method: "PUT",
      url: `/api/properties/${p.id}/deal`,
      headers: user.headers,
      payload: { ...body({ monthlyRentCents: 9_999_00 }), expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);

    const after = unwrap<DealPayload>(
      await testApp.app.inject({
        method: "GET",
        url: `/api/properties/${p.id}/deal`,
        headers: user.headers,
      }),
    );
    expect(after.inputs.monthlyRentCents).toBe(3_100_00);
  });

  it("keeps the financed/cash choice across a save", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const p = await makeProspect(testApp, user.headers);

    await testApp.app.inject({
      method: "PUT",
      url: `/api/properties/${p.id}/deal`,
      headers: user.headers,
      payload: { ...body(), scenario: "cash" },
    });

    const got = unwrap<DealPayload>(
      await testApp.app.inject({
        method: "GET",
        url: `/api/properties/${p.id}/deal`,
        headers: user.headers,
      }),
    );
    expect(got.scenario).toBe("cash");
    expect(got.analysis.scenario).toBe("cash");
  });

  it("goes with the property when it is deleted", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const p = await makeProspect(testApp, user.headers);

    await testApp.app.inject({
      method: "PUT",
      url: `/api/properties/${p.id}/deal`,
      headers: user.headers,
      payload: body(),
    });

    const del = await testApp.app.inject({
      method: "DELETE",
      url: `/api/properties/${p.id}`,
      headers: (() => {
        const h = { ...user.headers };
        delete h["content-type"];
        return h;
      })(),
    });
    expect([200, 204]).toContain(del.statusCode);

    const gone = await testApp.app.inject({
      method: "GET",
      url: `/api/properties/${p.id}/deal`,
      headers: user.headers,
    });
    expect(gone.statusCode).toBe(404);
  });

  it("rejects nonsense input rather than storing it", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const p = await makeProspect(testApp, user.headers);

    const res = await testApp.app.inject({
      method: "PUT",
      url: `/api/properties/${p.id}/deal`,
      headers: user.headers,
      payload: { ...body(), interestRatePct: 900, termYears: 0 },
    });
    expect(res.statusCode).toBe(422);
  });

  it("needs a session", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const p = await makeProspect(testApp, user.headers);
    const res = await testApp.app.inject({ method: "GET", url: `/api/properties/${p.id}/deal` });
    expect(res.statusCode).toBe(401);
  });
});
