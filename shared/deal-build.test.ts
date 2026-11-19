// shared/deal-build.test.ts — buying land and building on it.
//
// The ask: "an option for a property or lot bought for land only, with a unit
// built on it new — cost of building in $/sqft, land price, rent per unit — and
// how many units on the land are needed to make a profit."
import { describe, expect, it } from "vitest";
import {
  analyzeDeal,
  buildCosts,
  defaultDealInputs,
  expandBuild,
  maxPriceForCashFlow,
  rentNeededForCashFlow,
  storyFactor,
  unitsToProfit,
  type DealInputs,
} from "./deal-analysis.js";
import { estimateUtilities, resolveUtilities } from "./utility-estimate.js";

/** $100k lot, 1,200 sq ft units at $250/sq ft, $25k of site work, $3,800/mo per unit. */
function lot(over: Partial<DealInputs> = {}): DealInputs {
  return {
    ...defaultDealInputs(100_000_00),
    dealKind: "build",
    closingCostsCents: 3_000_00,
    buildCostPerSqftCents: 250_00,
    unitSqft: 1200,
    unitCount: 1,
    rentPerUnitCents: 3_800_00,
    siteWorkCents: 25_000_00,
    utilitiesAuto: false,
    monthlyUtilitiesCents: 0,
    ...over,
  };
}

describe("buildCosts", () => {
  it("is land plus sq ft × $/sq ft × units plus site work", () => {
    const c = buildCosts(lot({ unitCount: 3 }));
    expect(c.landCents).toBe(100_000_00);
    expect(c.constructionCents).toBe(3 * 1200 * 250_00); // $900,000
    expect(c.siteWorkCents).toBe(25_000_00);
    expect(c.totalCents).toBe(100_000_00 + 900_000_00 + 25_000_00);
    expect(c.totalSqft).toBe(3600);
  });
});

describe("building up", () => {
  // "There's some type of discount in price per square foot when building up."
  it("spreads the foundation and roof — 15% of a one-story building — over the floors", () => {
    expect(storyFactor(1)).toBe(1);
    expect(storyFactor(2)).toBeCloseTo(0.925, 10);
    expect(storyFactor(3)).toBeCloseTo(0.9, 10);
    // Three stories is the most this models; nothing further is claimed above it.
    expect(storyFactor(4)).toBe(storyFactor(3));
    expect(storyFactor(0)).toBe(1);
  });

  it("prices the 1099 Ocean Trail six-unit condo as drawn", () => {
    // Six 864 sq ft units, two per floor, three stories: 5,184 sq ft.
    const c = buildCosts(
      lot({
        unitCount: 6,
        unitSqft: 864,
        stories: 3,
        buildCostPerSqftCents: 185_00,
        priceCents: 0,
        siteWorkCents: 0,
      }),
    );
    expect(c.totalSqft).toBe(5184);
    expect(c.effectiveCostPerSqftCents).toBe(166_50);
    expect(c.constructionCents).toBe(5184 * 166_50); // $863,136
    expect(c.stackingSavingsCents).toBe(5184 * 185_00 - 5184 * 166_50); // $95,904
  });

  it("changes nothing for a one-story build", () => {
    const flat = buildCosts(lot({ unitCount: 3, stories: 1 }));
    expect(flat.constructionCents).toBe(3 * 1200 * 250_00);
    expect(flat.stackingSavingsCents).toBe(0);
  });

  it("makes a taller building need fewer units, never more", () => {
    const one = unitsToProfit(lot({ stories: 1 }), "financed");
    const three = unitsToProfit(lot({ stories: 3 }), "financed");
    expect(three.marginPerUnitCents).toBeGreaterThan(one.marginPerUnitCents);
    expect(three.breakEvenUnits!).toBeLessThanOrEqual(one.breakEvenUnits!);
  });
});

describe("expandBuild", () => {
  it("restates the build as the finished building it produces", () => {
    const e = expandBuild(lot({ unitCount: 2, monthlyUtilitiesCents: 150_00 }));
    expect(e.priceCents).toBe(100_000_00 + 600_000_00 + 25_000_00);
    expect(e.rehabCents).toBe(0);
    expect(e.arvCents).toBeNull();
    expect(e.monthlyRentCents).toBe(2 * 3_800_00);
    expect(e.monthlyUtilitiesCents).toBe(300_00);
    expect(e.sqft).toBe(2400);
    // Depreciation is on the building only: the land's real share of the cost.
    expect(e.landPct).toBeCloseTo((100_000_00 / 725_000_00) * 100, 9);
    // Cautious: each unit carries its own base and flood policy.
    expect(e.baseHazardCents).toBe(2 * lot().baseHazardCents);
    expect(e.floodAnnualCents).toBe(2 * lot().floodAnnualCents);
  });

  it("leaves a purchase alone, whatever the build fields say", () => {
    const buy = defaultDealInputs(400_000_00);
    buy.monthlyRentCents = 3_000_00;
    const withJunk = {
      ...buy,
      unitCount: 9,
      rentPerUnitCents: 99_999_00,
      buildCostPerSqftCents: 1,
    };
    expect(expandBuild(withJunk)).toBe(withJunk);
    expect(analyzeDeal(withJunk)).toEqual(analyzeDeal(buy));
  });

  it("is analysed exactly as the equivalent purchase would be", () => {
    const build = lot({ unitCount: 2 });
    expect(analyzeDeal(build)).toEqual(analyzeDeal({ ...expandBuild(build), dealKind: "buy" }));
  });
});

describe("unitsToProfit", () => {
  it("finds the fewest units that break even and that clear the bar", () => {
    const result = unitsToProfit(lot({ unitCount: 1 }), "financed");
    const { rows, breakEvenUnits, profitableUnits } = result;
    expect(rows[0]!.units).toBe(1);
    expect(result.marginPerUnitCents).toBeGreaterThan(0);
    // Worked example, pinned so a change to the model cannot move it quietly:
    // one unit carries the whole lot and loses money; two break even; four
    // clear $100/mo at 6% cash-on-cash.
    expect(rows[0]!.monthlyCashFlowCents).toBeLessThan(0);
    expect(breakEvenUnits).toBe(2);
    expect(profitableUnits).toBe(4);

    // Each unit adds cash flow once the land is paid for.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.monthlyCashFlowCents).toBeGreaterThan(rows[i - 1]!.monthlyCashFlowCents);
    }
    expect(breakEvenUnits).not.toBeNull();
    expect(rows[breakEvenUnits! - 1]!.monthlyCashFlowCents).toBeGreaterThanOrEqual(0);
    if (breakEvenUnits! > 1)
      expect(rows[breakEvenUnits! - 2]!.monthlyCashFlowCents).toBeLessThan(0);
    expect(profitableUnits).not.toBeNull();
    expect(profitableUnits!).toBeGreaterThanOrEqual(breakEvenUnits!);
    expect(rows[profitableUnits! - 1]!.verdict).toBe("profitable");
    expect(rows.slice(0, profitableUnits! - 1).every((r) => r.verdict !== "profitable")).toBe(true);
  });

  it("says no count of units works when each unit loses money on its own", () => {
    const result = unitsToProfit(lot({ rentPerUnitCents: 800_00 }), "financed");
    expect(result.marginPerUnitCents).toBeLessThanOrEqual(0);
    expect(result.breakEvenUnits).toBeNull();
    expect(result.profitableUnits).toBeNull();
  });

  it("needs fewer units when the land is cheaper", () => {
    const dear = unitsToProfit(lot({ priceCents: 400_000_00 }), "cash");
    const cheap = unitsToProfit(lot({ priceCents: 50_000_00 }), "cash");
    expect(cheap.breakEvenUnits).not.toBeNull();
    expect(dear.breakEvenUnits ?? Infinity).toBeGreaterThanOrEqual(cheap.breakEvenUnits!);
  });
});

describe("the solvers on a build", () => {
  it("solves for rent PER UNIT", () => {
    const plan = lot({ unitCount: 3 });
    const rent = rentNeededForCashFlow(plan, 0, "financed")!;
    expect(rent).not.toBeNull();
    const at = (r: number): number =>
      analyzeDeal({ ...plan, rentPerUnitCents: r }).financed.monthlyCashFlowCents;
    expect(at(rent)).toBeGreaterThanOrEqual(0);
    expect(at(rent - 2_000)).toBeLessThan(0);
  });

  it("solves for what the LAND is worth paying, construction held fixed", () => {
    const plan = lot({ unitCount: 3 });
    const land = maxPriceForCashFlow(plan, 100_00, "financed")!;
    expect(land).not.toBeNull();
    expect(
      analyzeDeal({ ...plan, priceCents: land }).financed.monthlyCashFlowCents,
    ).toBeGreaterThanOrEqual(
      // Rounded to the nearest $500 of price, which can land a dollar or two
      // either side of the target.
      100_00 - 5_00,
    );
    expect(
      analyzeDeal({ ...plan, priceCents: land + 5_000_00 }).financed.monthlyCashFlowCents,
    ).toBeLessThan(100_00);
  });
});

describe("utilities on a build", () => {
  it("are estimated for one unit's size and stay per unit", () => {
    const plan = lot({
      utilitiesAuto: true,
      utilityPayer: "owner_all",
      unitSqft: 900,
      sqft: 5000,
      unitCount: 4,
    });
    const resolved = resolveUtilities(plan, "27948");
    const oneUnit = estimateUtilities({ ...plan, sqft: 900 }, "27948").ownerMonthlyCents;
    expect(resolved.monthlyUtilitiesCents).toBe(oneUnit);
    expect(expandBuild(resolved).monthlyUtilitiesCents).toBe(oneUnit * 4);
  });
});
