// server/domain/appraisal/appraisal.test.ts — getting ready for a UAD 3.6 appraisal.
//
// The ask: "Property appraisals are adopting new rules, UAD 3.6 — can you build
// the property checklists, budgeting and document storage with this in mind."
//
// So three behaviours are pinned here, one per word of that sentence:
//   checklists — the starter list applies once, fits the property, and leaves
//                hand-made items alone;
//   budgeting  — open defects become budget lines exactly once, and the money
//                is visible on the project and on the summary;
//   documents  — many files per item, filed under the property, never deleted
//                by tidying the checklist, and all of it in one binder.
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../../testing/harness.js";
import { appraisalTemplateFor } from "../../../shared/appraisal-checklist.js";
import type {
  AppraisalItemView,
  AppraisalSummary,
  PropertyDossier,
  ProjectView,
  PropertyView,
  Upload,
} from "../../../shared/types.js";


function bodyless(h: Record<string, string>): Record<string, string> {
  const rest = { ...h };
  delete rest["content-type"];
  return rest;
}

let testApp: TestApp | null = null;
afterEach(async () => {
  if (testApp) {
    await testApp.close();
    testApp = null;
  }
});

async function setup(propertyType = "single_family"): Promise<{ t: TestApp; user: TestUser; propertyId: string }> {
  testApp = await createTestApp();
  const user = createTestUser({ role: "owner" });
  const res = await testApp.app.inject({
    method: "POST",
    url: "/api/properties",
    headers: user.headers,
    payload: {
      name: "Sound-side cottage",
      addressLine1: "12 Test St",
      city: "Kill Devil Hills",
      state: "NC",
      postalCode: "27948",
      propertyType,
    },
  });
  expect(res.statusCode).toBe(201);
  return { t: testApp, user, propertyId: unwrap<PropertyView>(res).id };
}

async function list(t: TestApp, user: TestUser, propertyId: string) {
  const res = await t.app.inject({ method: "GET", url: `/api/properties/${propertyId}/appraisal`, headers: user.headers });
  expect(res.statusCode).toBe(200);
  return unwrap<{ items: AppraisalItemView[]; summary: AppraisalSummary }>(res);
}

async function apply(t: TestApp, user: TestUser, propertyId: string) {
  const res = await t.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/appraisal/checklist`,
    headers: bodyless(user.headers),
  });
  expect(res.statusCode).toBe(201);
  return unwrap<{ added: AppraisalItemView[]; skipped: number }>(res);
}

async function create(t: TestApp, user: TestUser, propertyId: string, payload: Record<string, unknown>) {
  const res = await t.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/appraisal`,
    headers: user.headers,
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return unwrap<AppraisalItemView>(res);
}

async function uploadPhoto(t: TestApp, user: TestUser, propertyId: string, name: string): Promise<Upload> {
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 200, g: 10, b: 10 } } })
    .jpeg()
    .toBuffer();
  const boundary = "----appraisal";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="parentType"\r\n\r\nproperty\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="parentId"\r\n\r\n${propertyId}\r\n`),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const { cookie, "x-csrf-token": csrf } = user.headers;
  const res = await t.app.inject({
    method: "POST",
    url: "/api/uploads",
    headers: { cookie: cookie!, "x-csrf-token": csrf!, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return unwrap<Upload>(res);
}

/** Read the names out of a ZIP's central directory. Enough to check the binder's layout. */
function zipNames(buf: Buffer): string[] {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(-1);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + nameLen).toString("utf8"));
    p += 46 + nameLen + extra + comment;
  }
  return names;
}

/** The stored bytes of one entry, found by name through its local header. */
function zipEntry(buf: Buffer, name: string): Buffer {
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extra = buf.readUInt16LE(p + 28);
    const entryName = buf.subarray(p + 30, p + 30 + nameLen).toString("utf8");
    const start = p + 30 + nameLen + extra;
    if (entryName === name) return buf.subarray(start, start + size);
    p = start + size;
  }
  throw new Error(`no entry ${name}`);
}

describe("appraisal checklist", () => {
  it("starts empty, and the dossier carries it once applied", async () => {
    const { t, user, propertyId } = await setup();
    expect((await list(t, user, propertyId)).items).toEqual([]);

    const { added } = await apply(t, user, propertyId);
    const expected = appraisalTemplateFor({ propertyType: "single_family", unitCount: 0 });
    expect(added.map((i) => i.label)).toEqual(expected.map((i) => i.label));

    const dossier = await t.app.inject({ method: "GET", url: `/api/properties/${propertyId}/dossier`, headers: user.headers });
    expect(unwrap<PropertyDossier>(dossier).appraisal).toHaveLength(expected.length);
  });

  it("fits the property: no rent roll on a single-family house, a project questionnaire only on a condo", async () => {
    const house = await setup("single_family");
    const houseLabels = (await apply(house.t, house.user, house.propertyId)).added.map((i) => i.label);
    expect(houseLabels).not.toContain("Rent roll for the last twelve months");
    expect(houseLabels).not.toContain("Condo or townhome project information");
    await house.t.close();
    testApp = null;

    const condo = await setup("condo");
    const condoLabels = (await apply(condo.t, condo.user, condo.propertyId)).added.map((i) => i.label);
    expect(condoLabels).toContain("Condo or townhome project information");
    await condo.t.close();
    testApp = null;

    const duplex = await setup("duplex");
    const duplexLabels = (await apply(duplex.t, duplex.user, duplex.propertyId)).added.map((i) => i.label);
    expect(duplexLabels).toContain("Rent roll for the last twelve months");
    // The GSEs retired the Operating Income Statement; the list should not ask for one.
    expect(duplexLabels.some((l) => /operating/i.test(l))).toBe(false);
  });

  it("is idempotent by label and leaves a hand-made item, and what was written on it, alone", async () => {
    const { t, user, propertyId } = await setup();
    const mine = await create(t, user, propertyId, {
      label: "  floor plan or sketch of every level ",
      section: "measurement",
      finding: "Builder's plans, 2009",
    });
    const first = await apply(t, user, propertyId);
    expect(first.skipped).toBe(1);
    const second = await apply(t, user, propertyId);
    expect(second.added).toEqual([]);

    const items = (await list(t, user, propertyId)).items;
    const plans = items.filter((i) => i.label.trim().toLowerCase() === "floor plan or sketch of every level");
    expect(plans).toHaveLength(1);
    expect(plans[0]!.id).toBe(mine.id);
    expect(plans[0]!.finding).toBe("Builder's plans, 2009");
  });

  it("defaults a new defect's recommended action to repair, and a PATCH that omits status leaves it", async () => {
    const { t, user, propertyId } = await setup();
    const defect = await create(t, user, propertyId, { label: "Soft decking at the rear stair", section: "defects", kind: "defect" });
    expect(defect.recommendedAction).toBe("repair");
    expect(defect.status).toBe("todo");

    const res = await t.app.inject({
      method: "PATCH",
      url: `/api/appraisal-items/${defect.id}`,
      headers: user.headers,
      payload: { estimateCents: 85_000, expectedVersion: defect.version },
    });
    expect(res.statusCode).toBe(200);
    const patched = unwrap<AppraisalItemView>(res);
    expect(patched.status).toBe("todo");
    expect(patched.estimateCents).toBe(85_000);

    const stale = await t.app.inject({
      method: "PATCH",
      url: `/api/appraisal-items/${defect.id}`,
      headers: user.headers,
      payload: { status: "ready", expectedVersion: defect.version },
    });
    expect(stale.statusCode).toBe(409);
  });
});

describe("appraisal repair budget", () => {
  it("puts open, estimated defects on one project as budget lines, exactly once", async () => {
    const { t, user, propertyId } = await setup();
    await create(t, user, propertyId, { label: "Handrail missing on deck stair", section: "defects", kind: "defect", estimateCents: 40_000 });
    await create(t, user, propertyId, { label: "Stained ceiling under the roof leak", section: "defects", kind: "defect", recommendedAction: "inspect", estimateCents: 120_000 });
    // Not budgeted: no estimate, already fixed, and not a defect.
    await create(t, user, propertyId, { label: "Cracked outlet cover", section: "defects", kind: "defect" });
    await create(t, user, propertyId, { label: "Broken window latch", section: "defects", kind: "defect", status: "ready", estimateCents: 5_000 });
    await create(t, user, propertyId, { label: "Roof receipt", section: "dwelling", kind: "document", estimateCents: 9_999 });

    const before = (await list(t, user, propertyId)).summary;
    expect(before.openDefects).toBe(3);
    expect(before.costToCureCents).toBe(160_000);
    expect(before.unbudgetedCents).toBe(160_000);

    const res = await t.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/appraisal/budget`,
      headers: bodyless(user.headers),
    });
    expect(res.statusCode, res.body).toBe(201);
    const { project, linked, created } = unwrap<{ project: ProjectView; linked: AppraisalItemView[]; created: boolean }>(res);
    expect(created).toBe(true);
    expect(project.title).toBe("Repairs before the appraisal");
    expect(project.budgetTotalCents).toBe(160_000);
    expect(linked.map((i) => i.label).sort()).toEqual(
      ["Handrail missing on deck stair", "Stained ceiling under the roof leak"].sort(),
    );
    expect(linked.every((i) => i.project?.id === project.id)).toBe(true);

    const after = (await list(t, user, propertyId)).summary;
    expect(after.costToCureCents).toBe(160_000);
    expect(after.unbudgetedCents).toBe(0);

    // A second press finds nothing new to budget.
    const again = await t.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/appraisal/budget`,
      headers: bodyless(user.headers),
    });
    expect(again.statusCode).toBe(200);
    expect(unwrap<{ linked: unknown[] }>(again).linked).toEqual([]);

    // A defect found later joins the same live project rather than a new one.
    await create(t, user, propertyId, { label: "Rotten piling wrap", section: "defects", kind: "defect", estimateCents: 30_000 });
    const third = await t.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/appraisal/budget`,
      headers: bodyless(user.headers),
    });
    const thirdBody = unwrap<{ project: ProjectView; created: boolean }>(third);
    expect(thirdBody.created).toBe(false);
    expect(thirdBody.project.id).toBe(project.id);
    expect(thirdBody.project.budgetTotalCents).toBe(190_000);
  });

  it("refuses a project from another property", async () => {
    const a = await setup();
    const other = await a.t.app.inject({
      method: "POST",
      url: "/api/properties",
      headers: a.user.headers,
      payload: { name: "Other", addressLine1: "1 St", city: "Manteo", state: "NC", postalCode: "27954", propertyType: "single_family" },
    });
    const otherId = unwrap<PropertyView>(other).id;
    const proj = await a.t.app.inject({
      method: "POST",
      url: `/api/properties/${otherId}/projects`,
      headers: a.user.headers,
      payload: { title: "Not this one" },
    });
    const projectId = unwrap<ProjectView>(proj).id;
    const res = await a.t.app.inject({
      method: "POST",
      url: `/api/properties/${a.propertyId}/appraisal`,
      headers: a.user.headers,
      payload: { label: "Leak", kind: "defect", projectId },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("appraisal documents and the binder", () => {
  it("holds many files per item, filed under the property, and detaching or deleting never removes a file", async () => {
    const { t, user, propertyId } = await setup();
    const baths = await create(t, user, propertyId, { label: "Every bathroom, photo-ready", section: "photos", kind: "photo" });
    const one = await uploadPhoto(t, user, propertyId, "hall bath.jpg");
    const two = await uploadPhoto(t, user, propertyId, "primary bath.jpg");

    for (const u of [one, two, one]) {
      const res = await t.app.inject({
        method: "POST",
        url: `/api/appraisal-items/${baths.id}/uploads`,
        headers: user.headers,
        payload: { uploadId: u.id },
      });
      expect(res.statusCode).toBe(201);
    }
    let item = (await list(t, user, propertyId)).items[0]!;
    expect(item.documents.map((d) => d.filename)).toEqual(["hall bath.jpg", "primary bath.jpg"]);

    const detach = await t.app.inject({
      method: "DELETE",
      url: `/api/appraisal-items/${baths.id}/uploads/${one.id}`,
      headers: bodyless(user.headers),
    });
    expect(detach.statusCode).toBe(200);
    item = (await list(t, user, propertyId)).items[0]!;
    expect(item.documents.map((d) => d.filename)).toEqual(["primary bath.jpg"]);

    await t.app.inject({ method: "DELETE", url: `/api/appraisal-items/${baths.id}`, headers: bodyless(user.headers) });
    const dossier = unwrap<PropertyDossier>(
      await t.app.inject({ method: "GET", url: `/api/properties/${propertyId}/dossier`, headers: user.headers }),
    );
    expect(dossier.appraisal).toEqual([]);
    expect(dossier.attachments.map((a) => a.filename).sort()).toEqual(["hall bath.jpg", "primary bath.jpg"]);
  });

  it("refuses a file from another property", async () => {
    const { t, user, propertyId } = await setup();
    const item = await create(t, user, propertyId, { label: "Survey", section: "site" });
    const other = unwrap<PropertyView>(
      await t.app.inject({
        method: "POST",
        url: "/api/properties",
        headers: user.headers,
        payload: { name: "Other", addressLine1: "1 St", city: "Manteo", state: "NC", postalCode: "27954", propertyType: "single_family" },
      }),
    );
    const foreign = await uploadPhoto(t, user, other.id, "not ours.jpg");
    const res = await t.app.inject({
      method: "POST",
      url: `/api/appraisal-items/${item.id}/uploads`,
      headers: user.headers,
      payload: { uploadId: foreign.id },
    });
    expect(res.statusCode).toBe(409);
  });

  it("downloads a binder: a summary in report order and every file, foldered by section", async () => {
    const { t, user, propertyId } = await setup();
    await create(t, user, propertyId, {
      label: "Living area measured to ANSI Z765",
      section: "measurement",
      kind: "fact",
      status: "ready",
      finding: "1,842 sq ft above grade finished",
      asOf: "2026-10-04",
    });
    const kitchen = await create(t, user, propertyId, { label: "Every kitchen, photo-ready", section: "photos", kind: "photo" });
    await create(t, user, propertyId, { label: "Solar", section: "energy", status: "not_applicable" });
    await create(t, user, propertyId, { label: "Loose handrail", section: "defects", kind: "defect", estimateCents: 25_000 });
    const photo = await uploadPhoto(t, user, propertyId, "kitchen.jpg");
    await t.app.inject({
      method: "POST",
      url: `/api/appraisal-items/${kitchen.id}/uploads`,
      headers: user.headers,
      payload: { uploadId: photo.id },
    });

    const res = await t.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/appraisal/binder.zip`,
      headers: user.headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    const zip = res.rawPayload;
    const names = zipNames(zip);
    expect(names[0]).toBe("00 Summary.txt");
    expect(names).toContain("09 Photos/Every kitchen, photo-ready - kitchen.jpg");

    const summary = zipEntry(zip, "00 Summary.txt").toString("utf8");
    expect(summary).toContain("Sound-side cottage");
    expect(summary).toContain("1,842 sq ft above grade finished");
    expect(summary).toContain("As of 2026-10-04");
    expect(summary).toContain("Estimate: $250");
    // N/A items are not handed to the appraiser.
    expect(summary).not.toContain("Solar");
    // Report order: size before photos.
    expect(summary.indexOf("SIZE & FLOOR PLAN")).toBeLessThan(summary.indexOf("PHOTOS"));

    // The file inside is byte-for-byte the upload.
    const raw = await t.app.inject({ method: "GET", url: `/api/uploads/${photo.id}/raw`, headers: user.headers });
    expect(zipEntry(zip, "09 Photos/Every kitchen, photo-ready - kitchen.jpg").equals(raw.rawPayload)).toBe(true);
  });
});
