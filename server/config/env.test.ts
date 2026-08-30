// Regression tests for the blocker: TRUST_PROXY used to default to `true`,
// which makes proxy-addr trust the whole forwarded chain and resolve req.ip to
// the leftmost X-Forwarded-For entry — a value the client writes. Both rate
// limiters key on req.ip and every audit_log.ip is recorded from it, so the
// default handed any caller control of both.
//
// The fix trusts by ADDRESS RANGE, not by hop count: this Fastify version
// fails closed on a numeric trustProxy ("Hop-count-only trust cannot validate
// the immediate peer"), so a number would silently trust nothing and collapse
// every request onto the sidecar's own IP.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEnv } from "./env.js";

const SAVED = { ...process.env };

/** loadEnv() re-reads process.env on every call, so no cache reset is needed. */
function withEnv(patch: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return loadEnv();
}

describe("TRUST_PROXY", () => {
  beforeEach(() => {
    process.env = { ...SAVED, NODE_ENV: "test", SESSION_SECRET: "x".repeat(40) };
  });
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("defaults to private ranges only, never true", () => {
    const env = withEnv({ TRUST_PROXY: undefined });
    expect(env.TRUST_PROXY).toBe("loopback,uniquelocal");
    // The distinction is the whole point: `true` trusts the entire chain, so a
    // client's own X-Forwarded-For header becomes req.ip.
    expect(env.TRUST_PROXY).not.toBe(true);
  });

  it("accepts an explicit range list", () => {
    expect(withEnv({ TRUST_PROXY: "10.0.0.0/8" }).TRUST_PROXY).toBe("10.0.0.0/8");
  });

  it("falls back to the safe default for a hop count, which Fastify fails closed on", () => {
    // A number would make Fastify trust NOTHING, so req.ip would become the
    // sidecar's address and both rate limiters would key on one value for all
    // users. Treat it as a misconfiguration rather than honouring it.
    expect(withEnv({ TRUST_PROXY: "1" }).TRUST_PROXY).toBe("loopback,uniquelocal");
    expect(withEnv({ TRUST_PROXY: "2" }).TRUST_PROXY).toBe("loopback,uniquelocal");
  });

  it("still honours an explicit true for anyone who opts in deliberately", () => {
    expect(withEnv({ TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true);
  });

  it("honours an explicit false for a direct-exposure deployment", () => {
    expect(withEnv({ TRUST_PROXY: "false" }).TRUST_PROXY).toBe(false);
  });

  it("treats an empty value as unset", () => {
    expect(withEnv({ TRUST_PROXY: "  " }).TRUST_PROXY).toBe("loopback,uniquelocal");
  });
});
