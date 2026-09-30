// Full buy → open → reveal → keep → redeem flow through the real SDK runtime (GameHost, sandbox, bridge,
// trusted confirmations) with the SDK's mock wallet fixture. Needs Playwright Chromium: `npm run sdk:flow`.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { testGame } from "@rarefriends/friendsdk/testing";

const directory = fileURLToPath(new URL("..", import.meta.url));

for (const width of [360, 960]) {
  await testGame(directory, {
    width,
    timeout: 20_000,
    check: async ({ page, game }) => {
      const confirm = () => page.getByRole("button", { name: "Confirm preview", exact: true }).click();
      await game.getByText("Simulated economy", { exact: false }).waitFor();
      await game.getByRole("button", { name: /^Buy 1/ }).click();
      await confirm();
      await game.getByText("×1 pack ready").waitFor();
      await game.getByRole("button", { name: /^Open a pack/ }).click();
      await confirm();
      // The harness runs with prefers-reduced-motion, so the reveal completes at once.
      const title = game.locator("#sp-reveal-title");
      await title.waitFor();
      const outcome = (await title.textContent()) ?? "";
      assert.ok(["Sprout", "Bloom", "Full Bloom", "Gold Pixel"].includes(outcome), `unexpected outcome ${outcome}`);
      await game.getByRole("button", { name: /^Keep/ }).click();
      await game.getByRole("tab", { name: "Inventory 1" }).waitFor();
      await game.getByRole("tab", { name: "Inventory 1" }).click();
      await game.getByRole("button", { name: new RegExp(`^Redeem one ${outcome} for`) }).click();
      await confirm();
      await game.getByText(`Redeemed ${outcome}:`, { exact: false }).waitFor();
      await game.getByRole("tab", { name: "Inventory 0" }).waitFor();
      console.log(`${width}px: bought, opened ${outcome}, kept, redeemed`);
    },
  });
}
console.log("PASS seed-pack SDK flow");
