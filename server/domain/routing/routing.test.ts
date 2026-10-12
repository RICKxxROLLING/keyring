// server/domain/routing/routing.test.ts — the maintenance route.
//
// The ask: "a tool that creates a route based on what's needed to be done, so a
// todo with a map on the most efficient way of doing everything."
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../../testing/harness.js";
import { setGeocoder, type Geocoder } from "./geocoder.js";
import type {
  LocateResult,
  PropertyView,
  RouteHomeBase,
  RoutePayload,
} from "../../../shared/types.js";

function bodyless(h: Record<string, string>): Record<string, string> {
  const rest = { ...h };
  delete rest["content-type"];
  return rest;
}

/** A geocoder that knows a fixed set of addresses, and counts what it was asked. */
function fakeGeocoder(known: Record<string, [number, number]>): { g: Geocoder; asked: string[] } {
  const asked: string[] = [];
  const g: Geocoder = async (address) => {
    asked.push(address);
    const hit = Object.entries(known).find(([k]) => address.startsWith(k));
    return hit ? { latitude: hit[1][0], longitude: hit[1][1] } : null;
  };
  return { g, asked };
}

async function makeProperty(
  t: TestApp,
  headers: Record<string, string>,
  name: string,
  addressLine1: string,
  stage: "owned" | "prospect" = "owned",
): Promise<PropertyView> {
  const res = await t.app.inject({
    method: "POST",
    url: "/api/properties",
    headers,
    payload: {
      name,
      addressLine1,
      city: "Kill Devil Hills",
      state: "NC",
      postalCode: "27948",
      propertyType: "single_family",
      stage,
    },
  });
  expect(res.statusCode).toBe(201);
  return unwrap<PropertyView>(res);
}

async function makeWorkOrder(
  t: TestApp,
  headers: Record<string, string>,
  propertyId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await t.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/work-orders`,
    headers,
    payload,
  });
  expect(res.statusCode).toBe(201);
}

async function getRoute(t: TestApp, headers: Record<string, string>): Promise<RoutePayload> {
  const res = await t.app.inject({ method: "GET", url: "/api/maintenance/route", headers });
  expect(res.statusCode).toBe(200);
  return unwrap<RoutePayload>(res);
}

describe("maintenance route", () => {
  let testApp: TestApp | null = null;
  let restore: Geocoder | null = null;

  beforeEach(() => {
    restore = null;
  });

  afterEach(async () => {
    if (restore) setGeocoder(restore);
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  it("lists only owned, on-the-ring properties with open work, most pressing task first", async () => {
    testApp = await createTestApp();
    const user = createTestUser();
    const h = user.headers;

    const busy = await makeProperty(testApp, h, "Busy", "1 Beach Rd");
    const quiet = await makeProperty(testApp, h, "Quiet", "2 Beach Rd");
    const maybe = await makeProperty(testApp, h, "Maybe", "3 Beach Rd", "prospect");
    const passed = await makeProperty(testApp, h, "Passed", "4 Beach Rd", "prospect");

    await makeWorkOrder(testApp, h, busy.id, { title: "Paint trim", priority: "low" });
    await makeWorkOrder(testApp, h, busy.id, { title: "Burst pipe", priority: "urgent" });
    await makeWorkOrder(testApp, h, busy.id, { title: "Old job", status: "done" });
    await makeWorkOrder(testApp, h, quiet.id, { title: "Finished", status: "done" });
    await makeWorkOrder(testApp, h, maybe.id, { title: "Inspection", priority: "high" });
    await makeWorkOrder(testApp, h, passed.id, { title: "Never mind" });
    await testApp.app.inject({
      method: "PATCH",
      url: `/api/properties/${passed.id}`,
      headers: h,
      payload: { archivedAt: new Date().toISOString(), expectedVersion: passed.version },
    });

    const route = await getRoute(testApp, h);
    expect(route.home).toBeNull();
    expect(route.stops.map((s) => s.name)).toEqual(["Busy"]);
    const [stop] = route.stops;
    expect(stop!.address).toBe("1 Beach Rd, Kill Devil Hills, NC 27948");
    expect(stop!.latitude).toBeNull();
    expect(stop!.tasks.map((t) => t.title)).toEqual(["Burst pipe", "Paint trim"]);
  });

  it("looks each address up once, and reports the ones it could not find", async () => {
    testApp = await createTestApp();
    const user = createTestUser();
    const h = user.headers;
    const found = await makeProperty(testApp, h, "Found", "1 Beach Rd");
    const lost = await makeProperty(testApp, h, "Lost", "99 Nowhere Ln");
    await makeWorkOrder(testApp, h, found.id, { title: "Fix gate" });
    await makeWorkOrder(testApp, h, lost.id, { title: "Fix gate" });

    const fake = fakeGeocoder({ "1 Beach Rd": [36.03, -75.67] });
    restore = setGeocoder(fake.g);

    const res = await testApp.app.inject({
      method: "POST",
      url: "/api/maintenance/route/locate",
      headers: bodyless(h),
    });
    expect(res.statusCode).toBe(200);
    const result = unwrap<LocateResult>(res);
    expect(result.located).toEqual([found.id]);
    expect(result.failed.map((f) => f.name)).toEqual(["Lost"]);

    let route = await getRoute(testApp, h);
    const byName = Object.fromEntries(route.stops.map((s) => [s.name, s]));
    expect(byName["Found"]).toMatchObject({
      latitude: 36.03,
      longitude: -75.67,
      locationSource: "geocoder",
    });
    expect(byName["Lost"]!.latitude).toBeNull();

    // A second pass only asks about the one still missing.
    fake.asked.length = 0;
    await testApp.app.inject({
      method: "POST",
      url: "/api/maintenance/route/locate",
      headers: bodyless(h),
    });
    expect(fake.asked).toEqual(["99 Nowhere Ln, Kill Devil Hills, NC 27948"]);

    // The one it could not find can be placed by hand, and stays placed.
    const manual = await testApp.app.inject({
      method: "PUT",
      url: `/api/maintenance/route/locations/${lost.id}`,
      headers: h,
      payload: { latitude: 35.9, longitude: -75.6 },
    });
    expect(manual.statusCode).toBe(200);
    route = await getRoute(testApp, h);
    expect(route.stops.find((s) => s.name === "Lost")).toMatchObject({
      latitude: 35.9,
      longitude: -75.6,
      locationSource: "manual",
    });
  });

  it("forgets a point when the address it was found for changes", async () => {
    testApp = await createTestApp();
    const user = createTestUser();
    const h = user.headers;
    const p = await makeProperty(testApp, h, "Moved", "1 Beach Rd");
    await makeWorkOrder(testApp, h, p.id, { title: "Fix gate" });
    restore = setGeocoder(fakeGeocoder({ "1 Beach Rd": [36.03, -75.67] }).g);
    await testApp.app.inject({
      method: "POST",
      url: "/api/maintenance/route/locate",
      headers: bodyless(h),
    });
    expect((await getRoute(testApp, h)).stops[0]!.latitude).toBe(36.03);

    const edit = await testApp.app.inject({
      method: "PATCH",
      url: `/api/properties/${p.id}`,
      headers: h,
      payload: { addressLine1: "500 Ocean Blvd", expectedVersion: p.version },
    });
    expect(edit.statusCode).toBe(200);
    // Routing a house to where it used to be would be worse than not routing it.
    expect((await getRoute(testApp, h)).stops[0]!.latitude).toBeNull();
  });

  it("keeps a home base per person, looked up or given by hand", async () => {
    testApp = await createTestApp();
    const riley = createTestUser();
    const sam = createTestUser();
    restore = setGeocoder(fakeGeocoder({ "10 Home St": [36.1, -75.7] }).g);

    const looked = await testApp.app.inject({
      method: "PUT",
      url: "/api/maintenance/route/home",
      headers: riley.headers,
      payload: { address: "10 Home St, Kitty Hawk, NC" },
    });
    expect(looked.statusCode).toBe(200);
    expect(unwrap<RouteHomeBase>(looked)).toMatchObject({
      latitude: 36.1,
      longitude: -75.7,
      source: "geocoder",
    });

    const notFound = await testApp.app.inject({
      method: "PUT",
      url: "/api/maintenance/route/home",
      headers: sam.headers,
      payload: { address: "Somewhere vague" },
    });
    expect(notFound.statusCode).toBe(422);

    const byHand = await testApp.app.inject({
      method: "PUT",
      url: "/api/maintenance/route/home",
      headers: sam.headers,
      payload: { address: "The shop", latitude: 35.95, longitude: -75.62 },
    });
    expect(byHand.statusCode).toBe(200);

    expect((await getRoute(testApp, riley.headers)).home?.address).toBe(
      "10 Home St, Kitty Hawk, NC",
    );
    expect((await getRoute(testApp, sam.headers)).home).toMatchObject({
      address: "The shop",
      source: "manual",
    });
  });

  it("says so plainly when the lookup service cannot be reached", async () => {
    testApp = await createTestApp();
    const user = createTestUser();
    restore = setGeocoder(async () => {
      throw new Error("ECONNRESET");
    });
    const res = await testApp.app.inject({
      method: "PUT",
      url: "/api/maintenance/route/home",
      headers: user.headers,
      payload: { address: "10 Home St" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.message).toMatch(/couldn't be reached/);
  });

  it("requires signing in", async () => {
    testApp = await createTestApp();
    const res = await testApp.app.inject({ method: "GET", url: "/api/maintenance/route" });
    expect(res.statusCode).toBe(401);
  });
});
