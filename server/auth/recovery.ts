import { randomBytes } from "node:crypto";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { hashToken } from "./middleware.js";
import type { RecoveryCodes } from "../../shared/types.js";

// Crockford-ish alphabet, no ambiguous chars (0/O, 1/I/L excluded).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomSegment(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return hashToken(normalizeCode(code));
}

/** Generates and persists (hashed) a fresh batch of 10 single-use codes. */
export function issueRecoveryCodes(userId: string): RecoveryCodes {
  const db = getDb();
  const at = nowIso();
  const codes: string[] = [];
  const insert = db.prepare(
    `INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)`,
  );
  for (let i = 0; i < 10; i++) {
    const code = `${randomSegment(5)}-${randomSegment(5)}`;
    codes.push(code);
    insert.run(newId("rec"), userId, hashRecoveryCode(code), at);
  }
  return { codes, generatedAt: at };
}

/** Deletes all unused recovery codes for a user (called before re-issuing a batch). */
export function clearUnusedRecoveryCodes(userId: string): void {
  getDb()
    .prepare(`DELETE FROM recovery_codes WHERE user_id = ? AND used_at IS NULL`)
    .run(userId);
}

/**
 * Consumes a matching, unused code for the user, if any. Returns true and marks it
 * used exactly once; returns false (no side effect) when no match is found.
 */
export function consumeRecoveryCode(userId: string, code: string): boolean {
  const db = getDb();
  const hash = hashRecoveryCode(code);
  const row = db
    .prepare(
      `SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
    )
    .get(userId, hash) as { id: string } | undefined;
  if (!row) return false;
  const result = db
    .prepare(`UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`)
    .run(nowIso(), row.id);
  return result.changes === 1;
}
