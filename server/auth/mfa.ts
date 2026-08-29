import { getDb } from "../db/index.js";
import { newId, newToken } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { ApiError } from "../lib/errors.js";
import { hashToken } from "./middleware.js";

const MFA_TTL_MINUTES = 10;
const MFA_MAX_ATTEMPTS = 5;

export type MfaPurpose = "login" | "enroll";

export interface MfaChallenge {
  id: string;
  userId: string;
  attempts: number;
}

export function createMfaChallenge(
  userId: string,
  purpose: MfaPurpose,
): { mfaToken: string; expiresAt: string } {
  const db = getDb();
  const mfaToken = newToken();
  const at = nowIso();
  const expiresAt = new Date(Date.now() + MFA_TTL_MINUTES * 60_000).toISOString();
  db.prepare(
    `INSERT INTO mfa_challenges (id, user_id, token_hash, purpose, created_at, expires_at, attempts)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
  ).run(newId("mfa"), userId, hashToken(mfaToken), purpose, at, expiresAt);
  return { mfaToken, expiresAt };
}

interface MfaRow {
  id: string;
  user_id: string;
  attempts: number;
  consumed_at: string | null;
  expires_at: string;
}

/** Loads and validates an in-window, unconsumed, not-yet-exhausted challenge. */
export function loadMfaChallenge(mfaToken: string, purpose: MfaPurpose): MfaChallenge {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id, attempts, consumed_at, expires_at
         FROM mfa_challenges WHERE token_hash = ? AND purpose = ?`,
    )
    .get(hashToken(mfaToken), purpose) as MfaRow | undefined;
  if (!row || row.consumed_at !== null || Date.parse(row.expires_at) < Date.now()) {
    throw new ApiError("FORBIDDEN", "This code has expired or was already used. Sign in again.");
  }
  if (row.attempts >= MFA_MAX_ATTEMPTS) {
    db.prepare(`UPDATE mfa_challenges SET consumed_at = ? WHERE id = ?`).run(nowIso(), row.id);
    throw new ApiError("FORBIDDEN", "Too many attempts. Sign in again.");
  }
  return { id: row.id, userId: row.user_id, attempts: row.attempts };
}

/** Increments the attempt counter; burns the challenge once the cap is reached. */
export function recordMfaFailure(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ?`).run(id);
  const row = db.prepare(`SELECT attempts FROM mfa_challenges WHERE id = ?`).get(id) as {
    attempts: number;
  };
  if (row.attempts >= MFA_MAX_ATTEMPTS) {
    db.prepare(`UPDATE mfa_challenges SET consumed_at = ? WHERE id = ?`).run(nowIso(), id);
  }
}

export function consumeMfaChallenge(id: string): void {
  getDb().prepare(`UPDATE mfa_challenges SET consumed_at = ? WHERE id = ?`).run(nowIso(), id);
}
