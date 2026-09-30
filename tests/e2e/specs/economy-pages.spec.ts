/**
 * The public, read-only economy pages (GDD §5.10 "honest economy"): every price, the odds and the Gold book are
 * visible to anyone without a wallet, and everything that is not real RF says SIMULATED. Part of `npm run smoke:prod`.
 *
 * Pending feat/pages-wiring (page modules default-exported and routed): on main /economy, /about and /market still
 * answer "This screen failed to load", so these are test.fixme until it merges.
 */
import { expect, test } from "../fixtures/index.js";
import { noHorizontalOverflow } from "../fixtures/flows.js";

test.describe("economy pages (guest, read-only)", () => {
  test.use({ ownedFriends: 0 });
  test.fixme(true, "needs feat/pages-wiring: the page routes fail to load on main");

  test("/economy publishes the Seed Pack odds and labels simulated money", async ({ page }) => {
    await page.goto("/economy");
    await expect(page.locator("main")).not.toContainText("failed to load");
    await expect(page.getByRole("table").first()).toContainText("Gold Pixel");
    await expect(page.getByText(/simulated/i).first()).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test("/about explains the rule and links to play and the economy", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator("main")).not.toContainText("failed to load");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: /play/i })
        .or(page.getByRole("link", { name: /play/i }))
        .first(),
    ).toBeVisible();
  });

  test("/market shows the Gold book to guests without a buy button", async ({ page }) => {
    await page.goto("/market");
    await expect(page.locator("main")).not.toContainText("failed to load");
    await expect(page.getByText(/simulated/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^buy/i })).toHaveCount(0);
  });

  test("/mend lists resting Friends and asks guests to bring their own", async ({ page }) => {
    await page.goto("/mend");
    await expect(page.locator("main")).not.toContainText(/failed to load|on its way/);
  });
});
