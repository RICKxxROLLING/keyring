import { statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../testing/harness.js";
import { getDb } from "../db/index.js";
import { bootstrapOwner, parseEnvelope, readGeneratedSetupToken, totpCodeFor } from "./test-support.js";

describe("setup / bootstrap", () => {
  let ctx: TestApp;

  afterEach(async () => {
    if (ctx) await ctx.close();
  });

  it("reports needsSetup: true on a virgin DB and writes a 0600 setup-token.txt", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "GET", url: "/api/setup/status" });
    expect(res.statusCode).toBe(200);
    const body = parseEnvelope<{ needsSetup: boolean }>(res);
    expect(body.data?.needsSetup).toBe(true);

    const tokenPath = join(ctx.dir, "setup-token.txt");
    const stat = statSync(tokenPath);
    expect(stat.isFile()).toBe(true);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
    const token = readGeneratedSetupToken(ctx.dir);
    expect(token.length).toBeGreaterThan(10);
  });

  it("bootstrap creates exactly one owner, returns an EnrollmentChallenge, and issues no session", async () => {
    ctx = await createTestApp();
    const setupToken = readGeneratedSetupToken(ctx.dir);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/setup/bootstrap",
      payload: {
        setupToken,
        email: "owner@example.test",
        handle: "owner",
        displayName: "Owner Test",
        password: "correct horse battery staple 42",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const body = parseEnvelope<{ userId: string; mfaToken: string; enrollment: { secret: string } }>(res);
    expect(body.data?.enrollment.secret).toBeTruthy();

    const db = getDb();
    const users = db.prepare(`SELECT role FROM users`).all() as { role: string }[];
    expect(users.length).toBe(1);
    expect(users[0]!.role).toBe("owner");
  });

  it("a second bootstrap attempt returns SETUP_ALREADY_DONE", async () => {
    ctx = await createTestApp();
    await bootstrapOwner(ctx.app, ctx.dir);
    const setupToken = readGeneratedSetupToken(ctx.dir);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/setup/bootstrap",
      payload: {
        setupToken,
        email: "second@example.test",
        handle: "second",
        displayName: "Second",
        password: "another very strong passphrase 1",
      },
    });
    expect(res.statusCode).toBe(409);
    const body = parseEnvelope<never>(res);
    expect(body.error?.code).toBe("SETUP_ALREADY_DONE");
  });

  it("a wrong setup token returns FORBIDDEN and is rate-limited", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/setup/bootstrap",
      payload: {
        setupToken: "definitely-not-the-real-token",
        email: "owner@example.test",
        handle: "owner",
        displayName: "Owner Test",
        password: "correct horse battery staple 42",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(parseEnvelope<never>(res).error?.code).toBe("FORBIDDEN");

    // Rate limit: exhaust the 10-per-5-minutes budget on this route.
    let sawRateLimited = false;
    for (let i = 0; i < 12; i++) {
      const r = await ctx.app.inject({
        method: "POST",
        url: "/api/setup/bootstrap",
        payload: {
          setupToken: "still-wrong",
          email: "owner@example.test",
          handle: "owner",
          displayName: "Owner Test",
          password: "correct horse battery staple 42",
        },
      });
      if (r.statusCode === 429) {
        sawRateLimited = true;
        expect(parseEnvelope<never>(r).error?.code).toBe("RATE_LIMITED");
        break;
      }
    }
    expect(sawRateLimited).toBe(true);
  });

  it("bootstrap/verify with a valid code issues the session cookie and 10 recovery codes; the secret is never re-exposed", async () => {
    ctx = await createTestApp();
    const setupToken = readGeneratedSetupToken(ctx.dir);
    const bootstrapRes = await ctx.app.inject({
      method: "POST",
      url: "/api/setup/bootstrap",
      payload: {
        setupToken,
        email: "owner@example.test",
        handle: "owner",
        displayName: "Owner Test",
        password: "correct horse battery staple 42",
      },
    });
    const { mfaToken, enrollment } = parseEnvelope<{ mfaToken: string; enrollment: { secret: string } }>(
      bootstrapRes,
    ).data!;
    const code = totpCodeFor(enrollment.secret, "owner@example.test");

    const verifyRes = await ctx.app.inject({
      method: "POST",
      url: "/api/setup/bootstrap/verify",
      payload: { mfaToken, code },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.headers["set-cookie"]).toBeDefined();
    const body = parseEnvelope<{ session: { user: { totpEnrolled: boolean } }; recovery: { codes: string[] } }>(
      verifyRes,
    );
    expect(body.data?.recovery.codes.length).toBe(10);
    expect(body.data?.session.user.totpEnrolled).toBe(true);
    expect(JSON.stringify(body.data)).not.toContain(enrollment.secret);

    const db = getDb();
    const row = db.prepare(`SELECT totp_secret, totp_enrolled_at FROM users`).get() as {
      totp_secret: string;
      totp_enrolled_at: string | null;
    };
    expect(row.totp_secret).toBe(enrollment.secret);
    expect(row.totp_enrolled_at).not.toBeNull();

    const codeHashes = db.prepare(`SELECT code_hash FROM recovery_codes`).all() as { code_hash: string }[];
    for (const { code_hash } of codeHashes) {
      for (const plain of body.data!.recovery.codes) expect(code_hash).not.toBe(plain);
    }
  });
});
