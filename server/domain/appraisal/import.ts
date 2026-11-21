// server/domain/appraisal/import.ts — read a past appraisal into facts the
// checklist can use.
//
// Two readers, very different in how far they can be trusted:
//
//   UAD 3.6 XML (bare, or inside the GSE delivery ZIP). Read field by field,
//   by the element names in the GSE delivery specification (Appendix A-1) and
//   checked against the GSEs' own sample files (Appendix D-1). Everything about
//   the property is taken from the one PROPERTY element marked
//   ValuationUseType="SubjectProperty" — never from the comparables, which are
//   sibling PROPERTY elements carrying the same field names with other houses'
//   values in them. Reading "the first YearBuilt in the file" would be right by
//   luck.
//
//   PDF. Read off the page text (pdftotext -layout), by label. The redesigned
//   URAR prints "label   value" in fixed columns and puts the subject before
//   the comparables grid, so the first match is the subject's. Older 1004-style
//   forms get a few tightly anchored patterns and nothing more. Like the receipt
//   reader, it leaves a field empty rather than guess.
//
// Neither reader writes anything. They produce a preview a person ticks
// through; see routes.import.ts.
import { findAll, findFirst, parseXml, textOf, textsOf, type XmlNode } from "../../lib/xml.js";
import type {
  AppraisalImportPreview,
  AppraisalRecommendedAction,
  ImportedDefect,
  ImportedFact,
} from "../../../shared/types.js";

/** What a reader returns; the route adds the property-specific parts. */
export type Extracted = Omit<AppraisalImportPreview, "sourceFilename" | "hasReportPdf" | "addressMismatch">;

/** Checklist labels the importer fills. Pinned by a test against the template. */
export const IMPORT_ITEM_LABELS = {
  gla: "Living area measured to ANSI Z765",
  nonStandard: "Rooms that do not count as living area",
  rooms: "Bedroom and bathroom count",
  flood: "Flood zone and elevation certificate",
  utilities: "Water and sewer — public, well or septic",
  survey: "Survey or recorded plat",
  zoning: "Zoning and permitted use",
  roof: "Roof — material and year installed",
  heating: "Heating and cooling — type, fuel and year",
  foundation: "Foundation and structure",
  yearBuilt: "Year built — and the year of any addition",
  kitchensBaths: "Kitchens and bathrooms — what is original, what was updated, and when",
  solar: "Solar panels — owned, leased or financed",
  energy: "Energy-efficient features and certifications",
  wind: "Wind mitigation — straps, impact windows, shutters",
  floodMitigation: "Flood mitigation — elevation, flood vents, breakaway walls",
  adu: "Accessory dwelling unit",
  outbuildings: "Outbuildings — sheds, detached garages, pool houses",
  vehicles: "Vehicle storage — garage, carport, under-house parking",
  amenities: "Amenities — pool, hot tub, dock, elevator",
  leases: "Current lease for every unit",
  hoa: "HOA or POA — dues, contact, documents",
} as const;

const L = IMPORT_ITEM_LABELS;

/* ------------------------------------------------------------ formatting -- */

/** "ForcedWarmAir" -> "Forced warm air"; "FEMASpecialFloodHazardArea" keeps FEMA. */
export function humanize(code: string): string {
  const words = code
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase()));
  if (words.length === 0) return code;
  const first = words[0]!;
  words[0] = first[0]!.toUpperCase() + first.slice(1);
  return words.join(" ");
}

function lower(code: string): string {
  const h = humanize(code);
  return /^[A-Z]{2,}\b/.test(h) ? h : h[0]!.toLowerCase() + h.slice(1);
}

function num(s: string | null): number | null {
  if (s === null) return null;
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function sqft(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} sq ft`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function usDateToIso(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/* --------------------------------------------------------------- UAD 3.6 -- */

const ACTION_MAP: Record<string, AppraisalRecommendedAction> = {
  Repair: "repair",
  Inspection: "inspect",
  Completion: "completion",
  None: "none",
};

export function extractFromUadXml(xml: string): Extracted {
  const doc = parseXml(xml);
  const subject = findAll(doc, "PROPERTY").find((p) => p.attrs.ValuationUseType === "SubjectProperty");
  if (!subject) {
    throw new ImportError(
      doc.name === "MESSAGE"
        ? "This file has no subject property in it."
        : "This does not look like a UAD 3.6 appraisal file.",
    );
  }
  // Never descend into another PROPERTY from inside the subject.
  const skip = (n: XmlNode): boolean => n.name === "PROPERTY";
  // Report-level values live outside every PROPERTY; skip them all.
  const notInProperty = (n: XmlNode): boolean => n.name === "PROPERTY";
  const s = (name: string): string | null => textOf(subject, name, skip);
  const all = (name: string): string[] => textsOf(subject, name, skip);

  const facts: ImportedFact[] = [];
  const warnings: string[] = [];

  /* report */
  const value = num(textOf(doc, "OpinionOfValueAmount", notInProperty));
  const report = {
    effectiveDate: textOf(doc, "AppraisalReportEffectiveDate", notInProperty),
    opinionOfValueCents: value === null ? null : Math.round(value * 100),
    assignmentType: (() => {
      const t = textOf(doc, "ValuationAssignmentType", notInProperty);
      return t ? humanize(t) : null;
    })(),
    valueCondition: (() => {
      const t = textOf(doc, "PropertyValuationConditionalConclusionType", notInProperty);
      return t ? humanize(t) : null;
    })(),
    overallCondition: s("OverallConditionRatingCode"),
    overallQuality: s("OverallQualityRatingCode"),
  };

  /* address */
  const addr = subject.children.find((c) => c.name === "ADDRESS") ?? null;
  const subjectAddress = addr
    ? [textOf(addr, "AddressLineText"), textOf(addr, "CityName"), [textOf(addr, "StateCode"), textOf(addr, "PostalCode")].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : null;

  /* size */
  const units = findAll(subject, "PROPERTY_UNIT", skip);
  const sumOver = (name: string): number | null => {
    const vals = units.map((u) => num(textOf(u, name))).filter((n): n is number => n !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const above = sumOver("UnitStandardAboveGradeFinishedAreaMeasure");
  const below = sumOver("UnitStandardBelowGradeFinishedAreaMeasure");
  const unfinished = (sumOver("UnitAboveGradeUnfinishedAreaMeasure") ?? 0) + (sumOver("UnitBelowGradeUnfinishedAreaMeasure") ?? 0);
  const nonStandard =
    (sumOver("UnitNonStandardAboveGradeFinishedAreaMeasure") ?? 0) + (sumOver("UnitNonStandardBelowGradeFinishedAreaMeasure") ?? 0);
  if (above !== null) {
    const ansi = textOf(doc, "MeasurementStandardPublisherType", notInProperty) === "AmericanNationalStandardsInstitute";
    const parts = [`${sqft(above)} finished above grade`];
    if (below) parts.push(`${sqft(below)} finished below grade`);
    if (unfinished) parts.push(`${sqft(unfinished)} unfinished`);
    facts.push({
      key: "gla",
      label: "Living area",
      value: parts.join(" · ") + (ansi ? " (measured to ANSI Z765)" : ""),
      itemLabel: L.gla,
      propertyField: "sqft",
      propertyValue: Math.round(above),
    });
  }
  if (nonStandard > 0) {
    facts.push({
      key: "nonStandard",
      label: "Finished area not counted as living area",
      value: `${sqft(nonStandard)} of non-standard finished area`,
      itemLabel: L.nonStandard,
    });
  }

  /* rooms, per unit when there are several */
  const unitLines = units
    .map((u, i) => {
      const beds = num(textOf(u, "BedroomCount"));
      const full = num(textOf(u, "FullBathroomCount"));
      const half = num(textOf(u, "HalfBathroomCount"));
      if (beds === null && full === null) return null;
      const body = [
        beds !== null ? plural(beds, "bedroom") : null,
        full !== null ? plural(full, "full bath") : null,
        half ? plural(half, "half bath") : null,
      ]
        .filter(Boolean)
        .join(", ");
      return units.length > 1 ? `${textOf(u, "UnitIdentifier") ?? `Unit ${i + 1}`}: ${body}` : body;
    })
    .filter((l): l is string => l !== null);
  if (unitLines.length) {
    facts.push({ key: "rooms", label: "Bedrooms and bathrooms", value: unitLines.join(" · "), itemLabel: L.rooms });
  }

  /* year built */
  const year = num(s("PropertyStructureBuiltYear"));
  if (year !== null && year > 1600 && year < 2200) {
    const est = s("PropertyStructureBuiltYearEstimatedIndicator") === "true";
    facts.push({
      key: "yearBuilt",
      label: "Year built",
      value: `${year}${est ? " (estimated by the appraiser)" : ""}`,
      itemLabel: L.yearBuilt,
      propertyField: "yearBuilt",
      propertyValue: year,
    });
  }

  /* site */
  const lotNode = findFirst(subject, "LotSizeAreaMeasure", skip);
  const lot = num(lotNode?.text ?? null);
  const parcel = s("ParcelIdentifier");
  if (lot !== null || parcel) {
    const acres = lotNode?.attrs.AreaUnitOfMeasureType === "Acres";
    const lotSqft = lot === null ? null : Math.round(acres ? lot * 43_560 : lot);
    const parts = [
      lot !== null ? `Site ${acres ? `${lot} acres` : sqft(lot)}` : null,
      parcel ? `parcel ${parcel}` : null,
    ].filter(Boolean);
    facts.push({ key: "site", label: "Site size and parcel", value: parts.join(" · "), itemLabel: L.survey });
    if (lotSqft !== null) {
      facts.push({ key: "lotSqft", label: "Lot size", value: sqft(lotSqft), itemLabel: null, propertyField: "lotSqft", propertyValue: lotSqft });
    }
    if (parcel) {
      facts.push({ key: "parcel", label: "Parcel number", value: parcel, itemLabel: null, propertyField: "parcelNumber", propertyValue: parcel });
    }
  }
  const zoningId = s("SiteZoningClassificationIdentifier");
  const zoningCompliance = s("SiteZoningComplianceType");
  if (zoningId || zoningCompliance) {
    const desc = s("SiteZoningClassificationDescription");
    facts.push({
      key: "zoning",
      label: "Zoning",
      value: [zoningId ? `${zoningId}${desc ? ` (${desc})` : ""}` : null, zoningCompliance ? `${lower(zoningCompliance)} use` : null]
        .filter(Boolean)
        .join(" · "),
      itemLabel: L.zoning,
    });
  }
  const site = findFirst(subject, "SITE", skip);
  const hazards = site ? textsOf(site, "HazardZoneType") : [];
  if (hazards.length) {
    const sfha = hazards.includes("FEMASpecialFloodHazardArea");
    facts.push({
      key: "flood",
      label: "Flood hazard",
      value: sfha
        ? "In a FEMA special flood hazard area, per the appraisal"
        : `Not in a FEMA special flood hazard area, per the appraisal${hazards.some((h) => h !== "None") ? ` (other hazard zone: ${hazards.filter((h) => h !== "None").map(lower).join(", ")})` : ""}`,
      itemLabel: L.flood,
    });
  }
  const utilities = site
    ? findAll(site, "SITE_UTILITY_DETAIL").map((u) => {
        const type = textOf(u, "UtilityType");
        const own = textOf(u, "SiteUtilityOwnershipType");
        return type ? `${humanize(type)}: ${own === "NonPublic" ? "private" : own ? lower(own) : "—"}` : null;
      })
    : [];
  if (utilities.some(Boolean)) {
    facts.push({ key: "utilities", label: "Utilities", value: utilities.filter(Boolean).join(" · "), itemLabel: L.utilities });
  }

  /* systems */
  const roof = s("RoofMaterialType");
  if (roof) {
    const age = s("RoofEstimatedAgeRangeType");
    facts.push({ key: "roof", label: "Roof", value: `${humanize(roof)}${age ? `, roughly ${lower(age)} old` : ""}`, itemLabel: L.roof });
  }
  const heat = s("HeatingSystemType");
  const fuel = s("HeatingFuelType");
  const cool = s("CoolingSystemType");
  if (heat || cool) {
    facts.push({
      key: "heating",
      label: "Heating and cooling",
      value: [heat ? `Heat: ${lower(heat)}${fuel ? `, ${lower(fuel)}` : ""}` : null, cool ? `cooling: ${lower(cool)}` : null]
        .filter(Boolean)
        .join(" · "),
      itemLabel: L.heating,
    });
  }
  const foundation = s("FoundationType");
  if (foundation) {
    const material = s("FoundationMaterialType");
    facts.push({ key: "foundation", label: "Foundation", value: `${humanize(foundation)}${material ? `, ${lower(material)}` : ""}`, itemLabel: L.foundation });
  }

  /* kitchens and baths */
  const roomLines = findAll(subject, "ROOM_DETAIL", skip)
    .filter((r) => /Kitchen|Bathroom/.test(textOf(r, "RoomType") ?? ""))
    .map((r) => {
      const status = textOf(r, "RoomUpdateStatusType");
      const when = textOf(r, "RoomUpdatedTimeframeType");
      return `${humanize(textOf(r, "RoomType")!)}: ${status ? lower(status) : "update status not given"}${when ? `, ${lower(when)} ago` : ""}`;
    });
  const overallBaths = s("OverallBathroomsUpdateStatusType");
  if (overallBaths) roomLines.push(`Bathrooms overall: ${lower(overallBaths)}`);
  const ratingParts = [
    s("ExteriorConditionRatingCode") && `exterior ${s("ExteriorConditionRatingCode")}/${s("ExteriorQualityRatingCode") ?? "?"}`,
    s("InteriorConditionRatingCode") && `interior ${s("InteriorConditionRatingCode")}/${s("InteriorQualityRatingCode") ?? "?"}`,
  ].filter(Boolean);
  if (ratingParts.length) roomLines.push(`Ratings (condition/quality): ${ratingParts.join(", ")}`);
  if (roomLines.length) {
    facts.push({ key: "kitchensBaths", label: "Kitchen and bath updates", value: roomLines.join(" · "), itemLabel: L.kitchensBaths });
  }

  /* energy and mitigation */
  const renewable = findAll(subject, "RENEWABLE_ENERGY_COMPONENT", skip);
  const renewableExists = s("RenewableEnergyComponentExistsIndicator");
  if (renewable.length) {
    facts.push({
      key: "solar",
      label: "Renewable energy",
      value: renewable
        .map((r) => {
          const type = textOf(r, "RenewableEnergyComponentType");
          const own = textOf(r, "RenewableEnergyComponentOwnershipType");
          const financed = textOf(r, "RenewableEnergyComponentFinancedIndicator") === "true";
          return [type ? humanize(type) : "System", own ? lower(own) : null, financed ? "financed" : null].filter(Boolean).join(", ");
        })
        .join(" · "),
      itemLabel: L.solar,
    });
  } else if (renewableExists === "false") {
    facts.push({ key: "solar", label: "Renewable energy", value: "None reported", itemLabel: L.solar, suggestsNotApplicable: true });
  }
  const green = s("EnergyEfficientAndGreenDescription");
  if (green) facts.push({ key: "energy", label: "Energy-efficient features", value: green, itemLabel: L.energy });

  const mitigation = all("DisasterMitigationFeatureType").filter((t) => t !== "None");
  const floodish = mitigation.filter((t) => /Flood/i.test(t));
  const windish = mitigation.filter((t) => !/Flood/i.test(t));
  if (windish.length) facts.push({ key: "wind", label: "Disaster mitigation", value: windish.map(humanize).join(", "), itemLabel: L.wind });
  if (floodish.length) facts.push({ key: "floodMitigation", label: "Flood mitigation", value: floodish.map(humanize).join(", "), itemLabel: L.floodMitigation });

  /* additional structures */
  const aduCount = num(s("AccessoryDwellingUnitTotalCount"));
  if (aduCount !== null) {
    facts.push({
      key: "adu",
      label: "Accessory dwelling units",
      value: aduCount === 0 ? "None reported" : plural(aduCount, "ADU"),
      itemLabel: L.adu,
      suggestsNotApplicable: aduCount === 0,
    });
  }
  const outbuildings = all("OutbuildingType");
  if (outbuildings.length) facts.push({ key: "outbuildings", label: "Outbuildings", value: outbuildings.map(humanize).join(", "), itemLabel: L.outbuildings });
  const cars = findAll(subject, "CAR_STORAGE_DETAIL", skip).map((c) => {
    const type = textOf(c, "CarStorageType");
    const attach = textOf(c, "CarStorageAttachmentType");
    const spaces = num(textOf(c, "ParkingSpacesCount"));
    return [type ? humanize(type) : "Parking", attach ? lower(attach) : null, spaces !== null ? plural(spaces, "space") : null].filter(Boolean).join(", ");
  });
  if (cars.length) facts.push({ key: "vehicles", label: "Vehicle storage", value: [...new Set(cars)].join(" · "), itemLabel: L.vehicles });
  const amenities = findAll(subject, "AMENITY_DETAIL", skip)
    .map((a) => {
      const type = textOf(a, "AmenityType");
      const count = num(textOf(a, "AmenityCount"));
      return type ? `${humanize(type)}${count && count > 1 ? ` ×${count}` : ""}` : null;
    })
    .filter(Boolean);
  if (amenities.length) facts.push({ key: "amenities", label: "Amenities", value: [...new Set(amenities)].join(", "), itemLabel: L.amenities });

  /* rent */
  const rentLines = units
    .map((u, i) => {
      const sched = findFirst(u, "UNIT_RENT_SCHEDULE");
      if (!sched) return null;
      const actual = num(textOf(sched, "UnitMonthlyActualRentAmount"));
      const market = num(textOf(sched, "UnitMonthlyMarketRentAmount"));
      if (actual === null && market === null) return null;
      const rented = textOf(sched, "UnitRentedIndicator") !== "false" && (actual ?? 0) > 0;
      const name = textOf(u, "UnitIdentifier") ?? `Unit ${i + 1}`;
      return `${name}: ${rented ? `$${actual!.toLocaleString("en-US")}/mo actual` : "not rented"}${market !== null ? `, $${market.toLocaleString("en-US")}/mo market` : ""}`;
    })
    .filter((l): l is string => l !== null);
  if (rentLines.length) facts.push({ key: "rent", label: "Rent schedule", value: rentLines.join(" · "), itemLabel: L.leases });

  /* HOA */
  const dues = findAll(subject, "ASSOCIATION_CHARGE_DETAIL", skip).find((d) => textOf(d, "AssociationChargeType") === "AssociationDues");
  const project = s("ProjectName");
  if (dues || project) {
    const amount = num(textOf(dues ?? null, "AssociationChargeAmount"));
    const period = textOf(dues ?? null, "AssociationChargePeriodType");
    const special = findAll(subject, "ASSOCIATION_CHARGE_DETAIL", skip).filter(
      (d) => textOf(d, "AssociationChargeType") === "AssociationSpecialAssessment" && textOf(d, "AssociationSpecialAssessmentStatusType") !== "None",
    );
    facts.push({
      key: "hoa",
      label: "Association",
      value: [
        project,
        amount !== null ? `dues $${amount.toLocaleString("en-US")}${period ? ` ${lower(period)}` : ""}` : null,
        special.length ? `${plural(special.length, "special assessment")} (${special.map((d) => lower(textOf(d, "AssociationSpecialAssessmentStatusType") ?? "")).join(", ")})` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      itemLabel: L.hoa,
    });
  }

  /* defects */
  const defects: ImportedDefect[] = findAll(subject, "DEFECT_DETAIL", skip).map((d, i) => {
    const component = textOf(d, "DefectComponentLabelType");
    const locType = textOf(d, "DefectItemLocationType");
    const location = locType === "Other" ? textOf(d, "DefectItemLocationTypeOtherDescription") : locType ? humanize(locType) : null;
    const cost = num(textOf(d, "DefectItemEstimatedCostToRepairAmount"));
    const action = textOf(d, "DefectItemRecommendedActionType");
    return {
      key: `defect-${i}`,
      where: [component && component !== "Other" ? humanize(component) : textOf(d, "DefectComponentLabelTypeOtherDescription"), location]
        .filter(Boolean)
        .join(" — "),
      description: textOf(d, "DefectItemDescription") ?? "Defect noted on the appraisal",
      recommendedAction: action ? (ACTION_MAP[action] ?? null) : null,
      estimateCents: cost === null ? null : Math.round(cost * 100),
      affectsSoundness: textOf(d, "DefectItemAffectsSoundnessStructuralIntegrityIndicator") === "true",
    };
  });

  return { format: "uad36_xml", report, subjectAddress, facts, defects, warnings };
}

/* ------------------------------------------------------------------- PDF -- */

/** First capture of the first pattern that matches, trimmed. */
function first(text: string, ...patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/**
 * Read the page text of an appraisal PDF.
 *
 * Patterns are anchored on the printed labels of the redesigned URAR (checked
 * against the GSEs' sample report PDFs) and, for the value and date, on the
 * certification sentence the legacy 1004 / 1025 / 1073 forms all print.
 */
export function extractFromPdfText(text: string): Extracted {
  const warnings: string[] = [];
  const facts: ImportedFact[] = [];
  const isUrar = /Opinion of Market Value/.test(text) && /Effective Date of Appraisal/.test(text);

  if (text.replace(/\s+/g, "").length < 200) {
    throw new ImportError(
      "This PDF has no readable text — it is probably a scan. Import the UAD 3.6 ZIP or XML from the lender or appraiser instead, if you can get it.",
    );
  }

  const legacy = /market value, as defined, of the real property that is the subject of this report is\s*\$?\s*([\d,]+)\s*,?\s*as of\s*,?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(
    text.replace(/\s+/g, " "),
  );
  const valueStr = first(text, /Opinion of Market Value\s+\$\s*([\d,]+)/) ?? legacy?.[1] ?? null;
  const dateStr = first(text, /Effective Date of Appraisal\s+(\d{1,2}\/\d{1,2}\/\d{4})/) ?? legacy?.[2] ?? null;
  const value = num(valueStr);
  const report = {
    effectiveDate: dateStr ? usDateToIso(dateStr) : null,
    opinionOfValueCents: value === null ? null : Math.round(value * 100),
    assignmentType: first(text, /Assignment Type\s+([A-Z][A-Za-z ]+?)(?:\s{2,}|\n)/),
    valueCondition: first(text, /Market Value Condition\s+([A-Z][A-Za-z ]+?)(?:\s{2,}|\n|$)/m),
    overallCondition: first(text, /Overall Condition\s+(C[1-6])\b/, /condition of the property[^\n]{0,160}?\b(C[1-6])\b/i),
    overallQuality: first(text, /Overall Quality\s+(Q[1-6])\b/, /quality of construction[^\n]{0,160}?\b(Q[1-6])\b/i),
  };

  if (!isUrar && !legacy) {
    warnings.push("This does not look like a URAR or a 1004-style appraisal, so very little could be read from it.");
  } else if (!isUrar) {
    warnings.push("Read from an older-style appraisal form. Only a few fields can be read reliably from these — check each one.");
  } else {
    warnings.push("Read from the PDF's text, not the appraisal data. Check each value before importing.");
  }

  const year = num(first(text, /Year Built\s+(\d{4})\b/));
  if (year !== null && year > 1600 && year < 2200) {
    facts.push({ key: "yearBuilt", label: "Year built", value: String(year), itemLabel: L.yearBuilt, propertyField: "yearBuilt", propertyValue: year });
  }

  // The redesigned report prints a size table per unit, so a 2-4 unit report
  // has one "Finished Above Grade" line per unit; the building is their sum.
  // (The comparables grid says "Finished Area Above Grade" and is not matched.)
  const sumAll = (re: RegExp): number | null => {
    const vals = [...text.matchAll(re)].map((m) => num(m[1]!)).filter((n): n is number => n !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const unitCount = [...text.matchAll(/Finished Above Grade\s+[\d,]+\s*Sq\.?\s*Ft/g)].length;
  const above =
    sumAll(/Finished Above Grade\s+([\d,]+)\s*Sq\.?\s*Ft/g) ??
    num(first(text, /([\d,]+)\s+Square Feet of Gross Living Area Above Grade/i));
  if (above !== null && above > 100) {
    const below = sumAll(/Finished Below Grade\s+([\d,]+)\s*Sq\.?\s*Ft/g);
    facts.push({
      key: "gla",
      label: "Living area",
      value: `${sqft(above)} finished above grade${below ? ` · ${sqft(below)} finished below grade` : ""}`,
      itemLabel: L.gla,
      propertyField: "sqft",
      propertyValue: Math.round(above),
    });
  }

  const beds = unitCount > 1 ? sumAll(/Total Bedrooms\s+(\d+)\b/g) : num(first(text, /Total Bedrooms\s+(\d+)\b/, /Rooms\s+\d+\s+Bedrooms\s+(\d+)\s+Bath/i));
  const full = unitCount > 1 ? sumAll(/Total Bathrooms - Full\s+(\d+)\b/g) : num(first(text, /Total Bathrooms - Full\s+(\d+)\b/));
  const half = unitCount > 1 ? sumAll(/Total Bathrooms - Half\s+(\d+)\b/g) : num(first(text, /Total Bathrooms - Half\s+(\d+)\b/));
  const legacyBaths = first(text, /Bedrooms\s+\d+\s+Bath\(s\)\s+([\d.]+)/i, /\d+\s+Bedrooms\s+([\d.]+)\s+Bath\(s\)/i);
  if (beds !== null) {
    const bathText = full !== null ? `${plural(full, "full bath")}${half ? `, ${plural(half, "half bath")}` : ""}` : legacyBaths ? `${legacyBaths} baths` : null;
    facts.push({
      key: "rooms",
      label: "Bedrooms and bathrooms",
      value: [plural(beds, "bedroom"), bathText].filter(Boolean).join(", ") + (unitCount > 1 ? ` across ${unitCount} units` : ""),
      itemLabel: L.rooms,
    });
  }

  const lotMatch = /Total Site Size\s+([\d,.]+)\s*(Sq\.?\s*Ft\.?|Acres?)/i.exec(text);
  const parcel = first(text, /Assessor's Parcel #\s+([A-Za-z0-9-.]{4,})/);
  if (lotMatch || parcel) {
    const lot = lotMatch ? num(lotMatch[1]!) : null;
    const acres = lotMatch ? /acre/i.test(lotMatch[2]!) : false;
    facts.push({
      key: "site",
      label: "Site size and parcel",
      value: [lot !== null ? `Site ${acres ? `${lot} acres` : sqft(lot)}` : null, parcel ? `parcel ${parcel}` : null].filter(Boolean).join(" · "),
      itemLabel: L.survey,
    });
    if (lot !== null) {
      const lotSqft = Math.round(acres ? lot * 43_560 : lot);
      facts.push({ key: "lotSqft", label: "Lot size", value: sqft(lotSqft), itemLabel: null, propertyField: "lotSqft", propertyValue: lotSqft });
    }
    if (parcel) facts.push({ key: "parcel", label: "Parcel number", value: parcel, itemLabel: null, propertyField: "parcelNumber", propertyValue: parcel });
  }

  const zoning = first(text, /Zoning Compliance\s+([A-Z][A-Za-z -]+?)(?:\s{2,}|\n|$)/m, /Zoning Compliance\s+.*?\b(Legal Nonconforming|Legal|Illegal)\b/);
  if (zoning) facts.push({ key: "zoning", label: "Zoning", value: `${zoning} use`, itemLabel: L.zoning });

  // Table rows in the redesigned report's Dwelling Exterior section: the label
  // at the start of a line, then the detail in the next column.
  const row = (label: string): string[] | null => {
    const m = new RegExp(`^\\s*${label}\\s{2,}(.+)$`, "m").exec(text);
    return m ? m[1]!.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean) : null;
  };
  if (isUrar) {
    const roof = row("Roof");
    if (roof?.[0]) facts.push({ key: "roof", label: "Roof", value: roof[0], itemLabel: L.roof });
    const heat = row("Heating");
    const cool = row("Cooling");
    if (heat?.[0] || cool?.[0]) {
      facts.push({
        key: "heating",
        label: "Heating and cooling",
        // The second column is the fuel when there is one, and a comment when
        // there is not; only a recognisable fuel is kept.
        value: [heat?.[0] ? `Heat: ${heat[0]}${heat[1] && FUEL.test(heat[1]) ? `, ${heat[1]}` : ""}` : null, cool?.[0] ? `cooling: ${cool[0]}` : null]
          .filter(Boolean)
          .join(" · "),
        itemLabel: L.heating,
      });
    }
    const foundation = row("Foundation");
    if (foundation?.[0]) facts.push({ key: "foundation", label: "Foundation", value: foundation[0], itemLabel: L.foundation });
  }

  return { format: "pdf", report, subjectAddress: null, facts, defects: [], warnings };
}

const FUEL = /^(Natural Gas|Gas|Electric(ity)?|Oil|Fuel Oil|Propane|Wood|Coal|Kerosene|Solar|Geothermal)$/i;

export class ImportError extends Error {}
