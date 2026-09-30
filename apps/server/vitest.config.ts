import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "@pl/server", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] } });
