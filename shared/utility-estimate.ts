// shared/utility-estimate.ts — what the utilities will cost, from the house.
//
// "An automated utility calculator based on typical usage of renters and the
// local rates for the zip codes."
//
// Two halves, kept apart on purpose:
//
//   USAGE  — how much a household in this house uses, from bedrooms, bathrooms
//            and square feet. Every coefficient is a named constant below with
//            its reasoning, so a number that looks wrong can be argued with.
//
//   RATES  — what that usage costs at this ZIP. Same rule as local-rates.ts:
//            a figure is only here if it came from somewhere. Where the local
//            provider's rate is not known, that line is left for you to fill
//            in and the estimate says it is partial, rather than borrowing a
//            neighbouring town's price and presenting it as this one's.
//
// WHY IT IS COMPUTED, NOT TYPED. The comparison this exists for is "add a
// bedroom". A utilities figure typed in once would stay put while plan B's
// bedroom count went up, and B would look cheaper to run than it is. Computed
// from each plan's own inputs, B's extra occupant shows up in B's bills.
import type { DealInputs } from "./deal-analysis.js";

/* ------------------------------------------------------------------ usage -- */

/**
 * Occupants from bedrooms: two in the first, one in each after. The same
 * rule of thumb occupancy standards and utility sizing both lean on, and
 * the one a landlord uses when guessing who will live somewhere.
 */
export function occupantsFor(bedrooms: number): number {
  return Math.max(1, Math.round(bedrooms) + 1);
}

/**
 * Electricity, kWh per month.
 *
 *   base load (fridge, water heater standby, always-on) ... 250 kWh
 *   conditioning, per square foot .......................  0.35 kWh
 *   per occupant (hot water, cooking, laundry, devices) ..   75 kWh
 *
 * A 1,600 sq ft, three-bedroom all-electric house comes out near 1,110 kWh —
 * above the ~900 kWh national residential average, which is right for a
 * coastal Carolina home on a heat pump and an electric water heater.
 */
const KWH_BASE = 250;
const KWH_PER_SQFT = 0.35;
const KWH_PER_OCCUPANT = 75;

/** When the square footage has not been entered, a size implied by the bedrooms. */
function sqftFor(inputs: Pick<DealInputs, "sqft" | "bedrooms">): number {
  return inputs.sqft > 0 ? inputs.sqft : 600 + 400 * Math.max(0, inputs.bedrooms);
}

/**
 * Water, gallons per month: 60 gallons a person a day indoors, plus 5% for
 * each bathroom past the first (more fixtures, more cleaning, more leaks).
 * Indoor only — landscaping is not a renter's usual bill.
 */
const GALLONS_PER_PERSON_DAY = 60;
const DAYS_PER_MONTH = 30.4;
const EXTRA_BATH_FACTOR = 0.05;

/* ------------------------------------------------------------------ rates -- */

export type UtilityConfidence = "local" | "partial" | "general";

interface WaterRate {
  provider: string;
  /** Base charge per month (the county bills quarterly; divided by three). */
  monthlyBaseCents: number;
  /** Gallons a month included in the base. */
  includedGallons: number;
  /** Cents per 1,000 gallons above that, averaged across the year. */
  centsPerKgal: number;
}

type Sewer =
  | { kind: "septic"; monthlyReserveCents: number }
  | { kind: "unknown"; provider: string };

export interface UtilityRates {
  label: string;
  confidence: UtilityConfidence;
  electricProvider: string;
  electricCentsPerKwh: number;
  electricMonthlyCents: number;
  /** Null: the water provider here is known, its rate is not. */
  water: WaterRate | null;
  waterProviderIfUnknown?: string;
  sewer: Sewer;
  /** 0 when the town collects trash as a service; null when unknown. */
  trashMonthlyCents: number | null;
  internetMonthlyCents: number;
  note: string;
}

/**
 * Dominion Energy North Carolina, residential: about 15.0¢ per kWh all-in
 * with a $6.58 monthly customer charge (2026). Serves the northern Outer
 * Banks and Roanoke Island.
 */
const DOMINION = {
  electricProvider: "Dominion Energy NC",
  electricCentsPerKwh: 15.0,
  electricMonthlyCents: 658,
} as const;

/**
 * Hatteras Island is served by Cape Hatteras Electric Cooperative, whose rate
 * is not in this table. The national residential average stands in, and the
 * estimate is marked partial so nobody mistakes it for CHEC's price.
 */
const HATTERAS_ELECTRIC = {
  electricProvider: "Cape Hatteras Electric Co-op (rate not in table — US average used)",
  electricCentsPerKwh: 16.8,
  electricMonthlyCents: 0,
} as const;

/**
 * Dare County Water, schedule effective 1 July 2026. A ¾" residential meter
 * is $49.80 a quarter including 3,000 gallons; usage above that is $10.74 per
 * 1,000 gallons in the summer quarters and $8.27 in the winter ones. Every
 * billing cycle has two of each, so the year averages the two.
 */
const DARE_COUNTY_WATER: WaterRate = {
  provider: "Dare County Water (July 2026 schedule)",
  monthlyBaseCents: Math.round(4980 / 3),
  includedGallons: 1_000,
  centsPerKgal: (1074 + 827) / 2,
};

/**
 * Pumping a residential septic tank every three years at about $450. The
 * system itself is on the diligence checklist; this is only the running cost.
 */
const SEPTIC: Sewer = { kind: "septic", monthlyReserveCents: Math.round(45_000 / 36) };

/** A typical cable/fibre plan. Owner-paid on a furnished or vacation rental. */
const INTERNET_CENTS = 70_00;

const CONFIRM =
  "Typical figures, not a quote — check the provider on the listing or the seller's last bills.";

const TABLE: Record<string, UtilityRates> = {
  "27948": {
    label: "Kill Devil Hills",
    confidence: "local",
    ...DOMINION,
    water: DARE_COUNTY_WATER,
    sewer: SEPTIC,
    // Collected by the town's own sanitation service, not billed separately.
    trashMonthlyCents: 0,
    internetMonthlyCents: INTERNET_CENTS,
    note: `Dominion electric, Dare County Water, septic, and town trash collection. ${CONFIRM}`,
  },
  "27959": {
    label: "Nags Head",
    confidence: "partial",
    ...DOMINION,
    water: null,
    waterProviderIfUnknown: "Town of Nags Head",
    // About 80% of Nags Head is on septic, per the town.
    sewer: SEPTIC,
    trashMonthlyCents: 0,
    internetMonthlyCents: INTERNET_CENTS,
    note:
      "Nags Head bills its own water and its rate is not in this table — the water line is left " +
      `at $0 until you enter it. Most of the town is on septic. ${CONFIRM}`,
  },
  "27954": {
    label: "Manteo",
    confidence: "partial",
    ...DOMINION,
    water: null,
    waterProviderIfUnknown: "Town of Manteo",
    sewer: { kind: "unknown", provider: "Town of Manteo" },
    trashMonthlyCents: null,
    internetMonthlyCents: INTERNET_CENTS,
    note:
      "Manteo bills its own water and sewer, and neither rate is in this table — those lines " +
      `are $0 until you enter them. ${CONFIRM}`,
  },
  "27949": {
    label: "Kitty Hawk, Southern Shores or Duck",
    confidence: "partial",
    ...DOMINION,
    water: DARE_COUNTY_WATER,
    sewer: SEPTIC,
    trashMonthlyCents: null,
    internetMonthlyCents: INTERNET_CENTS,
    note:
      "Dare County Water's rate is used; confirm the address is on it. Trash service differs " +
      `between the three towns and is left out. ${CONFIRM}`,
  },
  ...Object.fromEntries(
    (
      [
        ["27915", "Avon"],
        ["27920", "Buxton"],
        ["27936", "Frisco"],
        ["27943", "Hatteras"],
        ["27968", "Rodanthe, Waves & Salvo"],
        ["27982", "Waves"],
      ] as const
    ).map(([zip, place]) => [
      zip,
      {
        label: place,
        confidence: "partial",
        ...HATTERAS_ELECTRIC,
        water: DARE_COUNTY_WATER,
        sewer: SEPTIC,
        trashMonthlyCents: null,
        internetMonthlyCents: INTERNET_CENTS,
        note:
          "Hatteras Island power comes from Cape Hatteras Electric Co-op; its rate is not in " +
          `this table, so the US average stands in. ${CONFIRM}`,
      } satisfies UtilityRates,
    ]),
  ),
};

/** Anywhere else: usage still estimated, priced at US averages, water left blank. */
function generalRates(): UtilityRates {
  return {
    label: "US averages",
    confidence: "general",
    electricProvider: "US residential average",
    electricCentsPerKwh: 16.8,
    electricMonthlyCents: 0,
    water: null,
    waterProviderIfUnknown: "the local water provider",
    sewer: { kind: "unknown", provider: "the local sewer provider" },
    trashMonthlyCents: null,
    internetMonthlyCents: INTERNET_CENTS,
    note:
      "No local rates for this ZIP. Electricity uses the US residential average; water, sewer " +
      "and trash are left for you to fill in from the provider.",
  };
}

export function utilityRatesForZip(postalCode: string | null | undefined): UtilityRates {
  const zip = (postalCode ?? "").trim().slice(0, 5);
  return TABLE[zip] ?? generalRates();
}

/* --------------------------------------------------------------- estimate -- */

/**
 * Who pays which bill.
 *
 *   tenant_utilities — the usual long-term let: the tenant has the electric
 *                      and internet in their name; the owner keeps water,
 *                      sewer or septic, and trash, which follow the property.
 *   owner_all        — a furnished or vacation rental: everything is the
 *                      owner's, because nobody else is there long enough.
 *   tenant_all       — the tenant pays every bill.
 */
export type UtilityPayer = "tenant_utilities" | "owner_all" | "tenant_all";

export type UtilityKey = "electric" | "water" | "sewer" | "trash" | "internet";

export interface UtilityLine {
  key: UtilityKey;
  label: string;
  /** What the bill comes to, whoever pays it. */
  monthlyCents: number;
  ownerPays: boolean;
  /** The arithmetic, in words. */
  basis: string;
  /** True when this line has no rate behind it and reads $0 for that reason. */
  unknown: boolean;
}

export interface UtilityEstimate {
  rates: UtilityRates;
  occupants: number;
  kwh: number;
  gallons: number;
  lines: UtilityLine[];
  /** The part the owner pays — what goes into the deal. */
  ownerMonthlyCents: number;
  /** Every bill, whoever pays it — what the house costs to run. */
  totalMonthlyCents: number;
}

const OWNER_PAYS: Record<UtilityPayer, Record<UtilityKey, boolean>> = {
  tenant_utilities: { electric: false, water: true, sewer: true, trash: true, internet: false },
  owner_all: { electric: true, water: true, sewer: true, trash: true, internet: true },
  tenant_all: { electric: false, water: false, sewer: false, trash: false, internet: false },
};

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function estimateUtilities(
  inputs: Pick<DealInputs, "sqft" | "bedrooms" | "bathrooms" | "utilityPayer">,
  postalCode: string | null | undefined,
): UtilityEstimate {
  const rates = utilityRatesForZip(postalCode);
  const occupants = occupantsFor(inputs.bedrooms);
  const sqft = sqftFor(inputs);
  const pays = OWNER_PAYS[inputs.utilityPayer];

  const kwh = Math.round(KWH_BASE + KWH_PER_SQFT * sqft + KWH_PER_OCCUPANT * occupants);
  const electricCents = Math.round(kwh * rates.electricCentsPerKwh + rates.electricMonthlyCents);

  const extraBaths = Math.max(0, inputs.bathrooms - 1);
  const gallons = Math.round(
    occupants * GALLONS_PER_PERSON_DAY * DAYS_PER_MONTH * (1 + EXTRA_BATH_FACTOR * extraBaths),
  );

  const lines: UtilityLine[] = [
    {
      key: "electric",
      label: "Electric",
      monthlyCents: electricCents,
      ownerPays: pays.electric,
      unknown: false,
      basis:
        `${kwh.toLocaleString("en-US")} kWh × ${rates.electricCentsPerKwh.toFixed(1)}¢` +
        (rates.electricMonthlyCents ? ` + ${dollars(rates.electricMonthlyCents)} customer charge` : "") +
        ` — ${rates.electricProvider}`,
    },
  ];

  if (rates.water) {
    const w = rates.water;
    const over = Math.max(0, gallons - w.includedGallons);
    lines.push({
      key: "water",
      label: "Water",
      monthlyCents: Math.round(w.monthlyBaseCents + (over / 1000) * w.centsPerKgal),
      ownerPays: pays.water,
      unknown: false,
      basis: `${gallons.toLocaleString("en-US")} gal for ${occupants} people — ${dollars(w.monthlyBaseCents)} base + ${(over / 1000).toFixed(1)}k gal × ${dollars(w.centsPerKgal)} — ${w.provider}`,
    });
  } else {
    lines.push({
      key: "water",
      label: "Water",
      monthlyCents: 0,
      ownerPays: pays.water,
      unknown: true,
      basis: `About ${gallons.toLocaleString("en-US")} gal a month; rate from ${rates.waterProviderIfUnknown} not in table`,
    });
  }

  if (rates.sewer.kind === "septic") {
    lines.push({
      key: "sewer",
      label: "Septic pumping reserve",
      monthlyCents: rates.sewer.monthlyReserveCents,
      ownerPays: pays.sewer,
      unknown: false,
      basis: "About $450 to pump the tank every three years, set aside monthly",
    });
  } else {
    lines.push({
      key: "sewer",
      label: "Sewer",
      monthlyCents: 0,
      ownerPays: pays.sewer,
      unknown: true,
      basis: `Rate from ${rates.sewer.provider} not in table`,
    });
  }

  lines.push({
    key: "trash",
    label: "Trash",
    monthlyCents: rates.trashMonthlyCents ?? 0,
    ownerPays: pays.trash,
    unknown: rates.trashMonthlyCents === null,
    basis:
      rates.trashMonthlyCents === 0
        ? "Town collection — no separate bill"
        : rates.trashMonthlyCents === null
          ? "Not in table"
          : dollars(rates.trashMonthlyCents),
  });

  lines.push({
    key: "internet",
    label: "Internet",
    monthlyCents: rates.internetMonthlyCents,
    ownerPays: pays.internet,
    unknown: false,
    basis: "A typical cable or fibre plan",
  });

  return {
    rates,
    occupants,
    kwh,
    gallons,
    lines,
    ownerMonthlyCents: lines.filter((l) => l.ownerPays).reduce((s, l) => s + l.monthlyCents, 0),
    totalMonthlyCents: lines.reduce((s, l) => s + l.monthlyCents, 0),
  };
}

/**
 * Inputs ready for analyzeDeal: when utilities are on "estimate", the monthly
 * utilities figure is replaced by the estimate for THESE inputs.
 *
 * Kept outside analyzeDeal so the arithmetic stays a pure function of the
 * inputs alone — the ZIP is a fact about the property, not an assumption of
 * the deal, and plan B cannot move the house to another town.
 */
export function resolveUtilities(inputs: DealInputs, postalCode: string | null | undefined): DealInputs {
  if (!inputs.utilitiesAuto) return inputs;
  return {
    ...inputs,
    monthlyUtilitiesCents: estimateUtilities(inputs, postalCode).ownerMonthlyCents,
  };
}
