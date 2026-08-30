// server/domain/specs/specs.test.ts — isSecret masking, /reveal, and leak checks: the secret
// value must never appear in audit_log payloads or the search index.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../../testing/harness.js";
import { getDb } from "../../db/index.js";
import type { SpecEntryView } from "../../../shared/types.js";

let app: TestApp;
let user: TestUser;
const SECRET_VALUE = "GATE-CODE-4471#";

beforeEach(async () => {
  app = await createTestApp();
  user = createTestUser({ role: "manager" });
});

afterEach(async () => {
  await app.close();
});

function cookieOnly(u: TestUser): Record<string, string> {
  const { cookie, "x-csrf-token": csrf } = u.headers;
  return { cookie, "x-csrf-token": csrf };
}

async function createProperty(): Promise<string> {
  const res = await app.app.inject({
    method: "POST",
    url: "/api/properties",
    headers: user.headers,
    payload: {
      name: "Spec Vault Test Property",
      addressLine1: "1 Test St",
      city: "T",
      state: "OH",
      postalCode: "45000",
      country: "US",
      propertyType: "single_family",
    },
  });
  return unwrap<{ id: string }>(res).id;
}

function everyStoredTextContainsNoSecret(): void {
  const db = getDb();
  const auditRows = db.prepare(`SELECT before_json, after_json, summary FROM audit_log`).all() as {
    before_json: string | null;
    after_json: string | null;
    summary: string;
  }[];
  for (const row of auditRows) {
    expect(row.before_json ?? "").not.toContain(SECRET_VALUE);
    expect(row.after_json ?? "").not.toContain(SECRET_VALUE);
    expect(row.summary).not.toContain(SECRET_VALUE);
  }
  const searchRows = db.prepare(`SELECT title, body FROM search_index`).all() as { title: string; body: string }[];
  for (const row of searchRows) {
    expect(row.title).not.toContain(SECRET_VALUE);
    expect(row.body).not.toContain(SECRET_VALUE);
  }
}

describe("spec vault: isSecret masking", () => {
  it("create response masks the value", async () => {
    const propertyId = await createProperty();
    const res = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/specs`,
      headers: user.headers,
      payload: { category: "code", label: "Front gate code", value: SECRET_VALUE, isSecret: true },
    });
    expect(res.statusCode).toBe(201);
    const spec = unwrap<SpecEntryView>(res);
    expect(spec.valueMasked).toBe(true);
    expect(spec.value).toBeNull();
    everyStoredTextContainsNoSecret();
  });

  it("list response masks the value", async () => {
    const propertyId = await createProperty();
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/specs`,
      headers: user.headers,
      payload: { category: "code", label: "Front gate code", value: SECRET_VALUE, isSecret: true },
    });
    const listRes = await app.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/specs`,
      headers: cookieOnly(user),
    });
    const list = unwrap<{ items: SpecEntryView[] }>(listRes);
    const secretItem = list.items.find((i) => i.label === "Front gate code")!;
    expect(secretItem.valueMasked).toBe(true);
    expect(secretItem.value).toBeNull();
  });

  it("a non-secret entry is not masked", async () => {
    const propertyId = await createProperty();
    const res = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/specs`,
      headers: user.headers,
      payload: { category: "filter", label: "HVAC filter", value: "16x25x1", isSecret: false },
    });
    const spec = unwrap<SpecEntryView>(res);
    expect(spec.valueMasked).toBe(false);
    expect(spec.value).toBe("16x25x1");
  });

  it("/reveal returns the real value and writes a secret_revealed audit row with no leaked payload", async () => {
    const propertyId = await createProperty();
    const createRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/specs`,
      headers: user.headers,
      payload: { category: "code", label: "Lockbox code", value: SECRET_VALUE, isSecret: true },
    });
    const spec = unwrap<SpecEntryView>(createRes);

    const revealRes = await app.app.inject({
      method: "POST",
      url: `/api/specs/${spec.id}/reveal`,
      headers: cookieOnly(user),
    });
    expect(revealRes.statusCode).toBe(200);
    const revealed = unwrap<{ id: string; value: string }>(revealRes);
    expect(revealed.value).toBe(SECRET_VALUE);

    const auditRows = getDb()
      .prepare(`SELECT action, before_json, after_json FROM audit_log WHERE entity_id = ? ORDER BY at`)
      .all(spec.id) as { action: string; before_json: string | null; after_json: string | null }[];
    const revealRow = auditRows.find((r) => r.action === "secret_revealed");
    expect(revealRow).toBeDefined();
    expect(revealRow!.before_json).toBeNull();
    expect(revealRow!.after_json).toBeNull();

    // The secret must never appear anywhere in audit_log or search_index, even after reveal.
    everyStoredTextContainsNoSecret();
  });

  it("a secret entry may still be indexed by label, but never by its value", async () => {
    const propertyId = await createProperty();
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/specs`,
      headers: user.headers,
      payload: { category: "code", label: "Side gate code", value: SECRET_VALUE, isSecret: true },
    });
    const rows = getDb()
      .prepare(`SELECT title, body FROM search_index WHERE entity_type = 'spec_entry'`)
      .all() as { title: string; body: string }[];
    for (const row of rows) {
      expect(row.title).not.toContain(SECRET_VALUE);
      expect(row.body).not.toContain(SECRET_VALUE);
    }
  });

  it("updating a secret entry does not leak the value into the audit payload", async () => {
    const propertyId = await createProperty();
    const createRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/specs`,
      headers: user.headers,
      payload: { category: "code", label: "Back gate code", value: "OLD-VALUE", isSecret: true },
    });
    const spec = unwrap<SpecEntryView>(createRes);
    const patchRes = await app.app.inject({
      method: "PATCH",
      url: `/api/specs/${spec.id}`,
      headers: user.headers,
      payload: { value: SECRET_VALUE, expectedVersion: spec.version },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = unwrap<SpecEntryView>(patchRes);
    expect(updated.valueMasked).toBe(true);
    expect(updated.value).toBeNull();
    everyStoredTextContainsNoSecret();
  });
});
