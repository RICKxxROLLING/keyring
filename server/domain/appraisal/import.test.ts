// server/domain/appraisal/import.test.ts — the readers under the importer.
//
// The behaviour worth pinning, most important first:
//   1. Subject only. A comparable carries the same field names with another
//      house's values; reading it would put a wrong year or size into the
//      checklist, confidently.
//   2. The XML reader is safe on hostile input: no DOCTYPE, no entity tricks,
//      and the ZIP reader will not inflate past what an entry declares.
//   3. Every checklist label the importer targets exists in the starter list,
//      so a reworded template line cannot silently orphan an import.
import { describe, expect, it } from "vitest";
import { crc32, deflateRawSync } from "node:zlib";
import { parseXml, XmlError, textOf } from "../../lib/xml.js";
import { unzip, ZipError } from "../../lib/unzip.js";
import { buildZip } from "../../lib/zip.js";
import { extractFromPdfText, extractFromUadXml, humanize, IMPORT_ITEM_LABELS, ImportError } from "./import.js";
import { APPRAISAL_TEMPLATE } from "../../../shared/appraisal-checklist.js";
import { UAD36_FIXTURE, URAR_PDF_TEXT } from "./import.fixture.js";

/** A one-entry deflated ZIP, optionally lying about its uncompressed size. */
function deflatedZip(name: string, data: Buffer, declaredSize = data.length): Buffer {
  const comp = deflateRawSync(data);
  const n = Buffer.from(name);
  const crc = crc32(data) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(n.length, 28);
  const cdOffset = local.length + n.length + comp.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, comp, central, n, end]);
}

describe("xml reader", () => {
  it("reads elements, attributes, entities and CDATA, dropping namespace prefixes", () => {
    const doc = parseXml(`<?xml version="1.0"?><a:Root xmlns:a="x" k='v &amp; w'><b>1 &lt; 2 &#169;</b><![CDATA[<raw>]]><c/></a:Root>`);
    expect(doc.name).toBe("Root");
    expect(doc.attrs.k).toBe("v & w");
    expect(textOf(doc, "b")).toBe("1 < 2 ©");
    expect(doc.text).toBe("<raw>");
    expect(doc.children.map((c) => c.name)).toEqual(["b", "c"]);
  });

  it("refuses a DOCTYPE outright, so no entity can ever be defined", () => {
    expect(() => parseXml(`<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>`)).toThrow(XmlError);
  });

  it("leaves an unknown entity as text rather than resolving it", () => {
    expect(textOf(parseXml(`<x><y>&e;</y></x>`), "y")).toBe("&e;");
  });

  it("rejects mismatched and unclosed tags", () => {
    expect(() => parseXml(`<a><b></a>`)).toThrow(XmlError);
    expect(() => parseXml(`<a><b>`)).toThrow(XmlError);
  });
});

describe("zip reader", () => {
  it("reads stored entries written by our own ZIP writer, with UTF-8 names", () => {
    const zip = buildZip([
      { name: "Images/Café.png", data: Buffer.from("png") },
      { name: "report.xml", data: Buffer.from("<x/>") },
    ]);
    const out = unzip(zip, (n) => n.endsWith(".xml"));
    expect(out).toEqual([{ name: "report.xml", data: Buffer.from("<x/>") }]);
    expect(unzip(zip).map((e) => e.name)).toContain("Images/Café.png");
  });

  it("inflates deflated entries", () => {
    const data = Buffer.from("x".repeat(10_000));
    expect(unzip(deflatedZip("a.xml", data))[0]!.data.equals(data)).toBe(true);
  });

  it("will not inflate past the size an entry declares — the zip-bomb guard", () => {
    const data = Buffer.alloc(1_000_000, 0);
    expect(() => unzip(deflatedZip("bomb.xml", data, 1000))).toThrow(ZipError);
  });

  it("refuses an entry larger than the limit before inflating it", () => {
    const data = Buffer.alloc(5000, 1);
    expect(() => unzip(deflatedZip("big.xml", data), undefined, { maxEntryBytes: 1000 })).toThrow(ZipError);
  });

  it("says plainly when the bytes are not a ZIP", () => {
    expect(() => unzip(Buffer.from("not a zip at all, just some text padding it out"))).toThrow(ZipError);
  });
});

describe("UAD 3.6 extraction", () => {
  const r = extractFromUadXml(UAD36_FIXTURE);
  const fact = (key: string) => r.facts.find((f) => f.key === key);

  it("reads the subject, never the comparable sitting next to it", () => {
    expect(fact("yearBuilt")?.propertyValue).toBe(2018);
    expect(fact("gla")?.propertyValue).toBe(1842);
    expect(fact("rooms")?.value).toBe("3 bedrooms, 2 full baths, 1 half bath");
    expect(r.subjectAddress).toBe("12 Test St, Kill Devil Hills, NC 27948");
    expect(r.defects.map((d) => d.description)).not.toContain("Comparable's cracked slab");
  });

  it("reads the report's value, date, assignment and ratings", () => {
    expect(r.report).toEqual({
      effectiveDate: "2026-10-04",
      opinionOfValueCents: 61_200_000,
      assignmentType: "Refinance",
      valueCondition: "As is",
      overallCondition: "C3",
      overallQuality: "Q4",
    });
  });

  it("says the area was measured to ANSI and reports non-standard area separately", () => {
    expect(fact("gla")?.value).toBe("1,842 sq ft finished above grade (measured to ANSI Z765)");
    expect(fact("nonStandard")?.value).toBe("410 sq ft of non-standard finished area");
  });

  it("converts an acreage lot for the property record but shows it as written", () => {
    expect(fact("site")?.value).toBe("Site 0.25 acres · parcel 989617-12-3456");
    expect(fact("lotSqft")?.propertyValue).toBe(10_890);
    expect(fact("parcel")?.propertyValue).toBe("989617-12-3456");
  });

  it("reads site, systems, energy and mitigation in plain words", () => {
    expect(fact("flood")?.value).toBe("In a FEMA special flood hazard area, per the appraisal");
    expect(fact("utilities")?.value).toBe("Water: public · Sanitary sewer: private");
    expect(fact("zoning")?.value).toBe("RS-1 · legal use");
    expect(fact("roof")?.value).toBe("Asphalt, roughly one to ten years old");
    expect(fact("heating")?.value).toBe("Heat: heat pump, electricity");
    expect(fact("kitchensBaths")?.value).toBe("Kitchen: fully updated, one to five years ago");
    expect(fact("wind")?.value).toBe("Impact resistant glass");
    expect(fact("vehicles")?.value).toBe("Carport, 2 spaces");
  });

  it("offers N/A where the report says a feature is absent", () => {
    expect(fact("adu")).toMatchObject({ value: "None reported", suggestsNotApplicable: true });
    expect(fact("solar")).toMatchObject({ value: "None reported", suggestsNotApplicable: true });
  });

  it("maps defects with the report's recommended action and cost", () => {
    expect(r.defects).toEqual([
      expect.objectContaining({
        where: "Roof — Rear slope",
        description: "Missing shingles on the rear slope & minor flashing gaps",
        recommendedAction: "repair",
        estimateCents: 120_000,
        affectsSoundness: false,
      }),
      expect.objectContaining({ where: "Deck", recommendedAction: "inspect", estimateCents: null, affectsSoundness: true }),
    ]);
  });

  it("refuses a file with no subject property", () => {
    expect(() => extractFromUadXml(`<MESSAGE><PROPERTIES/></MESSAGE>`)).toThrow(ImportError);
  });

  it("targets only checklist labels that exist in the starter list", () => {
    const labels = new Set(APPRAISAL_TEMPLATE.map((t) => t.label));
    for (const label of Object.values(IMPORT_ITEM_LABELS)) expect(labels, label).toContain(label);
  });

  it("humanizes GSE codes, keeping acronyms", () => {
    expect(humanize("ForcedWarmAir")).toBe("Forced warm air");
    expect(humanize("FEMASpecialFloodHazardArea")).toBe("FEMA special flood hazard area");
  });
});

describe("PDF text extraction", () => {
  const r = extractFromPdfText(URAR_PDF_TEXT);
  const fact = (key: string) => r.facts.find((f) => f.key === key);

  it("reads the subject's values from a redesigned URAR, not the comparables grid", () => {
    expect(r.report.opinionOfValueCents).toBe(61_200_000);
    expect(r.report.effectiveDate).toBe("2026-10-04");
    expect(r.report.overallCondition).toBe("C3");
    expect(fact("yearBuilt")?.propertyValue).toBe(2018);
    expect(fact("gla")?.propertyValue).toBe(1842);
    expect(fact("rooms")?.value).toBe("3 bedrooms, 2 full baths, 1 half bath");
    expect(fact("lotSqft")?.propertyValue).toBe(10_890);
    expect(fact("heating")?.value).toBe("Heat: Heat Pump, Electricity · cooling: Centralized");
    expect(fact("foundation")?.value).toBe("Pilings");
  });

  it("warns that PDF values need checking", () => {
    expect(r.warnings.join(" ")).toMatch(/Check each value/);
  });

  it("reads the value and date from a legacy form's certification sentence", () => {
    const legacy = extractFromPdfText(
      `${"Uniform Residential Appraisal Report  ".repeat(8)}\nYear Built 1965\n` +
        "my (our) opinion of the market value, as defined, of the real property that is the subject of this report is $ 410,000 , as of 03/15/2024, which is the date of inspection",
    );
    expect(legacy.report.opinionOfValueCents).toBe(41_000_000);
    expect(legacy.report.effectiveDate).toBe("2024-03-15");
    expect(legacy.warnings.join(" ")).toMatch(/older-style/);
  });

  it("refuses a scan with no text layer, and says what to do instead", () => {
    expect(() => extractFromPdfText("   \n\f  ")).toThrow(/no readable text/);
  });
});
