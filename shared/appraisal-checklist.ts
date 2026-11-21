// shared/appraisal-checklist.ts — getting a property ready for an appraisal
// under UAD 3.6 and the redesigned URAR.
//
// What changed. Fannie Mae and Freddie Mac retired the fixed appraisal forms
// (1004, 1073, 1025, 2055 and the rest) in favour of one dynamic Uniform
// Residential Appraisal Report, delivered as UAD 3.6 data. It is mandatory for
// appraisals submitted to the GSEs on or after November 2, 2026. Much of what
// used to be a sentence of appraiser narrative is now a structured field, which
// means it is either answered precisely or it is a gap: measured area to the
// ANSI Z765 standard, a sketch or floor plan, photos of every kitchen and every
// bathroom, a defects table with a recommended action for each line, and their
// own sections for energy-efficient features, disaster mitigation, ADUs,
// outbuildings and vehicle storage.
//
// What this is NOT. An owner does not fill in the URAR, and the condition and
// quality ratings are the appraiser's call. Nothing here tells you what rating
// you will get, and nothing here should be read as appraisal or lending advice
// — requirements vary by loan, lender and assignment. What it is good at is the
// owner's half of the job: having every answer, and the paper behind it, ready
// before the appraiser arrives, and finding the defects while there is still
// time to fix them.
//
// The bias is coastal North Carolina, as with the diligence list: flood
// elevation, wind mitigation and enclosed ground floors under piling houses are
// near the top because they are the ones that change the report here.
//
// Sources, read November 2026: the Fannie Mae / Freddie Mac UAD 3.6 FAQ and
// the joint "UAD 3.6 Job Aid: Photo and Image Requirements" (v1.0, June 23,
// 2026). Where a line below says "required", it is required by that job aid.
//
// Applied on request, idempotent by label, and freely editable afterwards —
// see the diligence checklist for why it is never seeded automatically.

import type {
  AppraisalItem,
  AppraisalKind,
  AppraisalRecommendedAction,
  AppraisalSection,
  AppraisalStatus,
  AppraisalSummary,
  PropertyType,
} from "./types.js";

/** Just enough of a property to decide which template lines apply. */
export interface AppraisalProfile {
  propertyType: PropertyType;
  unitCount: number;
}

export interface AppraisalTemplateItem {
  label: string;
  section: AppraisalSection;
  kind: AppraisalKind;
  /** What the appraiser looks for, and what to have ready. */
  detail: string;
  /** Leave the line out where it cannot apply. Absent means always. */
  appliesTo?: (p: AppraisalProfile) => boolean;
}

const MULTI_UNIT_TYPES: readonly PropertyType[] = ["duplex", "triplex", "fourplex"];
const isMultiUnit = (p: AppraisalProfile): boolean =>
  MULTI_UNIT_TYPES.includes(p.propertyType) || p.unitCount >= 2;
const isProject = (p: AppraisalProfile): boolean =>
  p.propertyType === "condo" || p.propertyType === "townhouse";

export const APPRAISAL_TEMPLATE: readonly AppraisalTemplateItem[] = [
  /* -------------------------------------------------------- measurement -- */
  {
    label: "Living area measured to ANSI Z765",
    section: "measurement",
    kind: "fact",
    detail:
      "The redesigned URAR reports finished area measured to the ANSI Z765 standard: exterior dimensions, finished space only, above grade and below grade reported separately, garages and unfinished space left out. Finished space generally needs a ceiling of at least 7 feet. Write down above-grade finished, below-grade finished and unfinished square footage, and the date and source of the measurement. If the tax card or an old listing says something different, note which one is wrong — the appraiser's number will be the ANSI one.",
  },
  {
    label: "Floor plan or sketch of every level",
    section: "measurement",
    kind: "document",
    detail:
      "The redesigned URAR carries a sketch or floor plan of the dwelling, with a separate one for an ADU. The appraiser draws their own, but a plan you can hand over — from the builder, a past appraisal or a measuring app — saves a missed room and a second visit.",
  },
  {
    label: "Rooms that do not count as living area",
    section: "measurement",
    kind: "fact",
    detail:
      "List the finished-looking space that may be reported apart from living area: an enclosed ground floor under a piling house, a bonus room reached only by an outside stair, a sunroom that is not heated, a low attic room. Agreeing on which rooms count before the visit is far easier than arguing about the square footage afterwards.",
  },
  {
    label: "Bedroom and bathroom count",
    section: "measurement",
    kind: "fact",
    detail:
      "Count the rooms the way an appraiser will: a bedroom needs a way out and usually a closet, and a full bath has a tub or shower. Compare with the septic permit — if the permit is for fewer bedrooms than the house has, expect that to be noticed.",
  },

  /* --------------------------------------------------------------- site -- */
  {
    label: "Flood zone and elevation certificate",
    section: "site",
    kind: "document",
    detail:
      "Record the FEMA flood zone, the map date, and the base flood elevation. File the elevation certificate if one exists — the finished-floor elevation on it is what the appraiser and the insurer both read. No certificate is worth knowing before the appraisal, not after.",
  },
  {
    label: "Water and sewer — public, well or septic",
    section: "site",
    kind: "fact",
    detail:
      "Which utilities actually serve the parcel. For septic, file the operation permit and note the bedroom count it was approved for. For a well, have the most recent water test.",
  },
  {
    label: "Survey or recorded plat",
    section: "site",
    kind: "document",
    detail:
      "The most recent survey, so lot size, easements and any encroachment are answered from paper rather than from memory.",
  },
  {
    label: "Zoning and permitted use",
    section: "site",
    kind: "fact",
    detail:
      "The zoning district and whether the current use — including renting it — is legal, legal non-conforming, or not. A legal non-conforming use is fine to have and bad to be surprised by.",
  },

  /* ----------------------------------------------------------- dwelling -- */
  {
    label: "Roof — material and year installed",
    section: "dwelling",
    kind: "fact",
    detail:
      "Material, the year it went on, and the warranty if there is one. Keep the invoice with it. On the coast, note any wind-rated shingles or a FORTIFIED designation here as well as under disaster mitigation.",
  },
  {
    label: "Heating and cooling — type, fuel and year",
    section: "dwelling",
    kind: "fact",
    detail:
      "System type (heat pump, furnace, mini-splits), fuel, the year of each unit, and the last service date. A system that does not run on the day of the visit is a deficiency on the report.",
  },
  {
    label: "Water heater — type and year",
    section: "dwelling",
    kind: "fact",
    detail: "Tank or tankless, fuel, capacity and year. The date is usually on the label.",
  },
  {
    label: "Foundation and structure",
    section: "dwelling",
    kind: "fact",
    detail:
      "Foundation type — pilings, crawlspace, slab — and any engineer's or inspector's report. On piling houses, the condition of the pilings and their connections is the first thing to look at.",
  },
  {
    label: "Year built — and the year of any addition",
    section: "dwelling",
    kind: "fact",
    detail:
      "The URAR reports the year the original structure was completed, even if an addition came later — a 1950 house with a 2002 addition is still 1950. Have both years, and the permit for the addition.",
  },
  {
    label: "Kitchens and bathrooms — what is original, what was updated, and when",
    section: "dwelling",
    kind: "fact",
    detail:
      "The URAR now records an update status for each kitchen and bathroom, an overall status for the bathrooms and for flooring, and separate interior and exterior condition and quality ratings. For each kitchen and bathroom write down what was replaced (cabinets, counters, fixtures, flooring) and the year, with the receipts filed under Renovations — the ratings are the appraiser's, but they are built from these.",
  },

  /* ------------------------------------------------------------ updates -- */
  {
    label: "Renovations and updates since purchase, with dates",
    section: "updates",
    kind: "fact",
    detail:
      "One line per update: what, when, roughly what it cost. Finished projects in Keyring are listed alongside this section as a starting point. The appraiser needs the timeframe as much as the work.",
  },
  {
    label: "Building permits for the work",
    section: "updates",
    kind: "document",
    detail:
      "Permits and final inspections for additions, decks, enclosed ground floors, electrical and HVAC work. Unpermitted space may be reported differently from permitted space, and it is better to know which yours is.",
  },
  {
    label: "Receipts and contracts for the larger updates",
    section: "updates",
    kind: "document",
    detail:
      "Contractor invoices for the roof, HVAC, kitchen and baths. They date the work, and dates are what turn \"updated\" into a field the report can use.",
  },

  /* ------------------------------------------------------------ defects -- */
  {
    label: "Walk the property for defects, damage and deficiencies",
    section: "defects",
    kind: "fact",
    detail:
      "Do the appraiser's walk before they do. The redesigned URAR records defects, damage and deficiencies as discrete entries in the part of the report they belong to — site, dwelling exterior, unit interior, outbuilding, vehicle storage, amenities — each with a recommended action. Anything affecting safety, soundness or structural integrity goes in, and so do lesser items. Look for: roof leaks and ceiling stains, soft or rotten decking and stairs, missing handrails, water damage, peeling paint, broken windows, exposed wiring, missing smoke or CO detectors, appliances or systems that do not work. Add each one you find as its own defect with a cost estimate — that is what the repair budget is built from.",
  },

  /* ------------------------------------------------------------- energy -- */
  {
    label: "Solar panels — owned, leased or financed",
    section: "energy",
    kind: "document",
    detail:
      "If there is a solar system, the report records it, and an owned system is treated differently from a leased one or one with a power-purchase agreement. File the purchase paperwork, or the lease or PPA contract and any lien. Mark this N/A if there is no solar.",
  },
  {
    label: "Energy-efficient features and certifications",
    section: "energy",
    kind: "fact",
    detail:
      "The URAR has its own section for energy-efficient and green features. List what you can document: a HERS score or ENERGY STAR certification, high-efficiency heat pump, heat-pump water heater, added insulation, low-E or replacement windows, sealed crawlspace. A feature without paper behind it is a claim; with a receipt or certificate it is a fact.",
  },
  {
    label: "Twelve months of utility bills",
    section: "energy",
    kind: "document",
    detail:
      "Optional, but the simplest evidence that the efficiency features do something. Keep them if you are claiming any.",
  },

  /* --------------------------------------------------------- mitigation -- */
  {
    label: "Wind mitigation — straps, impact windows, shutters",
    section: "mitigation",
    kind: "document",
    detail:
      "Disaster mitigation is a section of its own on the redesigned URAR. File a wind mitigation inspection if you have one, and list hurricane straps or clips, impact-rated windows and doors, and storm shutters. On the Outer Banks these are also what the insurer prices off.",
  },
  {
    label: "FORTIFIED or other roof certificate",
    section: "mitigation",
    kind: "document",
    detail:
      "If the roof was built or re-roofed to the IBHS FORTIFIED standard, file the designation certificate. It is evidence for the appraisal and, separately, a discount on the wind policy.",
  },
  {
    label: "Flood mitigation — elevation, flood vents, breakaway walls",
    section: "mitigation",
    kind: "fact",
    detail:
      "How high the living space sits above base flood elevation, whether the enclosed ground level has flood vents and breakaway walls, and where the HVAC and water heater sit relative to flood level. These are the features that let a coastal house be described as mitigated rather than merely exposed.",
  },
  {
    label: "Backup power and other resilience features",
    section: "mitigation",
    kind: "fact",
    detail: "A standby generator, battery storage, a sump pump, a storm room. Note the install year and keep the invoice.",
  },

  /* --------------------------------------------------------- additional -- */
  {
    label: "Accessory dwelling unit",
    section: "additional",
    kind: "fact",
    detail:
      "An ADU is reported as its own dwelling: generally its own entrance and its own kitchen, with its own sketch and photos. If there is one, write down its size, layout and whether it was permitted as a dwelling. If there is not, mark this N/A.",
  },
  {
    label: "Outbuildings — sheds, detached garages, pool houses",
    section: "additional",
    kind: "fact",
    detail: "Each outbuilding is recorded separately, with interior and exterior photos. List size, use, and whether it is finished or heated.",
  },
  {
    label: "Vehicle storage — garage, carport, under-house parking",
    section: "additional",
    kind: "fact",
    detail:
      "The number of spaces and the type of each: attached or detached garage, carport, parking under a piling house, driveway. Vehicle storage is its own part of the report now, with a photo of each one.",
  },
  {
    label: "Amenities — pool, hot tub, dock, elevator",
    section: "additional",
    kind: "fact",
    detail: "Each amenity is its own entry on the report, with its own photo. List each with its condition and age. An elevator or a pool that does not work is a deficiency, not an amenity.",
  },

  /* ------------------------------------------------------------- photos -- */
  // The appraiser takes the report's photos. Your job is to make each of these
  // photo-ready, and to keep your own dated set from the same day: it is your
  // record of the condition they saw if a rating is ever disputed.
  {
    label: "Every kitchen, photo-ready",
    section: "photos",
    kind: "photo",
    detail:
      "Required on every report: interior photos of all kitchens. Clear the counters, make sure every appliance works, and take your own dated photos the same day.",
  },
  {
    label: "Every bathroom, photo-ready",
    section: "photos",
    kind: "photo",
    detail: "Required: interior photos of all bathrooms. Working fixtures, no leaks, no stains, your own dated set.",
  },
  {
    label: "Living areas and every bedroom",
    section: "photos",
    kind: "photo",
    detail:
      "Required: the main living areas — living room, family room, dining room and all bedrooms. Tenant-occupied rooms need to be reachable and reasonably clear.",
  },
  {
    label: "Exterior front and rear, and the street",
    section: "photos",
    kind: "photo",
    detail:
      "Required: the front and rear of the dwelling, and the street scene showing access to the property. Clear the yard and the drive, and fix anything that will be in frame.",
  },
  {
    label: "Views and water frontage",
    section: "photos",
    kind: "photo",
    detail:
      "Views that affect value or marketability must be photographed, and so must water frontage with private access. On the sound or the ocean, make sure the appraiser can get to where the view is.",
  },
  {
    label: "Below-grade areas, finished and unfinished",
    section: "photos",
    kind: "photo",
    detail: "Required when there is a basement or other below-grade space. Rare on the coast — mark N/A if there is none.",
  },
  {
    label: "Each outbuilding and any ADU, inside and out",
    section: "photos",
    kind: "photo",
    detail: "Required when present: interior and exterior photos of each outbuilding, and interior photos of an ADU.",
  },
  {
    label: "Recent updates — before and after",
    section: "photos",
    kind: "photo",
    detail:
      "The report must show recent restoration, remodelling or renovation where there is any. Your before-and-after photos are the strongest evidence of what was done and roughly when.",
  },
  {
    label: "Photos of every defect — and of the repair",
    section: "photos",
    kind: "photo",
    detail: "A dated photo of the repair is how you show a defect was dealt with before the visit.",
  },

  /* ------------------------------------------------------------- income -- */
  {
    label: "Current lease for every unit",
    section: "income",
    kind: "document",
    detail:
      "The old 1007 rent schedule is now the URAR's Rental Information section, completed when the loan needs market rent — an investment-property loan, typically. Have each signed lease on file, with the rent, the term, and what the tenant pays for.",
  },
  {
    label: "Rent roll for the last twelve months",
    section: "income",
    kind: "document",
    detail: "Unit, tenant, rent, and paid or not, month by month. The Money tab has the numbers; export or print them here.",
    appliesTo: isMultiUnit,
  },
  {
    label: "Short-term rental history",
    section: "income",
    kind: "document",
    detail:
      "If it is rented by the week, keep two years of statements from the manager or platform. Lenders differ on whether and how short-term income counts, so have it ready rather than assume either way.",
  },
  {
    label: "Tenant notice and access for the visit",
    section: "income",
    kind: "fact",
    detail:
      "The appraiser needs to see every room, plus the attic and crawlspace if they can. Give tenants the notice their lease requires, and arrange keys, pets and alarm codes in advance.",
  },

  /* ------------------------------------------------------------ project -- */
  {
    label: "HOA or POA — dues, contact, documents",
    section: "project",
    kind: "document",
    detail:
      "If there is an association: its name, the management company's contact, the current dues and any special assessment, and the covenants. Mark N/A if there is none.",
  },
  {
    label: "Condo or townhome project information",
    section: "project",
    kind: "document",
    detail:
      "Lenders ask the association about the project — number of units, how many are rented, the budget and reserves, insurance, any litigation. Find out who answers the lender's questionnaire and how long it takes, because it is usually the slowest document in the file.",
    appliesTo: isProject,
  },
];

/** The template lines that apply to this property, in template order. */
export function appraisalTemplateFor(profile: AppraisalProfile): AppraisalTemplateItem[] {
  return APPRAISAL_TEMPLATE.filter((t) => !t.appliesTo || t.appliesTo(profile));
}

/** In the order the report asks for them, roughly. */
export const APPRAISAL_SECTION_ORDER: readonly AppraisalSection[] = [
  "measurement",
  "site",
  "dwelling",
  "updates",
  "defects",
  "energy",
  "mitigation",
  "additional",
  "photos",
  "income",
  "project",
  "other",
];

export const APPRAISAL_SECTION_LABELS: Record<AppraisalSection, string> = {
  measurement: "Size & floor plan",
  site: "Site, flood & utilities",
  dwelling: "The house & its systems",
  updates: "Renovations & updates",
  defects: "Defects, damage & deficiencies",
  energy: "Energy-efficient & green features",
  mitigation: "Disaster mitigation",
  additional: "ADUs, outbuildings & parking",
  photos: "Photos",
  income: "Rent & access",
  project: "HOA & project",
  other: "Everything else",
};

export const APPRAISAL_KIND_LABELS: Record<AppraisalKind, string> = {
  document: "Document",
  photo: "Photos",
  fact: "Fact",
  defect: "Defect",
};

/** The URAR's four, in the report's words where they are clear enough. */
export const APPRAISAL_ACTION_LABELS: Record<AppraisalRecommendedAction, string> = {
  none: "None — note only",
  repair: "Repair",
  inspect: "Inspection",
  completion: "Completion — finish the work",
};

/** Status reads differently for a defect: "ready" means it has been fixed. */
export function appraisalStatusLabel(status: AppraisalStatus, kind: AppraisalKind): string {
  if (kind === "defect") {
    return { todo: "Open", in_progress: "Fixing", ready: "Fixed", not_applicable: "Ruled out" }[status];
  }
  return { todo: "To do", in_progress: "Gathering", ready: "Ready", not_applicable: "N/A" }[status];
}

function isOpen(status: AppraisalStatus): boolean {
  return status !== "ready" && status !== "not_applicable";
}

/**
 * The header line of the tab, and the number the budget button acts on.
 *
 * `unbudgetedCents` is the estimate on open defects that are not yet on a
 * project. Once a defect is linked, its money is the project's to track, and
 * counting it here as well would ask you to budget it twice.
 */
export function summarizeAppraisal(
  items: readonly Pick<AppraisalItem, "status" | "kind" | "estimateCents" | "projectId">[],
): AppraisalSummary {
  let ready = 0;
  let outstanding = 0;
  let openDefects = 0;
  let costToCureCents = 0;
  let unbudgetedCents = 0;
  for (const item of items) {
    if (item.status === "ready") ready++;
    if (!isOpen(item.status)) continue;
    outstanding++;
    if (item.kind !== "defect") continue;
    openDefects++;
    const est = item.estimateCents ?? 0;
    costToCureCents += est;
    if (item.projectId === null) unbudgetedCents += est;
  }
  return { total: items.length, ready, outstanding, openDefects, costToCureCents, unbudgetedCents };
}

/** Open defects that carry an estimate and are not on a project yet — what "budget the repairs" takes. */
export function isBudgetable(
  item: Pick<AppraisalItem, "status" | "kind" | "estimateCents" | "projectId">,
): boolean {
  return (
    item.kind === "defect" &&
    isOpen(item.status) &&
    item.projectId === null &&
    (item.estimateCents ?? 0) > 0
  );
}
