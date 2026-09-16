// shared/utility-estimate.test.ts — what the bills come to.
//
// Each figure is worked out longhand in the comment beside it, so a change to a
// coefficient or a rate has to argue with the arithmetic rather than simply
// re-baseline the expectation.
import { describe, expect, it } from "vitest";
import { analyzeDeal, defaultDealInputs, type DealInputs } from "./deal-analysis.js";
import { applyOverrides } from "./deal-compare.js";
import {
  estimateUtilities,
  occupantsFor,
  resolveUtilities,
  utilityRatesForZip,
} from "./utility-estimate.js";

const KDH = "27948";

function house(over: Partial<DealInputs> = {}): DealInputs {
  return {
    ...defaultDealInputs(400_000_00),
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1_600,
    utilitiesAuto: true,
    utilityPayer: "owner_all",
    ...over,
  };
}

describe("usage", () => {
  it("puts two people in the first bedroom and one in each after", () => {
    expect(occupantsFor(1)).toBe(2);
    expect(occupantsFor(3)).toBe(4);
    // A studio still has somebody living in it.
    expect(occupantsFor(0)).toBe(1);
  });

  it("sizes electricity from the floor area and the household", () => {
    const e = estimateUtilities(house(), KDH);
    // 250 + 0.35 × 1,600 + 75 × 4 = 250 + 560 + 300
    expect(e.kwh).toBe(1_110);
  });

  it("sizes water from the household, a little more for extra bathrooms", () => {
    const e = estimateUtilities(house(), KDH);
    // 4 people × 60 gal × 30.4 days × (1 + 0.05 × 1 extra bath) = 7,660.8
    expect(e.gallons).toBe(7_661);
  });

  it("infers a size from the bedrooms when square feet are missing", () => {
    const e = estimateUtilities(house({ sqft: 0 }), KDH);
    // 600 + 400 × 3 = 1,800 sq ft → 250 + 630 + 300
    expect(e.kwh).toBe(1_180);
  });
});

describe("Kill Devil Hills rates", () => {
  const e = estimateUtilities(house(), KDH);
  const line = (key: string) => e.lines.find((l) => l.key === key)!;

  it("prices electric at Dominion's rate plus its customer charge", () => {
    // 1,110 kWh × 15.0¢ = $166.50, + $6.58
    expect(line("electric").monthlyCents).toBe(173_08);
  });

  it("prices water on Dare County's July 2026 schedule", () => {
    // Base $49.80 a quarter = $16.60 a month, 1,000 gal included.
    // 6,661 gal over × average of $10.74 and $8.27 ($9.505) = $63.31
    expect(line("water").monthlyCents).toBe(Math.round(1660 + 6.661 * 950.5));
    expect(line("water").unknown).toBe(false);
  });

  it("reserves for septic pumping and charges nothing separate for town trash", () => {
    // $450 every 36 months.
    expect(line("sewer").monthlyCents).toBe(1_250);
    expect(line("sewer").label).toMatch(/Septic/);
    expect(line("trash").monthlyCents).toBe(0);
    expect(line("trash").unknown).toBe(false);
  });

  it("is a complete local estimate", () => {
    expect(e.rates.confidence).toBe("local");
  });
});

describe("where the rates are not known", () => {
  it("leaves Nags Head water at $0 and says why, rather than borrowing the county's", () => {
    const e = estimateUtilities(house(), "27959");
    const water = e.lines.find((l) => l.key === "water")!;
    // The town bills its own water. Using Dare County's price here would look
    // precise and be somebody else's rate.
    expect(water.monthlyCents).toBe(0);
    expect(water.unknown).toBe(true);
    expect(water.basis).toMatch(/Town of Nags Head/);
    expect(e.rates.confidence).toBe("partial");
  });

  it("leaves Manteo's water and sewer blank — both are town-billed", () => {
    const e = estimateUtilities(house(), "27954");
    expect(e.lines.find((l) => l.key === "water")!.unknown).toBe(true);
    expect(e.lines.find((l) => l.key === "sewer")!.unknown).toBe(true);
  });

  it("does not price Hatteras Island power as if it were Dominion's", () => {
    const rates = utilityRatesForZip("27920");
    expect(rates.electricProvider).toMatch(/Cape Hatteras/);
    expect(rates.confidence).toBe("partial");
  });

  it("still estimates electricity anywhere, at the US average, and says so", () => {
    const e = estimateUtilities(house(), "90210");
    expect(e.rates.confidence).toBe("general");
    // 1,110 kWh × 16.8¢, no local customer charge
    expect(e.lines.find((l) => l.key === "electric")!.monthlyCents).toBe(Math.round(1_110 * 16.8));
    expect(e.lines.find((l) => l.key === "water")!.unknown).toBe(true);
  });
});

describe("who pays", () => {
  it("on a long-term let, keeps only the bills that follow the property", () => {
    const e = estimateUtilities(house({ utilityPayer: "tenant_utilities" }), KDH);
    const owner = e.lines.filter((l) => l.ownerPays).map((l) => l.key);
    expect(owner).toEqual(["water", "sewer", "trash"]);
    expect(e.ownerMonthlyCents).toBeLessThan(e.totalMonthlyCents);
  });

  it("on a vacation rental, carries everything", () => {
    const e = estimateUtilities(house({ utilityPayer: "owner_all" }), KDH);
    expect(e.ownerMonthlyCents).toBe(e.totalMonthlyCents);
  });

  it("when the tenant pays everything, costs the owner nothing", () => {
    expect(estimateUtilities(house({ utilityPayer: "tenant_all" }), KDH).ownerMonthlyCents).toBe(0);
  });
});

describe("feeding the deal", () => {
  it("replaces the typed figure only when the estimate is switched on", () => {
    const typed = house({ utilitiesAuto: false, monthlyUtilitiesCents: 123_00 });
    expect(resolveUtilities(typed, KDH).monthlyUtilitiesCents).toBe(123_00);

    const auto = house({ utilitiesAuto: true, monthlyUtilitiesCents: 123_00 });
    expect(resolveUtilities(auto, KDH).monthlyUtilitiesCents).toBe(
      estimateUtilities(auto, KDH).ownerMonthlyCents,
    );
  });

  it("charges plan B's extra bedroom to plan B's bills", () => {
    // The reason this is computed rather than typed: a figure entered once
    // would stay put while B's bedroom count rose.
    const a = house();
    const b = applyOverrides(a, { bedrooms: 4 });
    const aBills = resolveUtilities(a, KDH).monthlyUtilitiesCents;
    const bBills = resolveUtilities(b, KDH).monthlyUtilitiesCents;
    expect(bBills).toBeGreaterThan(aBills);

    // And it reaches the cash flow.
    const aFlow = analyzeDeal(resolveUtilities(a, KDH), "cash").cash.monthlyCashFlowCents;
    const bFlow = analyzeDeal(resolveUtilities(b, KDH), "cash").cash.monthlyCashFlowCents;
    expect(aFlow - bFlow).toBeCloseTo(bBills - aBills, -1);
  });
});
