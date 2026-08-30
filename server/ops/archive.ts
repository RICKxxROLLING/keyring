// server/ops/archive.ts — tar + gzip + AES-256-GCM streaming archive format.
// Owner: T5. Implements the pinned header layout from design.md §C11.2:
//
//   offset 0   6 bytes   magic "STOOPB"
//   offset 6   1 byte    format version (0x01)
//   offset 7   1 byte    KDF id (0x01 = scrypt, N=2^15 r=8 p=1, 32-byte key)
//   offset 8   16 bytes  salt
//   offset 24  12 bytes  GCM iv
//   offset 36  ...       ciphertext (gzip'd tar stream, AES-256-GCM)
//   EOF-16     16 bytes  GCM auth tag
//
// The plaintext that is compressed and encrypted is a tar archive containing
// `keyring.db` (a VACUUM INTO snapshot, never the live file) and `uploads/`.

import { createReadStream, createWriteStream, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
} from "node:crypto";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";

// util.promisify() does not reliably resolve crypto.scrypt's 4-arg (with
// options) overload across @types/node versions, so wrap it by hand.
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** Magic written into every new archive. Six ASCII bytes; the header layout is
 *  unchanged from the "STOOPB" era, only the label differs. */
export const ARCHIVE_MAGIC = "KEYRNG";

/**
 * Magics accepted when READING. "STOOPB" is the pre-rebrand label: archives
 * written before the rename are still perfectly valid — same format, same
 * version, same KDF — and refusing them would silently turn every existing
 * backup into an unrestorable file at the exact moment someone needs one.
 * Read compatibility is permanent; there is no reason to ever drop it.
 */
export const ACCEPTED_ARCHIVE_MAGICS: readonly string[] = [ARCHIVE_MAGIC, "STOOPB"];
export const FORMAT_VERSION = 0x01;
export const KDF_SCRYPT = 0x01;

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

export const SALT_LEN = 16;
export const IV_LEN = 12;
export const TAG_LEN = 16;
export const HEADER_LEN = 6 + 1 + 1 + SALT_LEN + IV_LEN; // 36

/** The archive is not a Stoop backup (bad magic / unsupported version or KDF). */
export class ArchiveFormatError extends Error {}
/** GCM tag verification failed: wrong passphrase or a corrupted/tampered archive. */
export class ArchiveAuthError extends Error {}

export async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  const key = await scrypt(passphrase, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 256 * 1024 * 1024,
  });
  return key;
}

export function buildHeader(salt: Buffer, iv: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_LEN);
  header.write(ARCHIVE_MAGIC, 0, "ascii");
  header.writeUInt8(FORMAT_VERSION, 6);
  header.writeUInt8(KDF_SCRYPT, 7);
  salt.copy(header, 8);
  iv.copy(header, 24);
  return header;
}

export interface ParsedHeader {
  version: number;
  kdfId: number;
  salt: Buffer;
  iv: Buffer;
}

export function parseHeader(buf: Buffer): ParsedHeader {
  if (buf.length < HEADER_LEN) {
    throw new ArchiveFormatError("Archive is too small to contain a valid header.");
  }
  const magic = buf.toString("ascii", 0, 6);
  if (!ACCEPTED_ARCHIVE_MAGICS.includes(magic)) {
    throw new ArchiveFormatError(
      `Not a Keyring backup archive (bad magic: expected one of ` +
        `${ACCEPTED_ARCHIVE_MAGICS.map((m) => `"${m}"`).join(", ")}, found "${magic}").`,
    );
  }
  const version = buf.readUInt8(6);
  if (version !== FORMAT_VERSION) {
    throw new ArchiveFormatError(`Unsupported archive format version ${version}.`);
  }
  const kdfId = buf.readUInt8(7);
  if (kdfId !== KDF_SCRYPT) {
    throw new ArchiveFormatError(`Unsupported KDF id ${kdfId}.`);
  }
  const salt = Buffer.from(buf.subarray(8, 24));
  const iv = Buffer.from(buf.subarray(24, 36));
  return { version, kdfId, salt, iv };
}

export interface EncryptToFileInput {
  /** Directory the tar entries are relative to (a staging dir). */
  cwd: string;
  /** Paths (relative to cwd) to include, e.g. ["keyring.db", "uploads"]. */
  entries: string[];
  outPath: string;
  passphrase: string;
}

export interface EncryptToFileResult {
  sizeBytes: number;
  sha256: string;
}

function writeAndWait(ws: NodeJS.WritableStream, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
}

function endAndWait(ws: import("node:fs").WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

/**
 * Streams cwd/entries -> tar -> gzip -> AES-256-GCM -> outPath, with the pinned
 * header prepended and the GCM auth tag appended. Never writes plaintext to disk.
 */
export async function encryptToFile(input: EncryptToFileInput): Promise<EncryptToFileResult> {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveKey(input.passphrase, salt);
  const header = buildHeader(salt, iv);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const ws = createWriteStream(input.outPath);
  await writeAndWait(ws, header);

  // gzip:true makes node-tar gzip the tar stream itself — this is "tar -> gzip"
  // in one step; the cipher below is the AES-256-GCM layer on top of that.
  const tarStream = tar.create({ cwd: input.cwd, gzip: true, portable: true }, input.entries);

  await pipeline(tarStream, cipher, async function drain(source: AsyncIterable<Buffer>) {
    for await (const chunk of source) {
      await writeAndWait(ws, chunk);
    }
  });

  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LEN) {
    throw new Error(`Unexpected GCM tag length ${tag.length}`);
  }
  await writeAndWait(ws, tag);
  await endAndWait(ws);

  const sizeBytes = statSync(input.outPath).size;
  const sha256 = await sha256File(input.outPath);
  return { sizeBytes, sha256 };
}

export interface DecryptToDirInput {
  archivePath: string;
  outDir: string;
  passphrase: string;
}

/** Decrypts and untars an archive into outDir. Throws ArchiveFormatError / ArchiveAuthError. */
export async function decryptToDir(input: DecryptToDirInput): Promise<void> {
  const size = statSync(input.archivePath).size;
  if (size < HEADER_LEN + TAG_LEN) {
    throw new ArchiveFormatError("Archive is too small to be valid.");
  }
  const headerBuf = await readRange(input.archivePath, 0, HEADER_LEN);
  const { salt, iv } = parseHeader(headerBuf);
  const tag = await readRange(input.archivePath, size - TAG_LEN, TAG_LEN);
  const key = await deriveKey(input.passphrase, salt);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  await mkdir(input.outDir, { recursive: true });

  const ciphertextEnd = size - TAG_LEN - 1;
  const rs = createReadStream(input.archivePath, { start: HEADER_LEN, end: ciphertextEnd });
  // node-tar's extractor auto-detects and un-gzips a gzip-compressed input stream.
  const extractor = tar.extract({ cwd: input.outDir });

  try {
    await pipeline(rs, decipher, extractor);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (/auth|unable to authenticate|bad decrypt|unsupported state/i.test(msg)) {
      throw new ArchiveAuthError(
        "Decryption failed: wrong passphrase or corrupted archive (AES-256-GCM authentication " +
          "tag mismatch). A wrong passphrase is indistinguishable from a corrupt archive by design.",
      );
    }
    throw err;
  }
}

function readRange(file: string, start: number, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const rs = createReadStream(file, { start, end: start + length - 1 });
    rs.on("data", (c) => chunks.push(c as Buffer));
    rs.on("end", () => resolve(Buffer.concat(chunks)));
    rs.on("error", reject);
  });
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const rs = createReadStream(file);
    rs.on("data", (c) => hash.update(c as Buffer));
    rs.on("end", () => resolve(hash.digest("hex")));
    rs.on("error", reject);
  });
}
