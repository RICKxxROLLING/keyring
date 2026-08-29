import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

let db: Db | null = null;

export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.pragma("busy_timeout = 5000");
  d.pragma("synchronous = NORMAL");
  d.pragma("cache_size = -16000");
  d.pragma("wal_autocheckpoint = 1000");
  return d;
}

export function initDb(file: string): Db {
  if (db) db.close();
  db = openDb(file);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error("Database not initialised; buildApp() must run first");
  return db;
}

export function closeDb(): void {
  if (db) {
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* ignore */
    }
    db.close();
    db = null;
  }
}

/** Run fn inside a transaction. better-sqlite3 is synchronous: fn must be synchronous. */
export function tx<T>(fn: (d: Db) => T): T {
  const d = getDb();
  return d.transaction(() => fn(d))();
}
