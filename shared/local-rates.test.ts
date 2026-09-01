// shared/local-rates.test.ts
//
// Most of these assert what the table REFUSES to do. A tax rate feeds NOI, cap
// rate, cash flow and the maximum price the analyser recommends, so a plausible
// invented number is the most damaging thing this file could contain.
import { describe, expect, it } from "vitest";
import { ratesForZip } from "./local-rates.js";
import { analyzeDeal, defaultDealInputs } from "./deal-analysis.js";

describe("ratesForZip", () => {
  it("knows Kill Devil Hills in full", () => {
    const r = ratesForZip("27948")!;
    expect(r.confidence).toBe("town");
    // Dare County 0.2632% + town 0.28%.
    expect(r.taxRatePct).toBeCloseTo(0.5432, 4);
    expect(r.floodZone).toBe("AE");
  });

  it("knows Manteo in full, with its lower sound-side wind figure", () => {
    const r = ratesForZip("27954")!;
    expect(r.confidence).toBe("town");
    expect(r.taxRatePct).toBeCloseTo(0.6087, 4);
    expect(r.windPerSqftCents).toBeLessThan(ratesForZip("27948")!.windPerSqftCents);
  });

  it("treats unincorporated ZIPs as complete at the county rate", () => {
    const r = ratesForZip("27943")!; // Hatteras
    expect(r.confidence).toBe("county");
    expect(r.taxRatePct).toBeCloseTo(0.2632, 4);
    expect(r.note).toMatch(/no town rate to add/i);
  });

  it("flags a ZIP where a town rate exists but is not known", () => {
    const r = ratesForZip("27959")!; // Nags Head
    expect(r.confidence).toBe("partial");
    expect(r.taxRatePct).toBeCloseTo(0.2632, 4);
    // The whole point: it says out loud that it is understating the tax.
    expect(r.note).toMatch(/understated/i);
  });

  it("returns null for anywhere it has no figures for", () => {
    for (const zip of ["90210", "10001", "45501", "00000", "27000"]) {
      expect(ratesForZip(zip)).toBeNull();
    }
  });

  it("returns null rather than guessing on missing or malformed input", () => {
    expect(ratesForZip(null)).toBeNull();
    expect(ratesForZip(undefined)).toBeNull();
    expect(ratesForZip("")).toBeNull();
    expect(ratesForZip("not a zip")).toBeNull();
  });

  it("handles ZIP+4 and surrounding whitespace", () => {
    expect(ratesForZip("27948-1234")?.confidence).toBe("town");
    expect(ratesForZip("  27948 ")?.confidence).toBe("town");
  });

  it("never returns a rate of zero, which would read as 'no property tax'", () => {
    for (const zip of ["27948", "27954", "27943", "27959", "27949", "27915"]) {
      expect(ratesForZip(zip)!.taxRatePct).toBeGreaterThan(0);
    }
  });

  it("moves the analysis by a real amount, which is why it must be right", () => {
    const base = { ...defaultDealInputs(450_000_00), monthlyRentCents: 3_000_00, sqft: 1_800 };
    const kdh = ratesForZip("27948")!;
    const hatteras = ratesForZip("27943")!;

    const withKdh = analyzeDeal({ ...base, taxRatePct: kdh.taxRatePct }).financed;
    const withHatteras = analyzeDeal({ ...base, taxRatePct: hatteras.taxRatePct }).financed;

    // ~0.28% of 450k is about $1,260 a year between the two.
    const gap = withHatteras.noiCents - withKdh.noiCents;
    expect(gap).toBeGreaterThan(1_000_00);
    expect(gap).toBeLessThan(1_500_00);
  });
});
