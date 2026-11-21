// server/domain/appraisal/routes.import.test.ts — importing a past appraisal.
//
// The ask: "can you add an appraisal importer that autofills data".
//
// Pinned here: a preview writes nothing; apply writes only what was ticked,
// and only what the server reads from the file (never values the browser sends);
// it appends rather than overwrites; importing the same report twice changes
// nothing the second time; the report PDF ends up in Files, attached to what it
// filled; and the property record only changes when asked.
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../../testing/harness.js";
import { buildZip } from "../../lib/zip.js";
import { importSeams } from "./routes.import.js";
import { TINY_PDF, UAD36_FIXTURE, URAR_PDF_TEXT } from "./import.fixture.js";
import type {
  AppraisalImportPreview,
  AppraisalImportResult,
  PropertyDossier,
  PropertyView,
} from "../../../shared/types.js";

let testApp: TestApp | null = null;
const realPdfText = importSeams.pdfText;
afterEach(async () => {
  importSeams.pdfText = realPdfText;
  if (testApp) {
    await testApp.close();
    testApp = null;
  }
});

async function setup(address = "12 Test St"): Promise<{ t: TestApp; user: TestUser; propertyId: string }> {
  testApp = await createTestApp();
  const user = createTestUser({ role: "owner" });
  const res = await testApp.app.inject({
    method: "POST",
    url: "/api/properties",
    headers: user.headers,
    payload: {
      name: "Sound-side cottage",
      addressLine1: address,
      city: "Kill Devil Hills",
      state: "NC",
      postalCode: "27948",
      propertyType: "single_family",
      yearBuilt: 2017,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { t: testApp, user, propertyId: unwrap<PropertyView>(res).id };
}

function multipart(file: { name: string; bytes: Buffer }, fields: Record<string, string>): { payload: Buffer; type: string } {
  const b = "----import";
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    file.bytes,
    Buffer.from(`\r\n--${b}--\r\n`),
  );
  return { payload: Buffer.concat(parts), type: `multipart/form-data; boundary=${b}` };
}

async function send(
  t: TestApp,
  user: TestUser,
  propertyId: string,
  file: { name: string; bytes: Buffer },
  fields: Record<string, string>,
) {
  const { payload, type } = multipart(file, fields);
  const { cookie, "x-csrf-token": csrf } = user.headers;
  return t.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/appraisal/import`,
    headers: { cookie: cookie!, "x-csrf-token": csrf!, "content-type": type },
    payload,
  });
}

const PACKAGE = (): { name: string; bytes: Buffer } => ({
  name: "appraisal.zip",
  bytes: buildZip([
    { name: "Appraisal_v1.xml", data: Buffer.from(UAD36_FIXTURE) },
    { name: "Appraisal_v1.pdf", data: TINY_PDF },
    { name: "Images/Kitchen.png", data: Buffer.from("not really a png") },
  ]),
});

async function dossier(t: TestApp, user: TestUser, propertyId: string): Promise<PropertyDossier> {
  return unwrap<PropertyDossier>(
    await t.app.inject({ method: "GET", url: `/api/properties/${propertyId}/dossier`, headers: user.headers }),
  );
}

describe("appraisal import", () => {
  it("previews a UAD 3.6 package without writing anything", async () => {
    const { t, user, propertyId } = await setup();
    const res = await send(t, user, propertyId, PACKAGE(), { mode: "preview" });
    expect(res.statusCode, res.body).toBe(200);
    const preview = unwrap<AppraisalImportPreview>(res);
    expect(preview.format).toBe("uad36_xml");
    expect(preview.hasReportPdf).toBe(true);
    expect(preview.addressMismatch).toBe(false);
    expect(preview.report.opinionOfValueCents).toBe(61_200_000);
    expect(preview.facts.find((f) => f.key === "yearBuilt")).toMatchObject({ propertyValue: 2018, currentPropertyValue: 2017 });
    expect(preview.defects).toHaveLength(2);

    const d = await dossier(t, user, propertyId);
    expect(d.appraisal).toEqual([]);
    expect(d.appraisalReports).toEqual([]);
    expect(d.attachments).toEqual([]);
  });

  it("flags a report for a different house", async () => {
    const { t, user, propertyId } = await setup("400 Other Rd");
    const preview = unwrap<AppraisalImportPreview>(await send(t, user, propertyId, PACKAGE(), { mode: "preview" }));
    expect(preview.addressMismatch).toBe(true);
  });

  it("applies only what was ticked: fills items, adds defects, files the PDF, records the history", async () => {
    const { t, user, propertyId } = await setup();
    const selection = {
      facts: ["gla", "yearBuilt", "flood", "adu", "heating"],
      defects: ["defect-0", "defect-1"],
      propertyFields: ["sqft"],
      markNotApplicable: ["adu"],
    };
    const res = await send(t, user, propertyId, PACKAGE(), { mode: "apply", selection: JSON.stringify(selection) });
    expect(res.statusCode, res.body).toBe(201);
    const result = unwrap<AppraisalImportResult>(res);
    expect(result.itemsFilled).toBe(5);
    expect(result.defectsAdded).toBe(2);
    expect(result.propertyFieldsUpdated).toEqual(["sqft"]);
    expect(result.report).toMatchObject({ effectiveDate: "2026-10-04", opinionOfValueCents: 61_200_000, overallCondition: "C3", sourceFormat: "uad36_xml" });
    expect(result.report.document?.kind).toBe("pdf");

    const d = await dossier(t, user, propertyId);
    const item = (label: string) => d.appraisal.find((i) => i.label === label)!;

    // Items were created from the starter list, so they keep its guidance.
    const gla = item("Living area measured to ANSI Z765");
    expect(gla.detail).toMatch(/ANSI Z765 standard/);
    expect(gla.finding).toBe("From the appraisal effective 2026-10-04: 1,842 sq ft finished above grade (measured to ANSI Z765)");
    expect(gla.status).toBe("ready");
    expect(gla.asOf).toBe("2026-10-04");
    expect(gla.documents.map((u) => u.id)).toEqual([result.report.uploadId]);

    // A document item is advanced, not declared done: knowing the zone is not having the certificate.
    expect(item("Flood zone and elevation certificate").status).toBe("in_progress");
    expect(item("Accessory dwelling unit").status).toBe("not_applicable");

    const roofDefect = item("Missing shingles on the rear slope & minor flashing gaps");
    expect(roofDefect).toMatchObject({ kind: "defect", section: "defects", recommendedAction: "repair", estimateCents: 120_000 });
    expect(item("Soft decking at the stair landing")).toMatchObject({ recommendedAction: "inspect" });
    expect(item("Soft decking at the stair landing").detail).toMatch(/Affects soundness/);

    // Unticked facts went nowhere.
    expect(d.appraisal.find((i) => i.label.startsWith("Roof —"))).toBeUndefined();

    // Property: sqft ticked and changed; year built not ticked, left alone.
    expect(d.property.sqft).toBe(1842);
    expect(d.property.yearBuilt).toBe(2017);

    // The report is in Files, once.
    expect(d.attachments.filter((a) => a.kind === "pdf")).toHaveLength(1);
    expect(d.appraisalReports).toHaveLength(1);
  });

  it("appends to what someone typed, and a second import of the same report changes nothing", async () => {
    const { t, user, propertyId } = await setup();
    await t.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/appraisal`,
      headers: user.headers,
      payload: { label: "Year built — and the year of any addition", section: "dwelling", kind: "fact", finding: "Tax card says 2017" },
    });
    const selection = JSON.stringify({ facts: ["yearBuilt"], defects: ["defect-0"] });
    await send(t, user, propertyId, PACKAGE(), { mode: "apply", selection });
    const first = await dossier(t, user, propertyId);
    await send(t, user, propertyId, PACKAGE(), { mode: "apply", selection });
    const second = await dossier(t, user, propertyId);

    const year = second.appraisal.find((i) => i.label.startsWith("Year built"))!;
    expect(year.finding).toBe("Tax card says 2017\nFrom the appraisal effective 2026-10-04: 2018");
    expect(second.appraisal.filter((i) => i.kind === "defect")).toHaveLength(1);
    expect(second.appraisal.length).toBe(first.appraisal.length);
    // One report in Files and one history entry, not one per import.
    expect(second.attachments).toHaveLength(1);
    expect(second.appraisalReports).toHaveLength(1);
  });

  it("saves what the file says, whatever the browser sends", async () => {
    const { t, user, propertyId } = await setup();
    const selection = JSON.stringify({ facts: ["yearBuilt"], defects: [], propertyFields: ["yearBuilt"], value: 1066 });
    const res = await send(t, user, propertyId, PACKAGE(), { mode: "apply", selection });
    // Unknown keys are refused outright rather than ignored.
    expect(res.statusCode).toBe(422);
    const ok = await send(t, user, propertyId, PACKAGE(), {
      mode: "apply",
      selection: JSON.stringify({ facts: ["yearBuilt"], propertyFields: ["yearBuilt"] }),
    });
    expect(ok.statusCode).toBe(201);
    expect((await dossier(t, user, propertyId)).property.yearBuilt).toBe(2018);
  });

  it("imports a PDF by its text, and files the PDF itself", async () => {
    importSeams.pdfText = async () => URAR_PDF_TEXT;
    const { t, user, propertyId } = await setup();
    const preview = unwrap<AppraisalImportPreview>(
      await send(t, user, propertyId, { name: "Appraisal.pdf", bytes: TINY_PDF }, { mode: "preview" }),
    );
    expect(preview.format).toBe("pdf");
    expect(preview.facts.find((f) => f.key === "gla")?.propertyValue).toBe(1842);

    const res = await send(t, user, propertyId, { name: "Appraisal.pdf", bytes: TINY_PDF }, {
      mode: "apply",
      selection: JSON.stringify({ facts: ["gla", "rooms"] }),
    });
    expect(res.statusCode, res.body).toBe(201);
    const d = await dossier(t, user, propertyId);
    expect(d.appraisalReports[0]).toMatchObject({ sourceFormat: "pdf", opinionOfValueCents: 61_200_000 });
    expect(d.attachments.map((a) => a.filename)).toContain("Appraisal.pdf");
  });

  it("says so plainly when PDF reading is unavailable, rather than failing obscurely", async () => {
    importSeams.pdfText = async () => null;
    const { t, user, propertyId } = await setup();
    const res = await send(t, user, propertyId, { name: "Appraisal.pdf", bytes: TINY_PDF }, { mode: "preview" });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/Reading PDFs isn't available/);
  });

  it("refuses something that is not an appraisal", async () => {
    const { t, user, propertyId } = await setup();
    const res = await send(t, user, propertyId, { name: "notes.txt", bytes: Buffer.from("hello") }, { mode: "preview" });
    expect(res.statusCode).toBe(400);
  });

  it("removes a history entry without removing the report from Files", async () => {
    const { t, user, propertyId } = await setup();
    const result = unwrap<AppraisalImportResult>(
      await send(t, user, propertyId, PACKAGE(), { mode: "apply", selection: JSON.stringify({}) }),
    );
    const { "content-type": _ct, ...headers } = user.headers;
    const del = await t.app.inject({ method: "DELETE", url: `/api/appraisal-reports/${result.report.id}`, headers });
    expect(del.statusCode).toBe(200);
    const d = await dossier(t, user, propertyId);
    expect(d.appraisalReports).toEqual([]);
    expect(d.attachments).toHaveLength(1);
  });
});
