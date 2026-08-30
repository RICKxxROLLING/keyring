import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArchiveAuthError,
  ArchiveFormatError,
  buildHeader,
  decryptToDir,
  encryptToFile,
  HEADER_LEN,
  parseHeader,
} from "./archive.js";

describe("archive header (§C11.2)", () => {
  it("round-trips salt/iv through build/parse", () => {
    const salt = Buffer.from("0123456789abcdef", "utf8"); // 16 bytes
    const iv = Buffer.from("abcdefabcdef", "utf8"); // 12 bytes
    const header = buildHeader(salt, iv);
    expect(header.length).toBe(HEADER_LEN);
    expect(header.toString("ascii", 0, 6)).toBe("STOOPB");

    const parsed = parseHeader(header);
    expect(parsed.version).toBe(1);
    expect(parsed.kdfId).toBe(1);
    expect(parsed.salt.equals(salt)).toBe(true);
    expect(parsed.iv.equals(iv)).toBe(true);
  });

  it("rejects a buffer with the wrong magic", () => {
    const bad = Buffer.alloc(HEADER_LEN, 0);
    bad.write("NOTSTOOP", 0, "ascii");
    expect(() => parseHeader(bad)).toThrow(ArchiveFormatError);
  });

  it("rejects an unsupported format version", () => {
    const salt = Buffer.alloc(16, 1);
    const iv = Buffer.alloc(12, 2);
    const header = buildHeader(salt, iv);
    header.writeUInt8(0x09, 6);
    expect(() => parseHeader(header)).toThrow(ArchiveFormatError);
  });
});

describe("encryptToFile / decryptToDir round-trip", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stoop-archive-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a staging tree byte-for-byte", async () => {
    const staging = join(dir, "staging");
    mkdirSync(join(staging, "uploads"), { recursive: true });
    writeFileSync(join(staging, "stoop.db"), "fake-db-bytes-for-test");
    writeFileSync(join(staging, "uploads", "a.txt"), "hello upload");
    mkdirSync(join(staging, "uploads", "2026"), { recursive: true });
    writeFileSync(join(staging, "uploads", "2026", "b.bin"), Buffer.from([1, 2, 3, 4, 5]));

    const outPath = join(dir, "out.tar.gz.enc");
    const result = await encryptToFile({
      cwd: staging,
      entries: ["stoop.db", "uploads"],
      outPath,
      passphrase: "correct horse battery staple",
    });
    expect(result.sizeBytes).toBeGreaterThan(HEADER_LEN);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);

    const outDir = join(dir, "restored");
    await decryptToDir({
      archivePath: outPath,
      outDir,
      passphrase: "correct horse battery staple",
    });

    expect(readFileSync(join(outDir, "stoop.db"), "utf8")).toBe("fake-db-bytes-for-test");
    expect(readFileSync(join(outDir, "uploads", "a.txt"), "utf8")).toBe("hello upload");
    expect(Array.from(readFileSync(join(outDir, "uploads", "2026", "b.bin")))).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("fails the GCM tag check with the wrong passphrase, and is indistinguishable from corruption", async () => {
    const staging = join(dir, "staging2");
    mkdirSync(join(staging, "uploads"), { recursive: true });
    writeFileSync(join(staging, "stoop.db"), "fake-db-bytes-2");

    const outPath = join(dir, "out2.tar.gz.enc");
    await encryptToFile({
      cwd: staging,
      entries: ["stoop.db", "uploads"],
      outPath,
      passphrase: "right-passphrase",
    });

    const outDir = join(dir, "restored2");
    await expect(
      decryptToDir({ archivePath: outPath, outDir, passphrase: "WRONG-passphrase" }),
    ).rejects.toThrow(ArchiveAuthError);
  });

  it("rejects a file that is not a Stoop archive at all", async () => {
    const notArchive = join(dir, "not-an-archive.tar.gz.enc");
    writeFileSync(notArchive, Buffer.alloc(100, 1));
    const outDir = join(dir, "restored3");
    await expect(
      decryptToDir({ archivePath: notArchive, outDir, passphrase: "whatever" }),
    ).rejects.toThrow(ArchiveFormatError);
  });
});
