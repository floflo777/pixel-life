/**
 * Reusable user flows for the specs: they drive the real UI (no API shortcuts) so each spec reads like the journey.
 */
import { expect, type Page } from "@playwright/test";
import type { MeRes } from "@pl/shared";

/** Longest a Loose Pixels run takes in real time (60 s of sim plus the end slow-mo, with headroom for slow CI). */
export const RUN_TIMEOUT_MS = 100_000;

/** `/connect` → connect the injected wallet → pick `tokenId` → SIWE → bound. */
export async function connectAndBind(page: Page, tokenId: string): Promise<void> {
  await page.goto("/connect");
  await page.getByTestId("connect-wallet").click();
  await page.getByTestId(`pick-${tokenId}`).click();
  await expect(page.getByTestId("bound")).toBeVisible();
}

/** `GET /api/me` with the page's cookies (session or guest). */
export async function me(page: Page): Promise<MeRes> {
  const res = await page.request.get("/api/me");
  expect(res.ok()).toBe(true);
  return (await res.json()) as MeRes;
}

/**
 * Plays one real Loose Pixels run on `/play` (the venue must be mounted) with scripted drag-flings: press down on the
 * stage, drag, release (the Friend launches opposite to the drag), a new direction every fling, until the run ends
 * and the results card shows. Returns the number of flings sent.
 */
export async function playRun(page: Page, options: { gapMs?: number } = {}): Promise<number> {
  const stage = page.locator('[data-testid="play"] canvas').first();
  await page.getByRole("button", { name: "▶ play" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  const box = await stage.boundingBox();
  if (!box) throw new Error("the venue stage has no box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const reach = Math.min(box.width, box.height) / 3;
  const score = page.getByTestId("result-score");
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let flings = 0;
  while (Date.now() < deadline && !(await score.isVisible())) {
    const a = flings * 2.39996; // golden angle: directions spread over the arena
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach, { steps: 6 });
    await page.mouse.up();
    flings++;
    await page.waitForTimeout(options.gapMs ?? 650);
  }
  await expect(score).toBeVisible({ timeout: 5_000 });
  return flings;
}

/** True when the document is not wider than the viewport (the 360 px budget). */
export const noHorizontalOverflow = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
