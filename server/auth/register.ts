import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { registerAuditRoutes } from "../audit/routes.audit.js";
import { initSetupState } from "./bootstrap.js";
import { registerAuthRoutes } from "./routes.auth.js";
import { registerInviteRoutes } from "./routes.invites.js";
import { registerSetupRoutes } from "./routes.setup.js";
import { registerUserRoutes } from "./routes.users.js";

/**
 * Mounts /api/setup, /api/auth, /api/invites, /api/users, /api/audit.
 * Runs first in the composition order (server/app.ts §C9) so the setup token exists
 * and every later workstream's tests can rely on `requireAuth` / `requireRole` being live.
 */
export async function registerAuth(app: FastifyInstance, _ctx: AppContext): Promise<void> {
  initSetupState();
  await registerSetupRoutes(app);
  await registerAuthRoutes(app);
  await registerInviteRoutes(app);
  await registerUserRoutes(app);
  await registerAuditRoutes(app);
}
