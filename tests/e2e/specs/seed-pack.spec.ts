/**
 * Seed Pack booth (the stock FriendSDK venue in its sandboxed child, hosted by the trusted shell) against the real
 * server ledger: buy → host confirmation → open → keep → redeem, the simulated balance moving at each step and
 * surviving a reload because the ledger is the server's. Plus: switching wallet account mid-venue closes the booth.
 */
import { existsSync } from "node:fs";
import type { FrameLocator, Page } from "@playwright/test";
import { connectAndBind, me } from "../fixtures/flows.js";
import { expect, test, walletControls } from "../fixtures/index.js";

const SEED_PACK_CHILD = new URL("../../../apps/seed-pack/.friendsdk/game.html", import.meta.url);
const FRAME = 'iframe[src="/venues/seed-pack/game.html"]';

/** Bound owner → The Sky → the booth door; resolves once the child ledger has been read. */
async function enterBooth(page: Page, tokenId: string): Promise<FrameLocator> {
  await connectAndBind(page, tokenId);
  await page.getByRole("link", { name: "enter the sky" }).click();
  await page.getByRole("link", { name: "seed pack booth" }).click();
  await expect(page.locator(FRAME)).toHaveCount(1, { timeout: 15_000 });
  const child = page.frameLocator(FRAME);
  await expect(child.getByRole("button", { name: /buy 1/i })).toBeVisible({ timeout: 15_000 });
  return child;
}

/** The host's confirmation sheet (the child can't move value by itself). */
const confirmOnHost = (page: Page) => page.getByRole("button", { name: /^confirm/i }).click();

const balance = async (page: Page) => (await me(page)).balanceMicro ?? 0;

test.describe("seed pack booth", () => {
  test.skip(!existsSync(SEED_PACK_CHILD), "apps/seed-pack is not built (npm run build:all -w @pl/web)");

  test("buy → open → keep → redeem through the host, on the server ledger", async ({ page, friends }) => {
    const child = await enterBooth(page, friends[0] as string);
    const start = await balance(page);
    expect(start).toBeGreaterThan(0);
    await expect(child.getByText(/simulated/i).first()).toBeVisible();

    // Buy one pack: the trusted host asks, the server ledger charges 5 RF (simulated).
    await child.getByRole("button", { name: /buy 1/i }).click();
    await expect(page.getByText(/no transaction will be sent/i)).toBeVisible();
    await confirmOnHost(page);
    await expect(child.getByText(/1 pack ready/i)).toBeVisible();
    await expect.poll(() => balance(page)).toBe(start - 5_000_000);

    // Open it: the server rolls, the child reveals, the player keeps the reward.
    await child.getByRole("button", { name: /open a pack/i }).click();
    await expect(page.getByText(/use 1 seed pack/i)).toBeVisible();
    await confirmOnHost(page);
    await expect(child.getByRole("button", { name: /reward revealed/i })).toBeVisible({ timeout: 15_000 });
    await child.getByRole("button", { name: /^keep/i }).click();
    await expect(child.locator("button", { hasText: /inventory 1/i })).toBeVisible();

    // A reload keeps the kept reward: the ledger is the server's, not the SDK's session-local preview.
    await page.reload();
    const reconnect = page.getByRole("button", { name: "connect wallet" });
    await expect(reconnect.or(page.locator(FRAME))).toBeVisible({ timeout: 15_000 });
    if (await reconnect.isVisible()) await reconnect.click();
    const again = page.frameLocator(FRAME);
    const inventory = again.locator("button", { hasText: /inventory 1/i });
    await expect(inventory).toBeVisible({ timeout: 15_000 });
    await inventory.click();

    // Redeem the kept reward for its fixed simulated RF value.
    const before = await balance(page);
    await again
      .locator("button:visible:enabled", { hasText: /^redeem 1/i })
      .first()
      .click();
    await confirmOnHost(page);
    await expect(again.locator("button", { hasText: /inventory 0/i })).toBeVisible();
    await expect.poll(() => balance(page)).toBeGreaterThan(before);
  });

  test("switching account mid-venue closes the SDK booth", async ({ page, friends }) => {
    await enterBooth(page, friends[0] as string);
    await walletControls.switchAccount(page, 1);
    await expect(page.locator(FRAME)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Owners only" })).toBeVisible();
    // The flow re-ran discovery for the new account (which owns nothing); let it settle before teardown.
    await page.getByRole("link", { name: "use my friend", exact: true }).click();
    await expect(page.getByTestId("no-friends")).toBeVisible();
  });
});
