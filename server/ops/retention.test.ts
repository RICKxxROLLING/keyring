import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRetention } from "./retention.js";

describe("applyRetention", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "keyring-retention-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeArchive(name: string, ageDays: number): void {
    const p = join(dir, name);
    writeFileSync(p, "x");
    const when = new Date(Date.now() - ageDays * 86_400_000);
    utimesSync(p, when, when);
  }

  it("always keeps the newest 3 regardless of age", () => {
    makeArchive("keyring-20260101-030000.tar.gz.enc", 400);
    makeArchive("keyring-20260201-030000.tar.gz.enc", 300);
    makeArchive("keyring-20260301-030000.tar.gz.enc", 200);

    const result = applyRetention(dir, 14, 3);
    expect(result.deleted).toEqual([]);
    expect(readdirSync(dir).length).toBe(3);
  });

  it("deletes archives older than retentionDays beyond the newest 3", () => {
    makeArchive("keyring-20260101-030000.tar.gz.enc", 40); // old -> deleted
    makeArchive("keyring-20260102-030000.tar.gz.enc", 35); // old -> deleted
    makeArchive("keyring-20260103-030000.tar.gz.enc", 10); // kept: newest-3
    makeArchive("keyring-20260104-030000.tar.gz.enc", 5); // kept: newest-3
    makeArchive("keyring-20260105-030000.tar.gz.enc", 1); // kept: newest-3

    const result = applyRetention(dir, 14, 3);
    expect(result.deleted.slice().sort()).toEqual([
      "keyring-20260101-030000.tar.gz.enc",
      "keyring-20260102-030000.tar.gz.enc",
    ]);
    expect(readdirSync(dir).length).toBe(3);
  });

  it("keeps archives that are within the retention window even beyond newest-3", () => {
    makeArchive("keyring-20260101-030000.tar.gz.enc", 5);
    makeArchive("keyring-20260102-030000.tar.gz.enc", 4);
    makeArchive("keyring-20260103-030000.tar.gz.enc", 3);
    makeArchive("keyring-20260104-030000.tar.gz.enc", 2);

    const result = applyRetention(dir, 14, 3);
    expect(result.deleted).toEqual([]);
    expect(readdirSync(dir).length).toBe(4);
  });

  it("ignores files that do not match the archive filename pattern", () => {
    writeFileSync(join(dir, "not-an-archive.txt"), "x");
    const result = applyRetention(dir, 14, 3);
    expect(result.deleted).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(readdirSync(dir)).toEqual(["not-an-archive.txt"]);
  });

  it("returns empty result when the backup directory does not exist yet", () => {
    const result = applyRetention(join(dir, "does-not-exist"), 14, 3);
    expect(result).toEqual({ deleted: [], kept: [] });
  });
});
