// server/domain/timeline/routes.ts — GET {P}/timeline: reverse-chronological audit wall.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../../db/index.js";
import { requireAuth } from "../../auth/middleware.js";
import { parseParams, parseQuery, zId, PagingQuerySchema } from "../../lib/validate.js";
import { ok } from "../../lib/errors.js";
import { decodeCursor, encodeCursor } from "../../lib/paging.js";
import { requirePropertyExists, userRef } from "../common/access.js";
import type { AppContext } from "../../context.js";
import type { AuditAction, EntityType, Page, TimelineEvent } from "../../../shared/types.js";

function urlFor(entityType: EntityType, entityId: string, propertyId: string): string | null {
  switch (entityType) {
    case "property":
      return `/p/${propertyId}`;
    case "unit":
      return `/p/${propertyId}`;
    case "note":
      return `/p/${propertyId}/notes?note=${entityId}`;
    case "work_order":
    case "work_order_comment":
      return `/p/${propertyId}/maintenance?wo=${entityId}`;
    case "pm_template":
      return `/p/${propertyId}/maintenance?pm=${entityId}`;
    case "project":
    case "project_line":
      return `/p/${propertyId}/projects?project=${entityId}`;
    case "tenant":
      return `/p/${propertyId}/tenants?tenant=${entityId}`;
    case "lease":
      return `/p/${propertyId}/tenants?lease=${entityId}`;
    case "rent_entry":
      return `/p/${propertyId}/money`;
    case "property_expense":
      return `/p/${propertyId}/money?expense=${entityId}`;
    case "vendor":
      return `/vendors?vendor=${entityId}`;
    case "spec_entry":
      return `/p/${propertyId}/specs?spec=${entityId}`;
    case "compliance_item":
      return `/p/${propertyId}/compliance?item=${entityId}`;
    case "turnover":
    case "turnover_item":
      return `/p/${propertyId}/turnover?turnover=${entityId}`;
    default:
      return null;
  }
}

export function registerTimelineRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const db = getDb();

  app.get("/api/properties/:id/timeline", { preHandler: [requireAuth] }, async (req) => {
    const { id: propertyId } = parseParams(req, z.object({ id: zId }).strict());
    requirePropertyExists(propertyId);
    const q = parseQuery(req, PagingQuerySchema);
    const cursor = decodeCursor(q.cursor);

    const clauses = ["property_id = ?"];
    const params: unknown[] = [propertyId];
    if (cursor) {
      clauses.push("id < ?");
      params.push(cursor.id);
    }
    const rows = db
      .prepare(
        `SELECT id, at, actor_user_id, actor_label, action, entity_type, entity_id, summary
           FROM audit_log WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`,
      )
      .all(...params, q.limit + 1) as {
      id: string;
      at: string;
      actor_user_id: string | null;
      actor_label: string;
      action: AuditAction;
      entity_type: EntityType;
      entity_id: string;
      summary: string;
    }[];

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const events: TimelineEvent[] = page.map((r) => ({
      id: r.id,
      at: r.at,
      actor: userRef(r.actor_user_id),
      actorLabel: r.actor_label,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      summary: r.summary,
      url: urlFor(r.entity_type, r.entity_id, propertyId),
    }));
    const last = page[page.length - 1];
    const result: Page<TimelineEvent> = {
      items: events,
      nextCursor: hasMore && last ? encodeCursor(last.id, last.id) : null,
      total: null,
    };
    return ok(result);
  });
}
