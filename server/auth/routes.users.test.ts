import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../testing/harness.js";
import { getDb } from "../db/index.js";
import { authHeaders, bootstrapOwner, issueAndAcceptInvite, parseEnvelope, totpCodeFor } from "./test-support.js";

describe("users", () => {
  let ctx: TestApp;

  afterEach(async () => {
    if (ctx) await ctx.close();
  });

  it("owner-only: a manager session gets 403 from PATCH /api/users/:id and POST totp/reset", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const manager = await issueAndAcceptInvite(ctx.app, owner);

    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${owner.userId}`,
      headers: authHeaders(manager),
      payload: { displayName: "Hijacked", expectedVersion: 1 },
    });
    expect(patchRes.statusCode).toBe(403);
    expect(parseEnvelope<never>(patchRes).error?.code).toBe("FORBIDDEN");

    const resetRes = await ctx.app.inject({
      method: "POST",
      url: `/api/users/${owner.userId}/totp/reset`,
      headers: authHeaders(manager),
    });
    expect(resetRes.statusCode).toBe(403);
  });

  it("an owner cannot demote or deactivate themselves as the only active owner (CONFLICT)", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);

    const demoteRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${owner.userId}`,
      headers: authHeaders(owner),
      payload: { role: "manager", expectedVersion: 1 },
    });
    expect(demoteRes.statusCode).toBe(409);
    expect(parseEnvelope<never>(demoteRes).error?.code).toBe("CONFLICT");

    const deactivateRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${owner.userId}`,
      headers: authHeaders(owner),
      payload: { isActive: false, expectedVersion: 1 },
    });
    expect(deactivateRes.statusCode).toBe(409);
  });

  it("allows demoting an owner once a second active owner exists", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    // issueAndAcceptInvite always issues a manager-role invite; promote afterward via the
    // DB directly to set up the "two active owners" scenario this test needs.
    const secondOwner = await issueAndAcceptInvite(ctx.app, owner, {
      email: "owner2@example.test",
      handle: "owner2",
      displayName: "Owner Two",
    });
    const db = getDb();
    db.prepare(`UPDATE users SET role = 'owner' WHERE id = ?`).run(secondOwner.userId);

    const demoteRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${owner.userId}`,
      headers: authHeaders(owner),
      payload: { role: "manager", expectedVersion: 1 },
    });
    expect(demoteRes.statusCode).toBe(200);
  });

  it("PATCH /api/users/:id enforces optimistic concurrency (VERSION_CONFLICT)", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const manager = await issueAndAcceptInvite(ctx.app, owner);

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${manager.userId}`,
      headers: authHeaders(owner),
      payload: { displayName: "Renamed", expectedVersion: 99 },
    });
    expect(res.statusCode).toBe(409);
    expect(parseEnvelope<never>(res).error?.code).toBe("VERSION_CONFLICT");
  });

  it("PATCH /api/users/me lets a user update their own profile", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/users/me",
      headers: authHeaders(owner),
      payload: { displayName: "New Name", expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(200);
    const body = parseEnvelope<{ displayName: string }>(res);
    expect(body.data?.displayName).toBe("New Name");
  });

  it("totp/reset on another user is CONFLICT when targeting yourself", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/users/${owner.userId}/totp/reset`,
      headers: authHeaders(owner),
    });
    expect(res.statusCode).toBe(409);
  });

  it("totp/reset re-arms enrollment, KEEPS recovery codes, revokes sessions, and is audited", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const manager = await issueAndAcceptInvite(ctx.app, owner);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/users/${manager.userId}/totp/reset`,
      headers: authHeaders(owner),
    });
    expect(res.statusCode).toBe(200);

    const db = getDb();
    const row = db
      .prepare(`SELECT totp_secret, totp_enrolled_at FROM users WHERE id = ?`)
      .get(manager.userId) as { totp_secret: string | null; totp_enrolled_at: string | null };
    // A FRESH secret is issued rather than nulled. Nulling it left the account
    // with no re-enrollment path at all — completeEnrollment() needs an
    // "enroll" challenge against an existing secret, and only bootstrap and
    // invite-accept could mint one — so the account dropped to single factor
    // and became permanently locked out once its recovery codes were spent.
    expect(row.totp_secret).toBeTruthy();
    // ...but they are NOT enrolled: this is what makes POST /api/auth/login
    // hand back an EnrollmentChallenge instead of a login challenge.
    expect(row.totp_enrolled_at).toBeNull();

    // Recovery codes SURVIVE the reset, and that is the point.
    //
    // An earlier version cleared them here, with a comment claiming it avoided
    // a single-factor window. It created one: /api/auth/login hands the new
    // TOTP secret to whoever presents the password, so with the codes also
    // gone, a stolen password alone would enroll and take the account. The
    // codes are the surviving second factor, and re-enrollment consumes one.
    const codes = db
      .prepare(`SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL`)
      .get(manager.userId) as { n: number };
    expect(codes.n).toBe(10);

    const meRes = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: manager.sessionCookie },
    });
    expect(meRes.statusCode).toBe(401);

    const audited = db
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'totp_reset'`)
      .get() as { n: number };
    expect(audited.n).toBe(1);
  });

  it("re-enrollment after a reset REQUIRES a valid recovery code", async () => {
    // The security property this endpoint exists to preserve. /api/auth/login
    // hands the new TOTP secret to anyone with the password, so the recovery
    // code is the only thing standing between a stolen password and a taken
    // account during the reset window.
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const manager = await issueAndAcceptInvite(ctx.app, owner);

    await ctx.app.inject({
      method: "POST",
      url: `/api/users/${manager.userId}/totp/reset`,
      headers: authHeaders(owner),
    });

    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: manager.email, password: manager.password },
    });
    const body = login.json() as {
      data: { mfaToken: string; enrollment?: { secret: string } };
    };
    const goodTotp = totpCodeFor(body.data.enrollment!.secret, manager.email);

    // A correct TOTP code from the handed-out secret is NOT enough on its own.
    const wrongCode = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login/enroll",
      headers: { "content-type": "application/json" },
      payload: { mfaToken: body.data.mfaToken, code: goodTotp, recoveryCode: "aaaaa-bbbbb" },
    });
    expect(wrongCode.statusCode).toBe(403);
    expect(wrongCode.headers["set-cookie"]).toBeUndefined();

    // Omitting it entirely is a validation failure, not a way around it.
    const missing = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login/enroll",
      headers: { "content-type": "application/json" },
      payload: { mfaToken: body.data.mfaToken, code: goodTotp },
    });
    expect(missing.statusCode).toBe(422);

    // Still not enrolled, so the account was not taken.
    const after = getDb()
      .prepare(`SELECT totp_enrolled_at FROM users WHERE id = ?`)
      .get(manager.userId) as { totp_enrolled_at: string | null };
    expect(after.totp_enrolled_at).toBeNull();
  });

  it("a user whose TOTP was reset can re-enroll themselves and sign back in", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const manager = await issueAndAcceptInvite(ctx.app, owner);

    await ctx.app.inject({
      method: "POST",
      url: `/api/users/${manager.userId}/totp/reset`,
      headers: authHeaders(owner),
    });

    // Password login now returns an ENROLL challenge with the new otpauth URI
    // instead of a login challenge the user could never satisfy.
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: manager.email, password: manager.password },
    });
    expect(login.statusCode).toBe(200);
    const body = login.json() as {
      data: { mfaToken: string; enrollment?: { secret: string; otpauthUrl: string } };
    };
    expect(body.data.enrollment).toBeTruthy();
    expect(body.data.enrollment!.otpauthUrl).toContain("otpauth://totp/");

    // Confirming a code from the new secret enrolls them and signs them in.
    const verify = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login/enroll",
      headers: { "content-type": "application/json" },
      payload: {
        mfaToken: body.data.mfaToken,
        code: totpCodeFor(body.data.enrollment!.secret, manager.email),
        // Two factors: the password got the secret, a recovery code proves
        // this is the account owner and not someone who knows the password.
        recoveryCode: manager.recoveryCodes[0],
      },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.headers["set-cookie"]).toBeTruthy();

    const db2 = getDb();
    const after = db2
      .prepare(`SELECT totp_enrolled_at FROM users WHERE id = ?`)
      .get(manager.userId) as { totp_enrolled_at: string | null };
    expect(after.totp_enrolled_at).toBeTruthy();

    // And a fresh set of recovery codes replaces the ones the reset voided.
    const codes = db2
      .prepare(`SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL`)
      .get(manager.userId) as { n: number };
    expect(codes.n).toBe(10);
  });
});
