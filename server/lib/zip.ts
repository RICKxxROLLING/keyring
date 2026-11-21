// server/lib/zip.ts — the smallest ZIP writer that every unzip tool opens.
//
// Store-only (no compression): the contents are photos and PDFs, which are
// already compressed, so deflating them again costs CPU and saves nothing. No
// dependency, because the whole format at this level is three fixed headers.
//
// Filenames are written as UTF-8 with general-purpose flag bit 11 set, which
// is what makes "Café floor plan.pdf" survive the trip on macOS and Windows.
// No ZIP64: a single binder is a handful of documents, far below 4 GB, and
// buildZip refuses rather than writing a corrupt archive if that ever changes.
import { crc32 } from "node:zlib";

export interface ZipEntry {
  /** Path inside the archive, forward slashes. */
  name: string;
  data: Buffer;
  /** Defaults to now. */
  modified?: Date;
}

const UTF8_FLAG = 0x0800;
const LIMIT = 0xffffffff;

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function buildZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const { time, date } = dosDateTime(entry.modified ?? new Date());
    const crc = crc32(entry.data) >>> 0;
    const size = entry.data.length;
    if (size >= LIMIT || offset >= LIMIT) throw new Error("Archive too large for a plain ZIP.");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    // extra len, comment len, disk start, internal attrs, external attrs: all 0
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + size;
  }

  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  if (entries.length > 0xffff || offset >= LIMIT) throw new Error("Archive too large for a plain ZIP.");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, ...centrals, end]);
}
