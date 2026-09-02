// server/domain/diligence/diligence.test.ts — the pre-purchase checklist.
//
// The ask: "a todo section on acquiring things like past permits or land data
// to verify septic and elevation data."
//
// The behaviour worth pinning is the template application. The naive version
// ("seed if empty") breaks the moment somebody adds one item themselves and
// then wants the rest of the standard list, and the careless version duplicates
// everything on a second click. Both failures are silent and both leave you
// with a checklist you stop trusting.
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../../testing/harness.js";
import { DILIGENCE_TEMPLATE, summarizeDiligence } from "../../../shared/diligence-checklist.js";
import type { DiligenceItemView, PropertyDossier, PropertyView } from "../../../shared/types.js";

function bodyless(h: Record<string, string>): Record<string, string> {
  const rest = { ...h };
  delete rest["content-type"];
  return rest;
}

async function makeProperty(testApp: TestApp, headers: Record<string, string>): Promise<string> {
  const res = await testApp.app.inject({
    method: "POST",
    url: "/api/properties",
    headers,
    payload: {
      name: "Prospect on Colington",
      addressLine1: "1 Test St",
      city: "Kill Devil Hills",
      state: "NC",
      postalCode: "27948",
      propertyType: "single_family",
      stage: "prospect",
    },
  });
  expect(res.statusCode).toBe(201);
  return unwrap<PropertyView>(res).id;
}

async function listItems(
  testApp: TestApp,
  headers: Record<string, string>,
  propertyId: string,
): Promise<DiligenceItemView[]> {
  const res = await testApp.app.inject({
    method: "GET",
    url: `/api/properties/${propertyId}/diligence`,
    headers,
  });
  expect(res.statusCode).toBe(200);
  return unwrap<{ items: DiligenceItemView[] }>(res).items;
}

async function applyChecklist(
  testApp: TestApp,
  headers: Record<string, string>,
  propertyId: string,
): Promise<{ added: DiligenceItemView[]; skipped: number }> {
  const res = await testApp.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/diligence/checklist`,
    headers: bodyless(headers),
  });
  expect(res.statusCode).toBe(201);
  return unwrap<{ added: DiligenceItemView[]; skipped: number }>(res);
}

describe("diligence checklist", () => {
  let testApp: TestApp | null = null;

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  it("starts empty — a checklist nobody asked for is noise", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);
    expect(await listItems(testApp, user.headers, propertyId)).toEqual([]);
  });

  it("applies the suggested list on request, in template order", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);

    const result = await applyChecklist(testApp, user.headers, propertyId);
    expect(result.added).toHaveLength(DILIGENCE_TEMPLATE.length);
    expect(result.skipped).toBe(0);

    const items = await listItems(testApp, user.headers, propertyId);
    expect(items.map((i) => i.label)).toEqual(DILIGENCE_TEMPLATE.map((t) => t.label));
    // The detail is the point: it says who to ask, which is the part you forget.
    expect(items.every((i) => (i.detail ?? "").length > 0)).toBe(true);
    expect(items.every((i) => i.status === "todo")).toBe(true);
  });

  it("is idempotent — a second application adds nothing", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);

    await applyChecklist(testApp, user.headers, propertyId);
    const second = await applyChecklist(testApp, user.headers, propertyId);

    expect(second.added).toHaveLength(0);
    expect(second.skipped).toBe(DILIGENCE_TEMPLATE.length);
    expect(await listItems(testApp, user.headers, propertyId)).toHaveLength(
      DILIGENCE_TEMPLATE.length,
    );
  });

  it("fills in the rest around work already done, without touching it", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);

    // Same wording as a template line, differently cased and padded — a person
    // typing it, not a machine matching it.
    const mine = unwrap<DiligenceItemView>(
      await testApp.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/diligence`,
        headers: user.headers,
        payload: {
          label: "  elevation certificate  ",
          category: "land",
          status: "verified",
          finding: "First floor 12.4ft, BFE 9ft. Fine.",
        },
      }),
    );

    const result = await applyChecklist(testApp, user.headers, propertyId);
    expect(result.skipped).toBe(1);
    expect(result.added).toHaveLength(DILIGENCE_TEMPLATE.length - 1);

    const items = await listItems(testApp, user.headers, propertyId);
    const kept = items.find((i) => i.id === mine.id);
    // The finding survives. Overwriting it with the template's "ask the seller
    // first" would throw away the answer to replace it with the question.
    expect(kept?.status).toBe("verified");
    expect(kept?.finding).toBe("First floor 12.4ft, BFE 9ft. Fine.");
    expect(items.filter((i) => i.label.trim().toLowerCase() === "elevation certificate")).toHaveLength(1);
  });

  it("keeps the question and the answer apart", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);
    const [item] = await applyChecklist(testApp, user.headers, propertyId).then((r) => r.added);

    const res = await testApp.app.inject({
      method: "PATCH",
      url: `/api/diligence-items/${item!.id}`,
      headers: user.headers,
      payload: {
        status: "verified",
        finding: "Permitted for 3 bedrooms. Listing says 4.",
        expectedVersion: item!.version,
      },
    });
    expect(res.statusCode).toBe(200);
    const updated = unwrap<DiligenceItemView>(res);
    expect(updated.finding).toBe("Permitted for 3 bedrooms. Listing says 4.");
    // Still there. Losing what was asked makes the answer uninterpretable a
    // month later.
    expect(updated.detail).toBe(item!.detail);
  });

  it("leaves status alone on a patch that does not mention it", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);
    const created = unwrap<DiligenceItemView>(
      await testApp.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/diligence`,
        headers: user.headers,
        payload: { label: "Ask about the well", category: "permits", status: "requested" },
      }),
    );

    // The schema defaults status to 'todo'. If the PATCH schema inherited that
    // default, editing the note would quietly undo the chase.
    const res = await testApp.app.inject({
      method: "PATCH",
      url: `/api/diligence-items/${created.id}`,
      headers: user.headers,
      payload: { detail: "County health dept, ask for Dana", expectedVersion: created.version },
    });
    expect(unwrap<DiligenceItemView>(res).status).toBe("requested");
  });

  it("counts what is left to do, and does not count a document nobody has read", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);
    const added = (await applyChecklist(testApp, user.headers, propertyId)).added;

    async function setStatus(item: DiligenceItemView, status: string): Promise<void> {
      const res = await testApp!.app.inject({
        method: "PATCH",
        url: `/api/diligence-items/${item.id}`,
        headers: user.headers,
        payload: { status, expectedVersion: item.version },
      });
      expect(res.statusCode).toBe(200);
    }

    await setStatus(added[0]!, "verified");
    await setStatus(added[1]!, "received");
    await setStatus(added[2]!, "blocked");
    await setStatus(added[3]!, "not_applicable");

    const summary = summarizeDiligence(await listItems(testApp, user.headers, propertyId));
    expect(summary.total).toBe(DILIGENCE_TEMPLATE.length);
    expect(summary.verified).toBe(1);
    expect(summary.blocked).toBe(1);
    // 'received' still counts as outstanding: a PDF sitting unread in an inbox
    // has not answered the question it was requested to answer.
    expect(summary.outstanding).toBe(DILIGENCE_TEMPLATE.length - 2);
  });

  it("refuses a document that belongs to a different property", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);
    const otherId = await makeProperty(testApp, user.headers);

    const boundary = "----diligence";
    const upload = unwrap<{ id: string }>(
      await testApp.app.inject({
        method: "POST",
        url: "/api/uploads",
        headers: {
          cookie: user.headers["cookie"]!,
          "x-csrf-token": user.headers["x-csrf-token"]!,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: multipartBody(boundary, { parentType: "property", parentId: otherId }),
      }),
    );

    const res = await testApp.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/diligence`,
      headers: user.headers,
      payload: { label: "Survey", category: "land", uploadId: upload.id },
    });
    // Attaching another house's survey to this checklist would be evidence for
    // the wrong building, presented as evidence for this one.
    expect(res.statusCode).toBe(409);
  });

  it("resolves an attached document, filed under the property", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);

    const boundary = "----attach";
    const upload = unwrap<{ id: string }>(
      await testApp.app.inject({
        method: "POST",
        url: "/api/uploads",
        headers: {
          cookie: user.headers["cookie"]!,
          "x-csrf-token": user.headers["x-csrf-token"]!,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: multipartBody(boundary, { parentType: "property", parentId: propertyId }),
      }),
    );

    const item = unwrap<DiligenceItemView>(
      await testApp.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/diligence`,
        headers: user.headers,
        payload: { label: "Survey", category: "land", uploadId: upload.id },
      }),
    );

    // The item points at the document; the document itself is filed against
    // the property, so it also shows up in Papers rather than being reachable
    // only through a checklist row.
    expect(item.document?.id).toBe(upload.id);
    expect(item.document?.parentType).toBe("property");
    expect(item.document?.parentId).toBe(propertyId);

    // Deleting the file leaves the item, without a paperclip claiming evidence
    // that is no longer there.
    const del = await testApp.app.inject({
      method: "DELETE",
      url: `/api/uploads/${upload.id}`,
      headers: bodyless(user.headers),
    });
    expect(del.statusCode).toBe(200);

    const after = (await listItems(testApp, user.headers, propertyId))[0]!;
    expect(after.uploadId).toBe(upload.id);
    expect(after.document).toBeNull();
  });

  it("ships with the dossier", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);
    await applyChecklist(testApp, user.headers, propertyId);

    const res = await testApp.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/dossier`,
      headers: user.headers,
    });
    expect(unwrap<PropertyDossier>(res).diligence).toHaveLength(DILIGENCE_TEMPLATE.length);
  });
});

/** A minimal PDF posted as multipart, so the upload route has a real file. */
function multipartBody(boundary: string, fields: Record<string, string>): Buffer {
  const CRLF = "\r\n";
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${key}"${CRLF}${CRLF}${value}${CRLF}`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="survey.pdf"${CRLF}` +
        `Content-Type: application/pdf${CRLF}${CRLF}`,
    ),
  );
  parts.push(Buffer.from("%PDF-1.4\n%%EOF\n"));
  parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));
  return Buffer.concat(parts);
}
