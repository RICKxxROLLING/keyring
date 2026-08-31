import type { FastifyReply, FastifyRequest } from "fastify";
import { closeSocketsForSession, closeSocketsForUser } from "../seams.js";
import { getDb } from "../db/index.js";
import { getEnv } from "../config/env.js";
import { newId, newToken } from "../lib/ids.js";
import { addHoursIso, nowIso } from "../lib/time.js";
import { CSRF_COOKIE, SESSION_COOKIE, hashToken } from "./middleware.js";
import { newCsrfToken } from "./csrf.js";

export interface CreatedSession {
  sessionId: string;
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
}

/** Inserts a new session row for a fully-authenticated user. */
export function createSession(userId: string, req: FastifyRequest): CreatedSession {
  const env = getEnv();
  const sessionId = newId("ses");
  const sessionToken = newToken();
  const csrfToken = newCsrfToken();
  const at = nowIso();
  const expiresAt = addHoursIso(env.SESSION_TTL_HOURS);
  const ua = req.headers["user-agent"];
  getDb()
    .prepare(
      `INSERT INTO sessions
         (id, user_id, token_hash, csrf_token, created_at, expires_at, last_seen_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      userId,
      hashToken(sessionToken),
      csrfToken,
      at,
      expiresAt,
      at,
      req.ip ?? null,
      typeof ua === "string" ? ua : null,
    );
  return { sessionId, sessionToken, csrfToken, expiresAt };
}

/** Sets the paired `keyring_session` (HttpOnly) and `keyring_csrf` (readable) cookies. */
export function setSessionCookies(reply: FastifyReply, session: CreatedSession): void {
  const env = getEnv();
  const maxAge = env.SESSION_TTL_HOURS * 3600;
  reply.setCookie(SESSION_COOKIE, session.sessionToken, {
    httpOnly: true,
    secure: env.SECURE_COOKIES,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  reply.setCookie(CSRF_COOKIE, session.csrfToken, {
    httpOnly: false,
    secure: env.SECURE_COOKIES,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  const env = getEnv();
  reply.clearCookie(SESSION_COOKIE, { path: "/", secure: env.SECURE_COOKIES, sameSite: "lax" });
  reply.clearCookie(CSRF_COOKIE, { path: "/", secure: env.SECURE_COOKIES, sameSite: "lax" });
}

/** Revokes one session row immediately; subsequent requests bearing its cookie 401. */
export function revokeSession(sessionId: string): void {
  getDb()
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .run(nowIso(), sessionId);
  // A WebSocket authenticates once at upgrade and is never re-checked, so the
  // database row alone does not stop it. Hang up too.
  closeSocketsForSession(sessionId);
}

/** Revokes every active session for a user (deactivation, role change safety, etc). */
export function revokeAllSessionsForUser(userId: string): void {
  getDb()
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .run(nowIso(), userId);
  closeSocketsForUser(userId);
}

/**
 * Revokes every session for a user EXCEPT the one making the request.
 *
 * Used when changing a password. Someone changing their password after a
 * suspected compromise expects it to end the attacker's access — if the
 * stolen session keeps working, the obvious remediation quietly does nothing.
 * Keeping the caller's own session alive is what stops the change from
 * logging them out of the device they are sitting at.
 *
 * @returns how many sessions were ended, so the caller can tell the user.
 */
export function revokeOtherSessionsForUser(userId: string, keepSessionId: string): number {
  const result = getDb()
    .prepare(
      `UPDATE sessions SET revoked_at = ?
        WHERE user_id = ? AND id != ? AND revoked_at IS NULL`,
    )
    .run(nowIso(), userId, keepSessionId);
  // Close their sockets too, then reconnect nothing: the caller keeps its own
  // session, and its client re-establishes its own socket normally.
  for (const row of getDb()
    .prepare(
      `SELECT id FROM sessions WHERE user_id = ? AND id != ? AND revoked_at IS NOT NULL`,
    )
    .all(userId, keepSessionId) as { id: string }[]) {
    closeSocketsForSession(row.id);
  }
  return result.changes;
}
