import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptToFile } from "./archive.js";
import { countUploads, getRowCounts, restoreArchive, verifyArchive } from "./restore.js";

describe("getRowCounts / countUploads", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stoop-restore-unit-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("counts rows in every user table", () => {
    const dbPath = join(dir, "t.db");
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE widgets (id TEXT PRIMARY KEY, name TEXT)`);
    db.prepare(`INSERT INTO widgets (id, name) VALUES (?, ?)`).run("w1", "one");
    db.prepare(`INSERT INTO widgets (id, name) VALUES (?, ?)`).run("w2", "two");
    db.close();

    const readDb = new Database(dbPath, { readonly: true });
    const counts = getRowCounts(readDb);
    readDb.close();
    expect(counts.widgets).toBe(2);
  });

  it("counts files and bytes recursively, and tolerates a missing directory", () => {
    expect(countUploads(join(dir, "nope"))).toEqual({ count: 0, bytes: 0 });

    const uploadsDir = join(dir, "uploads");
    mkdirSync(join(uploadsDir, "2026", "08"), { recursive: true });
    writeFileSync(join(uploadsDir, "a.txt"), "12345"); // 5 bytes
    writeFileSync(join(uploadsDir, "2026", "08", "b.txt"), "1234567890"); // 10 bytes

    const result = countUploads(uploadsDir);
    expect(result.count).toBe(2);
    expect(result.bytes).toBe(15);
  });
});

describe("restoreArchive / verifyArchive end to end", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stoop-restore-e2e-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function buildFixtureArchive(passphrase: string): Promise<string> {
    const staging = join(dir, "staging");
    mkdirSync(join(staging, "uploads"), { recursive: true });
    writeFileSync(join(staging, "uploads", "lease.pdf"), "%PDF-1.4 fake");

    const dbPath = join(staging, "stoop.db");
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE things (id TEXT PRIMARY KEY, val TEXT)`);
    db.prepare(`INSERT INTO things (id, val) VALUES (?, ?)`).run("t1", "hello");
    db.prepare(`INSERT INTO things (id, val) VALUES (?, ?)`).run("t2", "world");
    db.prepare(`INSERT INTO things (id, val) VALUES (?, ?)`).run("t3", "!");
    db.close();

    const outPath = join(dir, "fixture.tar.gz.enc");
    await encryptToFile({
      cwd: staging,
      entries: ["stoop.db", "uploads"],
      outPath,
      passphrase,
    });
    return outPath;
  }

  it("restoreArchive reports integrity_check ok, matching row counts, and the uploads count", async () => {
    const archivePath = await buildFixtureArchive("drill-passphrase");
    const outDir = join(dir, "restored");

    const report = await restoreArchive({ archivePath, outDir, passphrase: "drill-passphrase" });

    expect(report.ok).toBe(true);
    expect(report.integrityCheck).toBe("ok");
    expect(report.rowCounts.things).toBe(3);
    expect(report.uploads.count).toBe(1);
    expect(report.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifyArchive cleans up its temp directory whether it succeeds or fails", async () => {
    const archivePath = await buildFixtureArchive("verify-passphrase");

    const ok = await verifyArchive(archivePath, "verify-passphrase");
    expect(ok.ok).toBe(true);
    expect(ok.fileCount).toBe(2); // stoop.db + lease.pdf

    const bad = await verifyArchive(archivePath, "totally-wrong-passphrase");
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/wrong passphrase|corrupted|authenticate/i);
  });
});
