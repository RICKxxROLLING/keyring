import type { FastifyRequest } from "fastify";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import type { AuditAction, EntityType } from "../../shared/types.js";

export interface AuditInput {
  actorUserId: string | null;
  actorLabel: string;
  action: AuditAction;
  entityType: EntityType;
  entityId: string;
  propertyId?: string | null;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  requestId?: string | null;
}

const REDACTED = new Set([
  "password",
  "passwordHash",
  "password_hash",
  "totpSecret",
  "totp_secret",
  "tokenHash",
  "token_hash",
  "csrfToken",
  "recoveryCode",
  "setupToken",
]);

function scrub(obj: Record<string, unknown> | null | undefined): string | null {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = REDACTED.has(k) ? "[redacted]" : v;
  return JSON.stringify(out);
}

/** Synchronous insert. Safe (and required) inside the mutation's transaction. */
export function writeAudit(input: AuditInput): string {
  const id = newId("aud");
  getDb()
    .prepare(
      `INSERT INTO audit_log
         (id, at, actor_user_id, actor_label, action, entity_type, entity_id,
          property_id, summary, before_json, after_json, ip, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      nowIso(),
      input.actorUserId,
      input.actorLabel,
      input.action,
      input.entityType,
      input.entityId,
      input.propertyId ?? null,
      input.summary,
      scrub(input.before),
      scrub(input.after),
      input.ip ?? null,
      input.requestId ?? null,
    );
  return id;
}

export type RequestAuditInput = Omit<
  AuditInput,
  "actorUserId" | "actorLabel" | "ip" | "requestId"
>;

export function auditFromRequest(req: FastifyRequest, input: RequestAuditInput): string {
  return writeAudit({
    ...input,
    actorUserId: req.user?.id ?? null,
    actorLabel: req.user?.displayName ?? "system",
    ip: req.ip ?? null,
    requestId: String(req.id),
  });
}
