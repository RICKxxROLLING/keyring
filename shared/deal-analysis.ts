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
/**
 * What is being bought. "buy" is a house that already stands; "build" is land,
 * with new units put up on it — see expandBuild for how a build is costed.
 */
export type DealKind = "buy" | "build";

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
  /**
   * Buy a house, or buy land and build. A build keeps every other input on the
   * page — financing, tax, insurance, growth — and adds the fields below; the
   * analysis is then run on the finished project (see expandBuild).
   */
  dealKind: DealKind;

  // ---- new construction (dealKind "build" only)
  /**
   * Construction cost per square foot of finished floor, in cents, for this
   * quality of building ON ONE STORY. Stacking floors then lowers it — see
   * storyFactor — so the figure entered is the one a builder would quote for a
   * single-level building, and the page shows what it comes to once stacked.
   */
  buildCostPerSqftCents: number;
  /**
   * Floors the units are stacked on. Foundation and roof cover the footprint,
   * not the floor area, so a three-story building puts three floors of units on
   * one foundation and under one roof.
   */
  stories: number;
  /** Finished size of each unit. */
  unitSqft: number;
  /** How many units go on the land. */
  unitCount: number;
  rentPerUnitCents: number;
  /**
   * One-off costs of making bare land buildable: clearing, septic or sewer tap,
   * driveway, survey, permits and impact fees. On a coastal lot these are
   * routinely five figures, so they are a field rather than an afterthought.
   */
  siteWorkCents: number;

  // ---- the house
  /**
   * The layout being analysed. Not arithmetic on their own — rent is still
   * what you enter — but they size the utility estimate, and they are the
   * thing a plan B most often changes ("add a bedroom").
   */
  bedrooms: number;
  /** Halves allowed: 2.5 means two full baths and a half. */
  bathrooms: number;

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
  /**
   * Owner-paid utilities per month. When utilitiesAuto is on this is
   * recomputed from the house and the ZIP before analysis — see
   * shared/utility-estimate.ts — and whatever is stored here is ignored.
   */
  monthlyUtilitiesCents: number;
  /** Estimate utilities from bedrooms, bathrooms, size and local rates. */
  utilitiesAuto: boolean;
  /** Which bills the owner carries. Only used by the estimate. */
  utilityPayer: "tenant_utilities" | "owner_all" | "tenant_all";
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
  /**
   * The monthly rent being charged that year, after rentGrowthPct has been
   * applied year on year. Shown so the increase is something you can read in
   * the table rather than something buried inside the cash-flow figure.
   */
  monthlyRentCents: number;
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
    dealKind: "buy",
    // A plain starting point for a build, used only once one is chosen: one
    // 1,200 sq ft unit at $185/sq ft on one story — builder-grade wood frame.
    // Stacked three high that comes to about $167, the middle of the current
    // $130–$190 range for low-rise wood-frame ("garden-style") apartments. It is
    // not a custom-home rate; those run $250 and up. Change it to a builder's
    // number as soon as there is one.
    buildCostPerSqftCents: 185_00,
    stories: 1,
    unitSqft: 1200,
    unitCount: 1,
    rentPerUnitCents: 0,
    siteWorkCents: 0,
    // A typical Outer Banks single-family layout, used only until the
    // property's own units say otherwise.
    bedrooms: 3,
    bathrooms: 2,
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
    // New analyses estimate utilities; saved ones keep the figure they had.
    utilitiesAuto: true,
    // The usual long-term let: electric and internet in the tenant's name.
    utilityPayer: "tenant_utilities",
    maintenancePct: 5,
    capexPct: 5,
    managementPct: 10,
    taxBracketPct: 24,
    landPct: 20,
    appreciationPct: 3,
    // 3% a year: a typical annual lease increase, and what an owner would
    // normally put through at renewal. Change it per deal on the numbers tab.
    rentGrowthPct: 3,
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

/**
 * Share of a one-story building's construction cost that is set by its
 * FOOTPRINT rather than its floor area: the foundation and the roof.
 *
 * NAHB's 2024 Cost of Constructing a Home survey puts the foundation at about
 * 10.5% of construction cost; roof framing and roofing add roughly another
 * 5%. Those are the parts that do not grow when a floor is added, which is the
 * whole saving of building up.
 *
 * It is deliberately a modest number. Stacking also ADDS cost that a one-story
 * building does not carry — stairs and landings, rated fire walls and floors
 * between units, a sprinkler system, heavier shear walls and hold-downs for
 * wind on a taller box — and those are left inside the per-sq-ft rate rather
 * than netted off here, so the discount is never larger than the evidence.
 * A pile foundation makes the footprint share larger and the saving bigger.
 */
export const FOOTPRINT_COST_SHARE = 0.15;

/** Most floors a build can be — the ceiling for the light wood-frame building this models. */
export const MAX_STORIES = 3;

/**
 * What one square foot costs on `stories` floors, as a fraction of what it
 * costs on one: the floor-area share stays, the footprint share is divided
 * among the floors. One story is 1.0, two 0.925, three 0.90.
 *
 * Three is the limit on purpose. In North Carolina a fourth residential story
 * generally moves a building out of light wood-frame residential rules and
 * into commercial construction, and cost research finds a jump there rather
 * than a further saving (Eriksen & Orlando, 2024). A taller building is a
 * different kind of project, and its cost should come from a builder.
 */
export function storyFactor(stories: number): number {
  const n = Math.min(MAX_STORIES, Math.max(1, Math.round(stories)));
  return 1 - FOOTPRINT_COST_SHARE + FOOTPRINT_COST_SHARE / n;
}

export interface BuildCosts {
  landCents: number;
  constructionCents: number;
  /** The entered one-story rate, after stacking. What a sq ft actually costs here. */
  effectiveCostPerSqftCents: number;
  /** What stacking saved against building the same floor area on one story. */
  stackingSavingsCents: number;
  siteWorkCents: number;
  /** Land + construction + site work: what the finished project cost. */
  totalCents: number;
  totalSqft: number;
}

export function buildCosts(input: DealInputs): BuildCosts {
  const units = Math.max(0, Math.round(input.unitCount));
  const totalSqft = units * input.unitSqft;
  const effectiveCostPerSqftCents = Math.round(input.buildCostPerSqftCents * storyFactor(input.stories));
  const constructionCents = totalSqft * effectiveCostPerSqftCents;
  const landCents = input.priceCents;
  return {
    landCents,
    constructionCents,
    effectiveCostPerSqftCents,
    stackingSavingsCents: totalSqft * input.buildCostPerSqftCents - constructionCents,
    siteWorkCents: input.siteWorkCents,
    totalCents: landCents + constructionCents + input.siteWorkCents,
    totalSqft,
  };
}

/**
 * A build, restated as the finished building it produces, so the one model
 * below costs both kinds of deal and every answer on the page — verdict,
 * projection, plan B, what-to-pay — works for a build unchanged.
 *
 *   price      → land + construction + site work. It is what the project cost,
 *                and it is what a new building is assessed and valued at, so
 *                property tax, cap rate (here: yield on cost), the 1% rule and
 *                the starting value all read correctly from it.
 *   repairs    → none. Construction is in the price; nothing to fix on day one.
 *   land share → the land's actual share of the cost, so depreciation is taken
 *                on the building and only the building.
 *   rent       → rent per unit × units. Utilities are per unit too.
 *   size       → sq ft per unit × units, which sizes the wind premium.
 *   insurance  → the base hazard and flood premiums are charged per unit, on
 *                the cautious assumption that each unit carries its own policy.
 *                Enter a total in place of the coastal estimate if one
 *                building's policy will cover them all.
 *
 * Not modelled: the months of construction before any rent comes in, and the
 * interest carried on a construction loan through them. The analysis starts
 * on the day the units are let.
 */
export function expandBuild(input: DealInputs): DealInputs {
  if (input.dealKind !== "build") return input;
  const c = buildCosts(input);
  const units = Math.max(0, Math.round(input.unitCount));
  return {
    ...input,
    priceCents: c.totalCents,
    rehabCents: 0,
    arvCents: null,
    arvMode: "fixed",
    landPct: c.totalCents > 0 ? (c.landCents / c.totalCents) * 100 : 0,
    monthlyRentCents: input.rentPerUnitCents * units,
    monthlyUtilitiesCents: input.monthlyUtilitiesCents * units,
    sqft: c.totalSqft,
    baseHazardCents: input.baseHazardCents * units,
    floodAnnualCents: input.floodAnnualCents * units,
  };
}

export function analyzeDeal(raw: DealInputs, scenario: DealScenario = "financed"): DealAnalysis {
  const input = expandBuild(raw);
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
      monthlyRentCents: Math.round(input.monthlyRentCents * rentMultiplier),
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
  // On a build the thing you set is the rent per unit, so that is what is solved for.
  const at = (rent: number): number =>
    analyzeDeal(
      input.dealKind === "build" ? { ...input, rentPerUnitCents: rent } : { ...input, monthlyRentCents: rent },
      scenario,
    )[scenario].monthlyCashFlowCents;

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
 *
 * On a build, priceCents is the land, so this is the most the LAND is worth
 * paying with the planned units on it — construction costs held fixed.
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

export interface UnitCountRow {
  units: number;
  totalCostCents: number;
  monthlyCashFlowCents: number;
  cashOnCashPct: number;
  verdict: Verdict;
}

export interface UnitsToProfit {
  rows: UnitCountRow[];
  /** Fewest units that do not lose money each month; null if none up to the limit. */
  breakEvenUnits: number | null;
  /** Fewest units that clear the "profitable" bar ($100/mo and 6% cash-on-cash). */
  profitableUnits: number | null;
  /**
   * What one more unit adds to monthly cash flow, once the land is paid for.
   * When this is zero or negative, more units can never rescue the deal — the
   * problem is the rent or the build cost, not the count — and the page says so
   * rather than pointing at a number of units that does not exist.
   */
  marginPerUnitCents: number;
}

/** How far the units table looks. Past this, the answer is "not on this land". */
export const MAX_UNITS = 30;

/**
 * How many units it takes for a build to make money.
 *
 * Every unit brings its own rent and its own costs — construction, its share
 * of tax and insurance, its loan payment — while the land is paid for once. So
 * cash flow climbs by roughly the same step with each unit, and the land is
 * what the first few units have to carry. This walks the count up from one and
 * reports where it crosses break-even and where it clears the verdict's bar.
 *
 * Takes inputs with utilities already resolved, like analyzeDeal: the per-unit
 * utility figure does not depend on the count.
 */
export function unitsToProfit(
  input: DealInputs,
  scenario: DealScenario = "financed",
  maxUnits = MAX_UNITS,
): UnitsToProfit {
  const rows: UnitCountRow[] = [];
  let breakEvenUnits: number | null = null;
  let profitableUnits: number | null = null;
  for (let units = 1; units <= maxUnits; units += 1) {
    const plan = { ...input, dealKind: "build" as const, unitCount: units };
    const a = analyzeDeal(plan, scenario);
    const r = a[scenario];
    rows.push({
      units,
      totalCostCents: buildCosts(plan).totalCents,
      monthlyCashFlowCents: r.monthlyCashFlowCents,
      cashOnCashPct: r.cashOnCashPct,
      verdict: a.verdict,
    });
    if (breakEvenUnits === null && r.monthlyCashFlowCents >= 0) breakEvenUnits = units;
    if (profitableUnits === null && a.verdict === "profitable") profitableUnits = units;
  }
  const marginPerUnitCents =
    rows.length >= 2 ? rows[1]!.monthlyCashFlowCents - rows[0]!.monthlyCashFlowCents : 0;
  return { rows, breakEvenUnits, profitableUnits, marginPerUnitCents };
}
