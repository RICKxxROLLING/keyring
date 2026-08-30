// server/domain/money/money.test.ts — rent-roll idempotency, status derivation, MoneySummary
// reconciliation, and project budget-vs-actual variance (including over budget).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../../testing/harness.js";
import type { MoneySummary, ProjectView, RentEntry } from "../../../shared/types.js";

let app: TestApp;
let user: TestUser;

beforeEach(async () => {
  app = await createTestApp();
  user = createTestUser({ role: "manager" });
});

afterEach(async () => {
  await app.close();
});

async function createProperty(): Promise<string> {
  const res = await app.app.inject({
    method: "POST",
    url: "/api/properties",
    headers: user.headers,
    payload: {
      name: "Money Test Property",
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

async function createUnit(propertyId: string): Promise<string> {
  const res = await app.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/units`,
    headers: user.headers,
    payload: { label: "Unit A", status: "vacant" },
  });
  return unwrap<{ id: string }>(res).id;
}

async function createActiveLease(propertyId: string, unitId: string, rentCents: number): Promise<string> {
  const res = await app.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/leases`,
    headers: user.headers,
    payload: {
      unitId,
      startDate: "2026-01-01",
      rentCents,
      depositCents: rentCents,
      dueDay: 1,
      status: "active",
      renewalNoticeDays: 60,
      tenantIds: [],
    },
  });
  return unwrap<{ id: string }>(res).id;
}

describe("rent roll generation", () => {
  it("is idempotent per (unit, period)", async () => {
    const propertyId = await createProperty();
    const unitId = await createUnit(propertyId);
    await createActiveLease(propertyId, unitId, 150000);

    const period = "2026-03";
    const first = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/rent/generate`,
      headers: user.headers,
      payload: { period },
    });
    expect(first.statusCode).toBe(200);
    const firstEntries = unwrap<{ items: RentEntry[] }>(first).items;
    expect(firstEntries.length).toBe(1);
    expect(firstEntries[0]!.amountDueCents).toBe(150000);

    const second = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/rent/generate`,
      headers: user.headers,
      payload: { period },
    });
    const secondEntries = unwrap<{ items: RentEntry[] }>(second).items;
    // Same single row returned, not duplicated.
    expect(secondEntries.length).toBe(1);
    expect(secondEntries[0]!.id).toBe(firstEntries[0]!.id);

    const listRes = await app.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/rent?from=${period}&to=${period}`,
      headers: cookieOnly(),
    });
    const list = unwrap<{ items: RentEntry[] }>(listRes);
    expect(list.items.length).toBe(1);
  });
});

describe("rent status derivation", () => {
  it("derives unpaid -> partial -> paid from received vs due, and honors explicit waived", async () => {
    const propertyId = await createProperty();
    const unitId = await createUnit(propertyId);
    const createRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/rent`,
      headers: user.headers,
      payload: { unitId, period: "2026-05", amountDueCents: 100000, amountReceivedCents: 0 },
    });
    let entry = unwrap<RentEntry>(createRes);
    expect(["unpaid", "late"]).toContain(entry.status);

    const partialRes = await app.app.inject({
      method: "PATCH",
      url: `/api/rent/${entry.id}`,
      headers: user.headers,
      payload: { amountReceivedCents: 40000, expectedVersion: entry.version },
    });
    entry = unwrap<RentEntry>(partialRes);
    expect(entry.status).toBe("partial");

    const paidRes = await app.app.inject({
      method: "PATCH",
      url: `/api/rent/${entry.id}`,
      headers: user.headers,
      payload: { amountReceivedCents: 100000, expectedVersion: entry.version },
    });
    entry = unwrap<RentEntry>(paidRes);
    expect(entry.status).toBe("paid");

    const waivedRes = await app.app.inject({
      method: "PATCH",
      url: `/api/rent/${entry.id}`,
      headers: user.headers,
      payload: { status: "waived", expectedVersion: entry.version },
    });
    entry = unwrap<RentEntry>(waivedRes);
    expect(entry.status).toBe("waived");
  });
});

describe("MoneySummary reconciliation", () => {
  it("totals reconcile with the underlying rent and expense rows", async () => {
    const propertyId = await createProperty();
    const unitId = await createUnit(propertyId);

    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/rent`,
      headers: user.headers,
      payload: { unitId, period: "2026-06", amountDueCents: 120000, amountReceivedCents: 120000, status: "paid" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/rent`,
      headers: user.headers,
      payload: { unitId, period: "2026-07", amountDueCents: 120000, amountReceivedCents: 60000 },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/expenses`,
      headers: user.headers,
      payload: { category: "repair", description: "Fix roof", amountCents: 50000, incurredOn: "2026-06-15" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/expenses`,
      headers: user.headers,
      payload: { category: "utility", description: "Water bill", amountCents: 8000, incurredOn: "2026-07-10" },
    });

    const summaryRes = await app.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/money/summary?from=2026-06&to=2026-07`,
      headers: cookieOnly(),
    });
    expect(summaryRes.statusCode).toBe(200);
    const summary = unwrap<MoneySummary>(summaryRes);
    expect(summary.rentDueCents).toBe(240000);
    expect(summary.rentReceivedCents).toBe(180000);
    expect(summary.rentOutstandingCents).toBe(60000);
    expect(summary.expenseCents).toBe(58000);
    expect(summary.netCents).toBe(180000 - 58000);
    const byCategoryTotal = summary.byCategory.reduce((s, c) => s + c.amountCents, 0);
    expect(byCategoryTotal).toBe(summary.expenseCents);
    const byMonthRent = summary.byMonth.reduce((s, m) => s + m.rentReceivedCents, 0);
    const byMonthExpense = summary.byMonth.reduce((s, m) => s + m.expenseCents, 0);
    expect(byMonthRent).toBe(summary.rentReceivedCents);
    expect(byMonthExpense).toBe(summary.expenseCents);
  });
});

describe("project budget-vs-actual variance", () => {
  it("computes variance correctly, including the over-budget case", async () => {
    const propertyId = await createProperty();
    const projRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/projects`,
      headers: user.headers,
      payload: { title: "Kitchen remodel", status: "in_progress", priority: "normal", budgetCents: 1000000 },
    });
    const project = unwrap<ProjectView>(projRes);

    await app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/lines`,
      headers: user.headers,
      payload: { kind: "budget", label: "Materials", amountCents: 600000 },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/lines`,
      headers: user.headers,
      payload: { kind: "budget", label: "Labor", amountCents: 400000 },
    });

    const underBudgetRes = await app.app.inject({
      method: "GET",
      url: `/api/projects/${project.id}`,
      headers: cookieOnly(),
    });
    let view = unwrap<ProjectView>(underBudgetRes);
    expect(view.budgetTotalCents).toBe(1000000);
    expect(view.actualTotalCents).toBe(0);
    expect(view.varianceCents).toBe(1000000);

    // Push actual spend past budget.
    await app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/lines`,
      headers: user.headers,
      payload: { kind: "expense", label: "Materials invoice", amountCents: 700000, incurredOn: "2026-02-01" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/lines`,
      headers: user.headers,
      payload: { kind: "expense", label: "Labor invoice", amountCents: 500000, incurredOn: "2026-02-10" },
    });

    const overBudgetRes = await app.app.inject({
      method: "GET",
      url: `/api/projects/${project.id}`,
      headers: cookieOnly(),
    });
    view = unwrap<ProjectView>(overBudgetRes);
    expect(view.actualTotalCents).toBe(1200000);
    expect(view.varianceCents).toBe(1000000 - 1200000);
    expect(view.varianceCents).toBeLessThan(0);
  });
});

function cookieOnly(): Record<string, string> {
  const { cookie, "x-csrf-token": csrf } = user.headers;
  return { cookie, "x-csrf-token": csrf };
}
