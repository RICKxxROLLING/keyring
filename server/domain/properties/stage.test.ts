// server/domain/properties/stage.test.ts — prospects are planned but not counted.
//
// The ask: "a tag for a prospect property — not part of the current portfolio,
// but with projects, renovation and budgeting."
//
// Two halves, and both matter. A prospect has to be fully usable (or you cannot
// scope the work before buying) and fully excluded from the portfolio totals
// (or the dashboard quietly claims you own a building you don't).
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../../testing/harness.js";
import type { DashboardPayload, PropertyView } from "../../../shared/types.js";

function bodyless(h: Record<string, string>): Record<string, string> {
  const rest = { ...h };
  delete rest["content-type"];
  return rest;
}

async function makeProperty(
  testApp: TestApp,
  headers: Record<string, string>,
  name: string,
  stage: "owned" | "prospect",
): Promise<PropertyView> {
  const res = await testApp.app.inject({
    method: "POST",
    url: "/api/properties",
    headers,
    payload: {
      name,
      addressLine1: "1 Test St",
      city: "Springfield",
      state: "OH",
      postalCode: "45501",
      propertyType: "single_family",
      stage,
    },
  });
  expect(res.statusCode).toBe(201);
  return unwrap<PropertyView>(res);
}

async function dashboard(testApp: TestApp, headers: Record<string, string>): Promise<DashboardPayload> {
  const res = await testApp.app.inject({ method: "GET", url: "/api/dashboard", headers });
  expect(res.statusCode).toBe(200);
  return unwrap<DashboardPayload>(res);
}

describe("property stage", () => {
  let testApp: TestApp | null = null;

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  it("defaults to owned when the caller says nothing", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const res = await testApp.app.inject({
      method: "POST",
      url: "/api/properties",
      headers: user.headers,
      payload: {
        name: "No stage given",
        addressLine1: "2 Test St",
        city: "Springfield",
        state: "OH",
        postalCode: "45501",
        propertyType: "single_family",
      },
    });
    expect(unwrap<PropertyView>(res).stage).toBe("owned");
  });

  it("keeps prospects out of the portfolio totals but still on the ring", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });

    const owned = await makeProperty(testApp, user.headers, "Held", "owned");
    const prospect = await makeProperty(testApp, user.headers, "Considering", "prospect");

    // A unit on each, so the units total would differ if a prospect leaked in.
    for (const p of [owned, prospect]) {
      const res = await testApp.app.inject({
        method: "POST",
        url: `/api/properties/${p.id}/units`,
        headers: user.headers,
        payload: { label: "Unit A", status: "vacant" },
      });
      expect(res.statusCode).toBe(201);
    }

    const dash = await dashboard(testApp, user.headers);

    expect(dash.totals.properties).toBe(1);
    expect(dash.totals.units).toBe(1);

    // Both are still ON the ring — you need to be able to open a prospect.
    const ids = dash.properties.map((c) => c.id).sort();
    expect(ids).toEqual([owned.id, prospect.id].sort());
    expect(dash.properties.find((c) => c.id === prospect.id)?.stage).toBe("prospect");
  });

  it("buying it is one PATCH, and nothing has to be re-entered", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const prospect = await makeProperty(testApp, user.headers, "Maybe", "prospect");

    // Plan the renovation while deciding.
    const project = await testApp.app.inject({
      method: "POST",
      url: `/api/properties/${prospect.id}/projects`,
      headers: user.headers,
      payload: { title: "Gut the kitchen", status: "planning" },
    });
    expect(project.statusCode).toBe(201);

    const patched = await testApp.app.inject({
      method: "PATCH",
      url: `/api/properties/${prospect.id}`,
      headers: user.headers,
      payload: { stage: "owned", expectedVersion: prospect.version },
    });
    expect(patched.statusCode).toBe(200);
    expect(unwrap<PropertyView>(patched).stage).toBe("owned");

    // The planning survives the purchase — that is the whole reason this is a
    // stage on the property rather than a separate kind of record.
    const dossier = await testApp.app.inject({
      method: "GET",
      url: `/api/properties/${prospect.id}/dossier`,
      headers: user.headers,
    });
    const body = unwrap<{ projects: { title: string }[] }>(dossier);
    expect(body.projects.map((p) => p.title)).toContain("Gut the kitchen");

    const dash = await dashboard(testApp, user.headers);
    expect(dash.totals.properties).toBe(1);
  });

  // The ask: "a way to remove prospective properties that i did not buy so they
  // can be cleared from the list". Passing on one archives it: off the ring and
  // out of "Needs a hand", but nothing is lost and it can be put back.
  it("passing on a prospect clears it from the ring and the attention feed", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    await makeProperty(testApp, user.headers, "Keeper", "owned");
    const prospect = await makeProperty(testApp, user.headers, "Not this one", "prospect");

    // A leftover overdue request — the kind of thing that would otherwise keep
    // nagging about a house you walked away from.
    const wo = await testApp.app.inject({
      method: "POST",
      url: `/api/properties/${prospect.id}/work-orders`,
      headers: user.headers,
      payload: { title: "Get roof quote", dueDate: "2020-01-01" },
    });
    expect(wo.statusCode).toBe(201);
    let dash = await dashboard(testApp, user.headers);
    expect(dash.needsAttention.some((a) => a.propertyId === prospect.id)).toBe(true);

    const passed = await testApp.app.inject({
      method: "PATCH",
      url: `/api/properties/${prospect.id}`,
      headers: user.headers,
      payload: { archivedAt: new Date().toISOString(), expectedVersion: prospect.version },
    });
    expect(passed.statusCode).toBe(200);

    dash = await dashboard(testApp, user.headers);
    expect(dash.properties.map((p) => p.name)).toEqual(["Keeper"]);
    expect(dash.needsAttention.some((a) => a.propertyId === prospect.id)).toBe(false);

    // Still there for anyone who asks for archived properties, so it can come back.
    const all = await testApp.app.inject({
      method: "GET",
      url: "/api/properties?includeArchived=true",
      headers: user.headers,
    });
    const archived = unwrap<{ items: PropertyView[] }>(all).items.find((p) => p.id === prospect.id);
    expect(archived?.archivedAt).not.toBeNull();

    const restored = await testApp.app.inject({
      method: "PATCH",
      url: `/api/properties/${prospect.id}`,
      headers: user.headers,
      payload: { archivedAt: null, expectedVersion: archived!.version },
    });
    expect(restored.statusCode).toBe(200);
    dash = await dashboard(testApp, user.headers);
    expect(dash.properties.map((p) => p.name).sort()).toEqual(["Keeper", "Not this one"]);
    expect(dash.needsAttention.some((a) => a.propertyId === prospect.id)).toBe(true);
  });

  it("an owner can delete a passed prospect for good, with everything on it", async () => {
    testApp = await createTestApp();
    const owner = createTestUser({ role: "owner" });
    const manager = createTestUser({ role: "manager" });
    const prospect = await makeProperty(testApp, owner.headers, "Gone", "prospect");
    const project = await testApp.app.inject({
      method: "POST",
      url: `/api/properties/${prospect.id}/projects`,
      headers: owner.headers,
      payload: { title: "Gut the kitchen", status: "planning" },
    });
    expect(project.statusCode).toBe(201);

    // Deleting is the owner's call, as it already was for any property.
    const refused = await testApp.app.inject({
      method: "DELETE",
      url: `/api/properties/${prospect.id}`,
      headers: bodyless(manager.headers),
    });
    expect(refused.statusCode).toBe(403);

    const res = await testApp.app.inject({
      method: "DELETE",
      url: `/api/properties/${prospect.id}`,
      headers: bodyless(owner.headers),
    });
    expect(res.statusCode).toBe(200);

    const gone = await testApp.app.inject({
      method: "GET",
      url: `/api/properties/${prospect.id}`,
      headers: owner.headers,
    });
    expect(gone.statusCode).toBe(404);
  });

  it("rejects a stage that is not one of the two", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const res = await testApp.app.inject({
      method: "POST",
      url: "/api/properties",
      headers: user.headers,
      payload: {
        name: "Bad stage",
        addressLine1: "3 Test St",
        city: "Springfield",
        state: "OH",
        postalCode: "45501",
        propertyType: "single_family",
        stage: "sold",
      },
    });
    // 422 is this app's code for a body that failed validation.
    expect(res.statusCode).toBe(422);
  });
});
