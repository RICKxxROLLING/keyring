// server/realtime/frames.ts — schema validation for inbound WebSocket frames.
//
// Every frame arriving on /ws is untrusted input from a client we do not
// control. Before this existed, socket.ts guarded only `JSON.parse` and then
// cast the result `as ClientMessage`, so a well-formed-JSON frame with the
// wrong SHAPE reached the handlers unchecked. Two examples that each threw
// inside the `ws` 'message' listener — an uncaught exception, which with no
// process-level handler takes the whole server down for every user:
//
//   {"t":"sub","channels":123}   -> "channels is not iterable"
//   {"t":"lock.acquire"}         -> "Cannot read properties of undefined
//                                    (reading 'entityType')"
//
// Reachable by any authenticated session, and equally by a stale
// service-worker-cached client after a protocol change — which is the more
// likely way it would actually have happened.
//
// parseClientFrame() is the only way a frame should reach dispatch().

import { z } from "zod";
import type { ClientMessage } from "../../shared/realtime.js";

/** Mirrors EntityType in shared/types.ts. Kept as a literal list so an
 *  unknown entity type is rejected at the edge rather than reaching a lock
 *  key or a repo lookup. */
const zEntityType = z.enum([
  "user", "invite", "session",
  "property", "unit", "note",
  "work_order", "work_order_comment", "pm_template",
  "project", "project_line",
  "tenant", "lease", "rent_entry", "property_expense",
  "vendor", "spec_entry", "compliance_item",
  "turnover", "turnover_item",
  "upload", "notification", "backup",
]);

/** Channel names are `global`, `user:<id>` or `property:<id>`. Bounded so a
 *  client cannot push an unbounded string into the hub's subscription map. */
const zChannel = z.string().min(1).max(128);

const zLockKey = z.object({
  entityType: zEntityType,
  entityId: z.string().min(1).max(64),
  field: z.string().min(1).max(64),
});

/** Draft values carry the in-flight text of a field being edited. Capped well
 *  under the 256 KiB `ws` maxPayload so a single frame cannot be used to pin
 *  memory across every subscriber on the channel. */
const MAX_DRAFT_CHARS = 32_000;

/** At most this many channels in one sub/unsub frame. */
const MAX_CHANNELS_PER_FRAME = 64;

const zClientFrame = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), v: z.number().int(), csrf: z.string().min(1).max(256) }),
  z.object({ t: z.literal("sub"), channels: z.array(zChannel).max(MAX_CHANNELS_PER_FRAME) }),
  z.object({ t: z.literal("unsub"), channels: z.array(zChannel).max(MAX_CHANNELS_PER_FRAME) }),
  z.object({
    t: z.literal("presence"),
    channel: zChannel,
    page: z.string().max(512).nullable().optional(),
    status: z.enum(["active", "idle"]).optional(),
  }),
  z.object({ t: z.literal("lock.acquire"), key: zLockKey, force: z.boolean().optional() }),
  z.object({ t: z.literal("lock.heartbeat"), key: zLockKey }),
  z.object({ t: z.literal("lock.release"), key: zLockKey }),
  z.object({
    t: z.literal("draft"),
    key: zLockKey,
    value: z.string().max(MAX_DRAFT_CHARS),
    seq: z.number().int().nonnegative(),
  }),
  z.object({ t: z.literal("ping") }),
]);

export type ParsedFrame =
  | { ok: true; msg: ClientMessage }
  | { ok: false; reason: string };

/**
 * Parse and validate one raw inbound frame. Never throws — a bad frame is a
 * routine event on a public endpoint, not an exceptional one.
 */
export function parseClientFrame(raw: unknown): ParsedFrame {
  let json: unknown;
  try {
    json = JSON.parse(typeof raw === "string" ? raw : String(raw));
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, reason: "frame must be a JSON object" };
  }
  const result = zClientFrame.safeParse(json);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".");
    return { ok: false, reason: path ? `${path}: ${first?.message}` : (first?.message ?? "invalid frame") };
  }
  return { ok: true, msg: result.data as ClientMessage };
}
