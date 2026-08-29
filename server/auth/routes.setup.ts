import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { ApiError, ok } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { parseBody } from "../lib/validate.js";
import { writeAudit } from "../audit/audit.js";
import { consumeSetupToken, needsSetup, verifySetupToken } from "./bootstrap.js";
import { completeEnrollment } from "./enroll.js";
import { createMfaChallenge } from "./mfa.js";
import { hashPassword, passwordPolicyError } from "./password.js";
import { pickAvatarColor } from "./serialize.js";
import { generateTotpSecret, totpEnrollmentUri } from "./totp.js";

const AUTH_RATE_LIMIT = { max: 10, timeWindow: "5 minutes" } as const;

const zHandle = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{1,29}$/, "2-30 lowercase letters, digits, '_' or '-'.");

const BootstrapSchema = z
  .object({
    setupToken: z.string().min(1).max(300),
    email: z.string().trim().toLowerCase().email().max(200),
    handle: zHandle,
    displayName: z.string().trim().min(1).max(80),
    password: z.string().min(1).max(200),
  })
  .strict();

const VerifySchema = z
  .object({
    mfaToken: z.string().min(1).max(200),
    code: z.string().min(1).max(20),
  })
  .strict();

export async function registerSetupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/setup/status", async () => ok({ needsSetup: needsSetup() }));

  app.post("/api/setup/bootstrap", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (req) => {
    const body = parseBody(req, BootstrapSchema);
    if (!needsSetup()) {
      throw new ApiError("SETUP_ALREADY_DONE", "Setup has already been completed.");
    }
    if (!verifySetupToken(body.setupToken)) {
      throw new ApiError("FORBIDDEN", "Invalid setup token.");
    }
    const policyError = passwordPolicyError(body.password);
    if (policyError) {
      throw new ApiError("VALIDATION_FAILED", policyError, {
        fields: [{ path: "password", message: policyError }],
      });
    }

    const db = getDb();
    const dupe = db
      .prepare(`SELECT id FROM users WHERE lower(email) = ? OR lower(handle) = ?`)
      .get(body.email, body.handle);
    if (dupe) throw new ApiError("CONFLICT", "Email or handle already in use.");

    const passwordHash = await hashPassword(body.password);
    const secret = generateTotpSecret();
    const userId = newId("usr");
    const at = nowIso();
    db.prepare(
      `INSERT INTO users
         (id, email, handle, display_name, role, password_hash, totp_secret, avatar_color,
          is_active, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, 'owner', ?, ?, ?, 1, ?, ?, 1)`,
    ).run(userId, body.email, body.handle, body.displayName, passwordHash, secret, pickAvatarColor(), at, at);
    consumeSetupToken();
    writeAudit({
      actorUserId: null,
      actorLabel: "system",
      action: "create",
      entityType: "user",
      entityId: userId,
      propertyId: null,
      summary: `Bootstrapped the first owner account (${body.displayName}).`,
      ip: req.ip ?? null,
      requestId: String(req.id),
    });

    const { mfaToken } = createMfaChallenge(userId, "enroll");
    return ok({
      userId,
      mfaToken,
      enrollment: { secret, otpauthUrl: totpEnrollmentUri(secret, body.email) },
    });
  });

  app.post(
    "/api/setup/bootstrap/verify",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (req, reply) => {
      const body = parseBody(req, VerifySchema);
      return completeEnrollment(body.mfaToken, body.code, req, reply, "Signed in (bootstrap).");
    },
  );
}
