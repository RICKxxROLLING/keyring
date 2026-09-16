// shared/deal-compare.ts — plan A against plan B.
//
// "Could adding a bedroom be worth the extra upfront cost for the extra rent?"
//
// B is stored as OVERRIDES of A — only the fields that differ — never as a
// second full copy. That is the whole design, and the reason is the question
// itself: it is "this house, plus a bedroom". If B were a copy, changing the
// purchase price on A would leave B on the old price, and the comparison would
// silently become two different houses at two different prices with the extra
// bedroom somewhere in the noise. As overrides, everything B does not
// deliberately change follows A.
//
// The answer that matters is not "which plan has better numbers" — B nearly
// always has higher rent — but "does the extra money earn its keep". So the
// comparison is built around the INCREMENT: how much more cash goes in, how
// much more comes back each year, and how long before the extra is repaid.
import type { DealInputs, ScenarioResult } from "./deal-analysis.js";

export type DealOverrides = Partial<DealInputs>;

/** B, as a complete set of inputs. */
export function applyOverrides(base: DealInputs, overrides: DealOverrides): DealInputs {
  return { ...base, ...overrides };
}

/**
 * Only the fields where `variant` differs from `base`.
 *
 * Used when B is edited: setting a field back to A's value removes the override
 * rather than pinning it, so B goes back to following A for that field.
 */
export function diffInputs(base: DealInputs, variant: DealInputs): DealOverrides {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(variant) as (keyof DealInputs)[]) {
    if (!Object.is(variant[key], base[key])) out[key] = variant[key];
  }
  return out as DealOverrides;
}

export type ComparisonVerdict = "b_better" | "a_better" | "even";

export interface DealComparison {
  /** Extra cash B needs up front. Negative when B needs less. */
  extraInvestedCents: number;
  extraMonthlyCashFlowCents: number;
  extraAnnualCashFlowCents: number;
  /** Difference in ten-year profit, sale included. The headline. */
  extraTotalProfitCents: number;
  /** B's IRR minus A's, in percentage points; null if either cannot be solved. */
  irrDeltaPts: number | null;
  /**
   * Years until B's extra cash flow has repaid its extra cost, or null if it
   * does not within the projection. 0 when B needs no extra cash at all.
   * Fractional: 3.4 means partway through year four.
   */
  paybackYears: number | null;
  /**
   * B's extra year-one cash flow as a percent of its extra cost — the return on
   * the renovation money specifically. Null when B costs nothing extra.
   */
  returnOnExtraPct: number | null;
  verdict: ComparisonVerdict;
  verdictLine: string;
}

/**
 * Within this, the two plans are called even. A thousand dollars over ten years
 * is inside the error of every assumption on the page — the rent, the rate, the
 * resale value — and declaring a winner on it would be false precision.
 */
const EVEN_WITHIN_CENTS = 1_000_00;

export function compareScenarios(a: ScenarioResult, b: ScenarioResult): DealComparison {
  const extraInvestedCents = b.investedCents - a.investedCents;
  const extraAnnualCashFlowCents = b.annualCashFlowCents - a.annualCashFlowCents;
  const extraMonthlyCashFlowCents = b.monthlyCashFlowCents - a.monthlyCashFlowCents;
  const extraTotalProfitCents = b.totalProfitCents - a.totalProfitCents;

  const irrDeltaPts = a.irrPct !== null && b.irrPct !== null ? b.irrPct - a.irrPct : null;

  const paybackYears = payback(a, b, extraInvestedCents);

  const returnOnExtraPct =
    extraInvestedCents > 0 ? (extraAnnualCashFlowCents / extraInvestedCents) * 100 : null;

  let verdict: ComparisonVerdict;
  if (Math.abs(extraTotalProfitCents) < EVEN_WITHIN_CENTS) verdict = "even";
  else verdict = extraTotalProfitCents > 0 ? "b_better" : "a_better";

  return {
    extraInvestedCents,
    extraMonthlyCashFlowCents,
    extraAnnualCashFlowCents,
    extraTotalProfitCents,
    irrDeltaPts,
    paybackYears,
    returnOnExtraPct,
    verdict,
    verdictLine: verdictLine(verdict, extraTotalProfitCents, paybackYears, extraInvestedCents),
  };
}

/**
 * When B's cumulative extra cash flow first covers its extra cost.
 *
 * Walked year by year through the projection rather than divided once, because
 * rent grows: extra cost / year-one extra cash flow overstates the wait for
 * any deal where the rent gap widens every year, which is all of them.
 *
 * The sale is left out on purpose. Counting it would make almost any
 * renovation "pay back" in year ten through resale value, which answers a
 * different question from the one being asked — how long the extra money is
 * tied up before the extra rent has returned it.
 */
function payback(a: ScenarioResult, b: ScenarioResult, extraInvested: number): number | null {
  if (extraInvested <= 0) return 0;
  let recovered = 0;
  const years = Math.min(a.years.length, b.years.length);
  for (let i = 0; i < years; i += 1) {
    const extra = b.years[i]!.cashFlowCents - a.years[i]!.cashFlowCents;
    if (extra > 0 && recovered + extra >= extraInvested) {
      return i + (extraInvested - recovered) / extra;
    }
    recovered += extra;
  }
  return null;
}

function money(cents: number): string {
  const dollars = Math.round(Math.abs(cents) / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

function verdictLine(
  verdict: ComparisonVerdict,
  extraProfit: number,
  paybackYears: number | null,
  extraInvested: number,
): string {
  if (verdict === "even") {
    return "The two plans come out within $1,000 of each other over ten years.";
  }
  if (verdict === "b_better") {
    const tail =
      extraInvested <= 0
        ? " and needs no extra cash up front."
        : paybackYears === null
          ? ", mostly through resale value — the extra rent alone does not repay the extra cost within ten years."
          : `, and the extra rent repays the extra cost in ${paybackYears.toFixed(1)} years.`;
    return `B earns ${money(extraProfit)} more over ten years${tail}`;
  }
  return `A earns ${money(extraProfit)} more over ten years — B's extra cost is not repaid by what it adds.`;
}
