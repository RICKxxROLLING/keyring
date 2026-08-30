// server/realtime/hub.ts — connection registry, channel membership, fan-out.
// In-memory only. Never touches the database. Reset between test apps via resetHub().

import type { Channel, ServerMessage } from "../../shared/realtime.js";
import type { UserRef } from "../../shared/types.js";

export interface ConnRecord {
  connId: string;
  /** Minimal duck-typed WebSocket: only what the hub needs to send frames. */
  socket: { send: (data: string) => void; readyState: number };
  userId: string;
  user: UserRef;
  sessionId: string;
  channels: Set<Channel>;
  page: string | null;
  status: "active" | "idle";
  since: string;
}

const OPEN = 1;

const connections = new Map<string, ConnRecord>();
const channelMembers = new Map<Channel, Set<string>>();

export function resetHub(): void {
  connections.clear();
  channelMembers.clear();
}

export function addConnection(rec: ConnRecord): void {
  connections.set(rec.connId, rec);
}

export function getConnection(connId: string): ConnRecord | undefined {
  return connections.get(connId);
}

export function removeConnection(connId: string): void {
  const rec = connections.get(connId);
  if (!rec) return;
  for (const ch of rec.channels) {
    const members = channelMembers.get(ch);
    if (members) {
      members.delete(connId);
      if (members.size === 0) channelMembers.delete(ch);
    }
  }
  connections.delete(connId);
}

export function subscribe(connId: string, channel: Channel): void {
  const rec = connections.get(connId);
  if (!rec) return;
  rec.channels.add(channel);
  let members = channelMembers.get(channel);
  if (!members) {
    members = new Set();
    channelMembers.set(channel, members);
  }
  members.add(connId);
}

export function unsubscribe(connId: string, channel: Channel): void {
  const rec = connections.get(connId);
  if (rec) rec.channels.delete(channel);
  const members = channelMembers.get(channel);
  if (members) {
    members.delete(connId);
    if (members.size === 0) channelMembers.delete(channel);
  }
}

export function channelConnIds(channel: Channel): string[] {
  return [...(channelMembers.get(channel) ?? [])];
}

export function listActiveChannels(): Channel[] {
  return [...channelMembers.keys()];
}

export function send(connId: string, msg: ServerMessage): void {
  const rec = connections.get(connId);
  if (!rec) return;
  if (rec.socket.readyState !== OPEN) return;
  try {
    rec.socket.send(JSON.stringify(msg));
  } catch {
    /* dead socket; the close handler will clean it up */
  }
}

/** Send to every connection in a channel, optionally excluding one connId (e.g. the sender). */
export function broadcast(channel: Channel, msg: ServerMessage, exceptConnId?: string): void {
  for (const connId of channelMembers.get(channel) ?? []) {
    if (connId === exceptConnId) continue;
    send(connId, msg);
  }
}

export function allConnections(): ConnRecord[] {
  return [...connections.values()];
}
