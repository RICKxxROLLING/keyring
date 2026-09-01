// server/auth/remove-user.test.ts — DELETE /api/users/:id and its three guards.
//
// Deletion is the one irreversible thing an owner can do to another person's
// account, so each guard is tested for what it protects rather than just for
// its status code. The reference guard especially: it is what stands between
// "remove this test account" and quietly destroying who-did-what across a
// portfolio's history.
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../testing/harness.js";
import { getDb } from "../db/index.js";
import { authHeaders, bootstrapOwner, issueAndAcceptInvite, parseEnvelope } from "./test-support.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";

/** app.inject() sends no body here, so the JSON content-type must not be set. */
function bodyless(h: Record<string, string>): Record<string, string> {
  const rest = { ...h };
  delete rest["content-type"];
  return rest;
}

function deactivate(id: string): void {
  getDb().prepare(`UPDATE users SET is_active = 0 WHERE id = ?`).run(id);
}

describe("removing a user", () => {
  let ctx: TestApp;

  afterEach(async () => {
    if (ctx) await ctx.close();
  });

  it("refuses a manager (owner-only)", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const manager = await issueAndAcceptInvite(ctx.app, owner);
    deactivate(owner.userId);

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/users/${owner.userId}`,
      headers: bodyless(authHeaders(manager)),
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses an anonymous caller", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const res = await ctx.app.inject({ method: "DELETE", url: `/api/users/${owner.userId}` });
    expect(res.statusCode).toBe(401);
  });

  it("refuses an account that is still active — deactivate first", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const manager = await issueAndAcceptInvite(ctx.app, owner);

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/users/${manager.userId}`,
      headers: bodyless(authHeaders(owner)),
    });
    expect(res.statusCode).toBe(409);
    expect(parseEnvelope<never>(res).error?.message).toMatch(/deactivate/i);

    // Still there, untouched.
    const still = getDb().prepare(`SELECT id FROM users WHERE id = ?`).get(manager.userId);
    expect(still).toBeDefined();
  });

  it("refuses the account you are signed in as", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);

    // Signed in, so necessarily still active — a deactivated session cannot
    // authenticate at all, which is why the self-check is ordered before the
    // deactivate-first check rather than after it. Without that ordering this
    // would refuse with "deactivate first", advice that leads nowhere: doing so
    // would lock the owner out rather than let them proceed.
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/users/${owner.userId}`,
      headers: bodyless(authHeaders(owner)),
    });
    expect(res.statusCode).toBe(409);
    expect(parseEnvelope<never>(res).error?.message).toMatch(/signed in as/i);
    expect(getDb().prepare(`SELECT id FROM users WHERE id = ?`).get(owner.userId)).toBeDefined();
  });

  it("removes a deactivated account and the spent invite that created it", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const manager = await issueAndAcceptInvite(ctx.app, owner);
    deactivate(manager.userId);

    // The invite pointing at them is exactly what blocked this at the CLI:
    // invites.accepted_user_id is a foreign key with no ON DELETE rule.
    const invitesBefore = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM invites WHERE accepted_user_id = ?`)
      .get(manager.userId) as { n: number };
    expect(invitesBefore.n).toBe(1);

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/users/${manager.userId}`,
      headers: bodyless(authHeaders(owner)),
    });
    expect(res.statusCode).toBe(200);
    expect(parseEnvelope<{ invitesCleared: number }>(res).data?.invitesCleared).toBe(1);

    const db = getDb();
    expect(db.prepare(`SELECT id FROM users WHERE id = ?`).get(manager.userId)).toBeUndefined();
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM invites WHERE accepted_user_id = ?`).get(manager.userId) as { n: number }).n,
    ).toBe(0);
    // Their sessions go with them, by cascade.
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`).get(manager.userId) as { n: number }).n,
    ).toBe(0);
    // The owner is untouched.
    expect(db.prepare(`SELECT id FROM users WHERE id = ?`).get(owner.userId)).toBeDefined();
  });

  it("refuses an account that authored records, and names what they are", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const manager = await issueAndAcceptInvite(ctx.app, owner);

    const db = getDb();
    const at = nowIso();
    db.prepare(
      `INSERT INTO properties (id, name, address_line1, city, state, postal_code, country,
         property_type, sort_order, created_at, updated_at, created_by, updated_by, version)
       VALUES (?, 'Theirs', '1 Main St', 'Springfield', 'OH', '45501', 'US', 'single_family', 0, ?, ?, ?, ?, 1)`,
    ).run(newId("prp"), at, at, manager.userId, manager.userId);

    deactivate(manager.userId);

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/users/${manager.userId}`,
      headers: bodyless(authHeaders(owner)),
    });
    expect(res.statusCode).toBe(409);
    const msg = parseEnvelope<never>(res).error?.message ?? "";
    expect(msg).toMatch(/properties/);
    expect(msg).toMatch(/deactivated/i);

    // The account and its work both survive the refusal.
    expect(db.prepare(`SELECT id FROM users WHERE id = ?`).get(manager.userId)).toBeDefined();
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM properties`).get() as { n: number }).n,
    ).toBe(1);
  });

  it("404s for an id that does not exist", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/users/usr_00000000000000000000000000`,
      headers: bodyless(authHeaders(owner)),
    });
    expect(res.statusCode).toBe(404);
  });

  it("writes an audit entry that outlives the account", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const manager = await issueAndAcceptInvite(ctx.app, owner);
    deactivate(manager.userId);

    await ctx.app.inject({
      method: "DELETE",
      url: `/api/users/${manager.userId}`,
      headers: bodyless(authHeaders(owner)),
    });

    const entry = getDb()
      .prepare(
        `SELECT actor_label, summary FROM audit_log
          WHERE entity_type = 'user' AND entity_id = ? AND action = 'delete'`,
      )
      .get(manager.userId) as { actor_label: string; summary: string } | undefined;
    expect(entry).toBeDefined();
    expect(entry!.summary).toMatch(/Removed the deactivated account/);
    // actor_label is a text snapshot, so the record still reads properly even
    // once the actor's own row is gone.
    expect(entry!.actor_label.length).toBeGreaterThan(0);
  });
});
