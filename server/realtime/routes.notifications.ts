// server/realtime/routes.notifications.ts — /api/notifications/* and /api/presence.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireUser } from "../auth/middleware.js";
import { parseQuery, parseParams, IdParamSchema, zId } from "../lib/validate.js";
import { ok, deleted } from "../lib/errors.js";
import * as notifications from "./notifications.js";
import * as presence from "./presence.js";
import * as hub from "./hub.js";
import { propertyChannel } from "../../shared/realtime.js";

const ListNotificationsQuerySchema = z
  .object({
    unreadOnly: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();

const PresenceQuerySchema = z
  .object({
    propertyId: zId.optional(),
  })
  .strict();

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/notifications", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const q = parseQuery(req, ListNotificationsQuerySchema);
    return ok(notifications.listNotifications(user.id, q));
  });

  app.get("/api/notifications/unread-count", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    return ok({ unread: notifications.getUnreadCount(user.id) });
  });

  app.post("/api/notifications/:id/read", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    return ok(notifications.markRead(user.id, id));
  });

  app.post("/api/notifications/read-all", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    return ok({ marked: notifications.markAllRead(user.id) });
  });

  app.delete("/api/notifications/:id", { preHandler: [requireAuth] }, async (req) => {
    const user = requireUser(req);
    const { id } = parseParams(req, IdParamSchema);
    notifications.deleteNotification(user.id, id);
    return deleted(id);
  });

  app.get("/api/presence", { preHandler: [requireAuth] }, async (req) => {
    const q = parseQuery(req, PresenceQuerySchema);
    const channels = q.propertyId
      ? [propertyChannel(q.propertyId)]
      : hub.listActiveChannels().filter((c) => c.startsWith("property:"));
    return ok({
      channels: channels.map((channel) => ({
        channel,
        users: presence.presenceUsersForChannel(channel),
      })),
    });
  });
}
