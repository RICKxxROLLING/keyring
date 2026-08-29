import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../testing/harness.js";
import { getDb } from "../db/index.js";

/**
 * Parses Fastify's `printRoutes({ commonPrefix: false })` ASCII tree into a flat
 * `{ method, path }[]`. Every indent block in that output is exactly 4 characters
 * ("├── ", "└── ", "│   ", or "    "), so `prefixLength / 4` is the node's depth and
 * everything after the prefix is that node's own path segment, optionally followed by
 * " (METHOD, METHOD)" when the node is itself a registered route.
 */
function parseRoutes(tree: string): { method: string; path: string }[] {
  const out: { method: string; path: string }[] = [];
  const stack: string[] = [];
  for (const rawLine of tree.split("\n")) {
    if (!rawLine.trim()) continue;
    let i = 0;
    while (i + 4 <= rawLine.length && /^(│ {3}| {4}|├── |└── )/.test(rawLine.slice(i))) {
      i += 4;
    }
    const depth = i / 4;
    const content = rawLine.slice(i);
    const match = /^(.*?)(?:\s\(([^)]+)\))?$/.exec(content);
    const segment = match?.[1] ?? content;
    const methods = match?.[2];
    stack.length = depth;
    stack.push(segment);
    if (methods) {
      const fullPath = stack.join("");
      for (const m of methods.split(",").map((s) => s.trim())) {
        out.push({ method: m, path: fullPath });
      }
    }
  }
  return out;
}

describe("route table", () => {
  let ctx: TestApp;

  afterEach(async () => {
    if (ctx) await ctx.close();
  });

  it("no route creates a user other than bootstrap and invite-accept", async () => {
    ctx = await createTestApp();
    const tree = ctx.app.printRoutes({ commonPrefix: false });
    const routes = parseRoutes(tree);
    expect(routes.length).toBeGreaterThan(0);

    const nonGet = routes.filter((r) => r.method !== "GET" && r.method !== "HEAD");
    const userCreators = nonGet.filter(
      (r) =>
        (r.method === "POST" && r.path === "/api/setup/bootstrap") ||
        (r.method === "POST" && /\/api\/invites\/.+\/accept$/.test(r.path) && !r.path.includes("accept/verify")),
    );
    // Exactly the two contract-sanctioned user-creating routes, no more, no fewer.
    expect(userCreators.length).toBe(2);

    const db = getDb();
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;

    for (const route of nonGet) {
      const isSanctioned = userCreators.some((u) => u.method === route.method && u.path === route.path);
      if (isSanctioned) continue;
      // Fire every other mutating route with a garbage/empty body and no session. Every
      // one must fail closed (auth/validation) long before it could touch `users`.
      const url = route.path.replace(/:\w+(\|:\w+)?/g, "x");
      await ctx.app.inject({ method: route.method as "POST", url, payload: {} });
    }

    const after = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it("there is no POST /api/users route of any kind", async () => {
    ctx = await createTestApp();
    const tree = ctx.app.printRoutes({ commonPrefix: false });
    const routes = parseRoutes(tree);
    expect(routes.some((r) => r.method === "POST" && r.path === "/api/users")).toBe(false);
  });
});
