import { getEnv } from "../config/env.js";

/**
 * Standalone structured logger for code paths outside a Fastify request/response
 * lifecycle (one-time boot messages, CLI scripts). Request-scoped code should prefer
 * `req.log` / `app.log` (Fastify's own pino instance) instead of this module.
 *
 * Never log: passwords, TOTP secrets/codes, recovery codes, session/invite tokens,
 * BACKUP_PASSPHRASE, SESSION_SECRET, tenant email/phone, upload contents. See §C5.13.
 */

const LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
type Level = (typeof LEVELS)[number];

function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

function currentLevel(): Level {
  try {
    return getEnv().LOG_LEVEL;
  } catch {
    return "info";
  }
}

function shouldLog(level: Level): boolean {
  return levelRank(level) <= levelRank(currentLevel());
}

function line(level: Level, obj: unknown, msg?: string): string {
  const extra = obj && typeof obj === "object" ? obj : { value: obj };
  return JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra });
}

export const logger = {
  fatal(obj: unknown, msg?: string): void {
    if (shouldLog("fatal")) console.error(line("fatal", obj, msg));
  },
  error(obj: unknown, msg?: string): void {
    if (shouldLog("error")) console.error(line("error", obj, msg));
  },
  warn(obj: unknown, msg?: string): void {
    if (shouldLog("warn")) console.warn(line("warn", obj, msg));
  },
  /** Routed through console.warn (allowed by eslint) since info has no dedicated sink here. */
  info(obj: unknown, msg?: string): void {
    if (shouldLog("info")) console.warn(line("info", obj, msg));
  },
};
