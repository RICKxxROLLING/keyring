// server/realtime/register.ts — mounts /ws and /api/notifications, installs the publisher and
// notifier into server/seams.ts. Registration order matters: this must run before registerDomain
// so the first domain write already broadcasts (see §C9).

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";
import { setPublisher, setNotifier, setSocketCloser } from "../seams.js";
import type { EntityEventInput } from "../seams.js";
import { registerJob } from "../lib/scheduler.js";
import { ApiError } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";
import { resolveSessionFromRequest, type ResolvedSession } from "../auth/middleware.js";
import * as hub from "./hub.js";
import * as locksModule from "./locks.js";
import * as drafts from "./drafts.js";
import { handleConnection, type WsLike } from "./socket.js";
import { notifyMentionsImpl, notifyUsersImpl } from "./notifications.js";
import { registerNotificationRoutes } from "./routes.notifications.js";
import { propertyChannel, GLOBAL_CHANNEL } from "../../shared/realtime.js";

declare module "fastify" {
  interface FastifyRequest {
    keyringSession?: ResolvedSession;
  }
}

function publishEntityImpl(e: EntityEventInput): void {
  const channel = e.propertyId ? propertyChannel(e.propertyId) : GLOBAL_CHANNEL;
  hub.broadcast(channel, {
    t: "entity",
    channel,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    propertyId: e.propertyId,
    version: e.version,
    actorId: e.actorId,
    at: nowIso(),
    data: e.data,
  });
}

export async function registerRealtime(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Fresh in-memory state per app build — critical for test isolation (each createTestApp()
  // call runs this again).
  hub.resetHub();
  locksModule.resetLocks();
  drafts.resetDrafts();

  setPublisher(publishEntityImpl);
  setNotifier({ notifyMentions: notifyMentionsImpl, notifyUsers: notifyUsersImpl });
  // Revoking a session must reach the live socket, not just HTTP.
  setSocketCloser({
    closeSession: (sessionId) => hub.closeConnectionsForSession(sessionId),
    closeUser: (userId) => hub.closeConnectionsForUser(userId),
  });

  registerJob({
    name: "realtime-lock-sweep",
    intervalMs: 5000,
    fn: () => {
      locksModule.sweepExpiredLocks();
    },
  });

  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (req: FastifyRequest) => {
        const origin = req.headers.origin;
        if (!origin || origin !== ctx.env.APP_ORIGIN) {
          throw new ApiError("FORBIDDEN", "Origin not allowed.");
        }
        const resolved = resolveSessionFromRequest(req);
        if (!resolved) {
          throw new ApiError("UNAUTHENTICATED", "Sign in required.");
        }
        req.keyringSession = resolved;
      },
    },
    (socket: WsLike, req: FastifyRequest) => {
      const resolved = req.keyringSession;
      if (!resolved) {
        socket.close(1008, "no session");
        return;
      }
      handleConnection(socket, resolved);
    },
  );

  await registerNotificationRoutes(app);
}
