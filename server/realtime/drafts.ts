// server/realtime/drafts.ts — ephemeral keystroke fan-out. Never persisted, never audited,
// never indexed, never touches the database.

import * as hub from "./hub.js";
import { touchLockActivity } from "./locks.js";
import { lockKeyString, type LockKey } from "../../shared/realtime.js";

const lastSeq = new Map<string, number>();

export function resetDrafts(): void {
  lastSeq.clear();
}

export function handleDraft(connId: string, key: LockKey, value: string, seq: number): void {
  const conn = hub.getConnection(connId);
  if (!conn) return;
  const keyStr = lockKeyString(key);
  const last = lastSeq.get(keyStr) ?? -1;
  if (seq <= last) return; // out-of-order or duplicate — drop
  lastSeq.set(keyStr, seq);

  // A draft counts as lock activity (extends TTL) without spamming a full lock.state broadcast.
  touchLockActivity(connId, key);

  const channels = [...conn.channels].filter((c) => c.startsWith("property:"));
  for (const ch of channels) {
    hub.broadcast(ch, { t: "draft", key, from: conn.user, value, seq }, connId);
  }
}
