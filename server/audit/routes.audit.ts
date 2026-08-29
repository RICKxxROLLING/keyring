import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { ok } from "../lib/errors.js";
import { parseQuery } from "../lib/validate.js";
import { buildPage, parsePaging } from "../lib/paging.js";
import { requireAuth } from "../auth/middleware.js";
import { toUserRef, type UserRow } from "../auth/serialize.js";
import type { AuditAction, AuditEntry, EntityType } from "../../shared/types.js";

const QuerySchema = z
  .object({
    entityType: z.string().max(50).optional(),
    entityId: z.string().max(100).optional(),
    propertyId: z.string().max(100).optional(),
    actorId: z.string().max(100).optional(),
    action: z.string().max(50).optional(),
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();

interface AuditRow {
  id: string;
  at: string;
  actor_user_id: string | null;
  actor_label: string;
  action: AuditAction;
  entity_type: EntityType;
  entity_id: string;
  property_id: string | null;
  summary: string;
  before_json: string | null;
  after_json: string | null;
  ip: string | null;
  request_id: string | null;
}

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/audit", { preHandler: [requireAuth] }, async (req) => {
    const q = parseQuery(req, QuerySchema);
    const { limit, cursor } = parsePaging(q);
    const db = getDb();

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (q.entityType) {
      clauses.push("entity_type = ?");
      params.push(q.entityType);
    }
    if (q.entityId) {
      clauses.push("entity_id = ?");
      params.push(q.entityId);
    }
    if (q.propertyId) {
      clauses.push("property_id = ?");
      params.push(q.propertyId);
    }
    if (q.actorId) {
      clauses.push("actor_user_id = ?");
      params.push(q.actorId);
    }
    if (q.action) {
      clauses.push("action = ?");
      params.push(q.action);
    }
    if (q.from) {
      clauses.push("at >= ?");
      params.push(q.from);
    }
    if (q.to) {
      clauses.push("at <= ?");
      params.push(q.to);
    }
    if (cursor) {
      clauses.push("(at < ? OR (at = ? AND id < ?))");
      params.push(cursor.sort, cursor.sort, cursor.id);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY at DESC, id DESC LIMIT ?`)
      .all(...params, limit + 1) as AuditRow[];

    const actorIds = [
      ...new Set(rows.map((r) => r.actor_user_id).filter((x): x is string => x !== null)),
    ];
    const actors = new Map<string, UserRow>();
    if (actorIds.length > 0) {
      const placeholders = actorIds.map(() => "?").join(",");
      const actorRows = db
        .prepare(`SELECT * FROM users WHERE id IN (${placeholders})`)
        .all(...actorIds) as UserRow[];
      for (const a of actorRows) actors.set(a.id, a);
    }

    const entries: AuditEntry[] = rows.map((r) => {
      const actorRow = r.actor_user_id ? actors.get(r.actor_user_id) : undefined;
      return {
        id: r.id,
        at: r.at,
        actor: actorRow ? toUserRef(actorRow) : null,
        actorLabel: r.actor_label,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        propertyId: r.property_id,
        summary: r.summary,
        before: r.before_json ? (JSON.parse(r.before_json) as Record<string, unknown>) : null,
        after: r.after_json ? (JSON.parse(r.after_json) as Record<string, unknown>) : null,
        ip: r.ip,
      };
    });

    return ok(buildPage(entries, limit, (e) => e.at));
  });
}
