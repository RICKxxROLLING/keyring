// server/domain/dossier/dossier.test.ts — the single-request PropertyDossier.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../../testing/harness.js";
import type { PropertyDossier } from "../../../shared/types.js";

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

describe("GET /api/properties/:id/dossier", () => {
  it("returns a complete PropertyDossier in one request, reflecting created data", async () => {
    const propRes = await app.app.inject({
      method: "POST",
      url: "/api/properties",
      headers: user.headers,
      payload: {
        name: "Dossier Test Property",
        addressLine1: "1 Test St",
        city: "T",
        state: "OH",
        postalCode: "45000",
        country: "US",
        propertyType: "single_family",
      },
    });
    const propertyId = unwrap<{ id: string }>(propRes).id;

    const unitRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/units`,
      headers: user.headers,
      payload: { label: "Unit 1", status: "vacant" },
    });
    const unitId = unwrap<{ id: string }>(unitRes).id;

    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/notes`,
      headers: user.headers,
      payload: { body: "Dossier note" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/work-orders`,
      headers: user.headers,
      payload: { title: "Dossier work order", status: "new", priority: "normal" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/pm-templates`,
      headers: user.headers,
      payload: { title: "Dossier PM", frequency: "quarterly", anchorDate: "2026-01-01", leadDays: 7 },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/projects`,
      headers: user.headers,
      payload: { title: "Dossier project", status: "idea", priority: "normal" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/tenants`,
      headers: user.headers,
      payload: { unitId, firstName: "D", lastName: "Ossier", isPrimary: true },
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
      url: `/api/properties/${propertyId}/rent`,
      headers: user.headers,
      payload: { unitId, period: "2026-01", amountDueCents: 100000 },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/expenses`,
      headers: user.headers,
      payload: { category: "repair", description: "Dossier expense", amountCents: 5000, incurredOn: "2026-01-05" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/specs`,
      headers: user.headers,
      payload: { category: "filter", label: "Dossier spec", isSecret: false },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/compliance`,
      headers: user.headers,
      payload: { kind: "insurance", title: "Dossier compliance", dueDate: "2026-06-01", leadDays: 30, recurrence: "none" },
    });
    await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/turnovers`,
      headers: user.headers,
      payload: { unitId, phase: "move_out" },
    });

    const res = await app.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/dossier`,
      headers: cookieOnly(user),
    });
    expect(res.statusCode).toBe(200);
    const dossier = unwrap<PropertyDossier>(res);

    expect(dossier.property.id).toBe(propertyId);
    expect(dossier.property.units.length).toBe(1);
    expect(dossier.notes.length).toBe(1);
    expect(dossier.workOrders.length).toBe(1);
    expect(dossier.pmTemplates.length).toBe(1);
    expect(dossier.projects.length).toBe(1);
    expect(dossier.tenants.length).toBe(1);
    expect(dossier.leases.length).toBe(1);
    expect(dossier.rentEntries.length).toBe(1);
    expect(dossier.expenses.length).toBe(1);
    expect(dossier.specs.length).toBe(1);
    expect(dossier.compliance.length).toBe(1);
    expect(dossier.turnovers.length).toBe(1);
    expect(Array.isArray(dossier.vendors)).toBe(true);
    expect(Array.isArray(dossier.attachments)).toBe(true);
    expect(Array.isArray(dossier.attention)).toBe(true);
    expect(dossier.money).toBeDefined();
    expect(dossier.money.propertyId).toBe(propertyId);
    expect(typeof dossier.generatedAt).toBe("string");
  });

  it("404s for an unknown property id", async () => {
    const res = await app.app.inject({
      method: "GET",
      url: "/api/properties/prp_00000000000000000000000000/dossier",
      headers: cookieOnly(user),
    });
    expect(res.statusCode).toBe(404);
  });
});
