// server/uploads/ocr.test.ts — the scan route, including where Tesseract isn't.
//
// The important case here is ABSENCE. Tesseract ships in the Docker image but
// not on a Windows dev machine and not in CI, so the route has to say so
// plainly and let the upload stand — not 500, and not report the receipt as
// unreadable, which would send someone looking at their photo instead of at
// their server.
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../testing/harness.js";
import { isOcrAvailable } from "./ocr.js";

/**
 * The harness bakes `content-type: application/json` into its headers, so a
 * POST with no body makes Fastify try to JSON-parse "" and fail it with 400
 * before the route runs. Strip it for the bodyless calls — otherwise every
 * assertion here tests the body parser rather than the route.
 */
function bodyless(h: Record<string, string>): Record<string, string> {
  const rest = { ...h };
  delete rest["content-type"];
  return rest;
}

/** A real 1x1 PNG. Enough to exercise the plumbing; not enough to read. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function uploadTo(
  testApp: TestApp,
  headers: Record<string, string>,
  parentType: string,
  parentId: string,
  bytes: Buffer,
  filename: string,
): Promise<{ id: string }> {
  const boundary = "----keyringocr";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="parentType"\r\n\r\n${parentType}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="parentId"\r\n\r\n${parentId}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${filename.endsWith(".pdf") ? "application/pdf" : "image/png"}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await testApp.app.inject({
    method: "POST",
    url: "/api/uploads",
    headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  expect(res.statusCode).toBe(201);
  return unwrap<{ id: string }>(res);
}

async function makeProperty(testApp: TestApp, headers: Record<string, string>): Promise<string> {
  const res = await testApp.app.inject({
    method: "POST",
    url: "/api/properties",
    headers,
    payload: {
      name: "Receipts",
      addressLine1: "1 Test St",
      city: "Kill Devil Hills",
      state: "NC",
      postalCode: "27948",
      propertyType: "single_family",
    },
  });
  return unwrap<{ id: string }>(res).id;
}

describe("POST /api/uploads/:id/ocr", () => {
  let testApp: TestApp | null = null;

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  it("reports availability honestly instead of pretending", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const propertyId = await makeProperty(testApp, user.headers);
    const upload = await uploadTo(testApp, user.headers, "property", propertyId, PNG, "receipt.png");

    const res = await testApp.app.inject({
      method: "POST",
      url: `/api/uploads/${upload.id}/ocr`,
      headers: bodyless(user.headers),
    });
    expect(res.statusCode).toBe(200);

    const body = unwrap<{ available: boolean; fields: Record<string, unknown> }>(res);
    // Whichever machine this runs on, `available` must match reality — that is
    // the contract the UI branches on.
    expect(body.available).toBe(await isOcrAvailable());
    // A 1x1 pixel has nothing readable on it either way, so no field should be
    // invented from it.
    expect(body.fields).toEqual({});
  });

  it("refuses a PDF rather than running OCR over it", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const propertyId = await makeProperty(testApp, user.headers);

    const pdf = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
        "xref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF\n",
      "utf8",
    );
    const upload = await uploadTo(testApp, user.headers, "property", propertyId, pdf, "lease.pdf");

    const res = await testApp.app.inject({
      method: "POST",
      url: `/api/uploads/${upload.id}/ocr`,
      headers: bodyless(user.headers),
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s for an upload that does not exist", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const res = await testApp.app.inject({
      method: "POST",
      url: "/api/uploads/upl_00000000000000000000000000/ocr",
      headers: bodyless(user.headers),
    });
    expect(res.statusCode).toBe(404);
  });

  it("needs a session", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const propertyId = await makeProperty(testApp, user.headers);
    const upload = await uploadTo(testApp, user.headers, "property", propertyId, PNG, "receipt.png");

    const res = await testApp.app.inject({ method: "POST", url: `/api/uploads/${upload.id}/ocr` });
    expect(res.statusCode).toBe(401);
  });

  it("re-files a scanned receipt onto the expense it becomes", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const propertyId = await makeProperty(testApp, user.headers);

    // Uploaded against the property, because that is the only parent that
    // exists when the photo is taken.
    const upload = await uploadTo(testApp, user.headers, "property", propertyId, PNG, "receipt.png");

    const expense = unwrap<{ id: string }>(
      await testApp.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/expenses`,
        headers: user.headers,
        payload: {
          description: "Shutoff valve",
          amountCents: 22_89,
          category: "supplies",
          incurredOn: "2026-08-14",
        },
      }),
    );

    const moved = await testApp.app.inject({
      method: "PATCH",
      url: `/api/uploads/${upload.id}`,
      headers: user.headers,
      payload: { parentType: "property_expense", parentId: expense.id },
    });
    expect(moved.statusCode).toBe(200);
    const dto = unwrap<{ parentType: string; parentId: string; propertyId: string }>(moved);
    expect(dto.parentType).toBe("property_expense");
    expect(dto.parentId).toBe(expense.id);
    // The property is re-derived from the new parent, not carried over blindly.
    expect(dto.propertyId).toBe(propertyId);
  });

  it("refuses half a move, which would point at an id of the wrong kind", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const propertyId = await makeProperty(testApp, user.headers);
    const upload = await uploadTo(testApp, user.headers, "property", propertyId, PNG, "receipt.png");

    const res = await testApp.app.inject({
      method: "PATCH",
      url: `/api/uploads/${upload.id}`,
      headers: user.headers,
      payload: { parentType: "property_expense" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("refuses a move to a parent that does not exist", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const propertyId = await makeProperty(testApp, user.headers);
    const upload = await uploadTo(testApp, user.headers, "property", propertyId, PNG, "receipt.png");

    const res = await testApp.app.inject({
      method: "PATCH",
      url: `/api/uploads/${upload.id}`,
      headers: user.headers,
      payload: { parentType: "property_expense", parentId: "exp_00000000000000000000000000" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("never writes an expense by itself", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const propertyId = await makeProperty(testApp, user.headers);
    const upload = await uploadTo(testApp, user.headers, "property", propertyId, PNG, "receipt.png");

    await testApp.app.inject({
      method: "POST",
      url: `/api/uploads/${upload.id}/ocr`,
      headers: bodyless(user.headers),
    });

    // Scanning proposes; a person disposes. OCR is confidently wrong often
    // enough that writing straight to the ledger would be indefensible.
    const expenses = await testApp.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/expenses`,
      headers: user.headers,
    });
    expect(unwrap<{ items: unknown[] }>(expenses).items).toHaveLength(0);
  });
});
