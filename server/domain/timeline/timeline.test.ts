// server/domain/timeline/timeline.test.ts — reverse-chronological audit wall for a property.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../../testing/harness.js";
import type { TimelineEvent } from "../../../shared/types.js";

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

describe("GET /api/properties/:id/timeline", () => {
  it("returns property events reverse-chronologically, each with an actor and a summary", async () => {
    const propRes = await app.app.inject({
      method: "POST",
      url: "/api/properties",
      headers: user.headers,
      payload: {
        name: "Timeline Test Property",
        addressLine1: "1 Test St",
        city: "T",
        state: "OH",
        postalCode: "45000",
        country: "US",
        propertyType: "single_family",
      },
    });
    const propertyId = unwrap<{ id: string }>(propRes).id;

    const noteRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/notes`,
      headers: user.headers,
      payload: { body: "First note" },
    });
    const note = unwrap<{ id: string; version: number }>(noteRes);

    await app.app.inject({
      method: "PATCH",
      url: `/api/notes/${note.id}`,
      headers: user.headers,
      payload: { body: "Edited note", expectedVersion: note.version },
    });

    const res = await app.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/timeline`,
      headers: cookieOnly(user),
    });
    expect(res.statusCode).toBe(200);
    const page = unwrap<{ items: TimelineEvent[] }>(res);

    // At least: property create, note create, note update.
    expect(page.items.length).toBeGreaterThanOrEqual(3);
    for (const event of page.items) {
      expect(typeof event.summary).toBe("string");
      expect(event.summary.length).toBeGreaterThan(0);
      expect(event.actor).not.toBeNull();
      expect(event.actor!.id).toBe(user.id);
    }
    // Reverse-chronological: 'at' timestamps are non-increasing down the list.
    for (let i = 1; i < page.items.length; i++) {
      expect(page.items[i]!.at <= page.items[i - 1]!.at).toBe(true);
    }
    // The most recent event should be the note update.
    expect(page.items[0]!.entityType).toBe("note");
    expect(page.items[0]!.action).toBe("update");
  });

  it("404s for an unknown property id", async () => {
    const res = await app.app.inject({
      method: "GET",
      url: "/api/properties/prp_00000000000000000000000000/timeline",
      headers: cookieOnly(user),
    });
    expect(res.statusCode).toBe(404);
  });
});
