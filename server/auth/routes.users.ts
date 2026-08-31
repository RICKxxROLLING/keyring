import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { ApiError, ok } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";
import { onePage } from "../lib/paging.js";
import { toBool } from "../lib/rowmap.js";
import { parseBody, parseParams, parseQuery } from "../lib/validate.js";
import { auditFromRequest, writeAudit } from "../audit/audit.js";
import { requireAuth, requireRole } from "./middleware.js";
import { toUser, type UserRow } from "./serialize.js";
import { revokeAllSessionsForUser } from "./session.js";
import { generateTotpSecret } from "./totp.js";

const IdParamSchema = z.object({ id: z.string().min(1) }).strict();

const ListUsersQuerySchema = z
  .object({ includeInactive: z.coerce.boolean().optional().default(false) })
  .strict();

const PatchUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    role: z.enum(["owner", "manager"]).optional(),
    isActive: z.boolean().optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

const PatchMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    avatarColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "expected '#rrggbb'")
      .optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

function getUserOr404(id: string): UserRow {
  const row = getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  if (!row) throw new ApiError("NOT_FOUND", "User not found.");
  return row;
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/users", { preHandler: [requireAuth] }, async (req) => {
    const q = parseQuery(req, ListUsersQuerySchema);
    const db = getDb();
    const rows = (
      q.includeInactive
        ? db.prepare(`SELECT * FROM users ORDER BY display_name`).all()
        : db.prepare(`SELECT * FROM users WHERE is_active = 1 ORDER BY display_name`).all()
    ) as UserRow[];
    return ok(onePage(rows.map(toUser)));
  });

  // NOTE: registered before PATCH /api/users/:id so 'me' is not swallowed as an :id.
  app.patch("/api/users/me", { preHandler: [requireAuth] }, async (req) => {
    const body = parseBody(req, PatchMeSchema);
    const db = getDb();
    const id = req.user!.id;
    const before = getUserOr404(id);

    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.displayName !== undefined) {
      sets.push("display_name = ?");
      params.push(body.displayName);
    }
    if (body.avatarColor !== undefined) {
      sets.push("avatar_color = ?");
      params.push(body.avatarColor);
    }
    sets.push("updated_at = ?");
    params.push(nowIso());
    sets.push("version = version + 1");
    params.push(id, body.expectedVersion);

    const result = db
      .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ? AND version = ?`)
      .run(...params);
    if (result.changes === 0) {
      const current = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as
        | UserRow
        | undefined;
      if (!current) throw new ApiError("NOT_FOUND", "User not found.");
      throw new ApiError("VERSION_CONFLICT", "Your profile was changed elsewhere.", {
        current: toUser(current),
      });
    }
    const updated = getUserOr404(id);
    auditFromRequest(req, {
      action: "update",
      entityType: "user",
      entityId: id,
      propertyId: null,
      summary: "Updated own profile.",
      before: { displayName: before.display_name, avatarColor: before.avatar_color },
      after: { displayName: updated.display_name, avatarColor: updated.avatar_color },
    });
    return ok(toUser(updated));
  });

  app.patch(
    "/api/users/:id",
    { preHandler: [requireAuth, requireRole("owner")] },
    async (req) => {
      const { id } = parseParams(req, IdParamSchema);
      const body = parseBody(req, PatchUserSchema);
      const db = getDb();
      const before = getUserOr404(id);

      const newRole = body.role ?? before.role;
      const newIsActive = body.isActive === undefined ? toBool(before.is_active) : body.isActive;
      const wasActiveOwner = before.role === "owner" && toBool(before.is_active);
      const staysActiveOwner = newRole === "owner" && newIsActive;
      if (wasActiveOwner && !staysActiveOwner) {
        const { n } = db
          .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND is_active = 1 AND id != ?`)
          .get(id) as { n: number };
        if (n === 0) {
          throw new ApiError("CONFLICT", "There must always be at least one active owner.");
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      if (body.displayName !== undefined) {
        sets.push("display_name = ?");
        params.push(body.displayName);
      }
      if (body.role !== undefined) {
        sets.push("role = ?");
        params.push(body.role);
      }
      if (body.isActive !== undefined) {
        sets.push("is_active = ?");
        params.push(body.isActive ? 1 : 0);
      }
      sets.push("updated_at = ?");
      params.push(nowIso());
      sets.push("version = version + 1");
      params.push(id, body.expectedVersion);

      const result = db
        .prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ? AND version = ?`)
        .run(...params);
      if (result.changes === 0) {
        const current = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as
          | UserRow
          | undefined;
        if (!current) throw new ApiError("NOT_FOUND", "User not found.");
        throw new ApiError("VERSION_CONFLICT", "This user was changed by someone else.", {
          current: toUser(current),
        });
      }

      if (body.role !== undefined && body.role !== before.role) {
        writeAudit({
          actorUserId: req.user!.id,
          actorLabel: req.user!.displayName,
          action: "role_changed",
          entityType: "user",
          entityId: id,
          propertyId: null,
          summary: `Changed role ${before.role} -> ${body.role} for ${before.display_name}.`,
          before: { role: before.role },
          after: { role: body.role },
          ip: req.ip ?? null,
          requestId: String(req.id),
        });
      }
      if (body.isActive !== undefined && body.isActive !== toBool(before.is_active)) {
        writeAudit({
          actorUserId: req.user!.id,
          actorLabel: req.user!.displayName,
          action: body.isActive ? "user_reactivated" : "user_deactivated",
          entityType: "user",
          entityId: id,
          propertyId: null,
          summary: `${body.isActive ? "Reactivated" : "Deactivated"} ${before.display_name}.`,
          ip: req.ip ?? null,
          requestId: String(req.id),
        });
        if (!body.isActive) revokeAllSessionsForUser(id);
      }
      if (body.displayName !== undefined && body.displayName !== before.display_name) {
        writeAudit({
          actorUserId: req.user!.id,
          actorLabel: req.user!.displayName,
          action: "update",
          entityType: "user",
          entityId: id,
          propertyId: null,
          summary: `Updated display name for ${before.display_name}.`,
          before: { displayName: before.display_name },
          after: { displayName: body.displayName },
          ip: req.ip ?? null,
          requestId: String(req.id),
        });
      }

      const updated = getUserOr404(id);
      return ok(toUser(updated));
    },
  );

  app.post(
    "/api/users/:id/totp/reset",
    { preHandler: [requireAuth, requireRole("owner")] },
    async (req) => {
      const { id } = parseParams(req, IdParamSchema);
      if (id === req.user!.id) {
        throw new ApiError("CONFLICT", "Use the self-service recovery-codes flow to reset your own TOTP.");
      }
      const before = getUserOr404(id);
      // Mint a FRESH secret rather than nulling it. Nulling left the account
      // with no re-enrollment path at all: completeEnrollment() requires an
      // "enroll" challenge against an existing secret, and the only producers
      // of one are bootstrap and invite-accept — both unreachable for an
      // existing user. The account silently dropped to single factor (password
      // + recovery code) and became permanently unusable once the ten codes
      // were spent.
      //
      // With a secret in place and totp_enrolled_at NULL, POST /api/auth/login
      // recognises the pending-re-enrollment state and hands back an
      // EnrollmentChallenge, so the user re-enrolls themselves with their
      // password. The owner never sees or handles the new secret.
      const secret = generateTotpSecret();
      getDb()
        .prepare(
          `UPDATE users SET totp_secret = ?, totp_enrolled_at = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(secret, nowIso(), id);
      // DO NOT clear the recovery codes here. An earlier version did, with a
      // comment claiming it prevented a single-factor window — it created one.
      //
      // Recovery codes ARE the second factor. During the reset window
      // POST /api/auth/login hands the new TOTP secret to whoever presents the
      // password, so if the codes were also gone, the password alone would be
      // enough to enroll and get a full session. Pre-reset that took password
      // AND an unused recovery code; clearing them traded two factors for one,
      // on the exact path an owner is told to use when someone loses a phone.
      //
      // The codes stay live and POST /api/auth/login/enroll consumes one to
      // complete the re-enrollment, so two factors are required throughout.
      // The fresh batch is issued there, once the account is enrolled again.
      revokeAllSessionsForUser(id);
      writeAudit({
        actorUserId: req.user!.id,
        actorLabel: req.user!.displayName,
        action: "totp_reset",
        entityType: "user",
        entityId: id,
        propertyId: null,
        summary: `Reset TOTP enrollment for ${before.display_name}; they must re-enroll at next sign-in.`,
        ip: req.ip ?? null,
        requestId: String(req.id),
      });
      return ok({ ok: true } as const);
    },
  );
}
