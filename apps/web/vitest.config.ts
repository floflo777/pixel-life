import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "@pl/web", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] } });
