/**
 * Reusable user flows for the specs: they drive the real UI (no API shortcuts) so each spec reads like the journey.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import type { MeRes } from "@pl/shared";
import { REMOTE_URL } from "../env/stack.js";

/**
 * Longest a Loose Pixels run takes in real time: 60 s of sim plus the end slow-mo. The sim advances at most 8 fixed
 * steps per rendered frame, so on a CPU-starved runner (software WebGL, 2 workers) it runs slower than real time.
 */
export const RUN_TIMEOUT_MS = process.env["CI"] ? 180_000 : 100_000;

/**
 * "Play now" budget (GDD: a Friend on screen in under 3 s). Asserted as is locally and against a deployed build; CI's
 * software-rendered, shared runners only get a loose ceiling (the measured time is attached to the report either way).
 */
export const PLAY_NOW_BUDGET_MS = process.env["CI"] && !REMOTE_URL ? 15_000 : 3_000;

/** Desktop viewport for the long run specs: fewer pixels for SwiftShader to fill, same game. */
export const RUN_VIEWPORT = { width: 960, height: 600 } as const;

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

/** The Loose Pixels results card (the venue's own, a dialog titled "run over · <arena> · gulp: <mood>"). */
export const runResults = (page: Page): Locator => page.getByRole("dialog", { name: /run over|needs a nap/i });

/**
 * Plays one real Loose Pixels run on `/play` (the venue must be mounted, showing its start card) with scripted
 * drag-flings: press on the stage, drag, release (the Friend launches opposite to the drag), a new direction every
 * fling, until the run ends and the venue shows its results card. Returns the number of flings sent.
 */
export async function playRun(page: Page, options: { gapMs?: number } = {}): Promise<number> {
  const stage = page.locator('[data-testid="play"] canvas').first();
  await page.getByRole("button", { name: /▶ play/i }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  const box = await stage.boundingBox();
  if (!box) throw new Error("the venue stage has no box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const reach = Math.min(box.width, box.height) / 3;
  const results = runResults(page);
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let flings = 0;
  while (Date.now() < deadline && !(await results.isVisible())) {
    const a = flings * 2.39996; // golden angle: directions spread over the arena
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach, { steps: 6 });
    await page.mouse.up();
    flings++;
    await page.waitForTimeout(options.gapMs ?? 650);
  }
  await expect(results).toBeVisible({ timeout: 5_000 });
  return flings;
}

/** A stat of the venue results card (`kept`, `score`, `lost`, `bits`, ...), as its text. */
export const resultStat = (page: Page, name: string): Promise<string> =>
  runResults(page).locator(`dt:text-is("${name}") + dd`).innerText();

/** The shell HUD's pixel count for the current Friend (`present/total`), read from its accessible name. */
export async function hudPixels(page: Page): Promise<{ present: number; total: number }> {
  const label = (await page.getByTestId("hud-friend").getAttribute("aria-label")) ?? "";
  const m = /(\d+) of (\d+) pixels/.exec(label);
  if (!m) throw new Error(`unexpected HUD label: ${label}`);
  return { present: Number(m[1]), total: Number(m[2]) };
}

/** True when the document is not wider than the viewport (the 360 px budget). */
export const noHorizontalOverflow = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** A guest arriving in the plaza: Play-now identity, then the Sky (live unless `live: false`, e.g. without WebGL). */
export async function arriveInSky(page: Page, { live = true }: { live?: boolean } = {}): Promise<void> {
  await page.goto("/");
  await page.getByTestId("play-now").click();
  await expect(page).toHaveURL(/\/play/);
  await page.goto("/sky");
  await expect(page.getByTestId("sky")).toBeVisible();
  // A deployed plaza rate-limits WebSocket joins per IP (6/min), which a whole suite from one runner exceeds.
  if (live && !REMOTE_URL)
    await expect(page.getByTestId("sky")).toHaveAttribute("data-status", "online", { timeout: 30_000 });
}
