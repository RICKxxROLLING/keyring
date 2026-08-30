// server/realtime/presence.ts — per-connection presence, broadcast on join/leave/update.
//
// Note on scope: §C8.4's channel table documents "presence" only under `property:<id>`.
// The pinned client API (§C10.4) also exposes `useGlobalPresence()` — "everyone currently
// connected anywhere". Since every connection auto-subscribes to `global` on hello, we treat
// `global` as presence-bearing too (superset of the documented table) so that hook has data to
// read. Flagged in the T2 handoff report as an interpretation call.

import * as hub from "./hub.js";
import type { Channel, PresenceUser } from "../../shared/realtime.js";

export function presenceUsersForChannel(channel: Channel): PresenceUser[] {
  return hub.channelConnIds(channel).map((connId) => {
    const rec = hub.getConnection(connId)!;
    return {
      connId: rec.connId,
      user: rec.user,
      page: rec.page,
      status: rec.status,
      since: rec.since,
    };
  });
}

export function broadcastPresence(channel: Channel): void {
  hub.broadcast(channel, { t: "presence", channel, users: presenceUsersForChannel(channel) });
}

/** Update this connection's page/status and rebroadcast presence for the given channel. */
export function updatePresence(
  connId: string,
  channel: Channel,
  page?: string | null,
  status?: "active" | "idle",
): void {
  const rec = hub.getConnection(connId);
  if (!rec) return;
  if (!rec.channels.has(channel)) return;
  if (page !== undefined) rec.page = page;
  if (status !== undefined) rec.status = status;
  broadcastPresence(channel);
}
