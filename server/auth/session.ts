import type { FastifyReply, FastifyRequest } from "fastify";
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

/** Sets the paired `stoop_session` (HttpOnly) and `stoop_csrf` (readable) cookies. */
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
}

/** Revokes every active session for a user (deactivation, role change safety, etc). */
export function revokeAllSessionsForUser(userId: string): void {
  getDb()
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .run(nowIso(), userId);
}
