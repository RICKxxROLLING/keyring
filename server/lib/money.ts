import type { Cents } from "../../shared/types.js";

/** '1,250.50' | '$1250.5' | 1250.5 -> 125050. Throws on garbage. */
export function parseMoney(input: string | number): Cents {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error("Invalid money value");
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error("Invalid money value");
  return Math.round(Number(cleaned) * 100);
}

/** 125050 -> '$1,250.50' */
export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export function sumCents(values: readonly (Cents | null | undefined)[]): Cents {
  let total = 0;
  for (const v of values) total += v ?? 0;
  return total;
}
