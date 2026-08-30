import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, openDb } from "./index.js";
import { migrationCount, runMigrations } from "./migrate.js";

describe("migration runner", () => {
  let dir = "";

  afterEach(() => {
    closeDb();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("creates keyring.db in WAL mode and applies 0001_auth_core.sql", () => {
    dir = mkdtempSync(join(tmpdir(), "keyring-migrate-"));
    const db = openDb(join(dir, "keyring.db"));
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");

    const result = runMigrations(db);
    expect(result.applied).toContain("0001_auth_core.sql");
    expect(migrationCount(db)).toBeGreaterThanOrEqual(1);

    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
      .get();
    expect(table).toBeTruthy();
    db.close();
  });

  it("is a no-op on a second run", () => {
    dir = mkdtempSync(join(tmpdir(), "keyring-migrate-"));
    const db = openDb(join(dir, "keyring.db"));
    const first = runMigrations(db);
    expect(first.applied.length).toBeGreaterThan(0);

    const second = runMigrations(db);
    expect(second.applied.length).toBe(0);
    expect(second.skipped).toBe(second.total);
    db.close();
  });

  it("fails loudly when an already-applied migration file's checksum changes", () => {
    dir = mkdtempSync(join(tmpdir(), "keyring-migrate-"));
    const migDir = join(dir, "migrations");
    mkdirSync(migDir);
    const source = join(process.cwd(), "server", "db", "migrations", "0001_auth_core.sql");
    const copy = join(migDir, "0001_auth_core.sql");
    writeFileSync(copy, readFileSync(source, "utf8"));

    const db = openDb(join(dir, "keyring.db"));
    runMigrations(db, migDir);

    writeFileSync(copy, `${readFileSync(copy, "utf8")}\n-- tampered\n`);
    expect(() => runMigrations(db, migDir)).toThrow(/checksum/i);
    db.close();
  });
});
