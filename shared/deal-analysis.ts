// shared/deal-analysis.ts — will this property make money?
//
// A port of the Outer Banks Rental Property Analyzer (invest.hireclan.org) into
// Keyring, so the two are one app: you work a deal out on the prospect itself
// rather than in a separate tab with the numbers retyped.
//
// The model is unchanged from the original — same formulas, same verdict
// thresholds, same 10-year projection — and deal-analysis.test.ts pins the
// arithmetic to worked examples so a refactor cannot quietly move a number.
//
// Two deliberate differences from the source:
//
//   1. Money is in CENTS, like everywhere else in this app. The original used
//      dollars; a codebase with two money conventions eventually adds one to
//      the other.
//   2. Nothing computed is ever stored. Only the INPUTS live in the database.
//      Cap rate and cash-on-cash are functions of the inputs, so storing them
//      would create a second copy that goes stale the moment an assumption
//      changes — the same reasoning that makes heroColor stored (it is
//      identity) and this derived (it is arithmetic).

export type DownPaymentMode = "percent" | "amount";
export type ArvMode = "fixed" | "conservative" | "aggressive";
export type DealScenario = "financed" | "cash";

/** Rehab multiplier applied to the after-repair value. */
const ARV_MULTIPLIER: Record<ArvMode, number> = {
  fixed: 1.0,
  conservative: 1.5,
  aggressive: 2.0,
};

/** US residential rental depreciation: 27.5 years, straight line, buildings only. */
const DEPRECIATION_YEARS = 27.5;

const PROJECTION_YEARS = 10;

export interface DealInputs {
  // ---- purchase
  priceCents: number;
  closingCostsCents: number;
  rehabCents: number;
  /** After-repair value. Null derives it from the price, rehab and arvMode. */
  arvCents: number | null;
  arvMode: ArvMode;

  // ---- financing
  downPaymentMode: DownPaymentMode;
  /** Percent when mode is "percent", cents when "amount". */
  downPayment: number;
  /** Annual nominal rate, as a percent: 6.5 means 6.5%. */
  interestRatePct: number;
  termYears: number;
  /** Roll closing costs and rehab into the loan rather than paying them in cash. */
  financeCosts: boolean;

  // ---- income
  monthlyRentCents: number;
  monthlyOtherIncomeCents: number;
  vacancyPct: number;

  // ---- operating expenses
  /** Annual property tax as a percent of price. */
  taxRatePct: number;
  /**
   * Annual insurance. Null means build it from the coastal fields below, which
   * is the whole reason the original exists — on the Outer Banks wind and flood
   * are the make-or-break line, not a rounding error.
   */
  insuranceAnnualCents: number | null;
  baseHazardCents: number;
  /** Wind premium per square foot, in cents. */
  windPerSqftCents: number;
  floodAnnualCents: number;
  sqft: number;

  monthlyHoaCents: number;
  monthlyUtilitiesCents: number;
  /** Percent of gross scheduled income. */
  maintenancePct: number;
  capexPct: number;
  /** Percent of effective gross income — management is not paid on vacancy. */
  managementPct: number;

  // ---- tax treatment
  /** Marginal income tax bracket, percent. */
  taxBracketPct: number;
  /** Share of the purchase attributed to land, which is not depreciable. */
  landPct: number;

  // ---- projection assumptions
  appreciationPct: number;
  rentGrowthPct: number;
  expenseGrowthPct: number;
  sellingCostPct: number;
}

export interface YearRow {
  year: number;
  valueCents: number;
  loanBalanceCents: number;
  equityCents: number;
  cashFlowCents: number;
  cumulativeCashFlowCents: number;
}

export interface ScenarioResult {
  investedCents: number;
  downPaymentCents: number;
  loanCents: number;
  /** Monthly principal and interest. */
  paymentCents: number;

  grossAnnualCents: number;
  vacancyLossCents: number;
  effectiveGrossCents: number;
  taxCents: number;
  insuranceCents: number;
  hoaCents: number;
  utilitiesCents: number;
  maintenanceCents: number;
  capexCents: number;
  managementCents: number;
  operatingExpensesCents: number;
  noiCents: number;
  debtServiceCents: number;
  annualCashFlowCents: number;
  monthlyCashFlowCents: number;
  /** After-tax cash flow, year one. */
  atcfCents: number;
  depreciationCents: number;

  capRatePct: number;
  cashOnCashPct: number;
  /** Monthly rent as a percent of price — the "1% rule". */
  onePercentRulePct: number;
  /** NOI over debt service. Null when there is no debt. */
  dscr: number | null;

  years: YearRow[];
  netSaleProceedsCents: number;
  totalProfitCents: number;
  /** Internal rate of return as a percent, or null when it cannot be solved. */
  irrPct: number | null;
}

export type Verdict = "profitable" | "marginal" | "negative";

export interface DealAnalysis {
  financed: ScenarioResult;
  cash: ScenarioResult;
  arvCents: number;
  verdict: Verdict;
  /** Plain sentence for the headline, already phrased for a person. */
  verdictLine: string;
  /** Which scenario the verdict was judged on. */
  scenario: DealScenario;
}

export interface ClosingCostItem {
  label: string;
  cents: number;
  /** What the number is, so it can be argued with rather than just accepted. */
  basis: string;
}

/**
 * Buyer-side closing costs, itemised — deliberately NOT a flat percentage.
 *
 * The original used 4% of price, which is a reasonable single number and a
 * terrible explanation: you cannot tell whether it is too high for your lender
 * or too low for your title company. Naming the parts means each can be checked
 * against a real quote and the total can be overridden with confidence.
 *
 * NO AGENT COMMISSION. On a purchase the buyer's agent is paid from the
 * seller's proceeds in the ordinary case, so putting it in the buyer's cash-to-
 * close overstates what you need by tens of thousands. If you have separately
 * agreed to pay your own agent, add it to the field.
 *
 * Nothing here is a quote. The percentages are the middle of the usual range;
 * the flat fees are typical US figures. Real numbers come from a Loan Estimate
 * and a title company, and both arrive well before closing.
 */
export function estimateClosingCosts(
  input: Pick<
    DealInputs,
    | "priceCents"
    | "downPayment"
    | "downPaymentMode"
    | "financeCosts"
    | "rehabCents"
    | "taxRatePct"
    | "insuranceAnnualCents"
    | "baseHazardCents"
    | "windPerSqftCents"
    | "floodAnnualCents"
    | "sqft"
  >,
  scenario: DealScenario = "financed",
): { totalCents: number; items: ClosingCostItem[] } {
  const price = input.priceCents;

  // The loan the origination fee is charged on. Approximated from price and the
  // down payment rather than taken from the full model, because that model
  // takes closing costs as an input — deriving one from the other would be
  // circular.
  const down =
    input.downPaymentMode === "percent" ? (price * input.downPayment) / 100 : input.downPayment;
  const loan = scenario === "cash" ? 0 : Math.max(0, price - down);

  const annualTax = (price * input.taxRatePct) / 100;
  const annualInsurance =
    input.insuranceAnnualCents ??
    input.baseHazardCents + input.sqft * input.windPerSqftCents + input.floodAnnualCents;

  const items: ClosingCostItem[] = [];
  const add = (label: string, cents: number, basis: string): void => {
    if (cents > 0) items.push({ label, cents: Math.round(cents), basis });
  };

  if (loan > 0) {
    add("Lender fees", loan * 0.0075, "0.75% of the loan — origination and underwriting");
    add("Appraisal", 700_00, "typical single-family appraisal");
  }
  add("Inspection", 500_00, "general home inspection");
  add("Title & settlement", price * 0.006, "0.6% of price — search, insurance, closing fee");
  add("Recording & misc", 300_00, "deed recording and courier fees");
  // Escrow is money you get the use of later, but it is still cash you bring to
  // the table, so it belongs in cash-to-close.
  add("Prepaid escrow", (annualTax + annualInsurance) / 4, "3 months of taxes and insurance");

  return { totalCents: items.reduce((sum, i) => sum + i.cents, 0), items };
}

/** Sensible starting point for a new analysis. Coastal defaults match the original. */
export function defaultDealInputs(priceCents = 0): DealInputs {
  return {
    priceCents,
    closingCostsCents: Math.round(priceCents * 0.04),
    rehabCents: Math.round(priceCents * 0.01),
    arvCents: null,
    arvMode: "fixed",
    downPaymentMode: "percent",
    downPayment: 20,
    interestRatePct: 7,
    termYears: 30,
    financeCosts: true,
    monthlyRentCents: 0,
    monthlyOtherIncomeCents: 0,
    vacancyPct: 8,
    taxRatePct: 0.5432,
    insuranceAnnualCents: null,
    baseHazardCents: 180_000,
    windPerSqftCents: 130,
    floodAnnualCents: 250_000,
    sqft: 0,
    monthlyHoaCents: 0,
    monthlyUtilitiesCents: 0,
    maintenancePct: 5,
    capexPct: 5,
    managementPct: 10,
    taxBracketPct: 24,
    landPct: 20,
    appreciationPct: 3,
    rentGrowthPct: 2,
    expenseGrowthPct: 3,
    sellingCostPct: 6,
  };
}

/** Named flood-zone premiums, in cents. The original's ZONE table. */
export const FLOOD_ZONE_ANNUAL_CENTS: Record<string, number> = {
  X: 70_000,
  AE: 250_000,
  VE: 450_000,
};

export function analyzeDeal(input: DealInputs, scenario: DealScenario = "financed"): DealAnalysis {
  const arvCents =
    input.arvCents ??
    Math.round(input.priceCents + input.rehabCents * ARV_MULTIPLIER[input.arvMode]);

  const financed = runScenario(input, arvCents, true);
  const cash = runScenario(input, arvCents, false);

  const judged = scenario === "financed" ? financed : cash;
  const { verdict, verdictLine } = judge(judged);

  return { financed, cash, arvCents, verdict, verdictLine, scenario };
}

function runScenario(input: DealInputs, arvCents: number, financed: boolean): ScenarioResult {
  const { priceCents, closingCostsCents, rehabCents } = input;

  // How much cash actually leaves your pocket, and what the bank lends.
  //
  // Three cases, because "20% down" means different things depending on whether
  // closing costs and repairs are rolled into the loan — and that difference
  // lands directly on cash-on-cash return, so it cannot be glossed over.
  let downPaymentCents: number;
  let loanCents: number;
  let investedCents: number;

  if (financed && input.financeCosts) {
    const total = priceCents + closingCostsCents + rehabCents;
    downPaymentCents =
      input.downPaymentMode === "percent" ? (total * input.downPayment) / 100 : input.downPayment;
    loanCents = Math.max(0, total - downPaymentCents);
    investedCents = downPaymentCents;
  } else if (financed) {
    downPaymentCents =
      input.downPaymentMode === "percent"
        ? (priceCents * input.downPayment) / 100
        : input.downPayment;
    loanCents = Math.max(0, priceCents - downPaymentCents);
    investedCents = downPaymentCents + closingCostsCents + rehabCents;
  } else {
    downPaymentCents = priceCents;
    loanCents = 0;
    investedCents = priceCents + closingCostsCents + rehabCents;
  }

  const monthlyRate = input.interestRatePct / 100 / 12;
  const payments = input.termYears * 12;
  let paymentCents = 0;
  if (financed && loanCents > 0) {
    paymentCents =
      monthlyRate > 0
        ? (loanCents * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -payments))
        : payments > 0
          ? loanCents / payments
          : 0;
  }

  const grossAnnualCents = (input.monthlyRentCents + input.monthlyOtherIncomeCents) * 12;
  const vacancyLossCents = (grossAnnualCents * input.vacancyPct) / 100;
  const effectiveGrossCents = grossAnnualCents - vacancyLossCents;

  const taxCents = (priceCents * input.taxRatePct) / 100;
  const insuranceCents =
    input.insuranceAnnualCents ??
    input.baseHazardCents + input.sqft * input.windPerSqftCents + input.floodAnnualCents;
  const hoaCents = input.monthlyHoaCents * 12;
  const utilitiesCents = input.monthlyUtilitiesCents * 12;
  const maintenanceCents = (grossAnnualCents * input.maintenancePct) / 100;
  const capexCents = (grossAnnualCents * input.capexPct) / 100;
  // Management is a cut of what you actually collect, not of what you billed.
  const managementCents = (effectiveGrossCents * input.managementPct) / 100;

  const operatingExpensesCents =
    taxCents +
    insuranceCents +
    hoaCents +
    utilitiesCents +
    maintenanceCents +
    capexCents +
    managementCents;

  const noiCents = effectiveGrossCents - operatingExpensesCents;
  const debtServiceCents = paymentCents * 12;
  const annualCashFlowCents = noiCents - debtServiceCents;

  // Year-one tax position. Depreciation is on the building only, and the
  // mortgage interest is deductible while the principal is not — which is why
  // the first twelve payments have to be walked rather than approximated.
  const depreciationCents =
    ((priceCents + rehabCents) * (1 - input.landPct / 100)) / DEPRECIATION_YEARS;
  let firstYearInterestCents = 0;
  if (financed && loanCents > 0) {
    let balance = loanCents;
    for (let m = 0; m < 12; m += 1) {
      const interest = balance * monthlyRate;
      firstYearInterestCents += interest;
      balance -= paymentCents - interest;
    }
  }
  const taxableCents = noiCents - firstYearInterestCents - depreciationCents;
  const atcfCents = annualCashFlowCents - (taxableCents * input.taxBracketPct) / 100;

  const projection = project(input, {
    arvCents,
    loanCents,
    paymentCents,
    monthlyRate,
    effectiveGrossCents,
    operatingExpensesCents,
    debtServiceCents,
    investedCents,
    financed,
  });

  return {
    investedCents: Math.round(investedCents),
    downPaymentCents: Math.round(downPaymentCents),
    loanCents: Math.round(loanCents),
    paymentCents: Math.round(paymentCents),
    grossAnnualCents: Math.round(grossAnnualCents),
    vacancyLossCents: Math.round(vacancyLossCents),
    effectiveGrossCents: Math.round(effectiveGrossCents),
    taxCents: Math.round(taxCents),
    insuranceCents: Math.round(insuranceCents),
    hoaCents: Math.round(hoaCents),
    utilitiesCents: Math.round(utilitiesCents),
    maintenanceCents: Math.round(maintenanceCents),
    capexCents: Math.round(capexCents),
    managementCents: Math.round(managementCents),
    operatingExpensesCents: Math.round(operatingExpensesCents),
    noiCents: Math.round(noiCents),
    debtServiceCents: Math.round(debtServiceCents),
    annualCashFlowCents: Math.round(annualCashFlowCents),
    monthlyCashFlowCents: Math.round(annualCashFlowCents / 12),
    atcfCents: Math.round(atcfCents),
    depreciationCents: Math.round(depreciationCents),
    capRatePct: priceCents ? (noiCents / priceCents) * 100 : 0,
    cashOnCashPct: investedCents ? (annualCashFlowCents / investedCents) * 100 : 0,
    onePercentRulePct: priceCents ? (input.monthlyRentCents / priceCents) * 100 : 0,
    dscr: debtServiceCents > 0 ? noiCents / debtServiceCents : null,
    years: projection.years,
    netSaleProceedsCents: Math.round(projection.netSaleProceedsCents),
    totalProfitCents: Math.round(projection.totalProfitCents),
    irrPct: projection.irr === null ? null : projection.irr * 100,
  };
}

interface ProjectionBasis {
  arvCents: number;
  loanCents: number;
  paymentCents: number;
  monthlyRate: number;
  effectiveGrossCents: number;
  operatingExpensesCents: number;
  debtServiceCents: number;
  investedCents: number;
  financed: boolean;
}

function project(
  input: DealInputs,
  m: ProjectionBasis,
): { years: YearRow[]; netSaleProceedsCents: number; totalProfitCents: number; irr: number | null } {
  const years: YearRow[] = [];
  let balance = m.loanCents;
  let value = m.arvCents;
  let rentMultiplier = 1;
  let expenseMultiplier = 1;
  let cumulative = 0;
  const flows: number[] = [-m.investedCents];

  for (let y = 1; y <= PROJECTION_YEARS; y += 1) {
    if (y > 1) {
      rentMultiplier *= 1 + input.rentGrowthPct / 100;
      expenseMultiplier *= 1 + input.expenseGrowthPct / 100;
      value *= 1 + input.appreciationPct / 100;
    }
    const egi = m.effectiveGrossCents * rentMultiplier;
    const opex = m.operatingExpensesCents * expenseMultiplier;
    const cashFlow = egi - opex - m.debtServiceCents;
    cumulative += cashFlow;

    if (m.financed && m.loanCents > 0) {
      for (let month = 0; month < 12; month += 1) {
        const interest = balance * m.monthlyRate;
        balance -= m.paymentCents - interest;
        if (balance < 0) balance = 0;
      }
    }

    flows.push(cashFlow);
    years.push({
      year: y,
      valueCents: Math.round(value),
      loanBalanceCents: Math.round(balance),
      equityCents: Math.round(value - balance),
      cashFlowCents: Math.round(cashFlow),
      cumulativeCashFlowCents: Math.round(cumulative),
    });
  }

  const last = years[years.length - 1]!;
  const netSaleProceedsCents =
    last.valueCents * (1 - input.sellingCostPct / 100) - last.loanBalanceCents;
  flows[flows.length - 1] = flows[flows.length - 1]! + netSaleProceedsCents;

  return {
    years,
    netSaleProceedsCents,
    totalProfitCents: cumulative + netSaleProceedsCents - m.investedCents,
    irr: irr(flows),
  };
}

/**
 * IRR by bisection.
 *
 * Bisection rather than Newton because these cash-flow series are not
 * well-behaved — a deal that loses money every year and is rescued by the sale
 * makes Newton wander off. Bisection is slower and always converges within the
 * bracket, which is the right trade for a hundred iterations of arithmetic.
 *
 * Returns null when the series has no sign change, which means there is no rate
 * that makes it break even and any number would be a lie.
 */
export function irr(flows: number[]): number | null {
  const npv = (rate: number): number =>
    flows.reduce((sum, flow, i) => sum + flow / Math.pow(1 + rate, i), 0);

  let low = -0.9999;
  let high = 10;
  const atLow = npv(low);
  if (!Number.isFinite(atLow) || atLow * npv(high) > 0) return null;

  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (npv(mid) * atLow < 0) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

/**
 * The headline call, using the original's thresholds: $100/month of cash flow
 * and 6% cash-on-cash. They are deliberately modest — this is a "does it clear
 * the bar at all" test, not a ranking.
 */
function judge(s: ScenarioResult): { verdict: Verdict; verdictLine: string } {
  const monthly = s.monthlyCashFlowCents / 100;
  const coc = s.cashOnCashPct;

  if (s.monthlyCashFlowCents < 0) {
    return {
      verdict: "negative",
      verdictLine: `Loses ${dollars(-monthly)}/mo — the rent doesn't cover the mortgage and expenses.`,
    };
  }
  if (s.monthlyCashFlowCents >= 10_000 && coc >= 6) {
    return {
      verdict: "profitable",
      verdictLine: `${dollars(monthly)}/mo cash flow at ${coc.toFixed(1)}% cash-on-cash.`,
    };
  }

  const weak: string[] = [];
  if (s.monthlyCashFlowCents < 10_000) weak.push(`cash flow only ${dollars(monthly)}/mo (aim for $100+)`);
  if (coc < 6) weak.push(`${coc.toFixed(1)}% cash-on-cash (aim for 6%+)`);
  return { verdict: "marginal", verdictLine: weak.join(" · ") + "." };
}

function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * The monthly rent this property would have to fetch to hit a cash-flow target
 * at its current asking price.
 *
 * The counterpart to maxPriceForCashFlow: that one answers "what can I pay?",
 * this one answers "what would it have to rent for?". Together they say whether
 * a deal that does not work is off by a little or by a lot, which the verdict
 * alone cannot.
 *
 * Bisection again, because rent feeds vacancy, maintenance, capex AND
 * management — the last as a cut of effective gross, not gross — so the closed
 * form is easy to get subtly wrong when any of those percentages change.
 */
export function rentNeededForCashFlow(
  input: DealInputs,
  targetMonthlyCents: number,
  scenario: DealScenario = "financed",
): number | null {
  const at = (monthlyRentCents: number): number =>
    analyzeDeal({ ...input, monthlyRentCents }, scenario)[scenario].monthlyCashFlowCents;

  let low = 0;
  let high = 1_000_000_00;
  if (at(high) < targetMonthlyCents) return null;

  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (at(mid) >= targetMonthlyCents) high = mid;
    else low = mid;
  }
  // To the nearest $5: rent is quoted in round numbers, and a figure like
  // $5,064.73 would imply a precision this model does not have.
  return Math.round(high / 500) * 500;
}

/**
 * The highest price at which the deal still clears a monthly cash-flow target.
 *
 * Found by bisection on price rather than algebraically, because price feeds
 * the loan, the property tax AND the after-repair value, and the closed form is
 * both ugly and easy to get subtly wrong when any assumption changes.
 */
export function maxPriceForCashFlow(
  input: DealInputs,
  targetMonthlyCents: number,
  scenario: DealScenario = "financed",
): number | null {
  const at = (priceCents: number): number =>
    analyzeDeal({ ...input, priceCents }, scenario)[scenario].monthlyCashFlowCents;

  let low = 0;
  let high = Math.max(input.priceCents * 4, 5_000_000_00);
  if (at(low) < targetMonthlyCents) return null;

  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (at(mid) >= targetMonthlyCents) low = mid;
    else high = mid;
  }
  // Rounded to the nearest $500, as the original does — false precision on a
  // number this soft would invite haggling over dollars.
  return Math.round(low / 50_000) * 50_000;
}
