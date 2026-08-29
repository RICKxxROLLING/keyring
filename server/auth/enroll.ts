import type { FastifyReply, FastifyRequest } from "fastify";
import { getDb } from "../db/index.js";
import { getEnv } from "../config/env.js";
import { ApiError, ok } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";
import { writeAudit } from "../audit/audit.js";
import { consumeMfaChallenge, loadMfaChallenge, recordMfaFailure } from "./mfa.js";
import { issueRecoveryCodes } from "./recovery.js";
import { toUser, type UserRow } from "./serialize.js";
import { createSession, setSessionCookies } from "./session.js";
import { verifyTotpCode } from "./totp.js";

/**
 * Shared by `POST /api/setup/bootstrap/verify` and `POST /api/invites/accept/verify`:
 * both are "confirm the first TOTP code for a freshly-created account, then log in."
 */
export async function completeEnrollment(
  mfaToken: string,
  code: string,
  req: FastifyRequest,
  reply: FastifyReply,
  loginSummary: string,
) {
  const challenge = loadMfaChallenge(mfaToken, "enroll");
  const db = getDb();
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(challenge.userId) as
    | UserRow
    | undefined;
  if (!row || !row.totp_secret) throw new ApiError("FORBIDDEN", "Invalid or expired code.");
  if (!verifyTotpCode(row.totp_secret, code, row.email)) {
    recordMfaFailure(challenge.id);
    throw new ApiError("FORBIDDEN", "Incorrect verification code.");
  }
  consumeMfaChallenge(challenge.id);
  const at = nowIso();
  db.prepare(
    `UPDATE users SET totp_enrolled_at = ?, last_login_at = ?, updated_at = ? WHERE id = ?`,
  ).run(at, at, at, row.id);
  const recovery = issueRecoveryCodes(row.id);
  const session = createSession(row.id, req);
  setSessionCookies(reply, session);
  writeAudit({
    actorUserId: row.id,
    actorLabel: row.display_name,
    action: "totp_enrolled",
    entityType: "user",
    entityId: row.id,
    propertyId: null,
    summary: "Enrolled TOTP.",
    ip: req.ip ?? null,
    requestId: String(req.id),
  });
  writeAudit({
    actorUserId: row.id,
    actorLabel: row.display_name,
    action: "login",
    entityType: "user",
    entityId: row.id,
    propertyId: null,
    summary: loginSummary,
    ip: req.ip ?? null,
    requestId: String(req.id),
  });
  const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(row.id) as UserRow;
  return ok({
    session: {
      user: toUser(updated),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      serverTime: nowIso(),
      timezone: getEnv().APP_TIMEZONE,
    },
    recovery,
  });
}
