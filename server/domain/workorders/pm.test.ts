// server/domain/workorders/pm.test.ts — PM template generation: quarterly/semiannual/annual,
// idempotent double-run, nextDueDate/lastGeneratedDate advancement.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../../testing/harness.js";
import { runJobNow } from "../../lib/scheduler.js";
import { todayLocal, addMonths } from "../../lib/time.js";
import { getEnv } from "../../config/env.js";
import { getDb } from "../../db/index.js";
import { advanceDueDate } from "./pm.js";
import type { PmTemplate } from "../../../shared/types.js";

let app: TestApp;
let user: TestUser;

beforeEach(async () => {
  app = await createTestApp();
  user = createTestUser({ role: "manager" });
});

afterEach(async () => {
  await app.close();
});

describe("advanceDueDate", () => {
  it("advances quarterly by 3 months, semiannual by 6, annual by 12", () => {
    expect(advanceDueDate("2026-01-15", "quarterly", null)).toBe("2026-04-15");
    expect(advanceDueDate("2026-01-15", "semiannual", null)).toBe("2026-07-15");
    expect(advanceDueDate("2026-01-15", "annual", null)).toBe("2027-01-15");
    expect(advanceDueDate("2026-01-15", "custom_days", 45)).toBe("2026-03-01");
  });
});

async function createProperty(): Promise<string> {
  const res = await app.app.inject({
    method: "POST",
    url: "/api/properties",
    headers: user.headers,
    payload: {
      name: "PM Test Property",
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

async function createTemplate(propertyId: string, frequency: string): Promise<PmTemplate> {
  const today = todayLocal(getEnv().APP_TIMEZONE);
  const res = await app.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/pm-templates`,
    headers: user.headers,
    payload: {
      title: `${frequency} maintenance`,
      frequency,
      anchorDate: today,
      leadDays: 14,
    },
  });
  return unwrap<PmTemplate>(res);
}

describe.each(["quarterly", "semiannual", "annual"] as const)("pm-generate job: %s frequency", (frequency) => {
  it("generates a work order when due within lead time, advances the schedule, and is a no-op on a second run", async () => {
    const propertyId = await createProperty();
    const template = await createTemplate(propertyId, frequency);
    const today = todayLocal(getEnv().APP_TIMEZONE);
    expect(template.nextDueDate).toBe(today);
    expect(template.lastGeneratedDate).toBeNull();

    await runJobNow("pm-generate");

    const woCountAfterFirst = (
      getDb().prepare(`SELECT COUNT(*) AS n FROM work_orders WHERE pm_template_id = ?`).get(template.id) as {
        n: number;
      }
    ).n;
    expect(woCountAfterFirst).toBe(1);

    const wo = getDb()
      .prepare(`SELECT source, due_date, status FROM work_orders WHERE pm_template_id = ?`)
      .get(template.id) as { source: string; due_date: string; status: string };
    expect(wo.source).toBe("pm");
    expect(wo.due_date).toBe(today);
    expect(wo.status).toBe("new");

    const refreshed = getDb().prepare(`SELECT next_due_date, last_generated_date FROM pm_templates WHERE id = ?`).get(
      template.id,
    ) as { next_due_date: string; last_generated_date: string };
    expect(refreshed.next_due_date).toBe(advanceDueDate(today, frequency, null));
    expect(refreshed.last_generated_date).toBe(today);

    // Second run the same day: nextDueDate has moved well past the lead window, so this must
    // be a true no-op -- no new work order, no further advancement.
    await runJobNow("pm-generate");
    const woCountAfterSecond = (
      getDb().prepare(`SELECT COUNT(*) AS n FROM work_orders WHERE pm_template_id = ?`).get(template.id) as {
        n: number;
      }
    ).n;
    expect(woCountAfterSecond).toBe(1);
    const refreshedAgain = getDb()
      .prepare(`SELECT next_due_date FROM pm_templates WHERE id = ?`)
      .get(template.id) as { next_due_date: string };
    expect(refreshedAgain.next_due_date).toBe(refreshed.next_due_date);
  });
});

it("manual generate endpoint reports skipped:true when not yet due", async () => {
  const propertyId = await createProperty();
  const today = todayLocal(getEnv().APP_TIMEZONE);
  const res = await app.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/pm-templates`,
    headers: user.headers,
    payload: {
      title: "Far future maintenance",
      frequency: "annual",
      anchorDate: addMonths(today, 6),
      leadDays: 7,
    },
  });
  const template = unwrap<PmTemplate>(res);
  // Body-less POST: Fastify throws FST_ERR_CTP_EMPTY_JSON_BODY if Content-Type: application/json
  // is present with an empty body, so drop it for this call.
  const { cookie, "x-csrf-token": csrf } = user.headers;
  const genRes = await app.app.inject({
    method: "POST",
    url: `/api/pm-templates/${template.id}/generate`,
    headers: { cookie, "x-csrf-token": csrf },
  });
  const body = unwrap<{ workOrder: unknown; skipped: boolean }>(genRes);
  expect(body.skipped).toBe(true);
  expect(body.workOrder).toBeNull();
});
