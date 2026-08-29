import { randomBytes } from "node:crypto";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

function encodeTime(ms: number): string {
  let n = ms;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ENCODING[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += ENCODING[bytes[i]! % 32];
  return out;
}

/** '<prefix>_<26 char ULID-style id>'. Sortable by creation millisecond. */
export function newId(prefix: string): string {
  return `${prefix}_${encodeTime(Date.now())}${encodeRandom()}`;
}

/** Opaque high-entropy token for cookies, invites, and MFA challenges. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function isId(value: unknown, prefix?: string): value is string {
  if (typeof value !== "string") return false;
  const m = /^([a-z]{2,4})_([0-9A-HJKMNP-TV-Z]{26})$/.exec(value);
  if (!m) return false;
  return prefix === undefined || m[1] === prefix;
}
