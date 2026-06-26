import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["node_modules", ".next", "tests/e2e/**"],
    // Reap any embedded-postgres children that linger after the suite (Windows).
    globalSetup: ["tests/helpers/global-teardown.ts"],
    // Integration tests spin up a real embedded Postgres; give them room.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    // Each integration file boots its own Postgres instance; run files serially
    // so two clusters don't contend for resources or collide during initdb.
    fileParallelism: false,
  },
});
