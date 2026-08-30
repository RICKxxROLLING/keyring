// Regression tests for the blocker: a malformed WebSocket frame used to throw
// inside the `ws` 'message' listener, which is an uncaught exception and took
// the whole process down for every user.

import { describe, it, expect } from "vitest";
import { parseClientFrame } from "./frames.js";

describe("parseClientFrame", () => {
  it("accepts every valid client frame shape", () => {
    const key = { entityType: "note", entityId: "not_01ABC", field: "body" };
    const valid: unknown[] = [
      { t: "hello", v: 1, csrf: "tok" },
      { t: "sub", channels: ["global", "property:prp_1"] },
      { t: "unsub", channels: ["property:prp_1"] },
      { t: "presence", channel: "property:prp_1", page: "/p/prp_1", status: "active" },
      { t: "presence", channel: "global" },
      { t: "lock.acquire", key },
      { t: "lock.acquire", key, force: true },
      { t: "lock.heartbeat", key },
      { t: "lock.release", key },
      { t: "draft", key, value: "half a sentence", seq: 3 },
      { t: "ping" },
    ];
    for (const frame of valid) {
      const result = parseClientFrame(JSON.stringify(frame));
      expect(result.ok, `expected to accept ${JSON.stringify(frame)}`).toBe(true);
    }
  });

  // The two frames the reviewer verified would crash the server.
  it("rejects the frames that previously threw, rather than throwing", () => {
    const crashers = [
      // "channels is not iterable" in handleSub
      '{"t":"sub","channels":123}',
      // "Cannot read properties of undefined (reading 'entityType')" in acquireLock
      '{"t":"lock.acquire"}',
    ];
    for (const raw of crashers) {
      expect(() => parseClientFrame(raw)).not.toThrow();
      const result = parseClientFrame(raw);
      expect(result.ok, `expected to reject ${raw}`).toBe(false);
    }
  });

  it("rejects malformed JSON, non-objects and unknown discriminators without throwing", () => {
    const bad = [
      "not json at all",
      "[1,2,3]",
      '"a bare string"',
      "null",
      '{"t":"nope"}',
      "{}",
      '{"t":"draft","key":{"entityType":"note","entityId":"n1","field":"body"},"value":"x"}', // no seq
      '{"t":"draft","key":{"entityType":"WRONG","entityId":"n1","field":"body"},"value":"x","seq":1}',
      '{"t":"presence","channel":"global","status":"whatever"}',
      '{"t":"hello","v":"one","csrf":"tok"}',
    ];
    for (const raw of bad) {
      expect(() => parseClientFrame(raw)).not.toThrow();
      expect(parseClientFrame(raw).ok, `expected to reject ${raw}`).toBe(false);
    }
  });

  it("bounds the fields an attacker controls", () => {
    const key = { entityType: "note", entityId: "n1", field: "body" };
    // Oversized draft value
    expect(
      parseClientFrame(JSON.stringify({ t: "draft", key, value: "x".repeat(40_000), seq: 1 })).ok,
    ).toBe(false);
    // Too many channels in one frame
    expect(
      parseClientFrame(
        JSON.stringify({ t: "sub", channels: Array.from({ length: 200 }, (_, i) => `c${i}`) }),
      ).ok,
    ).toBe(false);
    // Negative sequence number
    expect(parseClientFrame(JSON.stringify({ t: "draft", key, value: "x", seq: -1 })).ok).toBe(false);
  });

  it("reports why a frame was rejected", () => {
    const result = parseClientFrame('{"t":"sub","channels":123}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/channels/);
  });
});
