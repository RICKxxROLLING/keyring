// server/domain/projects/ledger-tie.test.ts — renovation money reaches the ledger.
//
// The ask: a renovation tab for the work a prospect needs before it can be
// rented, "which would tie into the ledger".
//
// property_expenses.project_id has existed since migration 2001 and nothing
// ever wrote to it, so renovation spend lived inside the project and the money
// page never saw a penny of it. The fix is single-entry: one ledger row per
// payment, tagged to the project, read by both views.
//
// The failure this guards against is the tempting alternative — record it on
// the project AND in the ledger — which is two numbers for one payment. They
// only have to disagree once for both to become worthless.
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../../testing/harness.js";
import type { MoneySummary, ProjectView, PropertyExpense, PropertyView } from "../../../shared/types.js";

describe("renovation spend and the ledger", () => {
  let testApp: TestApp | null = null;

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  async function setup(): Promise<{
    user: ReturnType<typeof createTestUser>;
    propertyId: string;
    project: ProjectView;
  }> {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = unwrap<PropertyView>(
      await testApp.app.inject({
        method: "POST",
        url: "/api/properties",
        headers: user.headers,
        payload: {
          name: "Needs everything",
          addressLine1: "1 Test St",
          city: "Manteo",
          state: "NC",
          postalCode: "27954",
          propertyType: "single_family",
          stage: "prospect",
        },
      }),
    ).id;
    const project = unwrap<ProjectView>(
      await testApp.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/projects`,
        headers: user.headers,
        payload: { title: "Gut the kitchen", status: "planning", priority: "high" },
      }),
    );
    return { user, propertyId, project };
  }

  async function logCost(
    user: ReturnType<typeof createTestUser>,
    propertyId: string,
    projectId: string,
    description: string,
    amountCents: number,
    incurredOn: string,
  ): Promise<PropertyExpense> {
    const res = await testApp!.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/expenses`,
      headers: user.headers,
      payload: { category: "capex", description, amountCents, incurredOn, projectId },
    });
    expect(res.statusCode).toBe(201);
    return unwrap<PropertyExpense>(res);
  }

  async function readProject(
    user: ReturnType<typeof createTestUser>,
    projectId: string,
  ): Promise<ProjectView> {
    const res = await testApp!.app.inject({
      method: "GET",
      url: `/api/projects/${projectId}`,
      headers: user.headers,
    });
    expect(res.statusCode).toBe(200);
    return unwrap<ProjectView>(res);
  }

  it("counts a renovation cost once, on the project and in the ledger", async () => {
    const { user, propertyId, project } = await setup();
    await logCost(user, propertyId, project.id, "Cabinets", 840000, "2026-03-04");
    await logCost(user, propertyId, project.id, "Countertop", 310000, "2026-03-19");

    const updated = await readProject(user, project.id);
    expect(updated.ledgerCosts).toHaveLength(2);
    expect(updated.actualTotalCents).toBe(1150000);

    const summary = unwrap<MoneySummary>(
      await testApp!.app.inject({
        method: "GET",
        url: `/api/properties/${propertyId}/money/summary?from=2026-03&to=2026-03`,
        headers: user.headers,
      }),
    );
    // The same 11,500 dollars, seen from the money page. Not 23,000.
    expect(summary.expenseCents).toBe(1150000);
  });

  it("leaves the property's other spending out of the project", async () => {
    const { user, propertyId, project } = await setup();
    await logCost(user, propertyId, project.id, "New subfloor", 500000, "2026-03-04");

    const untagged = await testApp!.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/expenses`,
      headers: user.headers,
      payload: {
        category: "insurance",
        description: "Wind and hail premium",
        amountCents: 420000,
        incurredOn: "2026-03-10",
      },
    });
    expect(untagged.statusCode).toBe(201);

    const updated = await readProject(user, project.id);
    expect(updated.actualTotalCents).toBe(500000);
    expect(updated.ledgerCosts.map((e) => e.description)).toEqual(["New subfloor"]);
  });

  it("reports the variance against the project's budget lines", async () => {
    const { user, propertyId, project } = await setup();
    for (const [label, amountCents] of [
      ["Materials", 600000],
      ["Labour", 400000],
    ] as const) {
      const res = await testApp!.app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/lines`,
        headers: user.headers,
        payload: { kind: "budget", label, amountCents },
      });
      expect(res.statusCode).toBe(201);
    }

    const onBudget = await readProject(user, project.id);
    expect(onBudget.budgetTotalCents).toBe(1000000);
    expect(onBudget.varianceCents).toBe(1000000);

    await logCost(user, propertyId, project.id, "Materials invoice", 700000, "2026-04-01");
    await logCost(user, propertyId, project.id, "Labour invoice", 500000, "2026-04-08");

    const over = await readProject(user, project.id);
    expect(over.actualTotalCents).toBe(1200000);
    expect(over.varianceCents).toBe(-200000);
  });

  it("un-tagging a cost removes it from the project but not from the ledger", async () => {
    const { user, propertyId, project } = await setup();
    const cost = await logCost(user, propertyId, project.id, "Deck boards", 220000, "2026-05-02");

    const res = await testApp!.app.inject({
      method: "PATCH",
      url: `/api/expenses/${cost.id}`,
      headers: user.headers,
      payload: { projectId: null, expectedVersion: cost.version },
    });
    expect(res.statusCode).toBe(200);

    expect((await readProject(user, project.id)).actualTotalCents).toBe(0);

    // Still money that left the account. Deleting the project must never be a
    // way to make spending disappear from the property's books.
    const summary = unwrap<MoneySummary>(
      await testApp!.app.inject({
        method: "GET",
        url: `/api/properties/${propertyId}/money/summary?from=2026-05&to=2026-05`,
        headers: user.headers,
      }),
    );
    expect(summary.expenseCents).toBe(220000);
  });

  it("survives the project being deleted, still on the property's books", async () => {
    const { user, propertyId, project } = await setup();
    await logCost(user, propertyId, project.id, "Demolition", 180000, "2026-06-01");

    const { "content-type": _ct, ...bodyless } = user.headers;
    const del = await testApp!.app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}`,
      headers: bodyless,
    });
    expect(del.statusCode).toBe(200);

    // ON DELETE SET NULL, not CASCADE. Abandoning a renovation plan does not
    // un-spend the money already spent on it.
    const summary = unwrap<MoneySummary>(
      await testApp!.app.inject({
        method: "GET",
        url: `/api/properties/${propertyId}/money/summary?from=2026-06&to=2026-06`,
        headers: user.headers,
      }),
    );
    expect(summary.expenseCents).toBe(180000);
  });
});
