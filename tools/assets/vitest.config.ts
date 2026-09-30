import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "@pl/assets", include: ["src/**/*.test.ts"], testTimeout: 20_000 } });
