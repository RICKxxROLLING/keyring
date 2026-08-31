import type { FastifyReply, FastifyRequest } from "fastify";
import { getDb } from "../db/index.js";
import { getEnv } from "../config/env.js";
import { ApiError, ok } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";
import { writeAudit } from "../audit/audit.js";
import { consumeMfaChallenge, loadMfaChallenge, recordMfaFailure } from "./mfa.js";
import { clearUnusedRecoveryCodes, consumeRecoveryCode, issueRecoveryCodes } from "./recovery.js";
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
  /**
   * Re-enrollment after an administrative TOTP reset ONLY.
   *
   * Bootstrap and invite-accept enroll an account that has no recovery codes
   * yet, so they pass nothing. Re-enrollment is different: the account already
   * exists and already has codes, and POST /api/auth/login hands the new TOTP
   * secret to anyone who presents the password. Without a second factor here,
   * a stolen password alone would be enough to enroll and take the account —
   * which is strictly weaker than before the reset, on the very path an owner
   * is told to use when a colleague loses their phone.
   *
   * Consuming a recovery code keeps two factors required throughout.
   */
  opts: { requireRecoveryCode?: string } = {},
) {
  const challenge = loadMfaChallenge(mfaToken, "enroll");
  const db = getDb();
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(challenge.userId) as
    | UserRow
    | undefined;
  if (!row || !row.totp_secret) throw new ApiError("FORBIDDEN", "Invalid or expired code.");

  // Second factor first: a wrong recovery code must not be distinguishable
  // from a wrong TOTP code, and must burn an attempt either way.
  if (opts.requireRecoveryCode !== undefined) {
    if (!consumeRecoveryCode(row.id, opts.requireRecoveryCode)) {
      recordMfaFailure(challenge.id);
      throw new ApiError("FORBIDDEN", "Incorrect verification or recovery code.");
    }
  }

  if (!verifyTotpCode(row.totp_secret, code, row.email)) {
    recordMfaFailure(challenge.id);
    throw new ApiError("FORBIDDEN", "Incorrect verification code.");
  }
  consumeMfaChallenge(challenge.id);
  const at = nowIso();
  db.prepare(
    `UPDATE users SET totp_enrolled_at = ?, last_login_at = ?, updated_at = ? WHERE id = ?`,
  ).run(at, at, at, row.id);
  // Retire whatever codes remain and issue a fresh batch. On bootstrap and
  // invite-accept there are none to clear; on re-enrollment this is what
  // finally invalidates the old set, now that the account is two-factor again.
  clearUnusedRecoveryCodes(row.id);
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
