import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { closeDb, getDb } from "../db/index.js";
import { newId, newToken } from "../lib/ids.js";
import { nowIso, addHoursIso } from "../lib/time.js";
import { hashToken, SESSION_COOKIE, CSRF_COOKIE } from "../auth/middleware.js";
import { clearJobs } from "../lib/scheduler.js";
import { resetSeams } from "../seams.js";
import type { Role } from "../../shared/types.js";

export interface TestApp {
  app: FastifyInstance;
  dir: string;
  close: () => Promise<void>;
}

export interface TestUser {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  role: Role;
  sessionToken: string;
  csrfToken: string;
  /** Spread into `headers` of app.inject() for an authenticated request. */
  headers: Record<string, string>;
}

export async function createTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), "stoop-test-"));
  process.env.NODE_ENV = "test";
  process.env.DATA_DIR = dir;
  process.env.DB_PATH = join(dir, "test.db");
  process.env.UPLOAD_DIR = join(dir, "uploads");
  process.env.BACKUP_DIR = join(dir, "backups");
  process.env.APP_ORIGIN = "http://localhost:8080";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.BACKUP_PASSPHRASE = "test-passphrase";
  process.env.APP_TIMEZONE = "UTC";
  clearJobs();
  resetSeams();
  const app = await buildApp({ startJobs: false });
  await app.ready();
  return {
    app,
    dir,
    close: async () => {
      await app.close();
      closeDb();
      clearJobs();
      resetSeams();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Inserts a user and an active session directly. No password/TOTP involved. */
export function createTestUser(opts: { role?: Role; handle?: string } = {}): TestUser {
  const db = getDb();
  const id = newId("usr");
  const handle = opts.handle ?? `u${randomBytes(4).toString("hex")}`;
  const role: Role = opts.role ?? "manager";
  const email = `${handle}@example.test`;
  const at = nowIso();
  db.prepare(
    `INSERT INTO users (id, email, handle, display_name, role, password_hash, avatar_color,
                        is_active, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, 'x', '#3366cc', 1, ?, ?, 1)`,
  ).run(id, email, handle, `Test ${handle}`, role, at, at);

  const sessionToken = newToken();
  const csrfToken = newToken(16);
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId("ses"), id, hashToken(sessionToken), csrfToken, at, addHoursIso(24), at);

  return {
    id,
    email,
    handle,
    displayName: `Test ${handle}`,
    role,
    sessionToken,
    csrfToken,
    headers: {
      cookie: `${SESSION_COOKIE}=${sessionToken}; ${CSRF_COOKIE}=${csrfToken}`,
      "x-csrf-token": csrfToken,
      "content-type": "application/json",
    },
  };
}

/** Unwraps `{ ok: true, data }` or throws with the error body for readable failures. */
export function unwrap<T>(res: { statusCode: number; body: string }): T {
  const parsed = JSON.parse(res.body) as { ok: boolean; data?: T; error?: unknown };
  if (!parsed.ok) throw new Error(`API error ${res.statusCode}: ${JSON.stringify(parsed.error)}`);
  return parsed.data as T;
}
