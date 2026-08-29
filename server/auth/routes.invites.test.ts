import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../testing/harness.js";
import { getDb } from "../db/index.js";
import { newToken } from "../lib/ids.js";
import { hashToken } from "./middleware.js";
import { authHeaders, bootstrapOwner, issueAndAcceptInvite, parseEnvelope } from "./test-support.js";

describe("invites", () => {
  let ctx: TestApp;

  afterEach(async () => {
    if (ctx) await ctx.close();
  });

  it("end to end: issue, preview (unauthenticated), accept, enrolls TOTP, burns the invite", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);

    const inviteRes = await ctx.app.inject({
      method: "POST",
      url: "/api/invites",
      headers: authHeaders(owner),
      payload: { email: "manager@example.test", role: "manager" },
    });
    expect(inviteRes.statusCode).toBe(200);
    const invite = parseEnvelope<{ inviteUrl: string }>(inviteRes).data!;
    const token = invite.inviteUrl.split("/invite/")[1]!;

    const previewRes = await ctx.app.inject({ method: "GET", url: `/api/invites/${token}/preview` });
    expect(previewRes.statusCode).toBe(200);
    const preview = parseEnvelope<{ email: string; role: string; valid: boolean }>(previewRes).data!;
    expect(preview.email).toBe("manager@example.test");
    expect(preview.role).toBe("manager");
    expect(preview.valid).toBe(true);

    const manager = await issueAndAcceptInvite(ctx.app, owner, {
      email: "manager@example.test",
      handle: "mgr1",
      displayName: "Manager One",
    });
    expect(manager.userId).toBeTruthy();

    const db = getDb();
    const row = db.prepare(`SELECT role, totp_enrolled_at FROM users WHERE id = ?`).get(manager.userId) as {
      role: string;
      totp_enrolled_at: string | null;
    };
    expect(row.role).toBe("manager");
    expect(row.totp_enrolled_at).not.toBeNull();

    // The invite is burned: reusing the accept endpoint fails.
    const reuseRes = await ctx.app.inject({
      method: "POST",
      url: `/api/invites/${token}/accept`,
      payload: { handle: "mgr2", displayName: "Manager Two", password: "another very strong passphrase 1" },
    });
    expect(reuseRes.statusCode).toBe(404);
  });

  it("revoking, and an expired token, both yield the same NOT_FOUND as reuse", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);

    const inviteRes = await ctx.app.inject({
      method: "POST",
      url: "/api/invites",
      headers: authHeaders(owner),
      payload: { email: "revoke-me@example.test", role: "manager" },
    });
    const invite = parseEnvelope<{ id: string; inviteUrl: string }>(inviteRes).data!;
    const token = invite.inviteUrl.split("/invite/")[1]!;

    const delRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/invites/${invite.id}`,
      headers: authHeaders(owner),
    });
    expect(delRes.statusCode).toBe(200);

    const previewRes = await ctx.app.inject({ method: "GET", url: `/api/invites/${token}/preview` });
    expect(previewRes.statusCode).toBe(404);
    expect(parseEnvelope<never>(previewRes).error?.code).toBe("NOT_FOUND");

    const acceptRes = await ctx.app.inject({
      method: "POST",
      url: `/api/invites/${token}/accept`,
      payload: { handle: "revoked", displayName: "Revoked", password: "another very strong passphrase 1" },
    });
    expect(acceptRes.statusCode).toBe(404);
    expect(parseEnvelope<never>(acceptRes).error?.code).toBe("NOT_FOUND");

    // Expired: manufacture an already-expired invite directly, with a real token/hash pair.
    const db = getDb();
    const expiredToken = newToken();
    db.prepare(
      `INSERT INTO invites (id, email, role, token_hash, created_by, created_at, expires_at)
       VALUES ('inv_expired00000000000000a', 'expired@example.test', 'manager', ?, ?, ?, ?)`,
    ).run(
      hashToken(expiredToken),
      owner.userId,
      new Date(Date.now() - 3_600_000).toISOString(),
      new Date(Date.now() - 1_800_000).toISOString(),
    );
    const expiredPreview = await ctx.app.inject({
      method: "GET",
      url: `/api/invites/${expiredToken}/preview`,
    });
    expect(expiredPreview.statusCode).toBe(404);
    expect(parseEnvelope<never>(expiredPreview).error?.code).toBe("NOT_FOUND");

    const expiredAccept = await ctx.app.inject({
      method: "POST",
      url: `/api/invites/${expiredToken}/accept`,
      payload: { handle: "expired1", displayName: "Expired", password: "another very strong passphrase 1" },
    });
    expect(expiredAccept.statusCode).toBe(404);
  });

  it("owner-only: a manager session gets 403 from issuing and revoking invites", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const manager = await issueAndAcceptInvite(ctx.app, owner);

    const issueRes = await ctx.app.inject({
      method: "POST",
      url: "/api/invites",
      headers: authHeaders(manager),
      payload: { email: "someone@example.test", role: "manager" },
    });
    expect(issueRes.statusCode).toBe(403);
    expect(parseEnvelope<never>(issueRes).error?.code).toBe("FORBIDDEN");

    const listRes = await ctx.app.inject({
      method: "POST",
      url: "/api/invites",
      headers: authHeaders(owner),
      payload: { email: "target@example.test", role: "manager" },
    });
    const invite = parseEnvelope<{ id: string }>(listRes).data!;
    const revokeRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/invites/${invite.id}`,
      headers: authHeaders(manager),
    });
    expect(revokeRes.statusCode).toBe(403);
  });

  it("rejects a duplicate open invite and a duplicate email that already has an account", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);

    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/invites",
      headers: authHeaders(owner),
      payload: { email: "dupe@example.test", role: "manager" },
    });
    expect(first.statusCode).toBe(200);
    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/invites",
      headers: authHeaders(owner),
      payload: { email: "dupe@example.test", role: "manager" },
    });
    expect(second.statusCode).toBe(409);

    const third = await ctx.app.inject({
      method: "POST",
      url: "/api/invites",
      headers: authHeaders(owner),
      payload: { email: owner.email, role: "manager" },
    });
    expect(third.statusCode).toBe(409);
  });
});
