/**
 * The Sky on a device without WebGL2 (GDD §6.10): no stage, but every door is still a plain link that opens its venue
 * or page, and Back returns to the door list. Chromium only (the switches are Chromium flags).
 */
import { arriveInSky as arrive } from "../fixtures/flows.js";
import { expect, test } from "../fixtures/index.js";

// A browser without WebGL: the Sky falls back to a list of doors. launchOptions forces its own worker.
test.use({
  ownedFriends: 0,
  launchOptions: { args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"] },
});

test.describe("the sky without WebGL", () => {
  test("every door is still a link, and each one opens", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "the WebGL switches are Chromium flags");
    // No stage, so no room either: the fallback is the single-player door list.
    await arrive(page, { live: false });
    const doors = page.getByRole("navigation", { name: "Doors" });
    await expect(doors).toBeVisible();
    const hrefs = await doors.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    for (const href of hrefs) {
      await doors.locator(`a[href="${href}"]`).click();
      await expect(page).not.toHaveURL(/\/sky$/);
      await expect(page.locator("main")).not.toContainText(/failed to load|no such (game|booth)/i);
      await page.goBack();
      await expect(doors).toBeVisible();
    }
  });
});
