// server/ops/retention.ts — backup archive retention. Owner: T5.
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ARCHIVE_RE = /^stoop-\d{8}-\d{6}(?:-\d+)?\.tar\.gz\.enc$/;

export interface RetentionResult {
  deleted: string[];
  kept: string[];
}

/**
 * Deletes archives in backupDir older than retentionDays, but always keeps the
 * newest `keepNewest` regardless of age (§C11.2). Filenames sort chronologically
 * because the timestamp segment is fixed-width, so a plain string sort is enough
 * to order them; per-file mtime (not the filename) decides the age cutoff.
 */
export function applyRetention(
  backupDir: string,
  retentionDays: number,
  keepNewest = 3,
): RetentionResult {
  let files: string[];
  try {
    files = readdirSync(backupDir).filter((f) => ARCHIVE_RE.test(f));
  } catch {
    return { deleted: [], kept: [] };
  }
  files.sort();
  files.reverse(); // newest first

  const cutoffMs = Date.now() - retentionDays * 86_400_000;
  const deleted: string[] = [];
  const kept: string[] = [];

  files.forEach((f, idx) => {
    if (idx < keepNewest) {
      kept.push(f);
      return;
    }
    const full = join(backupDir, f);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(full).mtimeMs;
    } catch {
      return;
    }
    if (mtimeMs < cutoffMs) {
      try {
        unlinkSync(full);
        deleted.push(f);
      } catch {
        /* best effort: a file we can't remove is not fatal to the backup that just ran */
        kept.push(f);
      }
    } else {
      kept.push(f);
    }
  });

  return { deleted, kept };
}
