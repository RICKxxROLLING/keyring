import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    pool: "forks",
    poolOptions: { forks: { singleFork: false } },
    projects: [
      {
        test: {
          name: "server",
          environment: "node",
          // shared/ runs here rather than in a third project: it is plain,
          // dependency-free TypeScript used by both sides, and node is the
          // cheaper environment to prove it in.
          include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
          setupFiles: [],
          testTimeout: 20000,
        },
      },
      {
        test: {
          name: "web",
          environment: "jsdom",
          include: ["web/**/*.test.{ts,tsx}"],
          setupFiles: ["web/test-setup.ts"],
          testTimeout: 15000,
        },
      },
    ],
  },
});
