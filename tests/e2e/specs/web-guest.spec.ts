/**
 * Guest path (architecture §5 "Guest", GDD §6.2) against the real stack: the landing is live and wallet-free, "Play now"
 * puts a loaned Friend on screen in under 3 s, a real run with scripted drag-flings reaches the results card, its
 * scars stay on the local copy after a reload, and the shell holds at 360 px. Read-only on the server: it also runs in
 * `npm run smoke:prod` against a deployed build.
 */
import type { Page } from "@playwright/test";
import { REMOTE_URL } from "../env/stack.js";
import { expect, test, walletControls } from "../fixtures/index.js";
import { hudPixels, noHorizontalOverflow, playRun, resultStat, runResults, RUN_TIMEOUT_MS } from "../fixtures/flows.js";

const stage = (page: Page) => page.locator('[data-testid="play"] .live-stage');

test.describe("guest", () => {
  test.use({ ownedFriends: 0 });

  test("landing is live and wallet-free; Play now shows a loaned Friend in under 3 s", async ({ page, chainRoute }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Loose Pixels/);
    const play = page.getByTestId("play-now");
    await expect(play).toBeVisible();
    await expect(page.getByRole("link", { name: "Use my Friend", exact: true })).toBeVisible();
    await expect(page.locator(".landing-stage")).toHaveAttribute("data-state", /live|fallback/);
    expect(await noHorizontalOverflow(page)).toBe(true);

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

  test("a real run with drag-flings reaches results; the loaner's scars persist and the Sky is next", async ({
    page,
  }) => {
    test.setTimeout(RUN_TIMEOUT_MS + 60_000);
    // Read-only against a deployed build: don't post bot runs to the public Visitors board.
    test.skip(!!REMOTE_URL, "posts a guest run");
    await page.goto("/");
    await page.getByTestId("play-now").click();
    await expect(stage(page)).toHaveAttribute("data-state", /live|fallback/);
    test.skip((await stage(page).getAttribute("data-state")) === "fallback", "no WebGL2 in this browser");

    const before = await hudPixels(page);
    const runs = page.waitForResponse((r) => r.url().endsWith("/api/runs") && r.request().method() === "POST", {
      timeout: RUN_TIMEOUT_MS,
    });
    const flings = await playRun(page);
    expect(flings).toBeGreaterThan(10);
    // The guest run is also sent to the server (Visitors board), best-effort.
    expect((await runs).status()).toBeLessThan(500);

    // The venue's own results card; the shell credits Bits with a toast.
    const results = runResults(page);
    await expect(results).toContainText(/loaner pixels/i);
    expect(Number((await resultStat(page, "score")).replace(/\D/g, ""))).toBeGreaterThanOrEqual(0);
    await expect(page.getByRole("status").filter({ hasText: /\+\d+ bits/ })).toBeVisible();

    // Scars land on the loaner's local copy (the HUD), and survive a reload.
    const lost = Number(/\d+/.exec(await resultStat(page, "lost"))?.[0]);
    await expect.poll(async () => (await hudPixels(page)).present).toBe(before.present - lost);
    const after = await hudPixels(page);
    expect(await noHorizontalOverflow(page)).toBe(true);

    // "walk into the sky" exits the venue into the hub.
    await results.getByRole("button", { name: /walk into the sky/i }).click();
    await expect(page).toHaveURL(/\/sky$/);
    await page.reload();
    expect((await hudPixels(page)).present).toBe(after.present);
  });

  test("keyboard only: skip link, Play now with Enter, settings reachable", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard flow is a desktop check");
    // https://github.com/floflo777/pixel-life/issues/26: a live stage preventDefaults Enter/Space on focused buttons.
    test.fixme(true, "#26 stage swallows Enter/Space on buttons");
    await page.goto("/");
    // Only a live stage installs the key handler: wait for it so the check is deterministic.
    await expect(page.locator(".landing-stage")).toHaveAttribute("data-state", /live|fallback/);
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
    await page.goto("/venue/seed-pack");
    await expect(page.getByRole("heading", { name: "Owners only" })).toBeVisible();
    await expect(page.getByRole("table")).toContainText("Gold Pixel");
    await expect(page.getByText(/simulated/i).first()).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("holds the 360 px width budget on every guest screen", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    for (const path of ["/", "/play", "/sky", "/connect", "/settings", "/inbox", "/venue/seed-pack"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      expect(await noHorizontalOverflow(page), `${path} overflows at 360 px`).toBe(true);
    }
  });
});
