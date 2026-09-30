import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@pl/web",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "happy-dom",
    server: { deps: { inline: ["@rarefriends/friendsdk"] } },
  },
});
