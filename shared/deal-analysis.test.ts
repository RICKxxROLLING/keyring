// shared/deal-analysis.test.ts — the arithmetic, pinned.
//
// This is a port of a calculator that was already in use, so the job of these
// tests is conservation: the numbers Keyring shows must be the numbers the
// original showed. Each case works the figure out longhand in the comment, so a
// future change to the model has to argue with the arithmetic rather than just
// re-baselining an expectation.
import { describe, expect, it } from "vitest";
import {
  analyzeDeal,
  defaultDealInputs,
  estimateClosingCosts,
  irr,
  maxPriceForCashFlow,
  rentNeededForCashFlow,
  type DealInputs,
} from "./deal-analysis.js";

/**
 * A deliberately round deal, so every intermediate is checkable by hand:
 * $300,000, 20% down, 6% for 30 years, $2,500/mo rent, no coastal insurance.
 */
function roundDeal(): DealInputs {
  return {
    ...defaultDealInputs(),
    priceCents: 300_000_00,
    closingCostsCents: 0,
    rehabCents: 0,
    arvCents: null,
    arvMode: "fixed",
    downPaymentMode: "percent",
    downPayment: 20,
    interestRatePct: 6,
    termYears: 30,
    financeCosts: false,
    monthlyRentCents: 2_500_00,
    monthlyOtherIncomeCents: 0,
    vacancyPct: 0,
    taxRatePct: 1,
    insuranceAnnualCents: 1_200_00,
    monthlyHoaCents: 0,
    monthlyUtilitiesCents: 0,
    maintenancePct: 0,
    capexPct: 0,
    managementPct: 0,
    taxBracketPct: 0,
    landPct: 20,
    appreciationPct: 0,
    rentGrowthPct: 0,
    expenseGrowthPct: 0,
    sellingCostPct: 0,
  };
}

describe("analyzeDeal — financing", () => {
  it("splits price into down payment and loan", () => {
    const { financed } = analyzeDeal(roundDeal());
    expect(financed.downPaymentCents).toBe(60_000_00); // 20% of 300k
    expect(financed.loanCents).toBe(240_000_00);
    expect(financed.investedCents).toBe(60_000_00);
  });

  it("computes the monthly payment from the amortisation formula", () => {
    const { financed } = analyzeDeal(roundDeal());
    // 240,000 at 0.5%/mo over 360 payments = $1,438.92
    expect(financed.paymentCents).toBeGreaterThan(1_438_00);
    expect(financed.paymentCents).toBeLessThan(1_440_00);
  });

  it("rolls closing and rehab into the loan when asked, which changes cash in", () => {
    const base = { ...roundDeal(), closingCostsCents: 12_000_00, rehabCents: 3_000_00 };

    const paidInCash = analyzeDeal({ ...base, financeCosts: false }).financed;
    // 20% of price, plus closing and rehab out of pocket.
    expect(paidInCash.downPaymentCents).toBe(60_000_00);
    expect(paidInCash.investedCents).toBe(75_000_00);

    const rolledIn = analyzeDeal({ ...base, financeCosts: true }).financed;
    // 20% of the whole 315,000, and that IS all the cash needed.
    expect(rolledIn.downPaymentCents).toBe(63_000_00);
    expect(rolledIn.investedCents).toBe(63_000_00);
    expect(rolledIn.loanCents).toBe(252_000_00);
  });

  it("an all-cash deal has no loan, no payment and the whole price invested", () => {
    const { cash } = analyzeDeal({ ...roundDeal(), closingCostsCents: 5_000_00 });
    expect(cash.loanCents).toBe(0);
    expect(cash.paymentCents).toBe(0);
    expect(cash.debtServiceCents).toBe(0);
    expect(cash.investedCents).toBe(305_000_00);
    expect(cash.dscr).toBeNull();
  });

  it("takes a fixed down payment in dollars when told to", () => {
    const { financed } = analyzeDeal({
      ...roundDeal(),
      downPaymentMode: "amount",
      downPayment: 45_000_00,
    });
    expect(financed.downPaymentCents).toBe(45_000_00);
    expect(financed.loanCents).toBe(255_000_00);
  });
});

describe("analyzeDeal — operating numbers", () => {
  it("works NOI down from gross rent", () => {
    const { financed } = analyzeDeal(roundDeal());
    expect(financed.grossAnnualCents).toBe(30_000_00); // 2,500 x 12
    expect(financed.effectiveGrossCents).toBe(30_000_00); // no vacancy
    expect(financed.taxCents).toBe(3_000_00); // 1% of 300k
    expect(financed.insuranceCents).toBe(1_200_00);
    expect(financed.noiCents).toBe(25_800_00); // 30,000 - 3,000 - 1,200
  });

  it("takes vacancy off the top and management off what is left", () => {
    const { financed } = analyzeDeal({ ...roundDeal(), vacancyPct: 10, managementPct: 10 });
    expect(financed.vacancyLossCents).toBe(3_000_00);
    expect(financed.effectiveGrossCents).toBe(27_000_00);
    // Management is 10% of the 27,000 collected, NOT of the 30,000 billed.
    expect(financed.managementCents).toBe(2_700_00);
  });

  it("charges maintenance and capex against gross, not effective gross", () => {
    const { financed } = analyzeDeal({
      ...roundDeal(),
      vacancyPct: 10,
      maintenancePct: 5,
      capexPct: 5,
    });
    expect(financed.maintenanceCents).toBe(1_500_00); // 5% of 30,000
    expect(financed.capexCents).toBe(1_500_00);
  });

  it("builds coastal insurance from hazard, wind per square foot and flood", () => {
    const { financed } = analyzeDeal({
      ...roundDeal(),
      insuranceAnnualCents: null,
      baseHazardCents: 1_800_00,
      windPerSqftCents: 130,
      floodAnnualCents: 2_500_00,
      sqft: 1_500,
    });
    // 1,800 + (1,500 sqft x $1.30) + 2,500 = 6,250
    expect(financed.insuranceCents).toBe(6_250_00);
  });

  it("reports cap rate, cash-on-cash, DSCR and the 1% rule", () => {
    const { financed } = analyzeDeal(roundDeal());
    expect(financed.capRatePct).toBeCloseTo(8.6, 1); // 25,800 / 300,000
    expect(financed.onePercentRulePct).toBeCloseTo(0.833, 2); // 2,500 / 300,000
    expect(financed.dscr!).toBeCloseTo(25_800 / (1_438.92 * 12), 1);
    // Cash flow 25,800 - 17,267 = 8,533 on 60,000 in = 14.2%
    expect(financed.cashOnCashPct).toBeCloseTo(14.2, 0);
  });
});

describe("analyzeDeal — projection", () => {
  it("runs ten years and pays the loan down", () => {
    const { financed } = analyzeDeal(roundDeal());
    expect(financed.years).toHaveLength(10);
    expect(financed.years[0]!.year).toBe(1);
    expect(financed.years[9]!.loanBalanceCents).toBeLessThan(financed.loanCents);
    expect(financed.years[9]!.equityCents).toBeGreaterThan(financed.years[0]!.equityCents);
  });

  it("grows value, rent and expenses at their own rates", () => {
    const { financed } = analyzeDeal({
      ...roundDeal(),
      appreciationPct: 10,
      rentGrowthPct: 0,
      expenseGrowthPct: 0,
    });
    // Year 1 is the starting value; growth begins in year 2.
    expect(financed.years[0]!.valueCents).toBe(300_000_00);
    expect(financed.years[1]!.valueCents).toBe(330_000_00);
  });

  it("adds the net sale into the final year for the IRR", () => {
    const { financed } = analyzeDeal({ ...roundDeal(), sellingCostPct: 10 });
    const last = financed.years[9]!;
    // 10% selling cost off the value, less whatever is still owed.
    expect(financed.netSaleProceedsCents).toBe(
      Math.round(last.valueCents * 0.9) - last.loanBalanceCents,
    );
    expect(financed.irrPct).not.toBeNull();
    expect(financed.irrPct!).toBeGreaterThan(0);
  });

  it("returns a null IRR when no rate can break even", () => {
    // Every flow negative: no discount rate makes this sum to zero.
    expect(irr([-1000, -100, -100, -100])).toBeNull();
  });

  it("solves a textbook IRR correctly", () => {
    // -1000 now, 600 for two years => 13.07%
    const r = irr([-1000, 600, 600]);
    expect(r).not.toBeNull();
    expect(r! * 100).toBeCloseTo(13.07, 1);
  });
});

describe("analyzeDeal — the verdict", () => {
  it("calls a deal that loses money every month negative", () => {
    const a = analyzeDeal({ ...roundDeal(), monthlyRentCents: 800_00 });
    expect(a.verdict).toBe("negative");
    expect(a.verdictLine).toContain("Loses");
  });

  it("calls a strong deal profitable", () => {
    const a = analyzeDeal(roundDeal());
    expect(a.verdict).toBe("profitable");
    expect(a.verdictLine).toContain("cash-on-cash");
  });

  it("calls a thin deal marginal and says which test it failed", () => {
    // $1,850/mo: gross 22,200, NOI 18,000, debt service 17,267 — so about
    // $61/mo. Positive, but under the $100 bar and well under 6% on 60k in.
    const a = analyzeDeal({ ...roundDeal(), monthlyRentCents: 1_850_00 });
    expect(a.verdict).toBe("marginal");
    expect(a.verdictLine).toContain("cash flow only");
  });

  it("judges the scenario it was asked about", () => {
    const input = { ...roundDeal(), monthlyRentCents: 1_500_00 };
    // Financed loses money on this rent; all-cash has no mortgage to cover.
    expect(analyzeDeal(input, "financed").verdict).toBe("negative");
    expect(analyzeDeal(input, "cash").verdict).not.toBe("negative");
  });
});

describe("maxPriceForCashFlow", () => {
  it("finds the price at which the deal still clears the target", () => {
    const input = roundDeal();
    const max = maxPriceForCashFlow(input, 100_00);
    expect(max).not.toBeNull();

    // At that price the deal makes at least the target...
    const at = analyzeDeal({ ...input, priceCents: max! }).financed.monthlyCashFlowCents;
    expect(at).toBeGreaterThanOrEqual(99_00);

    // ...and $20k more breaks it.
    const above = analyzeDeal({ ...input, priceCents: max! + 20_000_00 }).financed
      .monthlyCashFlowCents;
    expect(above).toBeLessThan(100_00);
  });

  it("returns null when no price works", () => {
    // Rent cannot cover a $10,000/month target at any price.
    expect(maxPriceForCashFlow(roundDeal(), 10_000_00)).toBeNull();
  });
});

describe("estimateClosingCosts", () => {
  it("itemises rather than returning one opaque percentage", () => {
    const { items, totalCents } = estimateClosingCosts(roundDeal());
    expect(items.length).toBeGreaterThan(3);
    expect(items.every((i) => i.label && i.basis && i.cents > 0)).toBe(true);
    expect(totalCents).toBe(items.reduce((s, i) => s + i.cents, 0));
  });

  it("never includes an agent commission", () => {
    const { items, totalCents } = estimateClosingCosts(roundDeal());
    // The buyer's agent is paid from the seller's proceeds in the ordinary
    // case; including it would overstate cash-to-close by tens of thousands.
    expect(items.some((i) => /commission|agent|realtor|broker/i.test(i.label))).toBe(false);
    // 3% of 300k would be 9,000 on its own — the whole estimate is under that.
    expect(totalCents).toBeLessThan(9_000_00);
  });

  it("lands in the usual range for a financed purchase", () => {
    const { totalCents } = estimateClosingCosts(roundDeal());
    const pct = (totalCents / 300_000_00) * 100;
    expect(pct).toBeGreaterThan(1);
    expect(pct).toBeLessThan(3.5);
  });

  it("drops the lender fees and appraisal for an all-cash purchase", () => {
    const financed = estimateClosingCosts(roundDeal(), "financed");
    const cash = estimateClosingCosts(roundDeal(), "cash");
    expect(financed.items.some((i) => /lender/i.test(i.label))).toBe(true);
    expect(cash.items.some((i) => /lender|appraisal/i.test(i.label))).toBe(false);
    expect(cash.totalCents).toBeLessThan(financed.totalCents);
  });

  it("scales the escrow with the local tax and insurance, not just the price", () => {
    const cheap = estimateClosingCosts({ ...roundDeal(), taxRatePct: 0.26 });
    const dear = estimateClosingCosts({ ...roundDeal(), taxRatePct: 1.5 });
    expect(dear.totalCents).toBeGreaterThan(cheap.totalCents);
  });

  it("builds escrow from the coastal figures when insurance is not a flat number", () => {
    const coastal = estimateClosingCosts({
      ...roundDeal(),
      insuranceAnnualCents: null,
      baseHazardCents: 1_800_00,
      windPerSqftCents: 130,
      floodAnnualCents: 4_500_00,
      sqft: 2_000,
    });
    const flat = estimateClosingCosts({ ...roundDeal(), insuranceAnnualCents: 1_200_00 });
    // Coastal insurance is ~8,900/yr against 1,200 — a quarter of that gap has
    // to show up in the prepaid escrow.
    expect(coastal.totalCents).toBeGreaterThan(flat.totalCents + 1_500_00);
  });

  it("returns something sane for a zero-price deal", () => {
    const { totalCents } = estimateClosingCosts(defaultDealInputs(0));
    expect(Number.isFinite(totalCents)).toBe(true);
    expect(totalCents).toBeGreaterThanOrEqual(0);
  });
});

describe("rentNeededForCashFlow", () => {
  it("finds the rent that breaks even at the asking price", () => {
    // Strip the rent out so the answer has to come from the solver.
    const input = { ...roundDeal(), monthlyRentCents: 0 };
    const need = rentNeededForCashFlow(input, 0);
    expect(need).not.toBeNull();

    const at = analyzeDeal({ ...input, monthlyRentCents: need! }).financed.monthlyCashFlowCents;
    expect(at).toBeGreaterThanOrEqual(-500); // within the $5 rounding
    expect(at).toBeLessThan(1_000);

    // $100 less a month and it stops working.
    const under = analyzeDeal({ ...input, monthlyRentCents: need! - 100_00 }).financed
      .monthlyCashFlowCents;
    expect(under).toBeLessThan(0);
  });

  it("accounts for the expenses that scale with rent", () => {
    const lean = { ...roundDeal(), monthlyRentCents: 0, managementPct: 0, vacancyPct: 0 };
    const loaded = { ...lean, managementPct: 10, vacancyPct: 8 };
    // Charging 10% management and losing 8% to vacancy means more rent is
    // needed to clear the same bar — a flat solve would miss this.
    expect(rentNeededForCashFlow(loaded, 0)!).toBeGreaterThan(rentNeededForCashFlow(lean, 0)!);
  });

  it("is lower for an all-cash purchase, which has no mortgage to cover", () => {
    const input = { ...roundDeal(), monthlyRentCents: 0 };
    expect(rentNeededForCashFlow(input, 0, "cash")!).toBeLessThan(
      rentNeededForCashFlow(input, 0, "financed")!,
    );
  });

  it("returns null when no rent could ever clear the target", () => {
    expect(rentNeededForCashFlow(roundDeal(), 10_000_000_00)).toBeNull();
  });
});

describe("defaults", () => {
  it("derives closing and rehab from the price", () => {
    const d = defaultDealInputs(400_000_00);
    expect(d.closingCostsCents).toBe(16_000_00); // 4%
    expect(d.rehabCents).toBe(4_000_00); // 1%
  });

  it("survives an all-zero deal without dividing by zero", () => {
    const a = analyzeDeal(defaultDealInputs(0));
    expect(a.financed.capRatePct).toBe(0);
    expect(a.financed.cashOnCashPct).toBe(0);
    expect(Number.isFinite(a.financed.noiCents)).toBe(true);
  });
});
