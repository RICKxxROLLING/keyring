import { join } from "node:path";

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
  TRUST_PROXY: boolean | number;
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
  const trustRaw = process.env.TRUST_PROXY ?? "true";
  const trustNum = Number(trustRaw);
  const env: Env = {
    NODE_ENV: nodeEnv,
    PORT: num("PORT", 8080),
    HOST: str("HOST", "0.0.0.0"),
    APP_ORIGIN: origin.replace(/\/+$/, ""),
    APP_VERSION: str("APP_VERSION", "1.0.0"),
    APP_TIMEZONE: str("APP_TIMEZONE", "America/New_York"),
    DATA_DIR: dataDir,
    DB_PATH: str("DB_PATH", join(dataDir, "stoop.db")),
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
    TRUST_PROXY: Number.isFinite(trustNum) && trustRaw !== "true" ? trustNum : bool("TRUST_PROXY", true),
    SECURE_COOKIES: bool("SECURE_COOKIES", origin.startsWith("https://")),
  };
  cached = env;
  return env;
}

export function getEnv(): Env {
  return cached ?? loadEnv();
}
