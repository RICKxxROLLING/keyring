// server/ops/health.ts — /healthz payload and /api/ops/info. Owner: T5.
import { existsSync, statSync } from "node:fs";
import { getDb } from "../db/index.js";
import { migrationCount } from "../db/migrate.js";
import { getEnv } from "../config/env.js";
import { nowIso } from "../lib/time.js";
import { camelRow } from "../lib/rowmap.js";
import type { BackupRun, HealthPayload, OpsInfo } from "../../shared/types.js";

const START_TIME = Date.now();

export function checkDb(): boolean {
  try {
    getDb().prepare("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}

/** Bare (unenveloped) payload for GET /healthz — public, no session required. */
export function buildHealthPayload(): HealthPayload {
  const dbOk = checkDb();
  let migrations = 0;
  if (dbOk) {
    try {
      migrations = migrationCount(getDb());
    } catch {
      /* leave at 0 */
    }
  }
  return {
    status: dbOk && migrations > 0 ? "ok" : "degraded",
    version: getEnv().APP_VERSION,
    uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
    dbOk,
    migrations,
    time: nowIso(),
  };
}

export function mapBackupRunRow(row: Record<string, unknown>): BackupRun {
  return camelRow<BackupRun>(row);
}

export function getLastBackup(): BackupRun | null {
  const row = getDb()
    .prepare(`SELECT * FROM backup_runs ORDER BY started_at DESC, id DESC LIMIT 1`)
    .get() as Record<string, unknown> | undefined;
  return row ? mapBackupRunRow(row) : null;
}

/** GET /api/ops/info — owner-only. */
export function buildOpsInfo(): OpsInfo {
  const env = getEnv();
  const db = getDb();

  const dbSizeBytes = existsSync(env.DB_PATH) ? statSync(env.DB_PATH).size : 0;
  const walPath = `${env.DB_PATH}-wal`;
  const walSizeBytes = existsSync(walPath) ? statSync(walPath).size : 0;

  const journalModeRows = db.pragma("journal_mode") as { journal_mode: string }[];
  const journalMode = journalModeRows[0]?.journal_mode ?? "unknown";

  let uploadCount = 0;
  let uploadBytes = 0;
  try {
    const uploadsRow = db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(size_bytes), 0) AS b
           FROM uploads WHERE deleted_at IS NULL`,
      )
      .get() as { c: number; b: number };
    uploadCount = uploadsRow.c;
    uploadBytes = uploadsRow.b;
  } catch {
    // The `uploads` table (T3, 2001_domain.sql) may not exist yet in a
    // worktree that only has T5's code plus stubs — report zero rather than 500.
  }

  return {
    version: env.APP_VERSION,
    nodeVersion: process.version,
    dbPath: env.DB_PATH,
    dbSizeBytes,
    walSizeBytes,
    journalMode,
    uploadCount,
    uploadBytes,
    backupDir: env.BACKUP_DIR,
    lastBackup: getLastBackup(),
    scheduledBackupAt: env.BACKUP_AT,
    retentionDays: env.BACKUP_RETENTION_DAYS,
    uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
  };
}
