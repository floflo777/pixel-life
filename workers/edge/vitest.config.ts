import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "@pl/edge", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] } });
