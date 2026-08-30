// server/ops/routes.ops.ts — GET /healthz + /api/ops/* (all owner-only). Owner: T5.
import { createReadStream, existsSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ApiError, deleted as deletedBody, notFound, ok } from "../lib/errors.js";
import {
  IdParamSchema,
  PagingQuerySchema,
  parseBody,
  parseParams,
  parseQuery,
} from "../lib/validate.js";
import { buildPage, decodeCursor } from "../lib/paging.js";
import { auditFromRequest } from "../audit/audit.js";
import { publishEntity } from "../seams.js";
import { buildHealthPayload, buildOpsInfo, mapBackupRunRow } from "./health.js";
import { performBackup, startBackupRun } from "./backup.js";
import { verifyArchive } from "./restore.js";
import type { BackupRun } from "../../shared/types.js";

const VerifyBodySchema = z.object({ archiveName: z.string().min(1).max(200) }).strict();
const ARCHIVE_NAME_RE = /^keyring-\d{8}-\d{6}(?:-\d+)?\.tar\.gz\.enc$/;

export async function registerOpsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { env, db } = ctx;

  // Public, unenveloped (the one documented exception to §C5.1), no session,
  // never rate-limited — see the allowList in server/app.ts. Docker's
  // HEALTHCHECK calls this from inside the container.
  app.get("/healthz", async (_req, reply) => {
    const payload = buildHealthPayload();
    reply.code(payload.status === "ok" ? 200 : 503);
    return payload;
  });

  await app.register(
    async (r) => {
      r.addHook("preHandler", requireAuth);
      r.addHook("preHandler", requireRole("owner"));

      r.get("/ops/info", async () => ok(buildOpsInfo()));

      r.get("/ops/backups", async (req) => {
        const q = parseQuery(req, PagingQuerySchema);
        const cursor = decodeCursor(q.cursor);
        const rows = (
          cursor
            ? db
                .prepare(
                  `SELECT * FROM backup_runs
                    WHERE (started_at || id) < ?
                    ORDER BY started_at DESC, id DESC
                    LIMIT ?`,
                )
                .all(`${cursor.sort}${cursor.id}`, q.limit + 1)
            : db
                .prepare(`SELECT * FROM backup_runs ORDER BY started_at DESC, id DESC LIMIT ?`)
                .all(q.limit + 1)
        ) as Record<string, unknown>[];
        const items = rows.map(mapBackupRunRow) as (BackupRun & { id: string })[];
        const page = buildPage(items, q.limit, (item) => item.startedAt);
        return ok(page);
      });

      r.post("/ops/backups", async (req, reply) => {
        const user = req.user!;
        const initial = startBackupRun("manual");
        void performBackup(initial.id, {
          actorUserId: user.id,
          actorLabel: user.displayName,
          ip: req.ip,
          requestId: String(req.id),
        }).catch((err: unknown) => {
          app.log.error({ err, runId: initial.id }, "manual backup failed");
        });
        reply.code(201);
        return ok(initial);
      });

      r.get<{ Params: { id: string } }>("/ops/backups/:id/download", async (req, reply) => {
        const { id } = parseParams(req, IdParamSchema);
        const row = db.prepare(`SELECT * FROM backup_runs WHERE id = ?`).get(id) as
          | Record<string, unknown>
          | undefined;
        if (!row) throw notFound("Backup run");
        const run = mapBackupRunRow(row);
        if (run.status !== "ok" || !run.archiveName) throw notFound("Backup archive");
        const filePath = join(env.BACKUP_DIR, run.archiveName);
        if (!existsSync(filePath)) throw notFound("Backup archive file");
        reply.header("Content-Disposition", `attachment; filename="${run.archiveName}"`);
        reply.type("application/octet-stream");
        return reply.send(createReadStream(filePath));
      });

      r.post("/ops/backups/verify", async (req) => {
        const body = parseBody(req, VerifyBodySchema);
        const safeName = basename(body.archiveName);
        if (safeName !== body.archiveName || !ARCHIVE_NAME_RE.test(safeName)) {
          throw new ApiError("BAD_REQUEST", "Invalid archive name.");
        }
        const filePath = join(env.BACKUP_DIR, safeName);
        if (!existsSync(filePath)) throw notFound("Backup archive file");
        if (!env.BACKUP_PASSPHRASE) {
          return ok({
            ok: false,
            dbBytes: 0,
            fileCount: 0,
            sha256: "",
            error: "BACKUP_PASSPHRASE is not set; cannot verify.",
          });
        }
        const result = await verifyArchive(filePath, env.BACKUP_PASSPHRASE);
        return ok(result);
      });

      r.delete<{ Params: { id: string } }>("/ops/backups/:id", async (req) => {
        const { id } = parseParams(req, IdParamSchema);
        const row = db.prepare(`SELECT * FROM backup_runs WHERE id = ?`).get(id) as
          | Record<string, unknown>
          | undefined;
        if (!row) throw notFound("Backup run");
        const run = mapBackupRunRow(row);
        if (run.archiveName) {
          const filePath = join(env.BACKUP_DIR, run.archiveName);
          try {
            if (existsSync(filePath)) unlinkSync(filePath);
          } catch {
            /* best effort */
          }
        }
        db.prepare(`DELETE FROM backup_runs WHERE id = ?`).run(id);
        auditFromRequest(req, {
          action: "delete",
          entityType: "backup",
          entityId: id,
          propertyId: null,
          summary: `deleted backup run ${run.archiveName ?? id}`,
        });
        publishEntity({
          action: "deleted",
          entityType: "backup",
          entityId: id,
          propertyId: null,
          version: 0,
          actorId: req.user!.id,
        });
        return deletedBody(id);
      });
    },
    { prefix: "/api" },
  );
}
