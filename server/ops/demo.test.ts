// server/ops/demo.test.ts — the demo toggle keeps its promise.
//
// The ask was "toggle demo data on and off WITHOUT wiping the database of
// users". The whole feature is worthless if removal takes an account with it,
// and worse than worthless if it takes real work, so both are asserted here
// rather than left to a careful reading of the SQL.
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../testing/harness.js";
import { getDb } from "../db/index.js";
import { getDemoStatus, loadDemoData, removeDemoData } from "./demo.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";

function bodyless(h: Record<string, string>): Record<string, string> {
  const rest = { ...h };
  delete rest["content-type"];
  return rest;
}

/** A property nobody seeded — stands in for work typed into a demo build. */
function insertRealProperty(ownerId: string, name: string): string {
  const id = newId("prp");
  const at = nowIso();
  getDb()
    .prepare(
      `INSERT INTO properties (id, name, address_line1, city, state, postal_code, country,
         property_type, sort_order, created_at, updated_at, created_by, updated_by, version, is_demo)
       VALUES (?, ?, '1 Real St', 'Springfield', 'OH', '45501', 'US', 'single_family', 99, ?, ?, ?, ?, 1, 0)`,
    )
    .run(id, name, at, at, ownerId, ownerId);
  return id;
}

describe("demo data toggle", () => {
  let testApp: TestApp | null = null;

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  it("reports nothing present on an empty portfolio", async () => {
    testApp = await createTestApp();
    const status = getDemoStatus();
    expect(status.present).toBe(false);
    expect(status.properties).toBe(0);
    expect(status.realProperties).toBe(0);
  });

  it("removing the demo leaves every user account intact", async () => {
    testApp = await createTestApp();
    const owner = createTestUser({ role: "owner" });
    const manager = createTestUser({ role: "manager" });

    const loaded = await loadDemoData();
    expect(loaded.loaded).toBe(true);
    expect(getDemoStatus().properties).toBeGreaterThan(0);

    const usersBefore = getDb().prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };

    removeDemoData();

    const usersAfter = getDb().prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
    expect(usersAfter.n).toBe(usersBefore.n);

    // Named, not just counted: a count would pass if removal deleted one user
    // and the seed's adopted owner happened to be recreated.
    for (const u of [owner, manager]) {
      const row = getDb().prepare(`SELECT id, is_active FROM users WHERE id = ?`).get(u.id) as
        | { id: string; is_active: number }
        | undefined;
      expect(row).toBeDefined();
      expect(row!.is_active).toBe(1);
    }

    expect(getDemoStatus().present).toBe(false);
  });

  it("removing the demo leaves real properties and their dossiers alone", async () => {
    testApp = await createTestApp();
    const owner = createTestUser({ role: "owner" });

    await loadDemoData();
    const realId = insertRealProperty(owner.id, "The one I actually own");

    const noteId = newId("not");
    const at = nowIso();
    getDb()
      .prepare(
        `INSERT INTO notes (id, property_id, unit_id, title, body, pinned, created_at, updated_at,
           created_by, updated_by, version)
         VALUES (?, ?, NULL, NULL, 'Real note on a real property', 0, ?, ?, ?, ?, 1)`,
      )
      .run(noteId, realId, at, at, owner.id, owner.id);

    const removed = removeDemoData();
    expect(removed.properties).toBe(5);

    const survivor = getDb().prepare(`SELECT name FROM properties WHERE id = ?`).get(realId) as
      | { name: string }
      | undefined;
    expect(survivor?.name).toBe("The one I actually own");

    const note = getDb().prepare(`SELECT body FROM notes WHERE id = ?`).get(noteId) as
      | { body: string }
      | undefined;
    expect(note?.body).toBe("Real note on a real property");

    // The demo's dossiers are gone with their properties, via ON DELETE CASCADE.
    const orphans = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM notes WHERE property_id != ?`)
      .get(realId) as { n: number };
    expect(orphans.n).toBe(0);
  });

  it("keeps a demo vendor that real work still references, and stops calling it demo", async () => {
    testApp = await createTestApp();
    const owner = createTestUser({ role: "owner" });

    await loadDemoData();
    const realId = insertRealProperty(owner.id, "Real one");
    const vendorId = (getDb().prepare(`SELECT id FROM vendors WHERE is_demo = 1 LIMIT 1`).get() as {
      id: string;
    }).id;

    const woId = newId("wo");
    const at = nowIso();
    getDb()
      .prepare(
        `INSERT INTO work_orders (id, property_id, unit_id, number, title, description, status,
           priority, assignee_id, vendor_id, created_at, updated_at, created_by, updated_by, version)
         VALUES (?, ?, NULL, 9001, 'Real job', NULL, 'new', 'normal', NULL, ?, ?, ?, ?, ?, 1)`,
      )
      .run(woId, realId, vendorId, at, at, owner.id, owner.id);

    removeDemoData();

    // Every vendor_id FK is ON DELETE SET NULL, so deleting this vendor would
    // have silently blanked a real assignment.
    const wo = getDb().prepare(`SELECT vendor_id FROM work_orders WHERE id = ?`).get(woId) as {
      vendor_id: string | null;
    };
    expect(wo.vendor_id).toBe(vendorId);

    const vendor = getDb().prepare(`SELECT is_demo FROM vendors WHERE id = ?`).get(vendorId) as {
      is_demo: number;
    };
    expect(vendor.is_demo).toBe(0);
    expect(getDemoStatus().present).toBe(false);
  });

  it("only the owner can read or change demo data", async () => {
    testApp = await createTestApp();
    const manager = createTestUser({ role: "manager" });

    for (const [method, url] of [
      ["GET", "/api/ops/demo"],
      ["POST", "/api/ops/demo"],
      ["DELETE", "/api/ops/demo"],
    ] as const) {
      const res = await testApp.app.inject({ method, url, headers: bodyless(manager.headers) });
      expect(res.statusCode).toBe(403);
    }

    const anon = await testApp.app.inject({ method: "GET", url: "/api/ops/demo" });
    expect(anon.statusCode).toBe(401);
  });

  it("POST is a no-op when the portfolio already has properties", async () => {
    testApp = await createTestApp();
    const owner = createTestUser({ role: "owner" });
    insertRealProperty(owner.id, "Already here");

    const res = await testApp.app.inject({
      method: "POST",
      url: "/api/ops/demo",
      headers: bodyless(owner.headers),
    });
    expect(res.statusCode).toBe(200);
    const body = unwrap<{ loaded: boolean }>(res);
    expect(body.loaded).toBe(false);
    expect(getDemoStatus().properties).toBe(0);
  });
});
