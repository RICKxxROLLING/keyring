// server/ops/register.ts — real implementation. Owner: T5.
// Mounts /healthz and /api/ops/*, and registers the nightly `backup` job.
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { registerOpsRoutes } from "./routes.ops.js";
import { registerBackupJob } from "./backup.js";

export async function registerOps(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await registerOpsRoutes(app, ctx);
  registerBackupJob();
}
