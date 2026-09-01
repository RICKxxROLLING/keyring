// shared/receipt-parse.ts — pull the facts out of OCR'd receipt text.
//
// From the tracking list: "receipt scanning + upload, auto-tag to work order."
//
// Separated from the OCR itself so it can be tested against real receipt text
// without Tesseract installed, and so a bad reading can be diagnosed as either
// "OCR misread the pixels" or "the parser misread the text" rather than one
// opaque wrong number.
//
// The governing rule, as with the listing parser: NEVER be confidently wrong. A
// blank amount costs a few seconds of typing. A wrong amount gets saved into
// the ledger, rolls into the property's expense totals, and is believed. Every
// heuristic here fails to `undefined` rather than to its best guess, and a good
// half of the tests exist to pin down what it must refuse.
//
// OCR text is genuinely bad: dropped decimal points, O for 0, l for 1, columns
// collapsed into one line. The patterns below are deliberately loose about
// spacing and strict about structure.

export type ExpenseCategory =
  | "repair"
  | "capex"
  | "utility"
  | "insurance"
  | "tax"
  | "management"
  | "supplies"
  | "legal"
  | "landscaping"
  | "other";

export interface ParsedReceipt {
  /** The amount actually paid, in cents. */
  totalCents?: number;
  /** Sales tax, when stated separately. */
  taxCents?: number;
  /** ISO date, when one can be read unambiguously. */
  incurredOn?: string;
  /** Merchant name, from the top of the receipt. */
  vendorName?: string;
  /** A guess from the merchant name, only when it is a confident one. */
  category?: ExpenseCategory;
}

export function parseReceipt(raw: string): ParsedReceipt {
  const text = raw.replace(/\r\n?/g, "\n");
  if (!text.trim()) return {};

  // Nothing at all unless the text carries money. A page with no currency
  // amount on it is not a receipt, and scraping a "vendor" off ordinary prose
  // is exactly the confident wrongness this file exists to avoid.
  if (!new RegExp(MONEY).test(text)) return {};

  const out: ParsedReceipt = {};

  const total = parseTotal(text);
  if (total !== undefined) out.totalCents = total;

  const tax = parseTax(text);
  if (tax !== undefined) out.taxCents = tax;

  const date = parseDate(text);
  if (date !== undefined) out.incurredOn = date;

  const vendor = parseVendor(text);
  if (vendor !== undefined) {
    out.vendorName = vendor;
    const category = guessCategory(vendor, text);
    if (category !== undefined) out.category = category;
  }

  return out;
}

/** Which fields were actually read — drives the "filled in 3 of 4" summary. */
export function filledReceiptFields(parsed: ParsedReceipt): (keyof ParsedReceipt)[] {
  return (Object.keys(parsed) as (keyof ParsedReceipt)[]).filter((k) => parsed[k] !== undefined);
}

// ---------------------------------------------------------------------- money

/** `1,234.56` / `1234.56` / `$1 234.56`. Requires cents: a receipt total has them. */
const MONEY = String.raw`\$?\s*([0-9][0-9,\s]{0,12}\.\d{2})`;

function toCents(s: string): number | undefined {
  const n = Number(s.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return undefined;
  return Math.round(n * 100);
}

/**
 * The amount paid.
 *
 * Labelled lines only. A receipt is full of numbers — line items, subtotal,
 * tax, change, cash tendered, loyalty points — and "the largest number on the
 * page" picks the wrong one often enough to be dangerous: cash tendered is
 * routinely larger than the total.
 *
 * Ordered by trust. "Amount due" and "balance" beat a bare "total", and
 * anything containing "subtotal" is excluded outright rather than ranked, since
 * "SUBTOTAL" contains "TOTAL" and would otherwise match.
 */
function parseTotal(text: string): number | undefined {
  const labels: RegExp[] = [
    /\b(?:amount\s+due|balance\s+due|total\s+due)\b/i,
    /\bgrand\s+total\b/i,
    /\btotal\b/i,
    /\bbalance\b/i,
  ];

  for (const label of labels) {
    const found = lastLabelledAmount(text, label);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The amount on the last line matching `label`, ignoring the ones that are
 * about something else.
 *
 * Last rather than first: receipts repeat "total" (per-department subtotals on
 * a hardware store slip), and the one that matters is at the bottom.
 */
function lastLabelledAmount(text: string, label: RegExp): number | undefined {
  const excluded =
    /\b(?:sub\s*-?\s*total|subtotal|change|tendered|cash\s+back|savings|you\s+saved|points|tip|gratuity)\b/i;

  let best: number | undefined;
  for (const line of text.split("\n")) {
    if (!label.test(line) || excluded.test(line)) continue;
    // The amount on a total line is the last one on it: "TOTAL 3 ITEMS 42.10".
    const amounts = [...line.matchAll(new RegExp(MONEY, "g"))];
    const last = amounts[amounts.length - 1];
    if (!last) continue;
    const cents = toCents(last[1]!);
    if (cents !== undefined) best = cents;
  }
  return best;
}

function parseTax(text: string): number | undefined {
  // Not "tax id", "taxable", or a tax-exempt line — those carry numbers that
  // are not money.
  const line = [...text.split("\n")]
    .filter((l) => /\b(?:sales\s+tax|tax)\b/i.test(l) && !/\b(?:tax\s*(?:id|exempt)|taxable)\b/i.test(l))
    .pop();
  if (!line) return undefined;
  const amounts = [...line.matchAll(new RegExp(MONEY, "g"))];
  const last = amounts[amounts.length - 1];
  return last ? toCents(last[1]!) : undefined;
}

// ----------------------------------------------------------------------- date

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * The transaction date.
 *
 * US ordering is assumed for all-numeric dates, because that is what the
 * receipts this reads are printed in — but only where it is unambiguous or the
 * day is over 12. A date that could be either is still returned in US order;
 * that is a deliberate, documented bias rather than an accident, and the field
 * is shown for confirmation before anything is saved.
 */
function parseDate(text: string): string | undefined {
  // 12 Jan 2026 / Jan 12, 2026
  const named =
    /\b(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})\b/i.exec(text) ??
    /\b([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(text);
  if (named) {
    const monthFirst = Number.isNaN(Number(named[1]));
    const month = MONTHS[(monthFirst ? named[1]! : named[2]!).toLowerCase().slice(0, 3)];
    const day = Number(monthFirst ? named[2] : named[1]);
    const year = Number(named[3]);
    const iso = build(year, month, day);
    if (iso) return iso;
  }

  // 01/12/2026, 1-12-26, 2026-01-12
  for (const m of text.matchAll(/\b(\d{1,4})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = Number(m[3]);
    // Leading four-digit year is ISO and unambiguous.
    const iso =
      String(m[1]).length === 4 ? build(a, b, c) : build(fullYear(c), a, b);
    if (iso) return iso;
  }
  return undefined;
}

function fullYear(n: number): number {
  return n >= 100 ? n : n + 2000;
}

function build(year: number, month: number | undefined, day: number): string | undefined {
  if (!month || !Number.isFinite(year) || !Number.isFinite(day)) return undefined;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  // A receipt is not from 1970 or from the next century.
  if (year < 2000 || year > new Date().getFullYear() + 1) return undefined;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Rejects 2026-02-31 and friends, which pass the range checks above.
  const parsed = new Date(`${iso}T00:00:00Z`);
  return parsed.getUTCDate() === day && parsed.getUTCMonth() + 1 === month ? iso : undefined;
}

// --------------------------------------------------------------------- vendor

/**
 * The merchant, from the top of the receipt.
 *
 * The first line that looks like a name rather than an address, a phone number,
 * a receipt number or OCR noise. Deliberately shallow — only the first few
 * lines are considered, because past that a receipt is line items.
 */
function parseVendor(text: string): string | undefined {
  const noise =
    /^(?:\d|\s*$|.*\b(?:receipt|invoice|order|store|reg(?:ister)?|tel|phone|www\.|http|thank\s+you)\b)/i;

  for (const line of text.split("\n").slice(0, 6)) {
    const cleaned = line.replace(/\s+/g, " ").trim();
    if (cleaned.length < 3 || cleaned.length > 60) continue;
    if (noise.test(cleaned)) continue;
    // Needs letters, and not be mostly punctuation from a bad scan.
    const letters = cleaned.replace(/[^a-z]/gi, "").length;
    if (letters < 3 || letters / cleaned.length < 0.5) continue;
    return titleCase(cleaned);
  }
  return undefined;
}

function titleCase(s: string): string {
  // Receipts are usually printed in caps, which reads as shouting once it is in
  // the ledger. Words already mixed-case are left alone.
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(Llc|Inc|Co)\b/g, (w) => w.toUpperCase());
}

// ------------------------------------------------------------------- category

const CATEGORY_HINTS: [RegExp, ExpenseCategory][] = [
  [/\b(?:home\s*depot|lowe'?s|ace\s+hardware|hardware|menards|true\s+value)\b/i, "supplies"],
  // Stems are open-ended on the right: "plumb" has to match "Plumbing" and
  // "Plumber", which is how these actually appear on a receipt. A trailing \b
  // would match neither, so the anchors go only on the whole words.
  [/\b(?:plumb|electric|hvac\b|roof|repair|handyman\b)/i, "repair"],
  [/\b(?:lawn\b|landscap|garden|tree\s+service|mulch)/i, "landscaping"],
  [/\b(?:insurance\b|assurance\b|underwrit)/i, "insurance"],
  [/\b(?:power\b|energy\b|water\b|sewer\b|gas\s+co\b|utilit)/i, "utility"],
  [/\b(?:attorney|law\s+office|legal\b)/i, "legal"],
];

/**
 * A category, only when the merchant name says so plainly.
 *
 * Left undefined otherwise rather than defaulting to "other": an unset select
 * asks the person to choose, while a wrong one that happens to be pre-selected
 * gets saved unread.
 */
function guessCategory(vendor: string, text: string): ExpenseCategory | undefined {
  const haystack = `${vendor}\n${text.split("\n").slice(0, 6).join("\n")}`;
  for (const [pattern, category] of CATEGORY_HINTS) {
    if (pattern.test(haystack)) return category;
  }
  return undefined;
}
