// server/search/routes.search.ts — GET /api/search
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { requireAuth } from "../auth/middleware.js";
import { parseQuery, zId } from "../lib/validate.js";
import { onePage } from "../lib/paging.js";
import { ok } from "../lib/errors.js";
import type { AppContext } from "../context.js";
import type { EntityType, SearchHit } from "../../shared/types.js";

/** Strips FTS operator syntax and rebuilds q as a safe prefix-matching AND of tokens. */
export function sanitizeFtsQuery(q: string): string {
  const tokens = q.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return "";
  return tokens
    .slice(0, 12)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(" AND ");
}

const SearchQuerySchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    types: z.string().max(500).optional(),
    propertyId: zId.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export function registerSearchRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.get("/api/search", { preHandler: [requireAuth] }, async (req) => {
    const q = parseQuery(req, SearchQuerySchema);
    const ftsQuery = sanitizeFtsQuery(q.q);
    if (!ftsQuery) return ok(onePage<SearchHit>([]));

    const types = q.types
      ? (q.types.split(",").map((t) => t.trim()).filter(Boolean) as EntityType[])
      : null;

    const clauses: string[] = [`search_fts MATCH ?`];
    const params: unknown[] = [ftsQuery];
    if (types && types.length > 0) {
      clauses.push(`si.entity_type IN (${types.map(() => "?").join(",")})`);
      params.push(...types);
    }
    if (q.propertyId) {
      clauses.push(`si.property_id = ?`);
      params.push(q.propertyId);
    }
    params.push(q.limit);

    const rows = getDb()
      .prepare(
        `SELECT si.entity_type, si.entity_id, si.property_id, si.title, si.url, si.updated_at,
                p.name AS property_name,
                snippet(search_fts, 1, '<mark>', '</mark>', '…', 12) AS snippet,
                bm25(search_fts) AS rank
           FROM search_fts
           JOIN search_index si ON si.rowid_pk = search_fts.rowid
           LEFT JOIN properties p ON p.id = si.property_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY bm25(search_fts)
          LIMIT ?`,
      )
      .all(...params) as {
      entity_type: EntityType;
      entity_id: string;
      property_id: string | null;
      title: string;
      url: string;
      updated_at: string;
      property_name: string | null;
      snippet: string;
      rank: number;
    }[];

    const hits: SearchHit[] = rows.map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      propertyId: r.property_id,
      propertyName: r.property_name,
      title: r.title,
      snippet: r.snippet,
      url: r.url,
      updatedAt: r.updated_at,
      rank: r.rank,
    }));
    return ok(onePage(hits));
  });
}
