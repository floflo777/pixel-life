import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@pl/server",
    include: ["src/**/*.test.ts"],
    // Starts one throwaway PostgreSQL 16 container (or uses TEST_DATABASE_URL); each test file gets its own database.
    globalSetup: ["src/test/global-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
