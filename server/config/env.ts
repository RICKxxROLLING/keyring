import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the database lives, when DB_PATH is not set explicitly.
 *
 * The file was called `stoop.db` before the rename to Keyring. New
 * deployments get `keyring.db`, but an existing deployment must NOT quietly
 * start a brand-new empty database beside its real one — that presents as
 * "all my data vanished after an update", which is about the worst possible
 * outcome of a cosmetic rename.
 *
 * So: prefer keyring.db; adopt a pre-existing stoop.db when keyring.db is not
 * there. Setting DB_PATH explicitly overrides all of this.
 */
function defaultDbPath(dataDir: string): string {
  const current = join(dataDir, "keyring.db");
  if (existsSync(current)) return current;
  const legacy = join(dataDir, "stoop.db");
  if (existsSync(legacy)) return legacy;
  return current;
}

export interface Env {
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  HOST: string;
  APP_ORIGIN: string;
  APP_VERSION: string;
  APP_TIMEZONE: string;
  DATA_DIR: string;
  DB_PATH: string;
  UPLOAD_DIR: string;
  BACKUP_DIR: string;
  SESSION_SECRET: string;
  SETUP_TOKEN: string | null;
  BACKUP_PASSPHRASE: string | null;
  SESSION_TTL_HOURS: number;
  INVITE_TTL_HOURS: number;
  UPLOAD_MAX_BYTES: number;
  RATE_LIMIT_MAX: number;
  AUTH_MAX_ATTEMPTS: number;
  AUTH_LOCKOUT_MINUTES: number;
  BACKUP_AT: string;
  BACKUP_RETENTION_DAYS: number;
  LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  /**
   * Who to believe `X-Forwarded-For` from. Either a boolean, or a
   * comma-separated list of IPs / CIDR ranges / the named presets
   * `loopback`, `linklocal`, `uniquelocal`. Defaults to
   * `"loopback,uniquelocal"`. A hop count is NOT supported — Fastify fails
   * closed on a numeric value; see loadEnv().
   */
  TRUST_PROXY: boolean | string;
  SECURE_COOKIES: boolean;
}

function str(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${key}`);
  }
  return v;
}
function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${key} must be a number`);
  return n;
}
function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

let cached: Env | null = null;

/** Re-reads process.env. Tests call this indirectly via buildApp(). */
export function loadEnv(): Env {
  const nodeEnv = (process.env.NODE_ENV ?? "development") as Env["NODE_ENV"];
  const dataDir = str("DATA_DIR", "./data");
  const origin = str("APP_ORIGIN", "http://localhost:8080");
  const isProd = nodeEnv === "production";
  const secret = process.env.SESSION_SECRET ?? "";
  if (isProd && secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters in production");
  }
  // SECURITY: default to trusting only PRIVATE peers, never `true`.
  //
  // With `trustProxy: true`, proxy-addr trusts every address in the chain and
  // resolves req.ip to the LEFTMOST X-Forwarded-For entry — which the client
  // writes. That makes req.ip attacker-controlled: both rate limiters key on it
  // (so they are defeated by rotating one header) and every audit_log.ip value
  // becomes forgeable. On a public hostname that is not acceptable.
  //
  // "loopback,uniquelocal" trusts an X-Forwarded-For header only when the
  // immediate peer is on 127.0.0.0/8, ::1, or an RFC1918/ULA range — i.e. the
  // cloudflared sidecar on the Docker bridge network. A client out on the
  // internet cannot connect from a private address, so it cannot get its
  // forged header believed.
  //
  // NOTE: a hop COUNT does not work here and must not be used. This Fastify
  // version deliberately fails closed on a numeric trustProxy —
  // "Hop-count-only trust cannot validate the immediate peer" — so a number
  // silently trusts NOTHING and req.ip becomes the sidecar's own address,
  // which collapses rate limiting onto one key for all users. Configure
  // ranges, not counts.
  const trustRaw = (process.env.TRUST_PROXY ?? "loopback,uniquelocal").trim();
  const trustProxy: boolean | string =
    trustRaw === "" ? "loopback,uniquelocal"
    : trustRaw.toLowerCase() === "true" ? true
    : trustRaw.toLowerCase() === "false" ? false
    // A bare number would fail closed inside Fastify and silently break IP
    // resolution, so treat it as a misconfiguration and fall back to the safe
    // default rather than honouring it.
    : /^\d+$/.test(trustRaw) ? "loopback,uniquelocal"
    : trustRaw;
  const env: Env = {
    NODE_ENV: nodeEnv,
    PORT: num("PORT", 8080),
    HOST: str("HOST", "0.0.0.0"),
    APP_ORIGIN: origin.replace(/\/+$/, ""),
    APP_VERSION: str("APP_VERSION", "1.0.0"),
    APP_TIMEZONE: str("APP_TIMEZONE", "America/New_York"),
    DATA_DIR: dataDir,
    DB_PATH: str("DB_PATH", defaultDbPath(dataDir)),
    UPLOAD_DIR: str("UPLOAD_DIR", join(dataDir, "uploads")),
    BACKUP_DIR: str("BACKUP_DIR", join(dataDir, "backups")),
    SESSION_SECRET: secret || "dev-only-insecure-secret-dev-only-insecure",
    SETUP_TOKEN: process.env.SETUP_TOKEN || null,
    BACKUP_PASSPHRASE: process.env.BACKUP_PASSPHRASE || null,
    SESSION_TTL_HOURS: num("SESSION_TTL_HOURS", 336),
    INVITE_TTL_HOURS: num("INVITE_TTL_HOURS", 72),
    UPLOAD_MAX_BYTES: num("UPLOAD_MAX_BYTES", 26_214_400),
    RATE_LIMIT_MAX: num("RATE_LIMIT_MAX", 600),
    AUTH_MAX_ATTEMPTS: num("AUTH_MAX_ATTEMPTS", 5),
    AUTH_LOCKOUT_MINUTES: num("AUTH_LOCKOUT_MINUTES", 15),
    BACKUP_AT: str("BACKUP_AT", "03:15"),
    BACKUP_RETENTION_DAYS: num("BACKUP_RETENTION_DAYS", 14),
    LOG_LEVEL: str("LOG_LEVEL", "info") as Env["LOG_LEVEL"],
    TRUST_PROXY: trustProxy,
    SECURE_COOKIES: bool("SECURE_COOKIES", origin.startsWith("https://")),
  };
  cached = env;
  return env;
}

export function getEnv(): Env {
  return cached ?? loadEnv();
}
