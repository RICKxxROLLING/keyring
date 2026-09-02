// shared/diligence-checklist.ts — the starting checklist for a property you
// are considering.
//
// Not a legal checklist and not advice. Every line is phrased as something to
// go and ASK, because the answer varies by town, by parcel and by year, and a
// checklist that states what the rule is would be wrong somewhere and confident
// about it. What it is good at is stopping you from forgetting to ask.
//
// The bias is coastal Outer Banks — Kill Devil Hills, Nags Head, Manteo — which
// is where these properties are. Septic capacity, elevation and wind coverage
// are near the top because they are the three that change the number rather
// than merely annoy you: a three-bedroom septic permit caps a four-bedroom
// house's rent, a low finished-floor elevation changes the flood premium by a
// multiple, and wind/hail is frequently a separate policy with its own
// deductible. Somewhere inland the same list would be nine items long.
//
// It is a SUGGESTION, applied on request and freely editable afterwards. It is
// not seeded automatically on every property: a checklist you did not ask for
// is noise, and one you cannot delete is worse.

import type { DiligenceCategory, DiligenceItem, DiligenceSummary } from "./types.js";

export interface ChecklistTemplateItem {
  label: string;
  category: DiligenceCategory;
  /** What to ask for, and roughly who from. */
  detail: string;
}

export const DILIGENCE_TEMPLATE: readonly ChecklistTemplateItem[] = [
  /* ------------------------------------------------------------- permits -- */
  {
    label: "Septic permit — and the bedroom count on it",
    category: "permits",
    detail:
      "Ask the county environmental health office for the improvement permit and the operation permit. The bedroom count the system was approved for is the one that matters, not the count in the listing — if they disagree, find out which one the town will let you rent.",
  },
  {
    label: "Town water and sewer, or well and septic?",
    category: "permits",
    detail:
      "Confirm which utilities actually serve the parcel. If there is a well, ask when it was last tested and get a current potability test.",
  },
  {
    label: "Past building permits and certificates of occupancy",
    category: "permits",
    detail:
      "Pull the permit history from the town. Decks, additions, pools, hot tubs and enclosed ground floors are the usual unpermitted work — anything without a permit becomes yours to legalise.",
  },
  {
    label: "Short-term rental rules for this address",
    category: "permits",
    detail:
      "Ask the town what registration, occupancy limits, parking minimums and inspections apply to renting this property, and whether the zoning district allows it at all. Occupancy is often tied back to the septic permit.",
  },
  {
    label: "CAMA or coastal permits on file",
    category: "permits",
    detail:
      "For anything near the ocean or sound, ask about coastal permits, the setback line and the vegetation line, and whether existing structures sit inside them. Ask what could and could not be rebuilt after a storm.",
  },

  /* ---------------------------------------------------------------- land -- */
  {
    label: "Elevation certificate",
    category: "land",
    detail:
      "Ask the seller first; the town or the surveyor may have one. The finished-floor elevation against the base flood elevation is what the flood premium is priced off. No certificate is itself a finding — budget to have one made.",
  },
  {
    label: "FEMA flood zone and base flood elevation",
    category: "land",
    detail:
      "Look the parcel up on the FEMA flood map and record the zone and the base flood elevation. Note the map's date — zones get redrawn.",
  },
  {
    label: "Survey — boundaries, setbacks, encroachments",
    category: "land",
    detail:
      "Ask for the most recent survey. Check that decks, sheds, driveways and neighbouring fences are where the plat says they are.",
  },
  {
    label: "Storm and erosion history",
    category: "land",
    detail:
      "Ask what flooded, when, and how far up. Ask about nourishment projects and any assessment attached to them, which can be a separate line on the tax bill.",
  },

  /* ----------------------------------------------------------- structure -- */
  {
    label: "Structural and termite inspection",
    category: "structure",
    detail:
      "General inspection plus a wood-destroying-insect report. On piling-built coastal houses pay particular attention to the pilings, the connections and any enclosed ground level.",
  },
  {
    label: "Age of roof, HVAC and water heater",
    category: "structure",
    detail:
      "Get the install dates and any remaining warranty. These three are the near-term capital spend and belong in the renovation budget, not in surprises.",
  },
  {
    label: "Known defects and past repairs",
    category: "structure",
    detail:
      "Ask for the seller's disclosure and any repair invoices. Insurance claim history tells you more than the disclosure does.",
  },

  /* ----------------------------------------------------------- financial -- */
  {
    label: "Insurance quotes — wind and hail, and flood",
    category: "financial",
    detail:
      "Get real quotes, not estimates, before the numbers are final. Coastal wind and hail is often a separate policy with its own deductible, and flood is separate again. This is the line most likely to move the whole deal.",
  },
  {
    label: "Tax record — parcel ID, assessed value, rate",
    category: "financial",
    detail:
      "Pull the county record. Check the town rate and the county rate, and ask whether the parcel sits in a service district with its own levy on top.",
  },
  {
    label: "Rental history, if it has been rented",
    category: "financial",
    detail:
      "Ask for two or three years of gross rental income by season, the management fee, and the cleaning and linen costs. Ask what is already on the books for next season.",
  },
  {
    label: "Existing bookings you would inherit",
    category: "financial",
    detail:
      "If it is sold turnkey, get the list of reservations, the deposits already taken, and who holds that money at closing.",
  },
  {
    label: "Furnishings — what conveys",
    category: "financial",
    detail:
      "Get the inventory in writing. On a rental this is not a detail; refurnishing a house is a five-figure line item.",
  },

  /* --------------------------------------------------------------- legal -- */
  {
    label: "Deed, title and easements",
    category: "legal",
    detail:
      "Have the attorney check the chain of title, easements, rights of way and anything recorded against the parcel.",
  },
  {
    label: "HOA or POA documents and dues",
    category: "legal",
    detail:
      "Get the covenants, the current dues, the reserve position, and any pending assessment. Read the rental restrictions specifically — some cap nightly rentals or minimum stays.",
  },
];

/** Grouped in the order above, which is roughly the order you would work it. */
export const DILIGENCE_CATEGORY_LABELS: Record<DiligenceCategory, string> = {
  permits: "Permits & permissions",
  land: "Land, flood & elevation",
  structure: "Structure & systems",
  financial: "Money & insurance",
  legal: "Title & covenants",
  other: "Everything else",
};

/**
 * The one-line state of the checklist.
 *
 * `outstanding` counts everything that still needs someone to do something,
 * which is every status except verified and not_applicable. `received` counts
 * as outstanding on purpose: a document sitting unread in an inbox has not
 * answered the question it was requested to answer.
 */
export function summarizeDiligence(
  items: readonly Pick<DiligenceItem, "status">[],
): DiligenceSummary {
  let verified = 0;
  let blocked = 0;
  let outstanding = 0;
  for (const item of items) {
    if (item.status === "verified") verified++;
    else if (item.status === "not_applicable") continue;
    else {
      outstanding++;
      if (item.status === "blocked") blocked++;
    }
  }
  return { total: items.length, outstanding, verified, blocked };
}
