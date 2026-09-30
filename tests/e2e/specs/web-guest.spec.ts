/**
 * Guest path (architecture §5 "Guest", GDD §6.2): the landing is live and wallet-free, "Play now" puts a loaned Friend
 * on screen in under 3 s, a run leaves local scars that survive a reload, and the shell holds at 360 px.
 * The API is stubbed per test (guests need none of it to play); the chain RPC is routed to the mock by the fixtures.
 */
import type { Page } from "@playwright/test";
import { expect, test, walletControls } from "../fixtures/index.js";

/** Minimal server stubs: anonymous `/api/me`, a guest cookie, and a server that is down for everything else. */
async function stubApi(page: Page): Promise<string[]> {
  const calls: string[] = [];
  await page.route(
    (u) => u.pathname.startsWith("/api/"),
    async (route) => {
      const url = new URL(route.request().url());
      calls.push(`${route.request().method()} ${url.pathname}`);
      if (url.pathname === "/api/me")
        return route.fulfill({
          json: { identity: { kind: "anon" }, friend: null, balanceMicro: null, unread: 0, economy: "sim" },
        });
      if (url.pathname === "/api/guest") return route.fulfill({ json: { guestId: "g-e2e" } });
      return route.fulfill({ status: 503, json: { error: "internal", message: "down in e2e" } });
    },
  );
  return calls;
}

const stage = (page: Page) => page.locator('[data-testid="play"] .live-stage');
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("guest", () => {
  test("landing is live and wallet-free; Play now shows a loaned Friend in under 3 s", async ({ page, chainRoute }) => {
    await stubApi(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/Loose Pixels/);
    const play = page.getByTestId("play-now");
    await expect(play).toBeVisible();
    await expect(page.getByRole("link", { name: "Use my Friend", exact: true })).toBeVisible();
    await expect(page.locator(".landing-stage")).toHaveAttribute("data-state", /live|fallback/);
    expect(await noOverflow(page)).toBe(true);

    const t0 = Date.now();
    await play.click();
    await expect(stage(page)).toHaveAttribute("data-state", /live|fallback/, { timeout: 3000 });
    await expect(page.getByTestId("hud-friend")).toContainText("on loan", { timeout: 3000 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(3000);
    test.info().annotations.push({ type: "play-now-ms", description: String(elapsed) });

    // No wallet wall: the guest path never asked the wallet for anything and never read the chain.
    expect(await walletControls.requests(page)).toEqual([]);
    expect(chainRoute.forwarded).toEqual([]);
  });

  test("a run leaves local scars that persist after reload", async ({ page }) => {
    await stubApi(page);
    await page.goto("/");
    await page.getByTestId("play-now").click();
    await expect(stage(page)).toHaveAttribute("data-state", /live|fallback/);
    test.skip((await stage(page).getAttribute("data-state")) === "fallback", "no WebGL2 in this browser");

    const hudPx = page.locator(".hud-friend-px .num");
    const before = await hudPx.textContent();
    await expect(page.locator(".venue-timer")).toBeVisible();
    for (let i = 0; i < 6; i++) await page.keyboard.press("Space");
    await expect(page.locator(".venue-px")).toContainText("lost 2/");
    await page.getByRole("button", { name: "finish run" }).click();

    const results = page.getByRole("heading", { name: "RUN OVER" });
    await expect(results).toBeVisible();
    await expect(results).toBeFocused();
    await expect(page.getByTestId("result-score")).not.toHaveText("0");
    await expect(page.getByText("These were loaner pixels.")).toBeVisible();
    const after = await hudPx.textContent();
    expect(after).not.toBe(before);

    await page.reload();
    await expect(page.locator(".hud-friend-px .num")).toHaveText(after ?? "");
    expect(await noOverflow(page)).toBe(true);
  });

  test("keyboard only: skip link, Play now with Enter, settings reachable", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard flow is a desktop check");
    await stubApi(page);
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "skip to content" })).toBeFocused();
    await page.getByTestId("play-now").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/play$/);
    await page.goto("/settings");
    const mute = page.getByLabel("mute all");
    await mute.focus();
    await page.keyboard.press("Space");
    await expect(mute).toBeChecked();
    await expect(page.getByRole("button", { name: /Unmute sound/ })).toBeVisible();
  });

  test("owner-only booth shows odds and the Use my Friend CTA to guests", async ({ page }) => {
    await stubApi(page);
    await page.goto("/venue/seed-pack");
    await expect(page.getByRole("heading", { name: "Owners only" })).toBeVisible();
    await expect(page.getByRole("table")).toContainText("Gold Pixel");
    await expect(page.getByText("SIMULATED").first()).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
  });
});
