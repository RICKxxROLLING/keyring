// server/domain/deals/variant.test.ts — plan B.
//
// The storage decision being defended: B is a set of OVERRIDES on A, not a
// copy. The test that matters most is the one where A's price changes and B
// follows — that is the property a copy would silently lose.
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../../testing/harness.js";
import { defaultDealInputs, type DealAnalysis, type DealInputs } from "../../../shared/deal-analysis.js";
import type { PropertyView } from "../../../shared/types.js";

interface Variant {
  label: string;
  overrides: Partial<DealInputs>;
  version: number;
  analysis: DealAnalysis;
}

interface DealPayload {
  inputs: DealInputs;
  version: number;
  analysis: DealAnalysis;
  variant: Variant | null;
}

function bodyless(h: Record<string, string>): Record<string, string> {
  const rest = { ...h };
  delete rest["content-type"];
  return rest;
}

describe("plan B", () => {
  let testApp: TestApp | null = null;

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  async function setup(): Promise<{ headers: Record<string, string>; propertyId: string }> {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const p = unwrap<PropertyView>(
      await testApp.app.inject({
        method: "POST",
        url: "/api/properties",
        headers: user.headers,
        payload: {
          name: "Three bed, could be four",
          addressLine1: "9 Ocean Ave",
          city: "Kill Devil Hills",
          state: "NC",
          postalCode: "27948",
          propertyType: "single_family",
          stage: "prospect",
        },
      }),
    );
    await saveA(user.headers, p.id, { priceCents: 400_000_00, monthlyRentCents: 3_000_00 });
    return { headers: user.headers, propertyId: p.id };
  }

  async function saveA(
    headers: Record<string, string>,
    propertyId: string,
    over: Partial<DealInputs>,
    expectedVersion?: number,
  ): Promise<DealPayload> {
    const res = await testApp!.app.inject({
      method: "PUT",
      url: `/api/properties/${propertyId}/deal`,
      headers,
      payload: {
        ...defaultDealInputs(),
        ...over,
        scenario: "financed",
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      },
    });
    expect(res.statusCode).toBe(200);
    return unwrap<DealPayload>(res);
  }

  async function read(headers: Record<string, string>, propertyId: string): Promise<DealPayload> {
    const res = await testApp!.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/deal`,
      headers,
    });
    return unwrap<DealPayload>(res);
  }

  it("does not exist until someone adds one", async () => {
    const { headers, propertyId } = await setup();
    expect((await read(headers, propertyId)).variant).toBeNull();
  });

  it("stores only what differs, and analyses B from A plus those changes", async () => {
    const { headers, propertyId } = await setup();
    const res = await testApp!.app.inject({
      method: "PUT",
      url: `/api/properties/${propertyId}/deal/variant`,
      headers,
      payload: {
        label: "Add a bedroom",
        overrides: { rehabCents: 45_000_00, monthlyRentCents: 3_600_00 },
      },
    });
    expect(res.statusCode).toBe(200);
    const v = unwrap<Variant>(res);
    expect(v.label).toBe("Add a bedroom");
    expect(v.overrides).toEqual({ rehabCents: 45_000_00, monthlyRentCents: 3_600_00 });
    // 3,600 × 12, from B's rent — not A's 3,000.
    expect(v.analysis.financed.grossAnnualCents).toBe(43_200_00);
  });

  it("follows A for everything it does not override", async () => {
    const { headers, propertyId } = await setup();
    await testApp!.app.inject({
      method: "PUT",
      url: `/api/properties/${propertyId}/deal/variant`,
      headers,
      payload: { label: "Add a bedroom", overrides: { rehabCents: 45_000_00 } },
    });

    const before = await read(headers, propertyId);
    const aVersion = before.version;
    const investedBefore = before.variant!.analysis.financed.investedCents;

    // The price moves on A. A stored copy of B would still be on $400k.
    const after = await saveA(
      headers,
      propertyId,
      { priceCents: 500_000_00, monthlyRentCents: 3_000_00 },
      aVersion,
    );
    expect(after.variant!.overrides).toEqual({ rehabCents: 45_000_00 });
    // 20% down on the extra $100k.
    expect(after.variant!.analysis.financed.investedCents - investedBefore).toBe(20_000_00);
  });

  it("refuses to let B pick a different financing scenario", async () => {
    const { headers, propertyId } = await setup();
    const res = await testApp!.app.inject({
      method: "PUT",
      url: `/api/properties/${propertyId}/deal/variant`,
      headers,
      payload: { label: "Sneaky", overrides: { scenario: "cash" } },
    });
    // A mortgage against a cash purchase is not a comparison of a bedroom.
    expect(res.statusCode).toBe(422);
  });

  it("validates overrides as strictly as A's own inputs", async () => {
    const { headers, propertyId } = await setup();
    for (const overrides of [{ rehabCents: -5 }, { termYears: 0 }, { notAnInput: 1 }]) {
      const res = await testApp!.app.inject({
        method: "PUT",
        url: `/api/properties/${propertyId}/deal/variant`,
        headers,
        payload: { label: "Bad", overrides },
      });
      expect(res.statusCode, JSON.stringify(overrides)).toBe(422);
    }
  });

  it("rejects a stale edit rather than overwriting someone else's", async () => {
    const { headers, propertyId } = await setup();
    const put = (overrides: Partial<DealInputs>, expectedVersion?: number) =>
      testApp!.app.inject({
        method: "PUT",
        url: `/api/properties/${propertyId}/deal/variant`,
        headers,
        payload: { label: "Add a bedroom", overrides, ...(expectedVersion ? { expectedVersion } : {}) },
      });
    const first = unwrap<Variant>(await put({ rehabCents: 45_000_00 }));
    expect(first.version).toBe(1);
    expect((await put({ rehabCents: 50_000_00 }, 1)).statusCode).toBe(200);
    expect((await put({ rehabCents: 60_000_00 }, 1)).statusCode).toBe(409);
  });

  it("can be removed, leaving A untouched", async () => {
    const { headers, propertyId } = await setup();
    await testApp!.app.inject({
      method: "PUT",
      url: `/api/properties/${propertyId}/deal/variant`,
      headers,
      payload: { label: "Add a bedroom", overrides: { rehabCents: 45_000_00 } },
    });
    const del = await testApp!.app.inject({
      method: "DELETE",
      url: `/api/properties/${propertyId}/deal/variant`,
      headers: bodyless(headers),
    });
    expect(del.statusCode).toBe(200);

    const after = await read(headers, propertyId);
    expect(after.variant).toBeNull();
    expect(after.inputs.priceCents).toBe(400_000_00);
    expect(after.inputs.rehabCents).toBe(0);
  });

  it("drops stored overrides that no longer pass the schema instead of using them", async () => {
    const { headers, propertyId } = await setup();
    await testApp!.app.inject({
      method: "PUT",
      url: `/api/properties/${propertyId}/deal/variant`,
      headers,
      payload: { label: "Add a bedroom", overrides: { rehabCents: 45_000_00 } },
    });
    // A later analyzer version renamed an input; an old row still has it.
    const { getDb } = await import("../../db/index.js");
    getDb()
      .prepare(`UPDATE property_deal_variants SET overrides = ? WHERE property_id = ?`)
      .run(JSON.stringify({ rehabCents: 45_000_00, retiredInput: 7 }), propertyId);

    const v = (await read(headers, propertyId)).variant!;
    // Nothing unknown is spread over A's inputs and fed into the arithmetic.
    expect(v.overrides).toEqual({});
    expect(v.label).toBe("Add a bedroom");
  });
});
