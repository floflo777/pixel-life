import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@pl/seed-pack",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "happy-dom",
    // Inline the SDK so its internal `./game.js` import can be spied on (patch fallback test).
    server: { deps: { inline: ["@rarefriends/friendsdk"] } },
  },
});
