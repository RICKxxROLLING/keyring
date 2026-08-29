import { afterEach, describe, expect, it } from "vitest";
import { closeSync, existsSync, openSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createTestApp, type TestApp } from "../testing/harness.js";
import { loadEnv } from "../config/env.js";
import { performBackup, startBackupRun } from "./backup.js";

function readHeaderBytes(path: string): Buffer {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(36);
  readSync(fd, buf, 0, 36, 0);
  closeSync(fd);
  return buf;
}

describe("backup job", () => {
  let testApp: TestApp | null = null;

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  it("fails loudly and writes NO archive when BACKUP_PASSPHRASE is unset", async () => {
    testApp = await createTestApp();
    const originalPassphrase = process.env.BACKUP_PASSPHRASE;
    process.env.BACKUP_PASSPHRASE = "";
    loadEnv(); // refresh the module-level env cache that getEnv() reads

    try {
      const initial = startBackupRun("manual");
      const result = await performBackup(initial.id);

      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/BACKUP_PASSPHRASE/);
      expect(result.archiveName).toBeNull();
      expect(result.sizeBytes).toBeNull();

      const env = loadEnv();
      const files = existsSync(env.BACKUP_DIR) ? readdirSync(env.BACKUP_DIR) : [];
      expect(files.filter((f) => f.endsWith(".tar.gz.enc"))).toEqual([]);
    } finally {
      process.env.BACKUP_PASSPHRASE = originalPassphrase;
      loadEnv();
    }
  });

  it("produces a valid encrypted archive (VACUUM INTO snapshot) and an ok run", async () => {
    testApp = await createTestApp();
    const env = loadEnv();
    expect(env.BACKUP_PASSPHRASE).toBeTruthy();

    const result = await performBackup(startBackupRun("manual").id);

    expect(result.status).toBe("ok");
    expect(result.archiveName).toMatch(/^stoop-\d{8}-\d{6}(-\d+)?\.tar\.gz\.enc$/);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.dbBytes).toBeGreaterThan(0);
    expect(result.fileCount).toBeGreaterThanOrEqual(1);

    const archivePath = join(env.BACKUP_DIR, result.archiveName!);
    expect(existsSync(archivePath)).toBe(true);

    const header = readHeaderBytes(archivePath);
    expect(header.toString("ascii", 0, 6)).toBe("STOOPB");
  });

  it("records a backup_runs row queryable back out of SQLite", async () => {
    testApp = await createTestApp();
    const result = await performBackup(startBackupRun("manual").id);
    const dbModule = await import("../db/index.js");
    const row = dbModule
      .getDb()
      .prepare(`SELECT status, archive_name FROM backup_runs WHERE id = ?`)
      .get(result.id) as { status: string; archive_name: string | null };
    expect(row.status).toBe("ok");
    expect(row.archive_name).toBe(result.archiveName);
  });
});
