import { defineProject } from "vitest/config";

export default defineProject({ test: { name: "@pl/mock-rpc", include: ["src/**/*.test.ts"] } });
