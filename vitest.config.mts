import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Database suites boot a full Postgres (PGlite) and apply every migration; give them room when run in parallel.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each database suite is a separate in-memory Postgres; too many at once starve each other on a laptop.
    maxWorkers: 4,
  },
});
