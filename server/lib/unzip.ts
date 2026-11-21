// server/lib/unzip.ts — read entries out of a ZIP held in memory.
//
// For the UAD 3.6 delivery package (an XML file, the report PDF and an Images
// folder). Only what that needs: stored and deflated entries, read through the
// central directory, which carries the true sizes even when the local header
// defers them to a data descriptor.
//
// Nothing is written to disk, so path tricks ("../../etc") cannot escape
// anywhere; names are returned as data. What CAN hurt is a small file that
// inflates to gigabytes, so every entry is inflated with a hard output ceiling
// and the archive as a whole has a budget. Encrypted entries and ZIP64 are
// refused rather than half-read.
import { inflateRawSync } from "node:zlib";

export interface UnzippedEntry {
  name: string;
  data: Buffer;
}

export class ZipError extends Error {}

export interface UnzipLimits {
  /** Largest single entry once inflated. */
  maxEntryBytes: number;
  /** All inflated entries together. */
  maxTotalBytes: number;
  maxEntries: number;
}

const DEFAULT_LIMITS: UnzipLimits = {
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 160 * 1024 * 1024,
  maxEntries: 2000,
};

export function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
}

/**
 * Read the entries whose names pass `want` (all of them if omitted).
 * Directories are skipped. Throws ZipError on anything malformed.
 */
export function unzip(
  buf: Buffer,
  want: (name: string) => boolean = () => true,
  limits: Partial<UnzipLimits> = {},
): UnzippedEntry[] {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  // The end-of-central-directory record is in the last 64 KiB + 22 bytes.
  const searchFrom = Math.max(0, buf.length - 0xffff - 22);
  let eocd = -1;
  for (let p = buf.length - 22; p >= searchFrom; p--) {
    if (buf.readUInt32LE(p) === 0x06054b50) {
      eocd = p;
      break;
    }
  }
  if (eocd === -1) throw new ZipError("Not a ZIP file, or the file is truncated.");

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError("ZIP64 archives are not supported.");
  if (count > lim.maxEntries) throw new ZipError("Too many files in the archive.");

  const out: UnzippedEntry[] = [];
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new ZipError("Corrupt ZIP central directory.");
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x0800 ? "utf8" : "latin1");
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/") || !want(name)) continue;
    if (flags & 0x0001) throw new ZipError("Encrypted ZIP entries are not supported.");
    if (size > lim.maxEntryBytes) throw new ZipError(`"${name}" is too large to read.`);
    total += size;
    if (total > lim.maxTotalBytes) throw new ZipError("The archive is too large to read.");

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new ZipError("Corrupt ZIP local header.");
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    if (start + compSize > buf.length) throw new ZipError("The archive is truncated.");
    const raw = buf.subarray(start, start + compSize);

    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try {
        // The ceiling is the declared size: an entry that inflates past what
        // its own header claims is either corrupt or hostile.
        data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      } catch {
        throw new ZipError(`Could not decompress "${name}".`);
      }
    } else throw new ZipError(`"${name}" uses an unsupported compression method.`);
    if (data.length !== size) throw new ZipError(`"${name}" is corrupt.`);
    out.push({ name, data });
  }
  return out;
}
