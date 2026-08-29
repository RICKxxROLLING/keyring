import { randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/index.js";
import { getEnv } from "../config/env.js";
import { nowIso } from "../lib/time.js";
import { logger } from "../lib/logger.js";
import { hashToken } from "./middleware.js";

interface SetupStateRow {
  token_hash: string | null;
  consumed_at: string | null;
}

function readSetupState(): SetupStateRow | undefined {
  return getDb().prepare(`SELECT token_hash, consumed_at FROM setup_state WHERE id = 1`).get() as
    | SetupStateRow
    | undefined;
}

/**
 * Idempotent. Ensures `setup_state` has row id=1. When no row exists yet and no
 * `SETUP_TOKEN` env var is set, generates a token, logs it once, and writes it to
 * `$DATA_DIR/setup-token.txt` (mode 0600). Called once at boot from registerAuth().
 */
export function initSetupState(): void {
  const existing = readSetupState();
  if (existing) return;
  const db = getDb();
  const env = getEnv();
  let token = env.SETUP_TOKEN;
  let generated = false;
  if (!token) {
    token = randomBytes(24).toString("base64url");
    generated = true;
  }
  db.prepare(`INSERT INTO setup_state (id, token_hash, created_at) VALUES (1, ?, ?)`).run(
    hashToken(token),
    nowIso(),
  );
  if (generated) {
    logger.warn({}, `Generated one-time setup token: ${token}`);
    try {
      const file = join(env.DATA_DIR, "setup-token.txt");
      writeFileSync(file, `${token}\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
    } catch (err) {
      logger.error({ err }, "failed to write setup-token.txt");
    }
  }
}

export function needsSetup(): boolean {
  initSetupState();
  const row = readSetupState();
  return !row || row.consumed_at === null;
}

export function verifySetupToken(token: string): boolean {
  initSetupState();
  const row = readSetupState();
  if (!row?.token_hash) return false;
  return row.token_hash === hashToken(token);
}

export function consumeSetupToken(): void {
  getDb().prepare(`UPDATE setup_state SET consumed_at = ? WHERE id = 1`).run(nowIso());
}
