// server/ops/backup.ts — the nightly (and on-demand) encrypted backup job. Owner: T5.
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { getDb } from "../db/index.js";
import { getEnv } from "../config/env.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { camelRow } from "../lib/rowmap.js";
import { registerJob } from "../lib/scheduler.js";
import { writeAudit } from "../audit/audit.js";
import { publishEntity } from "../seams.js";
import { encryptToFile } from "./archive.js";
import { applyRetention } from "./retention.js";
import { countUploads } from "./restore.js";
import type { BackupRun } from "../../shared/types.js";

export interface BackupActor {
  actorUserId?: string | null;
  actorLabel?: string;
  ip?: string | null;
  requestId?: string | null;
}

function localTimestamp(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
}

function row(id: string): BackupRun {
  const r = getDb().prepare(`SELECT * FROM backup_runs WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;
  return camelRow<BackupRun>(r);
}

function finish(id: string, patch: Record<string, unknown>): BackupRun {
  const keys = Object.keys(patch);
  const cols = keys.map((k) => `${k} = ?`).join(", ");
  getDb()
    .prepare(`UPDATE backup_runs SET ${cols} WHERE id = ?`)
    .run(...keys.map((k) => patch[k]), id);
  return row(id);
}

/** Synchronous: inserts the `running` row immediately so an HTTP caller can be
 * answered before the (potentially slow) archive work finishes. */
export function startBackupRun(kind: "scheduled" | "manual"): BackupRun {
  const id = newId("bkp");
  const startedAt = nowIso();
  getDb()
    .prepare(
      `INSERT INTO backup_runs (id, kind, status, started_at, retention_deleted)
       VALUES (?, ?, 'running', ?, 0)`,
    )
    .run(id, kind, startedAt);
  return row(id);
}

/**
 * Does the actual work for a run already inserted by startBackupRun(). Never
 * throws — every failure path ends in a `failed` backup_runs row instead.
 *
 * The one rule that must never bend: without BACKUP_PASSPHRASE this function
 * writes NO archive file, ever — not even a plaintext one. It fails loudly and
 * records `status: 'failed'`.
 */
export async function performBackup(runId: string, actor: BackupActor = {}): Promise<BackupRun> {
  const env = getEnv();
  const startedRun = row(runId);
  const actorUserId = actor.actorUserId ?? null;
  const actorLabel = actor.actorLabel ?? "system";

  writeAudit({
    actorUserId,
    actorLabel,
    action: "backup_started",
    entityType: "backup",
    entityId: runId,
    propertyId: null,
    summary: `${startedRun.kind} backup started`,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });

  if (!env.BACKUP_PASSPHRASE) {
    const error =
      "BACKUP_PASSPHRASE is not set; refusing to write an unencrypted backup archive.";
    const failedRun = finish(runId, { status: "failed", finished_at: nowIso(), error });
    writeAudit({
      actorUserId,
      actorLabel,
      action: "backup_failed",
      entityType: "backup",
      entityId: runId,
      propertyId: null,
      summary: error,
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    return failedRun;
  }

  let staging: string | null = null;
  let outPath: string | null = null;
  try {
    staging = mkdtempSync(join(tmpdir(), "stoop-backup-"));
    const dbSnapshotPath = join(staging, "stoop.db");
    const uploadsStagingPath = join(staging, "uploads");
    await mkdir(uploadsStagingPath, { recursive: true });

    // Consistent, WAL-checkpointed snapshot taken WITHOUT stopping writes.
    // This is a live-write-safe SQLite feature; a plain `cp` of the live file
    // is not, and is explicitly forbidden by the contract.
    getDb().prepare("VACUUM INTO ?").run(dbSnapshotPath);
    const dbBytes = statSync(dbSnapshotPath).size;

    if (existsSync(env.UPLOAD_DIR)) {
      await cp(env.UPLOAD_DIR, uploadsStagingPath, { recursive: true });
    }
    const { count: uploadFileCount, bytes: uploadsBytes } = countUploads(uploadsStagingPath);

    await mkdir(env.BACKUP_DIR, { recursive: true });
    let archiveName = `stoop-${localTimestamp(env.APP_TIMEZONE)}.tar.gz.enc`;
    let candidate = join(env.BACKUP_DIR, archiveName);
    let suffix = 2;
    while (existsSync(candidate)) {
      archiveName = `stoop-${localTimestamp(env.APP_TIMEZONE)}-${suffix}.tar.gz.enc`;
      candidate = join(env.BACKUP_DIR, archiveName);
      suffix += 1;
    }
    outPath = candidate;

    const { sizeBytes, sha256 } = await encryptToFile({
      cwd: staging,
      entries: ["stoop.db", "uploads"],
      outPath,
      passphrase: env.BACKUP_PASSPHRASE,
    });

    const okRun = finish(runId, {
      status: "ok",
      finished_at: nowIso(),
      archive_name: basename(outPath),
      size_bytes: sizeBytes,
      sha256,
      db_bytes: dbBytes,
      uploads_bytes: uploadsBytes,
      file_count: uploadFileCount + 1,
      error: null,
    });

    writeAudit({
      actorUserId,
      actorLabel,
      action: "backup_completed",
      entityType: "backup",
      entityId: runId,
      propertyId: null,
      summary: `${okRun.kind} backup completed: ${okRun.archiveName} (${sizeBytes} bytes)`,
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    publishEntity({
      action: "created",
      entityType: "backup",
      entityId: runId,
      propertyId: null,
      version: 1,
      actorId: actorUserId,
    });

    try {
      const retention = applyRetention(env.BACKUP_DIR, env.BACKUP_RETENTION_DAYS);
      if (retention.deleted.length > 0) {
        finish(runId, { retention_deleted: retention.deleted.length });
      }
    } catch (err) {
      // Retention failing never demotes a backup that already succeeded.
      getDb()
        .prepare(`UPDATE backup_runs SET error = ? WHERE id = ?`)
        .run(`backup ok; retention cleanup failed: ${(err as Error).message}`, runId);
    }

    return row(runId);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    if (outPath && existsSync(outPath)) {
      try {
        rmSync(outPath, { force: true });
      } catch {
        /* best effort — a leftover partial file is a problem, but must not crash the job */
      }
    }
    const failedRun = finish(runId, {
      status: "failed",
      finished_at: nowIso(),
      error: message.slice(0, 2000),
    });
    writeAudit({
      actorUserId,
      actorLabel,
      action: "backup_failed",
      entityType: "backup",
      entityId: runId,
      propertyId: null,
      summary: `backup failed: ${message.slice(0, 500)}`,
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    return failedRun;
  } finally {
    if (staging) {
      try {
        rmSync(staging, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/** Convenience: insert + run in one call. Used by the scheduled job and the CLI. */
export async function runBackup(
  kind: "scheduled" | "manual",
  actor: BackupActor = {},
): Promise<BackupRun> {
  const initial = startBackupRun(kind);
  return performBackup(initial.id, actor);
}

export function registerBackupJob(): void {
  const env = getEnv();
  registerJob({
    name: "backup",
    dailyAt: env.BACKUP_AT,
    fn: async () => {
      await runBackup("scheduled");
    },
  });
}

// `npm run backup` entry point (mirrors server/db/migrate.ts's --run pattern).
if (process.argv.includes("--run")) {
  const { loadEnv } = await import("../config/env.js");
  const { initDb } = await import("../db/index.js");
  const { runMigrations } = await import("../db/migrate.js");
  const env = loadEnv();
  const db = initDb(env.DB_PATH);
  runMigrations(db);
  const result = await runBackup("manual");
  if (result.status === "ok") {
    process.stdout.write(
      `backup ok: ${result.archiveName} (${result.sizeBytes} bytes, sha256 ${result.sha256})\n`,
    );
    process.exit(0);
  } else {
    process.stderr.write(`backup failed: ${result.error}\n`);
    process.exit(1);
  }
}
