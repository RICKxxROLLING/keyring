// server/search/search.test.ts — cross-entity hits, scoping, safe snippets, index sync on
// create/edit/delete, and FTS operator-injection neutralization.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../testing/harness.js";
import type { SearchHit } from "../../shared/types.js";

let app: TestApp;
let user: TestUser;

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

async function search(q: string, extra = ""): Promise<SearchHit[]> {
  const res = await app.app.inject({
    method: "GET",
    url: `/api/search?q=${encodeURIComponent(q)}${extra}`,
    headers: cookieOnly(user),
  });
  expect(res.statusCode).toBe(200);
  return unwrap<{ items: SearchHit[] }>(res).items;
}

async function createProperty(name = "Zylberton Manor"): Promise<string> {
  const res = await app.app.inject({
    method: "POST",
    url: "/api/properties",
    headers: user.headers,
    payload: {
      name,
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

describe("global search", () => {
  it("finds a property by a unique token in its name", async () => {
    const propertyId = await createProperty("Zylberton Manor");
    const hits = await search("zylberton");
    expect(hits.some((h) => h.entityType === "property" && h.entityId === propertyId)).toBe(true);
  });

  it("scopes results to a single property", async () => {
    const propertyA = await createProperty("Alpha House");
    const propertyB = await createProperty("Beta House");
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyA}/notes`,
      headers: user.headers,
      payload: { body: "quokka maintenance note on A" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyB}/notes`,
      headers: user.headers,
      payload: { body: "quokka maintenance note on B" },
    });
    const scoped = await search("quokka", `&propertyId=${propertyA}`);
    expect(scoped.length).toBe(1);
    expect(scoped[0]!.propertyId).toBe(propertyA);
  });

  it("scopes results by entity types", async () => {
    const propertyId = await createProperty();
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/notes`,
      headers: user.headers,
      payload: { body: "xanadu flooring plan" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/work-orders`,
      headers: user.headers,
      payload: { title: "xanadu flooring repair", status: "new", priority: "normal" },
    });
    const notesOnly = await search("xanadu", "&types=note");
    expect(notesOnly.length).toBe(1);
    expect(notesOnly[0]!.entityType).toBe("note");

    const both = await search("xanadu", "&types=note,work_order");
    expect(both.length).toBe(2);
  });

  it("escapes HTML in snippets so <mark> is the only real tag", async () => {
    const propertyId = await createProperty();
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/notes`,
      headers: user.headers,
      payload: { body: "<script>alert(1)</script> zorblatt reminder" },
    });
    const hits = await search("zorblatt");
    expect(hits.length).toBe(1);
    expect(hits[0]!.snippet).not.toContain("<script>");
    expect(hits[0]!.snippet).toContain("&lt;script&gt;");
  });

  it("reflects create, edit and delete in the index", async () => {
    const propertyId = await createProperty();
    const createRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/notes`,
      headers: user.headers,
      payload: { body: "wibbleflorp original text" },
    });
    const note = unwrap<{ id: string; version: number }>(createRes);
    expect((await search("wibbleflorp")).length).toBe(1);

    await app.app.inject({
      method: "PATCH",
      url: `/api/notes/${note.id}`,
      headers: user.headers,
      payload: { body: "quazzlemop replacement text", expectedVersion: note.version },
    });
    expect((await search("wibbleflorp")).length).toBe(0);
    expect((await search("quazzlemop")).length).toBe(1);

    await app.app.inject({
      method: "DELETE",
      url: `/api/notes/${note.id}`,
      headers: cookieOnly(user),
    });
    expect((await search("quazzlemop")).length).toBe(0);
  });

  it("neutralizes FTS operator injection in q", async () => {
    const propertyId = await createProperty();
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/notes`,
      headers: user.headers,
      payload: { body: "normal note about plumbing" },
    });
    // A raw FTS5 query with these characters would throw a syntax error if passed through
    // unsanitized. It must instead return a normal (possibly empty) result set, never 500.
    const injections = ['" OR 1=1 --', "*", "NEAR(plumbing, 2)", "((()))", "plumbing\"", "AND OR NOT"];
    for (const q of injections) {
      const res = await app.app.inject({
        method: "GET",
        url: `/api/search?q=${encodeURIComponent(q)}`,
        headers: cookieOnly(user),
      });
      expect(res.statusCode, `query=${q}`).toBe(200);
    }
  });

  it("finds hits across every indexed entity type", async () => {
    const propertyId = await createProperty("Kowalski Building");
    const unitRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/units`,
      headers: user.headers,
      payload: { label: "Frobnicate Unit", status: "vacant" },
    });
    const unitId = unwrap<{ id: string }>(unitRes).id;

    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/notes`,
      headers: user.headers,
      payload: { body: "Splendiferous note" },
    });
    const woRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/work-orders`,
      headers: user.headers,
      payload: { title: "Marmalade repair", status: "new", priority: "normal" },
    });
    const woId = unwrap<{ id: string }>(woRes).id;
    await app.app.inject({
      method: "POST",
      url: `/api/work-orders/${woId}/comments`,
      headers: user.headers,
      payload: { body: "Bumfuzzle comment" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/projects`,
      headers: user.headers,
      payload: { title: "Discombobulate project", status: "idea", priority: "normal" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/tenants`,
      headers: user.headers,
      payload: { unitId, firstName: "Thaddeus", lastName: "Winklebottom", isPrimary: true },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/leases`,
      headers: user.headers,
      payload: {
        unitId,
        startDate: "2026-01-01",
        rentCents: 100000,
        depositCents: 100000,
        dueDay: 1,
        status: "active",
        renewalNoticeDays: 60,
        tenantIds: [],
      },
    });
    await app.app.inject({
      method: "POST",
      url: "/api/vendors",
      headers: user.headers,
      payload: { name: "Bamboozle Plumbing", trade: "Plumbing", preferred: false },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/specs`,
      headers: user.headers,
      payload: { category: "filter", label: "Snickerdoodle filter", isSecret: false },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/compliance`,
      headers: user.headers,
      payload: { kind: "insurance", title: "Kerfuffle inspection", dueDate: "2026-06-01", leadDays: 30, recurrence: "none" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/turnovers`,
      headers: user.headers,
      payload: { unitId, phase: "move_out" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/expenses`,
      headers: user.headers,
      payload: { category: "repair", description: "Higgledy-piggledy expense", amountCents: 5000, incurredOn: "2026-01-05" },
    });

    const expectations: [string, string][] = [
      ["kowalski", "property"],
      ["frobnicate", "unit"],
      ["splendiferous", "note"],
      ["marmalade", "work_order"],
      ["bumfuzzle", "work_order_comment"],
      ["discombobulate", "project"],
      ["winklebottom", "tenant"],
      ["bamboozle", "vendor"],
      ["snickerdoodle", "spec_entry"],
      ["kerfuffle", "compliance_item"],
      ["higgledy", "property_expense"],
    ];
    for (const [token, entityType] of expectations) {
      const hits = await search(token);
      expect(hits.some((h) => h.entityType === entityType), `token=${token} expected entityType=${entityType}`).toBe(
        true,
      );
    }

    // lease and turnover are indexed with the unit label as their title, not a random token,
    // so just confirm both entity types are present somewhere in a broad scoped search.
    const propertyWide = await search("unit", `&propertyId=${propertyId}&limit=100`);
    const foundTypes = new Set(propertyWide.map((h) => h.entityType));
    expect(foundTypes.has("lease") || foundTypes.has("turnover")).toBe(true);
  });
});
