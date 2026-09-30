import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "@pl/venue-kit", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] } });
