// shared/receipt-parse.test.ts
//
// Against text shaped like real OCR output, noise included. As with the listing
// parser, the bar is not "extracts a lot" — it is "never confidently wrong".
// A blank amount costs seconds of typing; a wrong one lands in the ledger,
// rolls into the property's expense totals, and is believed.
import { describe, expect, it } from "vitest";
import { parseReceipt, filledReceiptFields } from "./receipt-parse.js";

const HARDWARE = `
THE HOME DEPOT
1801 N CROATAN HWY
KILL DEVIL HILLS, NC 27948
(252) 555-0134

SKU 1004521  PVC ELBOW 1/2       3.48
SKU 2210984  TEFLON TAPE         2.97
SKU 9931002  SHUTOFF VALVE      14.99

SUBTOTAL                        21.44
SALES TAX 6.75%                  1.45
TOTAL                           22.89

CASH TENDERED                   40.00
CHANGE                          17.11

08/14/2026  REG 04  TRN 8871
THANK YOU FOR SHOPPING
`;

const PLUMBER = `
Torres Plumbing LLC
Invoice #4417

Service call - unit A leaking faucet
Labor 2.0 hrs                  180.00
Parts                           42.50

Subtotal                       222.50
Tax                             15.02
Amount Due                     237.52

Date: Aug 3, 2026
`;

describe("parseReceipt", () => {
  it("reads a hardware store slip", () => {
    const r = parseReceipt(HARDWARE);
    expect(r.totalCents).toBe(22_89);
    expect(r.taxCents).toBe(1_45);
    expect(r.incurredOn).toBe("2026-08-14");
    expect(r.vendorName).toBe("The Home Depot");
    expect(r.category).toBe("supplies");
  });

  it("reads a service invoice", () => {
    const r = parseReceipt(PLUMBER);
    expect(r.totalCents).toBe(237_52);
    expect(r.taxCents).toBe(15_02);
    expect(r.incurredOn).toBe("2026-08-03");
    expect(r.vendorName).toBe("Torres Plumbing LLC");
    expect(r.category).toBe("repair");
  });

  it("takes the total, not the subtotal", () => {
    // "SUBTOTAL" contains "TOTAL", so this is the trap the label matching has
    // to be built around rather than hope to avoid.
    expect(parseReceipt(HARDWARE).totalCents).not.toBe(21_44);
  });

  it("takes the total, not the cash tendered", () => {
    // Cash tendered is routinely LARGER than the total, so "biggest number on
    // the page" would reliably pick it.
    expect(parseReceipt(HARDWARE).totalCents).not.toBe(40_00);
  });

  it("takes the total, not the change", () => {
    expect(parseReceipt(HARDWARE).totalCents).not.toBe(17_11);
  });

  it("prefers amount due over a bare total when both appear", () => {
    const r = parseReceipt(`Total 100.00\nDiscount -10.00\nAmount Due 90.00`);
    expect(r.totalCents).toBe(90_00);
  });

  it("takes the last total when a slip has several", () => {
    const r = parseReceipt(`GARDEN TOTAL 15.00\nLUMBER TOTAL 32.00\nTOTAL 47.00`);
    expect(r.totalCents).toBe(47_00);
  });

  it("returns nothing at all for text that is not a receipt", () => {
    expect(filledReceiptFields(parseReceipt("hello there, how are you"))).toEqual([]);
  });

  it("is empty and does not throw on empty input", () => {
    expect(parseReceipt("")).toEqual({});
    expect(parseReceipt("   \n\n ")).toEqual({});
  });

  it("does not mistake a tax id for a tax amount", () => {
    const r = parseReceipt(`ACME SUPPLY\nTax ID 12-3456789\nTOTAL 50.00`);
    expect(r.taxCents).toBeUndefined();
    expect(r.totalCents).toBe(50_00);
  });

  it("ignores an amount with no cents, which is usually a quantity", () => {
    const r = parseReceipt(`ACME\nTOTAL 12\nAMOUNT DUE 12.00`);
    expect(r.totalCents).toBe(12_00);
  });

  it("rejects an impossible date rather than shifting it", () => {
    // 02/31 would silently become March 3 if handed to Date().
    expect(parseReceipt(`ACME\n02/31/2026\nTOTAL 10.00`).incurredOn).toBeUndefined();
  });

  it("rejects a date that is not plausibly a receipt", () => {
    expect(parseReceipt(`ACME\n01/02/1970\nTOTAL 10.00`).incurredOn).toBeUndefined();
  });

  it("reads an ISO date without reordering it", () => {
    expect(parseReceipt(`ACME\n2026-08-14\nTOTAL 10.00`).incurredOn).toBe("2026-08-14");
  });

  it("expands a two-digit year", () => {
    expect(parseReceipt(`ACME\n08/14/26\nTOTAL 10.00`).incurredOn).toBe("2026-08-14");
  });

  it("skips address and phone lines when looking for the merchant", () => {
    const r = parseReceipt(`\n123 MAIN STREET\n(252) 555-0134\nRIVERA HVAC\nTOTAL 80.00`);
    expect(r.vendorName).toBe("Rivera Hvac");
  });

  it("leaves the category unset when the merchant says nothing about it", () => {
    // Unset asks the person to choose; a wrong pre-selection gets saved unread.
    expect(parseReceipt(`QUIK MART\nTOTAL 8.00`).category).toBeUndefined();
  });

  it("survives OCR noise without inventing a total", () => {
    const noisy = `#@!! ~~~\n|||| ,,, ...\nl0O0 ###\n`;
    const r = parseReceipt(noisy);
    expect(r.totalCents).toBeUndefined();
  });

  it("ignores an absurd amount rather than accepting it", () => {
    // A dropped decimal point turns 92.50 into something in the millions.
    expect(parseReceipt(`ACME\nTOTAL 99999999.00`).totalCents).toBeUndefined();
  });
});
