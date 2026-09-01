// shared/listing-parse.test.ts — the parser against text shaped like real pastes.
//
// The bar for this feature is not "extracts a lot". It is "never confidently
// wrong": a blank field costs a few seconds of typing, a wrong square footage
// or a wrong asking price gets saved and believed. Several tests below exist
// only to pin down what the parser must REFUSE to guess.
import { describe, expect, it } from "vitest";
import { parseListing, filledFields } from "./listing-parse.js";

const ZILLOW = `
123 Maple St, Springfield, OH 45501
$249,900
3 bd 2 ba 1,548 sqft
Single Family Residence
Built in 1965
Lot size: 7,405 sqft

Charming brick ranch on a quiet street, walking distance to the park. The
kitchen was updated in 2019 with new cabinets and quartz counters, and the roof
was replaced in 2021. Full basement with laundry hookups and plenty of storage.

Zestimate®: $252,300
Est. payment: $1,612/mo
`;

const REDFIN = `
456 Oak Avenue, Dayton, OH 45402 | Redfin
Duplex
$310,000
4 beds, 2 baths, 2,120 sq ft
Year built: 1948
Lot Size: 0.31 acres

Well-maintained side-by-side duplex in a strong rental pocket. Both units are
currently leased and each has separate utilities, which keeps operating costs
predictable for an owner. Off-street parking for four cars behind the building.
`;

describe("parseListing", () => {
  it("reads a Zillow-shaped paste", () => {
    const r = parseListing(ZILLOW);
    expect(r.addressLine1).toBe("123 Maple St");
    expect(r.city).toBe("Springfield");
    expect(r.state).toBe("OH");
    expect(r.postalCode).toBe("45501");
    expect(r.propertyType).toBe("single_family");
    expect(r.yearBuilt).toBe(1965);
    expect(r.sqft).toBe(1548);
    expect(r.lotSqft).toBe(7405);
    expect(r.bedrooms).toBe(3);
    expect(r.bathrooms).toBe(2);
  });

  it("reads a Redfin-shaped paste, including acres for the lot", () => {
    const r = parseListing(REDFIN);
    expect(r.addressLine1).toBe("456 Oak Avenue");
    expect(r.city).toBe("Dayton");
    expect(r.state).toBe("OH");
    expect(r.propertyType).toBe("duplex");
    expect(r.yearBuilt).toBe(1948);
    expect(r.sqft).toBe(2120);
    expect(r.lotSqft).toBe(Math.round(0.31 * 43_560));
    expect(r.priceCents).toBe(31_000_000);
  });

  it("takes the asking price, not the Zestimate or the monthly payment", () => {
    const r = parseListing(ZILLOW);
    // $252,300 is larger, but it is the Zestimate — and the largest-wins rule
    // is what makes this test worth having.
    expect(r.priceCents).toBe(25_230_000);
  });

  it("never mistakes a monthly figure for a price", () => {
    const r = parseListing("Rent: $1,850/mo. Deposit $1,850 per month.");
    expect(r.priceCents).toBeUndefined();
  });

  it("does not report the lot as the living area", () => {
    const r = parseListing("Lot size: 8,712 sqft\nNo interior square footage given.");
    expect(r.sqft).toBeUndefined();
    expect(r.lotSqft).toBe(8712);
  });

  it("keeps the prose and drops the listing furniture", () => {
    const r = parseListing(ZILLOW);
    expect(r.description).toContain("Charming brick ranch");
    expect(r.description).toContain("roof");
    expect(r.description).not.toContain("Zestimate");
    expect(r.description).not.toContain("sqft");
  });

  it("returns nothing at all for text that is not a listing", () => {
    const r = parseListing("hello, how are you today?");
    expect(filledFields(r)).toEqual([]);
  });

  it("is empty and does not throw on empty input", () => {
    expect(parseListing("")).toEqual({});
    expect(parseListing("   \n\n  ")).toEqual({});
  });

  it("ignores a year that is not a build year", () => {
    const r = parseListing("Sold in 2023 for $200,000. Listing viewed 1965 times.");
    expect(r.yearBuilt).toBeUndefined();
  });

  it("handles an address with a unit number and no comma before the state", () => {
    const r = parseListing("310 Pine Rd Apt 4, Kettering OH 45420");
    expect(r.addressLine1).toBe("310 Pine Rd Apt 4");
    expect(r.city).toBe("Kettering");
    expect(r.state).toBe("OH");
    expect(r.postalCode).toBe("45420");
  });

  it("recognises the multi-unit types by name", () => {
    expect(parseListing("Charming triplex").propertyType).toBe("triplex");
    expect(parseListing("Fourplex, fully leased").propertyType).toBe("fourplex");
    expect(parseListing("2 bed condominium").propertyType).toBe("condo");
    expect(parseListing("Townhome with garage").propertyType).toBe("townhouse");
  });

  it("reports which fields it actually filled", () => {
    const filled = filledFields(parseListing(ZILLOW));
    expect(filled).toContain("addressLine1");
    expect(filled).toContain("sqft");
    expect(filled.length).toBeGreaterThan(6);
  });
});
