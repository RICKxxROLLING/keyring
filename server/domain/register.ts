// server/domain/register.ts — T3's mount point into T1's app.ts (§C9).
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { registerJob } from "../lib/scheduler.js";
import { registerPropertyRoutes } from "./properties/routes.js";
import { registerNoteRoutes } from "./notes/routes.js";
import { registerVendorRoutes } from "./vendors/routes.js";
import { registerWorkOrderRoutes } from "./workorders/routes.js";
import { registerProjectRoutes } from "./projects/routes.js";
import { registerTenantRoutes } from "./tenants/routes.js";
import { registerMoneyRoutes } from "./money/routes.js";
import { registerSpecRoutes } from "./specs/routes.js";
import { registerComplianceRoutes } from "./compliance/routes.js";
import { registerTurnoverRoutes } from "./turnover/routes.js";
import { registerDossierRoutes } from "./dossier/routes.js";
import { registerDashboardRoutes } from "./dashboard/routes.js";
import { registerTimelineRoutes } from "./timeline/routes.js";
import { registerUploadRoutes } from "../uploads/routes.uploads.js";
import { registerSearchRoutes } from "../search/routes.search.js";
import { purgeSoftDeletedFiles } from "../uploads/routes.uploads.js";

export async function registerDomain(app: FastifyInstance, ctx: AppContext): Promise<void> {
  registerPropertyRoutes(app, ctx);
  registerNoteRoutes(app, ctx);
  registerVendorRoutes(app, ctx);
  registerWorkOrderRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerTenantRoutes(app, ctx);
  registerMoneyRoutes(app, ctx);
  registerSpecRoutes(app, ctx);
  registerComplianceRoutes(app, ctx);
  registerTurnoverRoutes(app, ctx);
  registerDossierRoutes(app, ctx);
  registerDashboardRoutes(app, ctx);
  registerTimelineRoutes(app, ctx);
  registerUploadRoutes(app, ctx);
  registerSearchRoutes(app, ctx);

  // pm-generate and rent-roll are registered by their owning modules (workorders/pm.ts,
  // money/rent.ts) so they are colocated with the logic they run.
  registerJob({
    name: "uploads-gc",
    dailyAt: "03:45",
    fn: () => {
      purgeSoftDeletedFiles(7);
    },
  });
}
