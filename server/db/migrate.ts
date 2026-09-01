import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./index.js";

function resolveMigrationsDir(): string {
  const beside = join(dirname(fileURLToPath(import.meta.url)), "migrations");
  if (existsSync(beside)) return beside;
  const fromCwd = join(process.cwd(), "server", "db", "migrations");
  if (existsSync(fromCwd)) return fromCwd;
  throw new Error(`Cannot locate migrations directory (tried ${beside} and ${fromCwd})`);
}

/**
 * The checksum that decides whether an applied migration has been tampered with.
 *
 * Line endings are normalised first, and that is not cosmetic. Git checks these
 * files out as CRLF on a Windows working copy (`core.autocrlf=true`) and LF in
 * the Linux container, so hashing the raw bytes gave the SAME migration two
 * different checksums depending on where it was read. A database migrated on
 * one and then served by the other would fail the immutability check on boot
 * and sit in a restart loop — the exact outage this check exists to prevent,
 * caused by the check itself.
 *
 * Safe to change: the container's files are LF, so normalising is a no-op
 * there and every checksum already stored by a deployment still matches.
 */
export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

export function listMigrations(dir = resolveMigrationsDir()): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

export interface MigrationResult {
  applied: string[];
  skipped: number;
  total: number;
}

export function runMigrations(db: Db, dir = resolveMigrationsDir()): MigrationResult {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL,
       checksum TEXT NOT NULL
     )`,
  );
  const done = new Map<string, string>();
  for (const row of db.prepare(`SELECT version, checksum FROM schema_migrations`).all() as {
    version: string;
    checksum: string;
  }[]) {
    done.set(row.version, row.checksum);
  }

  const files = listMigrations(dir);
  const applied: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    const checksum = migrationChecksum(sql);
    const seen = done.get(file);
    if (seen) {
      if (seen !== checksum) {
        throw new Error(
          `Migration ${file} changed after it was applied (checksum mismatch). ` +
            `Migrations are immutable: add a new file in your reserved range instead.`,
        );
      }
      continue;
    }
    db.transaction(() => {
      db.exec(sql);
      db.prepare(
        `INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)`,
      ).run(file, new Date().toISOString(), checksum);
    })();
    applied.push(file);
  }
  return { applied, skipped: files.length - applied.length, total: files.length };
}

export function migrationCount(db: Db): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM schema_migrations`).get() as { n: number };
  return row.n;
}

// `npm run migrate` entry point.
if (process.argv.includes("--run")) {
  const { loadEnv } = await import("../config/env.js");
  const { initDb } = await import("./index.js");
  const env = loadEnv();
  const db = initDb(env.DB_PATH);
  const result = runMigrations(db);
  process.stdout.write(`applied ${result.applied.length}, total ${result.total}\n`);
}
