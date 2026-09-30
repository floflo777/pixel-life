import { existsSync } from "node:fs";
import { expect, test } from "../fixtures/index.js";

/** Placeholder until apps/web ships a page (T-web). Replace the body, keep the guard until then. */
const webReady = !!process.env.PL_WEB_URL || existsSync(new URL("../../../apps/web/index.html", import.meta.url));

test.describe("smoke", () => {
  test.skip(!webReady, "apps/web has no index.html yet; set PL_WEB_URL or build the web app");

  test("landing renders and offers guest play within the width budget", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Loose Pixels/i);
    await expect(page.getByRole("button", { name: /play now/i })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
