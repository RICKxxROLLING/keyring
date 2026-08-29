import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../testing/harness.js";
import { getDb } from "../db/index.js";
import { authHeaders, bootstrapOwner, parseEnvelope, totpCodeFor } from "./test-support.js";

describe("login (two-step)", () => {
  let ctx: TestApp;

  afterEach(async () => {
    if (ctx) await ctx.close();
  });

  it("password step returns only an mfaToken, never a session cookie", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: owner.email, password: owner.password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const body = parseEnvelope<{ mfaToken: string; expiresAt: string }>(res);
    expect(body.data?.mfaToken).toBeTruthy();
    expect(Object.keys(body.data ?? {}).sort()).toEqual(["expiresAt", "mfaToken"]);
  });

  it("a correct password with a wrong TOTP code never authenticates", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const loginRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: owner.email, password: owner.password },
    });
    const { mfaToken } = parseEnvelope<{ mfaToken: string }>(loginRes).data!;

    const totpRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login/totp",
      payload: { mfaToken, code: "000001" },
    });
    expect(totpRes.statusCode).toBe(403);
    expect(totpRes.headers["set-cookie"]).toBeUndefined();

    // The mfaToken from the original password step is unusable now, but a fresh
    // login + correct code must still succeed — a wrong TOTP guess must not have
    // corrupted the account.
    const loginRes2 = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: owner.email, password: owner.password },
    });
    const { mfaToken: mfaToken2 } = parseEnvelope<{ mfaToken: string }>(loginRes2).data!;
    const code = totpCodeFor(owner.totpSecret, owner.email);
    const okRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login/totp",
      payload: { mfaToken: mfaToken2, code },
    });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.headers["set-cookie"]).toBeDefined();
  });

  it("recovery-code login works exactly once per code and is audited", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const useCode = owner.recoveryCodes[0]!;

    const loginRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: owner.email, password: owner.password },
    });
    const { mfaToken } = parseEnvelope<{ mfaToken: string }>(loginRes).data!;
    const recRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login/recovery",
      payload: { mfaToken, recoveryCode: useCode },
    });
    expect(recRes.statusCode).toBe(200);
    expect(recRes.headers["set-cookie"]).toBeDefined();

    const db = getDb();
    const audited = db
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'recovery_used'`)
      .get() as { n: number };
    expect(audited.n).toBe(1);

    // Reusing the same code (fresh mfa challenge) must fail.
    const loginRes2 = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: owner.email, password: owner.password },
    });
    const { mfaToken: mfaToken2 } = parseEnvelope<{ mfaToken: string }>(loginRes2).data!;
    const reuseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login/recovery",
      payload: { mfaToken: mfaToken2, recoveryCode: useCode },
    });
    expect(reuseRes.statusCode).toBe(403);
  });

  it("CSRF: a POST with a valid session but no/incorrect X-CSRF-Token returns 403; a GET does not require it", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);

    const getRes = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: owner.sessionCookie },
    });
    expect(getRes.statusCode).toBe(200);

    const noTokenRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: owner.sessionCookie },
    });
    expect(noTokenRes.statusCode).toBe(403);
    expect(parseEnvelope<never>(noTokenRes).error?.code).toBe("FORBIDDEN");

    const wrongTokenRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie: owner.sessionCookie, "x-csrf-token": "not-the-real-token" },
    });
    expect(wrongTokenRes.statusCode).toBe(403);
  });

  it("lockout: AUTH_MAX_ATTEMPTS failed logins for one account lock it out with a retryAfter", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: owner.email, password: "definitely the wrong password" },
      });
      lastStatus = res.statusCode;
      if (res.statusCode === 423) {
        const body = parseEnvelope<never>(res);
        expect(body.error?.code).toBe("LOCKED_OUT");
        expect(body.error?.retryAfter).toBeGreaterThan(0);
        break;
      }
    }
    expect(lastStatus).toBe(423);

    const db = getDb();
    const lockout = db.prepare(`SELECT key FROM lockouts WHERE key = ?`).get(`email:${owner.email}`);
    expect(lockout).toBeTruthy();

    // A correct password is also rejected while locked out.
    const stillLocked = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: owner.email, password: owner.password },
    });
    expect(stillLocked.statusCode).toBe(423);
  });

  it("records the client IP via req.ip (trustProxy honors X-Forwarded-For)", async () => {
    ctx = await createTestApp();
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "x-forwarded-for": "203.0.113.7" },
      payload: { email: "nobody@example.test", password: "whatever-password-12345" },
    });
    const db = getDb();
    const row = db
      .prepare(`SELECT ip FROM auth_attempts WHERE key = ? ORDER BY at DESC LIMIT 1`)
      .get("email:nobody@example.test") as { ip: string | null } | undefined;
    expect(row?.ip).toBe("203.0.113.7");
  });

  it("security headers are present on every response", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "GET", url: "/api/setup/status" });
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("same-origin");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("logout revokes the session immediately for subsequent requests, and is audited", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const logoutRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: authHeaders(owner),
    });
    expect(logoutRes.statusCode).toBe(200);

    const meRes = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: owner.sessionCookie },
    });
    expect(meRes.statusCode).toBe(401);

    const db = getDb();
    const actions = db.prepare(`SELECT action FROM audit_log ORDER BY at`).all() as { action: string }[];
    const names = actions.map((a) => a.action);
    expect(names).toContain("login");
    expect(names).toContain("logout");
  });

  it("password change is audited as password_changed and rejects a wrong current password", async () => {
    ctx = await createTestApp();
    const owner = await bootstrapOwner(ctx.app, ctx.dir);
    const badRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: authHeaders(owner),
      payload: { currentPassword: "not it", newPassword: "brand new passphrase 99" },
    });
    expect(badRes.statusCode).toBe(403);

    const okRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: authHeaders(owner),
      payload: { currentPassword: owner.password, newPassword: "brand new passphrase 99" },
    });
    expect(okRes.statusCode).toBe(200);

    const db = getDb();
    const audited = db
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'password_changed'`)
      .get() as { n: number };
    expect(audited.n).toBe(1);
  });
});
