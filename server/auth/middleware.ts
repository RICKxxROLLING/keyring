import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { getDb } from "../db/index.js";
import { ApiError } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";
import type { Role } from "../../shared/types.js";

export const SESSION_COOKIE = "stoop_session";
export const CSRF_COOKIE = "stoop_csrf";
export const CSRF_HEADER = "x-csrf-token";

export interface AuthUser {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  role: Role;
  avatarColor: string;
}

export interface ResolvedSession {
  user: AuthUser;
  sessionId: string;
  csrfToken: string;
  expiresAt: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    sessionId?: string;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cookie -> session. Used by HTTP middleware AND by T2's WebSocket handshake. */
export function resolveSessionFromRequest(req: FastifyRequest): ResolvedSession | null {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  const row = getDb()
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
              u.id, u.email, u.handle, u.display_name, u.role, u.avatar_color
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > ?
          AND u.is_active = 1`,
    )
    .get(hashToken(raw), nowIso()) as
    | {
        session_id: string;
        csrf_token: string;
        expires_at: string;
        id: string;
        email: string;
        handle: string;
        display_name: string;
        role: Role;
        avatar_color: string;
      }
    | undefined;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
    user: {
      id: row.id,
      email: row.email,
      handle: row.handle,
      displayName: row.display_name,
      role: row.role,
      avatarColor: row.avatar_color,
    },
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Attach as preHandler. Populates req.user, enforces CSRF on unsafe methods. */
export const requireAuth: preHandlerHookHandler = async (req: FastifyRequest, _reply: FastifyReply) => {
  const resolved = resolveSessionFromRequest(req);
  if (!resolved) throw new ApiError("UNAUTHENTICATED", "Sign in required.");
  if (!SAFE_METHODS.has(req.method)) {
    const header = req.headers[CSRF_HEADER];
    const sent = Array.isArray(header) ? header[0] : header;
    if (!sent || sent !== resolved.csrfToken) {
      throw new ApiError("FORBIDDEN", "Missing or invalid CSRF token.");
    }
  }
  req.user = resolved.user;
  req.sessionId = resolved.sessionId;
};

/** Attach AFTER requireAuth: `preHandler: [requireAuth, requireRole("owner")]`. */
export function requireRole(role: Role): preHandlerHookHandler {
  return async (req: FastifyRequest) => {
    if (!req.user) throw new ApiError("UNAUTHENTICATED", "Sign in required.");
    if (role === "owner" && req.user.role !== "owner") {
      throw new ApiError("FORBIDDEN", "This action is restricted to the account owner.");
    }
  };
}

/** For handlers that need the user after requireAuth ran. */
export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw new ApiError("UNAUTHENTICATED", "Sign in required.");
  return req.user;
}
