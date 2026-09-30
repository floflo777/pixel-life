/**
 * First visit (GDD §6.2): a brand-new browser gets the intro cards over the live landing; they can be skipped (or
 * stepped through with the keyboard), and a returning visitor never sees them again. Read-only: runs in smoke:prod.
 */
import { expect, test } from "../fixtures/index.js";

test.describe("first visit", () => {
  test.use({ seenOnboarding: false, ownedFriends: 0 });

  test("the intro cards show once; skip dismisses them for good", async ({ page }) => {
    await page.goto("/");
    const intro = page.getByRole("dialog");
    await expect(intro).toBeVisible();
    await expect(intro).toContainText(/pixel/i);
    await intro.getByRole("button", { name: /skip/i }).click();
    await expect(intro).toHaveCount(0);
    await expect(page.getByTestId("play-now")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("play-now")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the cards can be stepped through to the end", async ({ page }) => {
    await page.goto("/");
    const intro = page.getByRole("dialog");
    await expect(intro).toBeVisible();
    for (let i = 0; i < 10 && (await intro.count()) > 0; i++) {
      const next = intro.getByRole("button", { name: /next|play|start|done|let's go/i }).last();
      await next.click();
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
