// shared/local-rates.ts — local tax and insurance figures, by ZIP.
//
// What this is, and firmly what it is not.
//
// It is a small table of figures carried over from the Outer Banks analyzer,
// keyed by the ZIPs they apply to, so a property whose address is already in
// Keyring does not need its county rate typed in again.
//
// It is NOT a nationwide tax lookup. There is no data source behind it, and a
// property tax rate invented to look plausible would be the single most
// damaging kind of wrong here: it feeds the annual tax, which feeds NOI, cap
// rate, cash flow and the maximum price the analyser tells you to pay. So an
// unknown ZIP returns null and the fields are left for you to fill in, rather
// than being quietly populated with a number nobody stands behind.
//
// Three degrees of confidence, because Dare County is not uniform:
//
//   "town"   — county plus that town's own rate, both known. Complete.
//   "county" — the county rate, in an unincorporated area with no town rate to
//              add. Also complete, for a different reason.
//   "partial"— the county rate in a place that DOES levy a town rate which is
//              not in this table. Understates the tax; the UI says so.

export type RateConfidence = "town" | "county" | "partial";

export interface LocalRates {
  /** Where these apply, in words. */
  label: string;
  confidence: RateConfidence;
  /** Annual property tax as a percent of value. */
  taxRatePct: number;
  /** Wind & hail premium per square foot, in cents. */
  windPerSqftCents: number;
  /** Base landlord/hazard policy per year, in cents. */
  baseHazardCents: number;
  /** The flood zone most of this ZIP sits in. Always worth confirming. */
  floodZone: "X" | "AE" | "VE";
  note: string;
}

/** Dare County's own rate, unchanged for FY2026-27. The base every entry builds on. */
const DARE_COUNTY_PCT = 0.2632;

/** Outer Banks coastal insurance assumptions, shared across the county. */
const COASTAL = { windPerSqftCents: 130, baseHazardCents: 180_000 } as const;

const CONFIRM_QUOTE =
  "Wind and flood are the make-or-break numbers out here — confirm a real quote before you commit.";

const TABLE: Record<string, LocalRates> = {
  // ---- rates known in full -------------------------------------------------
  "27948": {
    label: "Kill Devil Hills, Dare County",
    confidence: "town",
    taxRatePct: DARE_COUNTY_PCT + 0.28,
    ...COASTAL,
    floodZone: "AE",
    note: `Dare County ${DARE_COUNTY_PCT}% + town 0.28% (FY25–26). Oceanside lots usually sit in AE or VE. ${CONFIRM_QUOTE}`,
  },
  "27954": {
    label: "Manteo, Dare County",
    confidence: "town",
    taxRatePct: DARE_COUNTY_PCT + 0.3455,
    windPerSqftCents: 100,
    baseHazardCents: 170_000,
    floodZone: "X",
    note: `Dare County ${DARE_COUNTY_PCT}% + town 0.3455%. Roanoke Island is sound-side, so wind and flood risk is generally lower than the oceanfront — still confirm the zone.`,
  },

  // ---- unincorporated: the county rate IS the whole rate --------------------
  "27915": unincorporated("Avon", "VE"),
  "27920": unincorporated("Buxton", "VE"),
  "27936": unincorporated("Frisco", "VE"),
  "27943": unincorporated("Hatteras", "VE"),
  "27968": unincorporated("Rodanthe, Waves & Salvo", "VE"),
  "27982": unincorporated("Waves", "VE"),
  "27981": unincorporated("Wanchese", "AE"),
  "27953": unincorporated("Manns Harbor & East Lake", "AE"),
  "27978": unincorporated("Stumpy Point", "AE"),

  "27959": {
    label: "Nags Head, Dare County",
    confidence: "town",
    // Town-wide 0.2120 + 0.0200 dedicated to beach nourishment = 0.2320,
    // unchanged in the FY2026-27 budget passed 3 June 2026.
    taxRatePct: DARE_COUNTY_PCT + 0.232,
    ...COASTAL,
    floodZone: "AE",
    note:
      `Dare County ${DARE_COUNTY_PCT}% + town 0.232% (0.212% town-wide plus 0.02% for beach ` +
      `nourishment), so about 49.5¢ per $100. Oceanfront and near-oceanfront parcels may also ` +
      `sit in one of the town's six beach-nourishment service districts, each with its own levy ` +
      `on top — check the parcel before trusting this total. ${CONFIRM_QUOTE}`,
  },

  // ---- county rate only, and a town rate exists that is not here ------------
  // 27949 covers Kitty Hawk, Southern Shores and Duck, which levy different
  // rates, so the ZIP alone cannot say which applies.
  "27949": partial("Kitty Hawk, Southern Shores or Duck", "AE"),
};

function unincorporated(place: string, floodZone: LocalRates["floodZone"]): LocalRates {
  return {
    label: `${place}, Dare County`,
    confidence: "county",
    taxRatePct: DARE_COUNTY_PCT,
    ...COASTAL,
    floodZone,
    note: `Unincorporated Dare County, so the county rate of ${DARE_COUNTY_PCT}% is the whole property tax — there is no town rate to add. ${CONFIRM_QUOTE}`,
  };
}

function partial(place: string, floodZone: LocalRates["floodZone"]): LocalRates {
  return {
    label: `${place}, Dare County`,
    confidence: "partial",
    taxRatePct: DARE_COUNTY_PCT,
    ...COASTAL,
    floodZone,
    note: `Only the county rate of ${DARE_COUNTY_PCT}% is filled in. ${place} levies its own rate on top, which is not in this table — look it up and add it, or the tax here is understated. ${CONFIRM_QUOTE}`,
  };
}

/**
 * Figures for a ZIP, or null when there are none.
 *
 * Null is the common case and the correct one: outside the area this table
 * covers, there is nothing to offer, and offering something anyway would be
 * worse than offering nothing.
 */
export function ratesForZip(postalCode: string | null | undefined): LocalRates | null {
  if (!postalCode) return null;
  const zip = postalCode.trim().slice(0, 5);
  return TABLE[zip] ?? null;
}
