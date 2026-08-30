// server/domain/dashboard/dashboard.test.ts — DashboardPayload shape and full AttentionKind
// coverage in the needsAttention feed.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../../testing/harness.js";
import { todayLocal, addDays } from "../../lib/time.js";
import { getEnv } from "../../config/env.js";
import type { AttentionKind, DashboardPayload } from "../../../shared/types.js";

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

describe("GET /api/dashboard", () => {
  it("returns a DashboardPayload whose needsAttention covers every AttentionKind", async () => {
    const today = todayLocal(getEnv().APP_TIMEZONE);

    const propRes = await app.app.inject({
      method: "POST",
      url: "/api/properties",
      headers: user.headers,
      payload: {
        name: "Attention Test Property",
        addressLine1: "1 Test St",
        city: "T",
        state: "OH",
        postalCode: "45000",
        country: "US",
        propertyType: "single_family",
      },
    });
    const propertyId = unwrap<{ id: string }>(propRes).id;

    // unit_vacant
    const unitRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/units`,
      headers: user.headers,
      payload: { label: "Vacant Unit", status: "vacant" },
    });
    const vacantUnitId = unwrap<{ id: string }>(unitRes).id;

    // Second unit for the leased/turnover scenarios.
    const unit2Res = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/units`,
      headers: user.headers,
      payload: { label: "Leased Unit", status: "occupied" },
    });
    const unit2Id = unwrap<{ id: string }>(unit2Res).id;

    // work_order_overdue
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/work-orders`,
      headers: user.headers,
      payload: { title: "Overdue WO", status: "new", priority: "normal", dueDate: addDays(today, -3) },
    });
    // work_order_urgent (not overdue)
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/work-orders`,
      headers: user.headers,
      payload: { title: "Urgent WO", status: "new", priority: "urgent", dueDate: addDays(today, 10) },
    });

    // compliance_overdue
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/compliance`,
      headers: user.headers,
      payload: { kind: "insurance", title: "Overdue compliance", dueDate: addDays(today, -5), leadDays: 30, recurrence: "none" },
    });
    // compliance_due
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/compliance`,
      headers: user.headers,
      payload: { kind: "inspection", title: "Due-soon compliance", dueDate: addDays(today, 10), leadDays: 30, recurrence: "none" },
    });

    // lease_expiring: active lease ending inside its renewal notice window.
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/leases`,
      headers: user.headers,
      payload: {
        unitId: unit2Id,
        startDate: addDays(today, -300),
        endDate: addDays(today, 20),
        rentCents: 120000,
        depositCents: 120000,
        dueDay: 1,
        status: "active",
        renewalNoticeDays: 60,
        tenantIds: [],
      },
    });

    // rent_unpaid
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/rent`,
      headers: user.headers,
      payload: { unitId: unit2Id, period: today.slice(0, 7), amountDueCents: 120000, amountReceivedCents: 0 },
    });

    // turnover_stalled: target ready date already passed, not closed.
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/turnovers`,
      headers: user.headers,
      payload: { unitId: vacantUnitId, phase: "make_ready", targetReadyDate: addDays(today, -2) },
    });

    // pm_due
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/pm-templates`,
      headers: user.headers,
      payload: { title: "Due PM", frequency: "quarterly", anchorDate: today, leadDays: 14 },
    });

    const res = await app.app.inject({ method: "GET", url: "/api/dashboard", headers: cookieOnly(user) });
    expect(res.statusCode).toBe(200);
    const payload = unwrap<DashboardPayload>(res);

    expect(payload.properties.length).toBe(1);
    expect(payload.properties[0]!.id).toBe(propertyId);
    expect(payload.totals.properties).toBe(1);
    expect(payload.totals.units).toBe(2);
    expect(typeof payload.generatedAt).toBe("string");

    const ALL_KINDS: AttentionKind[] = [
      "work_order_overdue",
      "work_order_urgent",
      "compliance_overdue",
      "compliance_due",
      "lease_expiring",
      "unit_vacant",
      "rent_unpaid",
      "turnover_stalled",
      "pm_due",
    ];
    const seenKinds = new Set(payload.needsAttention.map((a) => a.kind));
    for (const kind of ALL_KINDS) {
      expect(seenKinds.has(kind), `missing AttentionKind: ${kind}`).toBe(true);
    }
    expect(payload.properties[0]!.attentionCount).toBeGreaterThan(0);
  });
});
