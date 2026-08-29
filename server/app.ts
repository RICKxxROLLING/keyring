import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { loadEnv } from "./config/env.js";
import { initDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { ApiError, errorBody, installErrorHandler } from "./lib/errors.js";
import { newId } from "./lib/ids.js";
import { startJobs, stopJobs } from "./lib/scheduler.js";
import type { AppContext } from "./context.js";
import { registerAuth } from "./auth/register.js";
import { registerRealtime } from "./realtime/register.js";
import { registerDomain } from "./domain/register.js";
import { registerOps } from "./ops/register.js";

export interface BuildAppOptions {
  /** Tests pass false. Production leaves it undefined. */
  startJobs?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = loadEnv();
  const db = initDb(env.DB_PATH);
  runMigrations(db);

  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    genReqId: () => newId("req"),
    bodyLimit: 1_000_000,
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          'req.headers["x-csrf-token"]',
          "req.body.password",
          "req.body.newPassword",
          "req.body.currentPassword",
          "req.body.code",
          "req.body.recoveryCode",
          "req.body.setupToken",
        ],
        remove: true,
      },
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: env.SECURE_COOKIES ? [] : null,
      },
    },
    hsts: env.SECURE_COOKIES ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "same-origin" },
  });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    allowList: (req) => req.url === "/healthz",
  });
  await app.register(multipart, {
    limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 10, parts: 12 },
  });
  await app.register(websocket, { options: { maxPayload: 262_144 } });

  installErrorHandler(app);
  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Request-Id", String(req.id));
  });

  const ctx: AppContext = { app, db, env };

  await registerAuth(app, ctx);
  await registerRealtime(app, ctx);
  await registerDomain(app, ctx);
  await registerOps(app, ctx);

  const publicDir = join(process.cwd(), "dist", "public");
  const hasBuild = existsSync(join(publicDir, "index.html"));
  if (hasBuild) {
    await app.register(fastifyStatic, { root: publicDir, prefix: "/", wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.url.startsWith("/ws") || req.url === "/healthz") {
      return reply
        .code(404)
        .send(errorBody(new ApiError("NOT_FOUND", "No such endpoint."), String(req.id)));
    }
    if (hasBuild) return reply.sendFile("index.html");
    return reply.code(404).type("text/plain").send("UI not built. Run `npm run build:web`.\n");
  });

  if (opts.startJobs !== false) startJobs(app.log, env.APP_TIMEZONE);
  app.addHook("onClose", async () => {
    stopJobs();
  });

  return app;
}
