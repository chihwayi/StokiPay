import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Every query is a real round trip over the SSH tunnel to staging
    // Postgres (docs/handoffs/sprint-3.md's documented tunnel-latency
    // note) — tests with several sequential round trips can exceed
    // vitest's 5s default even though nothing is actually stuck.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
