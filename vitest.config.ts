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
          include: ["server/**/*.test.ts"],
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
