/**
 * The Sky (hub, GDD §6.5) against the real server's WebSocket rooms: two browsers in the plaza see each other, and every
 * door opens its venue or page and leads back to the Sky. Read-only for the server (guests only), so it also runs in
 * `npm run smoke:prod`.
 */
import type { Page } from "@playwright/test";
import { REMOTE_URL } from "../env/stack.js";
import { expect, openPlayer, test } from "../fixtures/index.js";

const population = (page: Page) => page.locator(".sky-top [role=status]");

/** A guest arriving in the plaza (Play-now identity, then the Sky). */
async function arrive(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("play-now").click();
  await expect(page).toHaveURL(/\/play$/);
  await page.goto("/sky");
  await expect(page.getByTestId("sky")).toBeVisible();
  // A deployed plaza rate-limits WebSocket joins per IP (6/min), which a whole suite from one runner exceeds.
  if (!REMOTE_URL) await expect(population(page)).toContainText(/here/, { timeout: 15_000 });
}

test.describe("the sky", () => {
  test.use({ ownedFriends: 0 });

  test("two players in the plaza see each other arrive and leave", async ({ page, browser, chain }) => {
    // On a deployed build other visitors may be around: only the local stack has an empty plaza to count in.
    test.skip(!!REMOTE_URL, "population counts need a private plaza");
    await arrive(page);
    const before = Number(/(\d+) here/.exec((await population(page).textContent()) ?? "")?.[1] ?? "1");

    const other = await openPlayer(browser, chain, { owned: 0, injectWallet: false });
    try {
      await arrive(other.page);
      await expect(population(page)).toContainText(`${before + 1} here`);
      await expect(population(other.page)).toContainText(`${before + 1} here`);
    } finally {
      await other.context.close();
    }
    await expect(population(page)).toContainText(`${before} here`);
  });

  // Needs createHubScene in the web shell (feat/hub-integration): walk-to-tap and emotes replicate over the room.
  test.fixme("a move and an emote in one browser show up in the other", async () => {});

  const doors: { name: RegExp; url: RegExp; landmark: RegExp }[] = [
    { name: /▶ play/i, url: /\/play$/, landmark: /./ },
    { name: /greenhouse/i, url: /\/shop$/, landmark: /greenhouse/i },
    { name: /seed pack booth/i, url: /\/venue\/seed-pack$/, landmark: /seed pack booth/i },
    { name: /daily stone/i, url: /\/board$/, landmark: /daily/i },
    { name: /mend well/i, url: /\/mend$/, landmark: /mend/i },
  ];
  for (const door of doors) {
    test(`the ${door.name.source.replace(/\\|\/|\^|\$/g, "")} door opens and leads back to the Sky`, async ({
      page,
    }) => {
      await arrive(page);
      await page.getByRole("navigation", { name: "Doors" }).getByRole("link", { name: door.name }).click();
      await expect(page).toHaveURL(door.url);
      await expect(page.locator("main")).toContainText(door.landmark);
      await page.goBack();
      await expect(page).toHaveURL(/\/sky$/);
      await expect(page.getByTestId("sky")).toBeVisible();
    });
  }
});
