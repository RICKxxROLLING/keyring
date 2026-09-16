// shared/deal-compare.test.ts — is the bedroom worth it?
import { describe, expect, it } from "vitest";
import { analyzeDeal, defaultDealInputs, type DealInputs } from "./deal-analysis.js";
import { applyOverrides, compareScenarios, diffInputs } from "./deal-compare.js";

/** All cash and no growth, so every increment is checkable by hand. */
function plain(): DealInputs {
  return {
    ...defaultDealInputs(),
    priceCents: 300_000_00,
    closingCostsCents: 0,
    rehabCents: 0,
    arvCents: null,
    arvMode: "fixed",
    monthlyRentCents: 2_500_00,
    monthlyOtherIncomeCents: 0,
    vacancyPct: 0,
    taxRatePct: 0,
    insuranceAnnualCents: 0,
    monthlyHoaCents: 0,
    monthlyUtilitiesCents: 0,
    maintenancePct: 0,
    capexPct: 0,
    managementPct: 0,
    appreciationPct: 0,
    rentGrowthPct: 0,
    expenseGrowthPct: 0,
    sellingCostPct: 0,
  };
}

function compare(a: DealInputs, overrides: Partial<DealInputs>) {
  const b = applyOverrides(a, overrides);
  return compareScenarios(analyzeDeal(a, "cash").cash, analyzeDeal(b, "cash").cash);
}

describe("overrides", () => {
  it("follow A for everything B does not change", () => {
    const a = plain();
    const b = applyOverrides(a, { rehabCents: 40_000_00, monthlyRentCents: 3_000_00 });
    expect(b.rehabCents).toBe(40_000_00);
    // The point of storing a diff: A's price moving moves B's too.
    const moved = applyOverrides({ ...a, priceCents: 350_000_00 }, { rehabCents: 40_000_00 });
    expect(moved.priceCents).toBe(350_000_00);
  });

  it("record only what differs, so setting a field back to A un-pins it", () => {
    const a = plain();
    expect(diffInputs(a, { ...a, rehabCents: 40_000_00 })).toEqual({ rehabCents: 40_000_00 });
    expect(diffInputs(a, { ...a })).toEqual({});
    // null is a real value for arvCents ("derive it"), not an absence.
    expect(diffInputs({ ...a, arvCents: 400_000_00 }, { ...a, arvCents: null })).toEqual({
      arvCents: null,
    });
  });
});

describe("compareScenarios — adding a bedroom", () => {
  it("measures the increment: extra cash in, extra cash back", () => {
    // $40k to add a bedroom, rent up $500/mo.
    const c = compare(plain(), { rehabCents: 40_000_00, monthlyRentCents: 3_000_00 });
    expect(c.extraInvestedCents).toBe(40_000_00);
    expect(c.extraMonthlyCashFlowCents).toBe(500_00);
    expect(c.extraAnnualCashFlowCents).toBe(6_000_00);
    // $6,000 a year on $40,000 of renovation.
    expect(c.returnOnExtraPct).toBeCloseTo(15, 5);
  });

  it("pays back when the cumulative extra rent covers the extra cost", () => {
    const c = compare(plain(), { rehabCents: 40_000_00, monthlyRentCents: 3_000_00 });
    // 40,000 / 6,000 = 6.67 years, flat rent.
    expect(c.paybackYears).toBeCloseTo(40_000 / 6_000, 5);
  });

  it("pays back sooner when the rent gap widens every year", () => {
    const flat = compare(plain(), { rehabCents: 40_000_00, monthlyRentCents: 3_000_00 });
    const growing = compare(
      { ...plain(), rentGrowthPct: 3 },
      { rehabCents: 40_000_00, monthlyRentCents: 3_000_00 },
    );
    // Dividing once by year one's gap would report the same wait for both.
    expect(growing.paybackYears!).toBeLessThan(flat.paybackYears!);
  });

  it("says so plainly when the extra rent never repays the extra cost", () => {
    // $100k for $100/mo: $12,000 back over ten years.
    const c = compare(
      { ...plain(), arvCents: 300_000_00 },
      { rehabCents: 100_000_00, monthlyRentCents: 2_600_00 },
    );
    expect(c.paybackYears).toBeNull();
    expect(c.verdict).toBe("a_better");
    expect(c.verdictLine).toMatch(/A earns/);
  });

  it("counts resale value in the ten-year verdict, but not in the payback", () => {
    // A fixed ARV means the renovation adds its full cost to the value, which
    // is sold in year ten — so B wins on total profit while the rent alone
    // still has not repaid the renovation.
    const c = compare(plain(), { rehabCents: 100_000_00, monthlyRentCents: 2_600_00 });
    expect(c.verdict).toBe("b_better");
    expect(c.paybackYears).toBeNull();
    expect(c.verdictLine).toMatch(/mostly through resale value/);
  });

  it("calls a near-tie a tie rather than inventing a winner", () => {
    const c = compare({ ...plain(), arvCents: 300_000_00 }, { monthlyRentCents: 2_505_00 });
    // $5/mo for ten years is $600.
    expect(c.extraTotalProfitCents).toBe(600_00);
    expect(c.verdict).toBe("even");
  });

  it("treats a change that needs no extra cash as paid back already", () => {
    const c = compare(plain(), { monthlyRentCents: 2_700_00 });
    expect(c.extraInvestedCents).toBe(0);
    expect(c.paybackYears).toBe(0);
    expect(c.returnOnExtraPct).toBeNull();
    expect(c.verdictLine).toMatch(/no extra cash/);
  });

  it("follows the financing: rolled-in rehab costs less cash but more debt", () => {
    const a = { ...plain(), financeCosts: true, rehabCents: 0 };
    const b = applyOverrides(a, { rehabCents: 40_000_00, monthlyRentCents: 3_000_00 });
    const c = compareScenarios(
      analyzeDeal(a, "financed").financed,
      analyzeDeal(b, "financed").financed,
    );
    // 20% down on the extra $40k, not the whole $40k.
    expect(c.extraInvestedCents).toBe(8_000_00);
    // And the extra rent is partly eaten by the bigger mortgage.
    expect(c.extraMonthlyCashFlowCents).toBeLessThan(500_00);
    expect(c.extraMonthlyCashFlowCents).toBeGreaterThan(0);
  });
});
