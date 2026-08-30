// server/domain/compliance/compliance.test.ts — derived status boundaries and /complete
// recurrence rollover.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../../testing/harness.js";
import { todayLocal, addDays } from "../../lib/time.js";
import { getEnv } from "../../config/env.js";
import type { ComplianceItemView } from "../../../shared/types.js";

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

async function createProperty(): Promise<string> {
  const res = await app.app.inject({
    method: "POST",
    url: "/api/properties",
    headers: user.headers,
    payload: {
      name: "Compliance Test Property",
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

async function createItem(propertyId: string, dueDate: string, leadDays: number, recurrence = "none"): Promise<ComplianceItemView> {
  const res = await app.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/compliance`,
    headers: user.headers,
    payload: { kind: "insurance", title: "Test item", dueDate, leadDays, recurrence },
  });
  return unwrap<ComplianceItemView>(res);
}

describe("compliance derived status boundaries", () => {
  it("daysOut = -1 -> overdue", async () => {
    const propertyId = await createProperty();
    const today = todayLocal(getEnv().APP_TIMEZONE);
    const item = await createItem(propertyId, addDays(today, -1), 30);
    expect(item.daysOut).toBe(-1);
    expect(item.status).toBe("overdue");
  });

  it("daysOut = 0 -> due_soon", async () => {
    const propertyId = await createProperty();
    const today = todayLocal(getEnv().APP_TIMEZONE);
    const item = await createItem(propertyId, today, 30);
    expect(item.daysOut).toBe(0);
    expect(item.status).toBe("due_soon");
  });

  it("daysOut = leadDays -> due_soon (boundary inclusive)", async () => {
    const propertyId = await createProperty();
    const today = todayLocal(getEnv().APP_TIMEZONE);
    const leadDays = 30;
    const item = await createItem(propertyId, addDays(today, leadDays), leadDays);
    expect(item.daysOut).toBe(leadDays);
    expect(item.status).toBe("due_soon");
  });

  it("daysOut = leadDays + 1 -> ok (just past the boundary)", async () => {
    const propertyId = await createProperty();
    const today = todayLocal(getEnv().APP_TIMEZONE);
    const leadDays = 30;
    const item = await createItem(propertyId, addDays(today, leadDays + 1), leadDays);
    expect(item.daysOut).toBe(leadDays + 1);
    expect(item.status).toBe("ok");
  });
});

describe("compliance /complete", () => {
  it("sets state=done and, for a recurring item, creates the next occurrence with the advanced due date", async () => {
    const propertyId = await createProperty();
    const today = todayLocal(getEnv().APP_TIMEZONE);
    const item = await createItem(propertyId, addDays(today, -5), 30, "quarterly");

    const completeRes = await app.app.inject({
      method: "POST",
      url: `/api/compliance/${item.id}/complete`,
      headers: user.headers,
      payload: { completedOn: today, expectedVersion: item.version },
    });
    expect(completeRes.statusCode).toBe(200);
    const completed = unwrap<ComplianceItemView>(completeRes);
    expect(completed.state).toBe("done");
    expect(completed.status).toBe("done");
    expect(completed.completedOn).toBe(today);

    const listRes = await app.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/compliance`,
      headers: cookieOnly(user),
    });
    const list = unwrap<{ items: ComplianceItemView[] }>(listRes);
    // The completed item plus one freshly-created 'open' occurrence.
    expect(list.items.length).toBe(2);
    const nextOccurrence = list.items.find((i) => i.id !== item.id);
    expect(nextOccurrence).toBeDefined();
    expect(nextOccurrence!.state).toBe("open");
    // quarterly = +3 months from the original due date.
    const expectedNextDue = addMonthsForTest(item.dueDate, 3);
    expect(nextOccurrence!.dueDate).toBe(expectedNextDue);
  });

  it("does not create a next occurrence when recurrence is 'none'", async () => {
    const propertyId = await createProperty();
    const today = todayLocal(getEnv().APP_TIMEZONE);
    const item = await createItem(propertyId, today, 30, "none");

    await app.app.inject({
      method: "POST",
      url: `/api/compliance/${item.id}/complete`,
      headers: user.headers,
      payload: { completedOn: today, expectedVersion: item.version },
    });

    const listRes = await app.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/compliance`,
      headers: cookieOnly(user),
    });
    const list = unwrap<{ items: ComplianceItemView[] }>(listRes);
    expect(list.items.length).toBe(1);
  });
});

function addMonthsForTest(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
