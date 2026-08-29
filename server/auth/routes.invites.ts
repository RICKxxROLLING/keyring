import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { getEnv } from "../config/env.js";
import { ApiError, deleted, ok } from "../lib/errors.js";
import { newId, newToken } from "../lib/ids.js";
import { addHoursIso, nowIso } from "../lib/time.js";
import { onePage } from "../lib/paging.js";
import { parseBody, parseParams, parseQuery } from "../lib/validate.js";
import { writeAudit } from "../audit/audit.js";
import { completeEnrollment } from "./enroll.js";
import { createMfaChallenge } from "./mfa.js";
import { hashToken, requireAuth, requireRole } from "./middleware.js";
import { hashPassword, passwordPolicyError } from "./password.js";
import { pickAvatarColor } from "./serialize.js";
import { generateTotpSecret, totpEnrollmentUri } from "./totp.js";
import type { Invite, Role } from "../../shared/types.js";

const AUTH_RATE_LIMIT = { max: 10, timeWindow: "5 minutes" } as const;

interface InviteRow {
  id: string;
  email: string;
  role: Role;
  token_hash: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_user_id: string | null;
  revoked_at: string | null;
}

function toInvite(row: InviteRow, inviteUrl?: string): Invite {
  const out: Invite = {
    id: row.id,
    email: row.email,
    role: row.role,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedUserId: row.accepted_user_id,
    revokedAt: row.revoked_at,
  };
  if (inviteUrl) out.inviteUrl = inviteUrl;
  return out;
}

function isOpen(row: InviteRow): boolean {
  return row.accepted_at === null && row.revoked_at === null && Date.parse(row.expires_at) > Date.now();
}

const CreateInviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(200),
    role: z.enum(["owner", "manager"]),
    expiresInHours: z.number().int().min(1).max(24 * 30).optional(),
  })
  .strict();

const ListQuerySchema = z.object({ state: z.enum(["open", "all"]).default("open") }).strict();
const TokenParamSchema = z.object({ token: z.string().min(1).max(300) }).strict();

const AcceptSchema = z
  .object({
    handle: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9_-]{1,29}$/, "2-30 lowercase letters, digits, '_' or '-'."),
    displayName: z.string().trim().min(1).max(80),
    password: z.string().min(1).max(200),
  })
  .strict();

const VerifySchema = z
  .object({ mfaToken: z.string().min(1).max(200), code: z.string().min(1).max(20) })
  .strict();

export async function registerInviteRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/invites",
    { preHandler: [requireAuth, requireRole("owner")] },
    async (req) => {
      const q = parseQuery(req, ListQuerySchema);
      const db = getDb();
      const rows = db
        .prepare(`SELECT * FROM invites ORDER BY created_at DESC`)
        .all() as InviteRow[];
      const filtered = q.state === "open" ? rows.filter(isOpen) : rows;
      return ok(onePage(filtered.map((r) => toInvite(r))));
    },
  );

  app.post(
    "/api/invites",
    { preHandler: [requireAuth, requireRole("owner")] },
    async (req) => {
      const body = parseBody(req, CreateInviteSchema);
      const db = getDb();
      const existingUser = db
        .prepare(`SELECT id FROM users WHERE lower(email) = ?`)
        .get(body.email);
      if (existingUser) throw new ApiError("CONFLICT", "That email already has an account.");
      const openInvite = (db.prepare(`SELECT * FROM invites WHERE lower(email) = ?`).all(body.email) as InviteRow[]).find(isOpen);
      if (openInvite) throw new ApiError("CONFLICT", "There is already an open invite for that email.");

      const id = newId("inv");
      const token = newToken();
      const at = nowIso();
      const expiresAt = addHoursIso(body.expiresInHours ?? getEnv().INVITE_TTL_HOURS);
      db.prepare(
        `INSERT INTO invites (id, email, role, token_hash, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, body.email, body.role, hashToken(token), req.user!.id, at, expiresAt);
      writeAudit({
        actorUserId: req.user!.id,
        actorLabel: req.user!.displayName,
        action: "invite_issued",
        entityType: "invite",
        entityId: id,
        propertyId: null,
        summary: `Invited ${body.email} as ${body.role}.`,
        ip: req.ip ?? null,
        requestId: String(req.id),
      });
      const row = db.prepare(`SELECT * FROM invites WHERE id = ?`).get(id) as InviteRow;
      const inviteUrl = `${getEnv().APP_ORIGIN}/invite/${token}`;
      return ok(toInvite(row, inviteUrl));
    },
  );

  app.delete(
    "/api/invites/:id",
    { preHandler: [requireAuth, requireRole("owner")] },
    async (req) => {
      const { id } = parseParams(req, z.object({ id: z.string().min(1) }).strict());
      const db = getDb();
      const row = db.prepare(`SELECT * FROM invites WHERE id = ?`).get(id) as InviteRow | undefined;
      if (!row) throw new ApiError("NOT_FOUND", "Invite not found.");
      if (row.accepted_at) throw new ApiError("CONFLICT", "This invite was already accepted.");
      if (!row.revoked_at) {
        db.prepare(`UPDATE invites SET revoked_at = ? WHERE id = ?`).run(nowIso(), id);
        writeAudit({
          actorUserId: req.user!.id,
          actorLabel: req.user!.displayName,
          action: "invite_revoked",
          entityType: "invite",
          entityId: id,
          propertyId: null,
          summary: `Revoked the invite for ${row.email}.`,
          ip: req.ip ?? null,
          requestId: String(req.id),
        });
      }
      return deleted(id);
    },
  );

  app.get("/api/invites/:token/preview", async (req) => {
    const { token } = parseParams(req, TokenParamSchema);
    const db = getDb();
    const row = db
      .prepare(`SELECT * FROM invites WHERE token_hash = ?`)
      .get(hashToken(token)) as InviteRow | undefined;
    if (!row || !isOpen(row)) throw new ApiError("NOT_FOUND", "This invite link is no longer valid.");
    return ok({ email: row.email, role: row.role, valid: true, expiresAt: row.expires_at });
  });

  app.post(
    "/api/invites/:token/accept",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (req) => {
      const { token } = parseParams(req, TokenParamSchema);
      const body = parseBody(req, AcceptSchema);
      const db = getDb();
      const invite = db
        .prepare(`SELECT * FROM invites WHERE token_hash = ?`)
        .get(hashToken(token)) as InviteRow | undefined;
      if (!invite || !isOpen(invite)) {
        throw new ApiError("NOT_FOUND", "This invite link is no longer valid.");
      }
      const dupe = db.prepare(`SELECT id FROM users WHERE lower(handle) = ?`).get(body.handle);
      if (dupe) throw new ApiError("CONFLICT", "That handle is already taken.");
      const policyError = passwordPolicyError(body.password);
      if (policyError) {
        throw new ApiError("VALIDATION_FAILED", policyError, {
          fields: [{ path: "password", message: policyError }],
        });
      }

      const passwordHash = await hashPassword(body.password);
      const secret = generateTotpSecret();
      const userId = newId("usr");
      const at = nowIso();
      db.prepare(
        `INSERT INTO users
           (id, email, handle, display_name, role, password_hash, totp_secret, avatar_color,
            is_active, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)`,
      ).run(
        userId,
        invite.email,
        body.handle,
        body.displayName,
        invite.role,
        passwordHash,
        secret,
        pickAvatarColor(),
        at,
        at,
      );
      db.prepare(`UPDATE invites SET accepted_at = ?, accepted_user_id = ? WHERE id = ?`).run(
        at,
        userId,
        invite.id,
      );
      writeAudit({
        actorUserId: null,
        actorLabel: body.displayName,
        action: "invite_accepted",
        entityType: "invite",
        entityId: invite.id,
        propertyId: null,
        summary: `${body.displayName} accepted the invite for ${invite.email}.`,
        ip: req.ip ?? null,
        requestId: String(req.id),
      });
      writeAudit({
        actorUserId: null,
        actorLabel: "system",
        action: "create",
        entityType: "user",
        entityId: userId,
        propertyId: null,
        summary: `Created ${invite.role} account for ${body.displayName}.`,
        ip: req.ip ?? null,
        requestId: String(req.id),
      });

      const { mfaToken } = createMfaChallenge(userId, "enroll");
      return ok({
        userId,
        mfaToken,
        enrollment: { secret, otpauthUrl: totpEnrollmentUri(secret, invite.email) },
      });
    },
  );

  app.post(
    "/api/invites/accept/verify",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (req, reply) => {
      const body = parseBody(req, VerifySchema);
      return completeEnrollment(body.mfaToken, body.code, req, reply, "Signed in (invite accepted).");
    },
  );
}
