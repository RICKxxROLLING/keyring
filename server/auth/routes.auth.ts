import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { getEnv } from "../config/env.js";
import { ApiError, ok } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";
import { parseBody } from "../lib/validate.js";
import { writeAudit } from "../audit/audit.js";
import { needsSetup } from "./bootstrap.js";
import { requireAuth } from "./middleware.js";
import { consumeMfaChallenge, createMfaChallenge, loadMfaChallenge, recordMfaFailure } from "./mfa.js";
import { hashPassword, passwordPolicyError, verifyPassword } from "./password.js";
import { accountKey, assertNotLockedOut, recordFailure, recordSuccess } from "./ratelimit.js";
import { clearUnusedRecoveryCodes, consumeRecoveryCode, issueRecoveryCodes } from "./recovery.js";
import { toUser, type UserRow } from "./serialize.js";
import { clearSessionCookies, createSession, revokeSession, setSessionCookies } from "./session.js";
import { totpEnrollmentUri, verifyTotpCode } from "./totp.js";
import { completeEnrollment } from "./enroll.js";

const AUTH_RATE_LIMIT = { max: 10, timeWindow: "5 minutes" } as const;

const LoginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(200),
    password: z.string().min(1).max(200),
  })
  .strict();

const MfaCodeSchema = z
  .object({ mfaToken: z.string().min(1).max(200), code: z.string().min(1).max(20) })
  .strict();

const RecoveryLoginSchema = z
  .object({ mfaToken: z.string().min(1).max(200), recoveryCode: z.string().min(1).max(20) })
  .strict();

const PasswordChangeSchema = z
  .object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) })
  .strict();

const RegenerateSchema = z
  .object({ password: z.string().min(1).max(200), code: z.string().min(1).max(20) })
  .strict();

function getUserRow(id: string): UserRow {
  const row = getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  if (!row) throw new ApiError("UNAUTHENTICATED", "Sign in required.");
  return row;
}

function sessionInfoOf(row: UserRow, csrfToken: string, expiresAt: string) {
  return {
    user: toUser(row),
    csrfToken,
    expiresAt,
    serverTime: nowIso(),
    timezone: getEnv().APP_TIMEZONE,
  };
}

let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = hashPassword("dummy-password-for-timing-parity-only");
  return dummyHash;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (req) => {
    const body = parseBody(req, LoginSchema);
    if (needsSetup()) throw new ApiError("SETUP_REQUIRED", "Initial setup has not been completed.");
    const key = accountKey(body.email);
    assertNotLockedOut(key);

    const db = getDb();
    const row = db.prepare(`SELECT * FROM users WHERE lower(email) = ?`).get(body.email) as
      | UserRow
      | undefined;
    const genericFail = (): never => {
      recordFailure(key, "login_password", req.ip ?? null);
      throw new ApiError("FORBIDDEN", "Incorrect email or password.");
    };

    if (!row || !row.is_active) {
      await verifyPassword(await getDummyHash(), body.password); // timing parity
      return genericFail();
    }
    const passOk = await verifyPassword(row.password_hash, body.password);
    if (!passOk) {
      writeAudit({
        actorUserId: row.id,
        actorLabel: row.display_name,
        action: "login_failed",
        entityType: "user",
        entityId: row.id,
        propertyId: null,
        summary: "Failed login attempt (bad password).",
        ip: req.ip ?? null,
        requestId: String(req.id),
      });
      return genericFail();
    }
    // An owner reset this user's TOTP: the secret was regenerated but they
    // have not confirmed it yet (totp_enrolled_at IS NULL). Hand back an
    // ENROLL challenge with the otpauth URI so they can re-enroll themselves,
    // instead of a login challenge they could never satisfy. The password
    // check above has already passed, so this is not a bypass — it is the
    // same standard the invite flow uses to enroll a new account.
    if (row.totp_secret && !row.totp_enrolled_at) {
      const { mfaToken, expiresAt } = createMfaChallenge(row.id, "enroll");
      return ok({
        mfaToken,
        expiresAt,
        enrollment: {
          secret: row.totp_secret,
          otpauthUrl: totpEnrollmentUri(row.totp_secret, row.email),
        },
      });
    }

    const { mfaToken, expiresAt } = createMfaChallenge(row.id, "login");
    return ok({ mfaToken, expiresAt });
  });

  /**
   * Confirm a re-enrollment started by POST /api/auth/login above, after an
   * owner reset this user's TOTP. Same shape as the bootstrap and
   * invite-accept verify endpoints: consumes the "enroll" challenge, stamps
   * totp_enrolled_at, issues a fresh set of recovery codes (the old ones were
   * cleared at reset), and signs the user in.
   */
  app.post(
    "/api/auth/login/enroll",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (req, reply) => {
      const body = parseBody(req, MfaCodeSchema);
      return completeEnrollment(
        body.mfaToken,
        body.code,
        req,
        reply,
        "Re-enrolled TOTP after an administrative reset, and signed in.",
      );
    },
  );

  app.post(
    "/api/auth/login/totp",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (req, reply) => {
      const body = parseBody(req, MfaCodeSchema);
      const challenge = loadMfaChallenge(body.mfaToken, "login");
      const row = getUserRow(challenge.userId);
      const key = accountKey(row.email);
      assertNotLockedOut(key);
      if (!row.totp_secret || !verifyTotpCode(row.totp_secret, body.code, row.email)) {
        recordMfaFailure(challenge.id);
        recordFailure(key, "login_totp", req.ip ?? null);
        writeAudit({
          actorUserId: row.id,
          actorLabel: row.display_name,
          action: "login_failed",
          entityType: "user",
          entityId: row.id,
          propertyId: null,
          summary: "Failed login attempt (bad TOTP code).",
          ip: req.ip ?? null,
          requestId: String(req.id),
        });
        throw new ApiError("FORBIDDEN", "Incorrect verification code.");
      }
      consumeMfaChallenge(challenge.id);
      recordSuccess(key, "login_totp", req.ip ?? null);
      const db = getDb();
      db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(nowIso(), row.id);
      const session = createSession(row.id, req);
      setSessionCookies(reply, session);
      writeAudit({
        actorUserId: row.id,
        actorLabel: row.display_name,
        action: "login",
        entityType: "user",
        entityId: row.id,
        propertyId: null,
        summary: "Signed in.",
        ip: req.ip ?? null,
        requestId: String(req.id),
      });
      const updated = getUserRow(row.id);
      return ok(sessionInfoOf(updated, session.csrfToken, session.expiresAt));
    },
  );

  app.post(
    "/api/auth/login/recovery",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (req, reply) => {
      const body = parseBody(req, RecoveryLoginSchema);
      const challenge = loadMfaChallenge(body.mfaToken, "login");
      const row = getUserRow(challenge.userId);
      const key = accountKey(row.email);
      assertNotLockedOut(key);
      const codeOk = consumeRecoveryCode(row.id, body.recoveryCode);
      if (!codeOk) {
        recordMfaFailure(challenge.id);
        recordFailure(key, "login_recovery", req.ip ?? null);
        writeAudit({
          actorUserId: row.id,
          actorLabel: row.display_name,
          action: "login_failed",
          entityType: "user",
          entityId: row.id,
          propertyId: null,
          summary: "Failed login attempt (bad recovery code).",
          ip: req.ip ?? null,
          requestId: String(req.id),
        });
        throw new ApiError("FORBIDDEN", "Incorrect or already-used recovery code.");
      }
      consumeMfaChallenge(challenge.id);
      recordSuccess(key, "login_recovery", req.ip ?? null);
      const db = getDb();
      db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(nowIso(), row.id);
      const session = createSession(row.id, req);
      setSessionCookies(reply, session);
      writeAudit({
        actorUserId: row.id,
        actorLabel: row.display_name,
        action: "recovery_used",
        entityType: "user",
        entityId: row.id,
        propertyId: null,
        summary: "Signed in using a recovery code.",
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
        summary: "Signed in (recovery code).",
        ip: req.ip ?? null,
        requestId: String(req.id),
      });
      const updated = getUserRow(row.id);
      return ok(sessionInfoOf(updated, session.csrfToken, session.expiresAt));
    },
  );

  app.post("/api/auth/logout", { preHandler: [requireAuth] }, async (req, reply) => {
    if (req.sessionId) revokeSession(req.sessionId);
    clearSessionCookies(reply);
    if (req.user) {
      writeAudit({
        actorUserId: req.user.id,
        actorLabel: req.user.displayName,
        action: "logout",
        entityType: "user",
        entityId: req.user.id,
        propertyId: null,
        summary: "Signed out.",
        ip: req.ip ?? null,
        requestId: String(req.id),
      });
    }
    return ok({ ok: true } as const);
  });

  app.get("/api/auth/me", { preHandler: [requireAuth] }, async (req) => {
    const row = getUserRow(req.user!.id);
    const sessionRow = getDb()
      .prepare(`SELECT csrf_token, expires_at FROM sessions WHERE id = ?`)
      .get(req.sessionId) as { csrf_token: string; expires_at: string } | undefined;
    if (!sessionRow) throw new ApiError("UNAUTHENTICATED", "Sign in required.");
    return ok(sessionInfoOf(row, sessionRow.csrf_token, sessionRow.expires_at));
  });

  app.post("/api/auth/password", { preHandler: [requireAuth] }, async (req) => {
    const body = parseBody(req, PasswordChangeSchema);
    const row = getUserRow(req.user!.id);
    const matches = await verifyPassword(row.password_hash, body.currentPassword);
    if (!matches) throw new ApiError("FORBIDDEN", "Current password is incorrect.");
    const policyError = passwordPolicyError(body.newPassword);
    if (policyError) {
      throw new ApiError("VALIDATION_FAILED", policyError, {
        fields: [{ path: "newPassword", message: policyError }],
      });
    }
    const newHash = await hashPassword(body.newPassword);
    getDb()
      .prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
      .run(newHash, nowIso(), row.id);
    writeAudit({
      actorUserId: row.id,
      actorLabel: row.display_name,
      action: "password_changed",
      entityType: "user",
      entityId: row.id,
      propertyId: null,
      summary: "Changed password.",
      ip: req.ip ?? null,
      requestId: String(req.id),
    });
    return ok({ ok: true } as const);
  });

  app.post("/api/auth/recovery-codes/regenerate", { preHandler: [requireAuth] }, async (req) => {
    const body = parseBody(req, RegenerateSchema);
    const row = getUserRow(req.user!.id);
    const passOk = await verifyPassword(row.password_hash, body.password);
    const codeOk = row.totp_secret ? verifyTotpCode(row.totp_secret, body.code, row.email) : false;
    if (!passOk || !codeOk) {
      throw new ApiError("FORBIDDEN", "Password or verification code is incorrect.");
    }
    clearUnusedRecoveryCodes(row.id);
    const recovery = issueRecoveryCodes(row.id);
    writeAudit({
      actorUserId: row.id,
      actorLabel: row.display_name,
      action: "update",
      entityType: "user",
      entityId: row.id,
      propertyId: null,
      summary: "Regenerated recovery codes.",
      ip: req.ip ?? null,
      requestId: String(req.id),
    });
    return ok(recovery);
  });
}
