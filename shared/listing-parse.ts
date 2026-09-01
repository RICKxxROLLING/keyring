// shared/listing-parse.ts — pull the facts out of a pasted property listing.
//
// From the tracking list: "cutting a new key should be able to import from
// Zillow etc. for photos and description."
//
// Zillow has no public API for this and actively blocks automated fetching, so
// fetching the URL server-side would be both against their terms and unreliable
// in practice. Pasting is better than it sounds: it works identically for
// Zillow, Redfin, Realtor.com, an MLS printout or an agent's email, it cannot
// break when a site changes its markup, and it never has to be un-blocked.
//
// Everything here is a guess offered to a human who is about to check it. The
// parser never throws and never returns something it is not reasonably sure of
// — a field left undefined just means you type it, which is the status quo. A
// confidently wrong square footage is far worse than a blank one.
//
// Pure and dependency-free so it can be unit tested against real pasted text
// and run in the browser without a round trip.

import type { PropertyType } from "./types.js";

export interface ParsedListing {
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  propertyType?: PropertyType;
  yearBuilt?: number;
  sqft?: number;
  lotSqft?: number;
  bedrooms?: number;
  bathrooms?: number;
  /** Asking price in cents, from a "$249,900"-style figure. */
  priceCents?: number;
  /** The prose paragraphs, with the listing furniture stripped out. */
  description?: string;
}

/** Which fields we actually found — drives the "filled in 6 of 9" summary. */
export function filledFields(parsed: ParsedListing): (keyof ParsedListing)[] {
  return (Object.keys(parsed) as (keyof ParsedListing)[]).filter(
    (k) => parsed[k] !== undefined && parsed[k] !== "",
  );
}

export function parseListing(raw: string): ParsedListing {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) return {};

  const out: ParsedListing = {};

  const address = parseAddress(text);
  if (address) Object.assign(out, address);

  const type = parsePropertyType(text);
  if (type) out.propertyType = type;

  const year = parseYearBuilt(text);
  if (year !== undefined) out.yearBuilt = year;

  const sqft = parseSqft(text);
  if (sqft !== undefined) out.sqft = sqft;

  const lot = parseLotSqft(text);
  if (lot !== undefined) out.lotSqft = lot;

  const beds = parseBedrooms(text);
  if (beds !== undefined) out.bedrooms = beds;

  const baths = parseBathrooms(text);
  if (baths !== undefined) out.bathrooms = baths;

  const price = parsePrice(text);
  if (price !== undefined) out.priceCents = price;

  const description = parseDescription(text);
  if (description) out.description = description;

  return out;
}

// --------------------------------------------------------------------- address

const STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";

/**
 * "123 Maple St, Springfield, OH 45501" and its common variants.
 *
 * Anchored on the state-and-ZIP tail, which is the only part with a rigid
 * shape. Working backwards from there is far more reliable than trying to
 * recognise a street address, which has almost no rules.
 */
function parseAddress(text: string): Partial<ParsedListing> | null {
  const re = new RegExp(
    // street , city , ST ZIP
    String.raw`([0-9][^\n,]{2,80}?)\s*,\s*([A-Za-z][A-Za-z .'-]{1,40}?)\s*,?\s+(${STATES})\.?\s+(\d{5})(?:-\d{4})?\b`,
  );
  const m = re.exec(text);
  if (!m) return null;

  const [, street, city, state, zip] = m;
  return {
    addressLine1: tidy(street!),
    city: tidy(city!),
    state: state!.toUpperCase(),
    postalCode: zip!,
  };
}

// ---------------------------------------------------------------- property type

/**
 * Order matters: "Single Family Residence" must be tested before the looser
 * "residence", and multi-unit words before "house".
 */
const TYPE_PATTERNS: [RegExp, PropertyType][] = [
  [/\bsingle[\s-]?family\b/i, "single_family"],
  [/\bduplex\b/i, "duplex"],
  [/\btri[\s-]?plex\b/i, "triplex"],
  [/\bfour[\s-]?plex\b|\bquad[\s-]?plex\b|\b4[\s-]?plex\b/i, "fourplex"],
  [/\btown(house|home)\b/i, "townhouse"],
  [/\bcondo(minium)?\b/i, "condo"],
  [/\bmulti[\s-]?family\b/i, "other"],
];

function parsePropertyType(text: string): PropertyType | undefined {
  for (const [re, type] of TYPE_PATTERNS) {
    if (re.test(text)) return type;
  }
  return undefined;
}

// ------------------------------------------------------------------ year built

function parseYearBuilt(text: string): number | undefined {
  const m = /\b(?:year\s*built|built\s*in|built)\s*:?\s*(1[6-9]\d{2}|20\d{2})\b/i.exec(text);
  if (!m) return undefined;
  const year = Number(m[1]);
  // A listing cannot describe a house built after next year; anything else is a
  // number that happened to sit next to the word "built".
  return year >= 1600 && year <= new Date().getFullYear() + 1 ? year : undefined;
}

// ---------------------------------------------------------------- square feet

/**
 * Living area, and specifically NOT the lot.
 *
 * "7,405 sqft lot" and "1,548 sqft" differ by one trailing word, so the lot
 * forms are excluded explicitly rather than hoping the living area appears
 * first — on Redfin it does not.
 */
function parseSqft(text: string): number | undefined {
  const re =
    /(?:^|[^\d.])([\d,]{3,9})\s*(?:sq\.?\s*(?:ft|feet)|sqft|square\s+feet)\b(?!\s*(?:lot|lot\s+size))/gi;
  for (const m of text.matchAll(re)) {
    // Skip a match that is introduced as a lot: "Lot size: 7,405 sqft".
    const before = text.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    if (/lot\s*(size)?\s*:?\s*$/.test(before)) continue;
    const n = toInt(m[1]!);
    if (n !== undefined && n >= 100 && n <= 100_000) return n;
  }
  return undefined;
}

function parseLotSqft(text: string): number | undefined {
  const acres = /\blot\s*(?:size)?\s*:?\s*([\d.]+)\s*acres?\b/i.exec(text);
  if (acres) {
    const a = Number(acres[1]);
    if (Number.isFinite(a) && a > 0 && a < 1000) return Math.round(a * 43_560);
  }
  const sq =
    /\blot\s*(?:size)?\s*:?\s*([\d,]{3,9})\s*(?:sq\.?\s*(?:ft|feet)|sqft)\b/i.exec(text) ??
    /([\d,]{3,9})\s*(?:sq\.?\s*(?:ft|feet)|sqft)\s*lot\b/i.exec(text);
  if (sq) {
    const n = toInt(sq[1]!);
    if (n !== undefined && n >= 100 && n <= 50_000_000) return n;
  }
  return undefined;
}

// ------------------------------------------------------------------ beds/baths

function parseBedrooms(text: string): number | undefined {
  const m = /\b(\d{1,2})\s*(?:bd\b|beds?\b|bedrooms?\b)/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 0 && n <= 30 ? n : undefined;
}

function parseBathrooms(text: string): number | undefined {
  const m = /\b(\d{1,2}(?:\.\d)?)\s*(?:ba\b|baths?\b|bathrooms?\b)/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 0 && n <= 30 ? n : undefined;
}

// ---------------------------------------------------------------------- price

/**
 * The asking price.
 *
 * The largest dollar figure wins: a listing is full of smaller ones (HOA $250,
 * taxes $3,400, "$1,850/mo Zestimate"), and the asking price is reliably the
 * biggest. Anything with a per-month suffix is dropped outright.
 */
function parsePrice(text: string): number | undefined {
  let best: number | undefined;
  for (const m of text.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)\s*(\/\s*mo\b|per\s+month\b)?/gi)) {
    if (m[2]) continue;
    const dollars = Number(m[1]!.replace(/,/g, ""));
    if (!Number.isFinite(dollars) || dollars < 1000) continue;
    if (best === undefined || dollars > best) best = dollars;
  }
  return best === undefined ? undefined : Math.round(best * 100);
}

// ---------------------------------------------------------------- description

/**
 * The prose, minus the furniture.
 *
 * Listing pastes carry a lot of chrome — "Save", "Share", "Zestimate®",
 * "3 beds 2 baths 1,548 sqft", navigation crumbs. What is worth keeping is the
 * agent's paragraphs, which are the lines long enough to be sentences.
 */
function parseDescription(text: string): string | undefined {
  const junk =
    /^(save|share|hide|more|overview|facts|features|contact|request a tour|zestimate|street view|map|photos?|see all|listing provided by|mls#|source:|est\.|payment calculator|schools?|neighborhood)\b/i;

  const paragraphs = text
    .split(/\n{2,}|\n(?=[A-Z])/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 80 && !junk.test(p) && /[.!?]/.test(p));

  if (paragraphs.length === 0) return undefined;
  return paragraphs.join("\n\n").slice(0, 20_000);
}

// ------------------------------------------------------------------- utilities

function toInt(s: string): number | undefined {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/[,;]+$/, "");
}
