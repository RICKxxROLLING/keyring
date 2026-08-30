// server/domain/workorders/workorders.test.ts — status flow, completedAt stamping, per-property
// sequential numbering, comment thread with mention notifications.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../../testing/harness.js";
import { setNotifier, type NotifyMentionsInput } from "../../seams.js";
import type { WorkOrderStatus, WorkOrderView } from "../../../shared/types.js";

let app: TestApp;
let user: TestUser;
let mentions: NotifyMentionsInput[];

beforeEach(async () => {
  app = await createTestApp();
  user = createTestUser({ role: "manager" });
  mentions = [];
  setNotifier({ notifyMentions: (i) => mentions.push(i), notifyUsers: () => {} });
});

afterEach(async () => {
  await app.close();
});

function noBody(u: TestUser): Record<string, string> {
  const { cookie, "x-csrf-token": csrf } = u.headers;
  return { cookie, "x-csrf-token": csrf };
}

async function createProperty(): Promise<string> {
  const res = await app.app.inject({
    method: "POST",
    url: "/api/properties",
    headers: user.headers,
    payload: {
      name: "WO Test Property",
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

const ALL_STATUSES: WorkOrderStatus[] = ["new", "triaged", "scheduled", "in_progress", "done", "cancelled"];

describe("work order status flow", () => {
  it("moves through every status; done stamps completedAt; leaving done clears it", async () => {
    const propertyId = await createProperty();
    const createRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/work-orders`,
      headers: user.headers,
      payload: { title: "Leaking sink", status: "new", priority: "normal" },
    });
    let wo = unwrap<WorkOrderView>(createRes);
    expect(wo.status).toBe("new");
    expect(wo.completedAt).toBeNull();

    for (const status of ALL_STATUSES) {
      const res = await app.app.inject({
        method: "PATCH",
        url: `/api/work-orders/${wo.id}`,
        headers: user.headers,
        payload: { status, expectedVersion: wo.version },
      });
      expect(res.statusCode).toBe(200);
      wo = unwrap<WorkOrderView>(res);
      expect(wo.status).toBe(status);
      if (status === "done") {
        expect(wo.completedAt).not.toBeNull();
      }
    }
    // Last status in the loop is 'cancelled' (off 'done'); completedAt must be cleared.
    expect(wo.status).toBe("cancelled");
    expect(wo.completedAt).toBeNull();
  });

  it("assigns a per-property sequential, unique number", async () => {
    const propertyA = await createProperty();
    const propertyB = await createProperty();
    const numbersA: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.app.inject({
        method: "POST",
        url: `/api/properties/${propertyA}/work-orders`,
        headers: user.headers,
        payload: { title: `WO ${i}`, status: "new", priority: "normal" },
      });
      numbersA.push(unwrap<WorkOrderView>(res).number);
    }
    expect(numbersA).toEqual([1, 2, 3]);

    const bRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyB}/work-orders`,
      headers: user.headers,
      payload: { title: "First in B", status: "new", priority: "normal" },
    });
    // Numbering is per-property, so property B starts at 1 again even though A is at 3.
    expect(unwrap<WorkOrderView>(bRes).number).toBe(1);
  });

  it("comment thread supports create, edit, delete, and notifies @mentions", async () => {
    const propertyId = await createProperty();
    const woRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/work-orders`,
      headers: user.headers,
      payload: { title: "Broken window", status: "new", priority: "normal" },
    });
    const wo = unwrap<WorkOrderView>(woRes);

    const createRes = await app.app.inject({
      method: "POST",
      url: `/api/work-orders/${wo.id}/comments`,
      headers: user.headers,
      payload: { body: "Assigning to @dana, please take a look" },
    });
    expect(createRes.statusCode).toBe(201);
    const comment = unwrap<{ id: string; body: string; version: number }>(createRes);
    expect(mentions.length).toBe(1);
    expect(mentions[0]!.bodyText).toContain("@dana");

    const listRes = await app.app.inject({
      method: "GET",
      url: `/api/work-orders/${wo.id}/comments`,
      headers: noBody(user),
    });
    const list = unwrap<{ items: { id: string }[] }>(listRes);
    expect(list.items.some((c) => c.id === comment.id)).toBe(true);

    const editRes = await app.app.inject({
      method: "PATCH",
      url: `/api/work-order-comments/${comment.id}`,
      headers: user.headers,
      payload: { body: "Edited: assigning to @dana", expectedVersion: comment.version },
    });
    expect(editRes.statusCode).toBe(200);

    const deleteRes = await app.app.inject({
      method: "DELETE",
      url: `/api/work-order-comments/${comment.id}`,
      headers: noBody(user),
    });
    expect(deleteRes.statusCode).toBe(200);

    const listAfterDelete = await app.app.inject({
      method: "GET",
      url: `/api/work-orders/${wo.id}/comments`,
      headers: noBody(user),
    });
    const listAfter = unwrap<{ items: { id: string }[] }>(listAfterDelete);
    expect(listAfter.items.some((c) => c.id === comment.id)).toBe(false);
  });
});
