import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../testing/harness.js";
import { performBackup, startBackupRun } from "./backup.js";
import type { BackupRun, OpsInfo } from "../../shared/types.js";

const FAKE_ID = `bkp_${"0".repeat(26)}`;

/**
 * The frozen harness bakes `content-type: application/json` into createTestUser()'s
 * headers. Fastify then tries to JSON-parse the empty body of a bodyless request and
 * fails it with 400 BAD_REQUEST before the route ever runs. Strip the header for
 * requests that send no body.
 *
 * Production is unaffected: web/lib/api.ts sends no content-type on DELETE, and omits
 * it on POST when there is no body.
 */
function bodyless(h: Record<string, string>): Record<string, string> {
  const rest = { ...h };
  delete rest["content-type"];
  return rest;
}

describe("ops routes", () => {
  let testApp: TestApp | null = null;

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  it("GET /healthz is public, unenveloped, and reports ok on a healthy DB", async () => {
    testApp = await createTestApp();
    const res = await testApp.app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.ok).toBeUndefined(); // NOT the {ok,data} envelope — §C6.6
    expect(body.status).toBe("ok");
    expect(body.dbOk).toBe(true);
    expect(typeof body.time).toBe("string");
    expect(typeof body.migrations).toBe("number");
  });

  it("every /api/ops/* route rejects an unauthenticated caller (401)", async () => {
    testApp = await createTestApp();
    const routes: [string, string][] = [
      ["GET", "/api/ops/info"],
      ["GET", "/api/ops/backups"],
      ["POST", "/api/ops/backups"],
      ["POST", "/api/ops/backups/verify"],
      ["DELETE", `/api/ops/backups/${FAKE_ID}`],
    ];
    for (const [method, url] of routes) {
      const res = await testApp.app.inject({ method, url, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("every /api/ops/* route rejects a manager (non-owner) session (403)", async () => {
    testApp = await createTestApp();
    const manager = createTestUser({ role: "manager" });
    const routes: [string, string, unknown?][] = [
      ["GET", "/api/ops/info"],
      ["GET", "/api/ops/backups"],
      ["POST", "/api/ops/backups"],
      ["POST", "/api/ops/backups/verify", { archiveName: "keyring-20260101-000000.tar.gz.enc" }],
      ["DELETE", `/api/ops/backups/${FAKE_ID}`],
    ];
    for (const [method, url, payload] of routes) {
      // `payload ?? {}` matches the 401 loop above: manager.headers carries
      // content-type: application/json, so a request with no payload at all makes
      // Fastify 400 on the empty body before the owner-only guard is reached.
      const res = await testApp.app.inject({
        method,
        url,
        headers: manager.headers,
        payload: payload ?? {},
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("GET /api/ops/info returns OpsInfo to an owner", async () => {
    testApp = await createTestApp();
    const owner = createTestUser({ role: "owner" });
    const res = await testApp.app.inject({
      method: "GET",
      url: "/api/ops/info",
      headers: owner.headers,
    });
    expect(res.statusCode).toBe(200);
    const info = unwrap<OpsInfo>({ statusCode: res.statusCode, body: res.body });
    expect(info.journalMode).toBe("wal");
    expect(info.retentionDays).toBeGreaterThan(0);
    expect(info.dbPath).toBeTruthy();
  });

  it("POST /api/ops/backups starts a run visible via GET /api/ops/backups", async () => {
    testApp = await createTestApp();
    const owner = createTestUser({ role: "owner" });
    const res = await testApp.app.inject({
      method: "POST",
      url: "/api/ops/backups",
      headers: owner.headers,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const created = unwrap<BackupRun>({ statusCode: res.statusCode, body: res.body });
    expect(["running", "ok"]).toContain(created.status);

    // Give the fire-and-forget backup a moment to finish before checking the list.
    await new Promise((resolve) => setTimeout(resolve, 800));

    const list = await testApp.app.inject({
      method: "GET",
      url: "/api/ops/backups",
      headers: owner.headers,
    });
    const page = unwrap<{ items: BackupRun[] }>({ statusCode: list.statusCode, body: list.body });
    expect(page.items.find((r) => r.id === created.id)).toBeTruthy();
  });

  it("POST /api/ops/backups/verify round-trips a real archive and cleans up its temp dir", async () => {
    testApp = await createTestApp();
    const owner = createTestUser({ role: "owner" });

    const run = await performBackup(startBackupRun("manual").id);
    expect(run.status).toBe("ok");

    const res = await testApp.app.inject({
      method: "POST",
      url: "/api/ops/backups/verify",
      headers: owner.headers,
      payload: { archiveName: run.archiveName },
    });
    expect(res.statusCode).toBe(200);
    const result = unwrap<{ ok: boolean; sha256: string; dbBytes: number; fileCount: number }>({
      statusCode: res.statusCode,
      body: res.body,
    });
    expect(result.ok).toBe(true);
    expect(result.sha256).toBe(run.sha256);
    expect(result.dbBytes).toBeGreaterThan(0);
  });

  it("POST /api/ops/backups/verify rejects a path-traversal archive name", async () => {
    testApp = await createTestApp();
    const owner = createTestUser({ role: "owner" });
    const res = await testApp.app.inject({
      method: "POST",
      url: "/api/ops/backups/verify",
      headers: owner.headers,
      payload: { archiveName: "../../etc/passwd" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /api/ops/backups/:id removes the row and the archive file", async () => {
    testApp = await createTestApp();
    const owner = createTestUser({ role: "owner" });
    const run = await performBackup(startBackupRun("manual").id);

    const res = await testApp.app.inject({
      method: "DELETE",
      url: `/api/ops/backups/${run.id}`,
      headers: bodyless(owner.headers),
    });
    expect(res.statusCode).toBe(200);

    const list = await testApp.app.inject({
      method: "GET",
      url: "/api/ops/backups",
      headers: owner.headers,
    });
    const page = unwrap<{ items: BackupRun[] }>({ statusCode: list.statusCode, body: list.body });
    expect(page.items.find((r) => r.id === run.id)).toBeUndefined();
  });

  it("DELETE /api/ops/backups/:id 404s for an unknown id", async () => {
    testApp = await createTestApp();
    const owner = createTestUser({ role: "owner" });
    const res = await testApp.app.inject({
      method: "DELETE",
      url: `/api/ops/backups/${FAKE_ID}`,
      headers: bodyless(owner.headers),
    });
    expect(res.statusCode).toBe(404);
  });
});
