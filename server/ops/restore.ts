// server/ops/restore.ts — shared decrypt+extract+verify logic for the CLI restore
// drill (npm run restore) and POST /api/ops/backups/verify. Owner: T5.
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArchiveAuthError,
  ArchiveFormatError,
  decryptToDir,
  sha256File,
} from "./archive.js";

export interface RowCounts {
  [table: string]: number;
}

/** Row count of every user table in the extracted DB (generic — works for any schema). */
export function getRowCounts(db: Database.Database): RowCounts {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    )
    .all() as { name: string }[];
  const out: RowCounts = {};
  for (const { name } of tables) {
    const r = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number };
    out[name] = r.c;
  }
  return out;
}

export function countUploads(dir: string): { count: number; bytes: number } {
  if (!existsSync(dir)) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        count += 1;
        bytes += statSync(full).size;
      }
    }
  };
  walk(dir);
  return { count, bytes };
}

export interface RestoreReport {
  ok: boolean;
  outDir: string;
  dbPath: string;
  uploadsDir: string;
  integrityCheck: string | null;
  rowCounts: RowCounts;
  uploads: { count: number; bytes: number };
  archiveSha256: string;
  error?: string;
}

export interface RestoreArchiveInput {
  archivePath: string;
  outDir: string;
  passphrase: string;
}

/**
 * Decrypts `archivePath` into `outDir` (left in place — this is the drill in
 * docs/RESTORE.md, not the throwaway verify path), then runs
 * `PRAGMA integrity_check` and counts rows/uploads for the operator to compare
 * against the source. Throws ArchiveFormatError / ArchiveAuthError on bad input.
 */
export async function restoreArchive(input: RestoreArchiveInput): Promise<RestoreReport> {
  const archiveSha256 = await sha256File(input.archivePath);
  await decryptToDir({
    archivePath: input.archivePath,
    outDir: input.outDir,
    passphrase: input.passphrase,
  });

  // Accept the pre-rename entry name as well as the current one.
  //
  // archive.ts already accepts the old "STOOPB" magic, precisely so that a
  // backup taken before the rename does not become unrestorable. But the tar
  // entry was named stoop.db, and looking only for keyring.db reintroduced the
  // exact failure one step later: the archive decrypts and authenticates, then
  // reports "did not contain keyring.db" — during a restore, which is the
  // worst possible moment to discover it. verifyArchive goes through here too,
  // so it would also have reported every old archive as broken.
  const DB_ENTRY_NAMES = ["keyring.db", "stoop.db"] as const;
  const uploadsDir = join(input.outDir, "uploads");
  const dbPath =
    DB_ENTRY_NAMES.map((n) => join(input.outDir, n)).find((p) => existsSync(p)) ??
    join(input.outDir, DB_ENTRY_NAMES[0]);

  if (!existsSync(dbPath)) {
    return {
      ok: false,
      outDir: input.outDir,
      dbPath,
      uploadsDir,
      integrityCheck: null,
      rowCounts: {},
      uploads: { count: 0, bytes: 0 },
      archiveSha256,
      error: `Archive did not contain a database (looked for ${DB_ENTRY_NAMES.join(" or ")}).`,
    };
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const integrityRows = db.pragma("integrity_check") as { integrity_check: string }[];
    const integrityCheck = integrityRows[0]?.integrity_check ?? "unknown";
    const rowCounts = getRowCounts(db);
    const uploads = countUploads(uploadsDir);
    return {
      ok: integrityCheck === "ok",
      outDir: input.outDir,
      dbPath,
      uploadsDir,
      integrityCheck,
      rowCounts,
      uploads,
      archiveSha256,
    };
  } finally {
    db.close();
  }
}

export interface VerifyResult {
  ok: boolean;
  dbBytes: number;
  fileCount: number;
  sha256: string;
  error?: string;
}

/**
 * Used by POST /api/ops/backups/verify: decrypts and integrity-checks an
 * archive inside a throwaway temp directory that is ALWAYS removed afterward,
 * success or failure.
 */
export async function verifyArchive(archivePath: string, passphrase: string): Promise<VerifyResult> {
  const workDir = mkdtempSync(join(tmpdir(), "keyring-verify-"));
  try {
    const report = await restoreArchive({ archivePath, outDir: workDir, passphrase });
    const dbBytes = existsSync(report.dbPath) ? statSync(report.dbPath).size : 0;
    const fileCount = 1 + report.uploads.count;
    return {
      ok: report.ok,
      dbBytes,
      fileCount,
      sha256: report.archiveSha256,
      error: report.ok
        ? undefined
        : `integrity_check returned "${report.integrityCheck ?? "unknown"}"`,
    };
  } catch (err) {
    const message =
      err instanceof ArchiveAuthError || err instanceof ArchiveFormatError
        ? err.message
        : `Verification failed: ${(err as Error).message}`;
    return { ok: false, dbBytes: 0, fileCount: 0, sha256: "", error: message };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
