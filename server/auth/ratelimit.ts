import { getDb } from "../db/index.js";
import { getEnv } from "../config/env.js";
import { ApiError } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";

const FAILURE_WINDOW_MINUTES = 15;

function addMinutesIso(minutes: number, from = new Date()): string {
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

export function accountKey(email: string): string {
  return `email:${email.trim().toLowerCase()}`;
}

export function ipKey(ip: string | null): string {
  return `ip:${ip ?? "unknown"}`;
}

/** Throws LOCKED_OUT (with retryAfter) if `key` is currently locked; clears a stale lock. */
export function assertNotLockedOut(key: string): void {
  const db = getDb();
  const row = db.prepare(`SELECT until FROM lockouts WHERE key = ?`).get(key) as
    | { until: string }
    | undefined;
  if (!row) return;
  const untilMs = Date.parse(row.until);
  if (untilMs > Date.now()) {
    throw new ApiError("LOCKED_OUT", "Too many failed attempts. Try again later.", {
      retryAfter: Math.max(1, Math.ceil((untilMs - Date.now()) / 1000)),
    });
  }
  db.prepare(`DELETE FROM lockouts WHERE key = ?`).run(key);
}

/**
 * Records a failed auth attempt for `key` and, once `AUTH_MAX_ATTEMPTS` failures have
 * landed inside the trailing 15-minute window, writes/refreshes a `lockouts` row that
 * blocks the key for `AUTH_LOCKOUT_MINUTES`.
 */
export function recordFailure(key: string, kind: string, ip: string | null): void {
  const db = getDb();
  const env = getEnv();
  db.prepare(`INSERT INTO auth_attempts (id, key, kind, at, success, ip) VALUES (?, ?, ?, ?, 0, ?)`).run(
    newId("att"),
    key,
    kind,
    nowIso(),
    ip,
  );
  const since = addMinutesIso(-FAILURE_WINDOW_MINUTES);
  const { n } = db
    .prepare(`SELECT COUNT(*) AS n FROM auth_attempts WHERE key = ? AND success = 0 AND at >= ?`)
    .get(key, since) as { n: number };
  if (n >= env.AUTH_MAX_ATTEMPTS) {
    const until = addMinutesIso(env.AUTH_LOCKOUT_MINUTES);
    db.prepare(
      `INSERT INTO lockouts (key, until, reason, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET until = excluded.until, reason = excluded.reason`,
    ).run(key, until, "too_many_failures", nowIso());
  }
}

/** Records a successful auth attempt and clears any lockout on the key. */
export function recordSuccess(key: string, kind: string, ip: string | null): void {
  const db = getDb();
  db.prepare(`INSERT INTO auth_attempts (id, key, kind, at, success, ip) VALUES (?, ?, ?, ?, 1, ?)`).run(
    newId("att"),
    key,
    kind,
    nowIso(),
    ip,
  );
  db.prepare(`DELETE FROM lockouts WHERE key = ?`).run(key);
}
