// server/auth/test-signin.test.ts — password-less sign-in on the test server,
// and every way it is kept off production.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../testing/harness.js";
import { loadEnv } from "../config/env.js";
import { isLanAddress } from "./test-signin.js";

const KEYS = ["KEYRING_TEST_SIGNIN", "KEYRING_INSTANCE", "APP_ORIGIN"] as const;
let saved: Record<string, string | undefined> = {};
let testApp: TestApp | null = null;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});
afterEach(async () => {
  if (testApp) await testApp.close();
  testApp = null;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function testServer(): Promise<TestApp> {
  process.env.KEYRING_INSTANCE = "test";
  process.env.KEYRING_TEST_SIGNIN = "1";
  testApp = await createTestApp(); // http://localhost:8080
  return testApp;
}

type Account = { id: string; displayName: string; role: string };

function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

describe("refusing to start where it could be reached", () => {
  it("without the test-server label", () => {
    process.env.KEYRING_TEST_SIGNIN = "1";
    delete process.env.KEYRING_INSTANCE;
    process.env.APP_ORIGIN = "http://10.0.0.5:8090";
    expect(() => loadEnv()).toThrow(/KEYRING_INSTANCE/);
  });

  it("on an https origin — which is what production's tunnel hostname is", () => {
    process.env.KEYRING_TEST_SIGNIN = "1";
    process.env.KEYRING_INSTANCE = "test";
    process.env.APP_ORIGIN = "https://keyring.example.com";
    expect(() => loadEnv()).toThrow(/https/);
  });
});

describe("production", () => {
  it("does not have the routes at all", async () => {
    delete process.env.KEYRING_TEST_SIGNIN;
    delete process.env.KEYRING_INSTANCE;
    testApp = await createTestApp();
    const res = await testApp.app.inject({ method: "GET", url: "/api/test/accounts" });
    expect(res.statusCode).toBe(404);
    const instance = await testApp.app.inject({ method: "GET", url: "/api/instance" });
    expect(unwrap<{ testSignIn: boolean }>(instance).testSignIn).toBe(false);
  });
});

describe("the test server", () => {
  it("has an owner and two managers, and no setup step", async () => {
    const t = await testServer();
    const accounts = unwrap<Account[]>(await t.app.inject({ method: "GET", url: "/api/test/accounts" }));
    expect(accounts.map((a) => a.role)).toEqual(["owner", "manager", "manager"]);
    const setup = await t.app.inject({ method: "GET", url: "/api/setup/status" });
    expect(unwrap<{ needsSetup: boolean }>(setup).needsSetup).toBe(false);
  });

  it("signs in with one click, into an ordinary session with owner rights", async () => {
    const t = await testServer();
    const [owner] = unwrap<Account[]>(await t.app.inject({ method: "GET", url: "/api/test/accounts" }));
    const res = await t.app.inject({
      method: "POST",
      url: "/api/test/sign-in",
      payload: { userId: owner!.id },
    });
    expect(res.statusCode).toBe(200);
    const { csrfToken } = unwrap<{ csrfToken: string }>(res);
    const cookie = cookieHeader(res.headers["set-cookie"]);

    const me = await t.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(unwrap<{ user: { displayName: string } }>(me).user.displayName).toBe("Test Owner");

    // Owner-only, CSRF-checked — the same rules as a password sign-in.
    const load = await t.app.inject({
      method: "POST",
      url: "/api/ops/demo",
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(load.statusCode).toBe(200);
    const noCsrf = await t.app.inject({ method: "POST", url: "/api/ops/demo", headers: { cookie } });
    expect(noCsrf.statusCode).toBe(403);
  });

  it("refuses a sign-in from outside the local network", async () => {
    const t = await testServer();
    const [owner] = unwrap<Account[]>(await t.app.inject({ method: "GET", url: "/api/test/accounts" }));
    const res = await t.app.inject({
      method: "POST",
      url: "/api/test/sign-in",
      payload: { userId: owner!.id },
      remoteAddress: "203.0.113.9",
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("only signs into test accounts — a real one still needs its password", async () => {
    const t = await testServer();
    const real = createTestUser({ role: "manager", handle: "someone-real" });
    const res = await t.app.inject({
      method: "POST",
      url: "/api/test/sign-in",
      payload: { userId: real.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it("gives the test accounts no password to guess", async () => {
    const t = await testServer();
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "test-owner@keyring.test", password: "!test-account-no-password" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("what counts as the local network", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.2.1.20", true],
    ["172.29.0.1", true],
    ["192.168.1.50", true],
    ["::1", true],
    ["::ffff:10.2.1.20", true],
    ["fd12:3456::1", true],
    ["203.0.113.9", false],
    ["172.32.0.1", false],
    ["::ffff:8.8.8.8", false],
    ["2606:4700::1111", false],
    ["", false],
  ])("%s → %s", (ip, expected) => {
    expect(isLanAddress(ip)).toBe(expected);
  });
});
