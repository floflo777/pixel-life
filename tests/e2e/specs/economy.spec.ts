/**
 * The SIMULATED economy end to end, owner side (GDD §5, tokenomics): Regrow your own Friend (select → server quote →
 * confirm with the split → receipt; balance and scars move), Mend a stranger's Friend from a second wallet (its owner
 * gets an inbox toast), and the Gold market (list from one Friend, buy from another). Starting states that would take
 * minutes of play (scars, a 2 % Gold Pixel) are seeded in the stack database; everything after that is the real UI.
 *
 * Pending feat/pages-wiring (routes /regrow, /mend/:id, /market, /inbox wired to the API): marked test.fixme until it
 * merges; the selectors follow that branch.
 */
import type { Page } from "@playwright/test";
import { popcount, type Hex64 } from "@pl/shared";
import { connectAndBind, me } from "../fixtures/flows.js";
import { expect, openPlayer, test } from "../fixtures/index.js";
import { seedGold, seedScars } from "../fixtures/seed.js";
import { WEB_URL } from "../env/stack.js";

const lostOf = async (page: Page) => popcount(((await me(page)).friend?.pub.scars.lost ?? "0".repeat(64)) as Hex64);

test.describe("economy (simulated)", () => {
  test.fixme(true, "needs feat/pages-wiring: /regrow, /mend/:id, /market and /inbox are not routed on main yet");

  test("Regrow: quote → confirm → receipt; balance and scars update", async ({ page, friends }) => {
    const tokenId = friends[0] as string;
    await connectAndBind(page, tokenId);
    await seedScars(WEB_URL, tokenId, 4);
    await page.goto("/regrow");
    const balance = (await me(page)).balanceMicro ?? 0;
    expect(await lostOf(page)).toBe(4);

    await page
      .getByRole("group", { name: "quick select" })
      .getByRole("button", { name: /^all 4/ })
      .click();
    await page.getByRole("button", { name: /^regrow 4 px/i }).click();
    // The quote shows the split and the exact price; paying is a second, explicit step.
    const pay = page.getByRole("button", { name: /^regrow · /i });
    await expect(pay).toBeVisible();
    await expect(page.getByText(/simulated/i).first()).toBeVisible();
    await pay.click();

    await expect(page.getByRole("status").filter({ hasText: `+4 px · #${tokenId}` })).toBeVisible();
    expect(await lostOf(page)).toBe(0);
    expect((await me(page)).balanceMicro).toBeLessThan(balance);
    await expect(page.getByTestId("hud-rf")).toContainText(/simulated/i);
  });

  test("Mend from a second wallet: the target's owner gets an inbox toast", async ({
    page,
    friends,
    browser,
    chain,
  }) => {
    const target = friends[0] as string;
    await connectAndBind(page, target);
    await seedScars(WEB_URL, target, 3);
    await page.goto("/sky");

    const mender = await openPlayer(browser, chain, { owned: 1 });
    try {
      await connectAndBind(mender.page, mender.friends[0] as string);
      const before = (await me(mender.page)).balanceMicro ?? 0;
      await mender.page.goto(`/mend/${target}`);
      await mender.page.getByRole("group", { name: "quick select" }).getByRole("button", { name: "1" }).click();
      await mender.page.getByRole("button", { name: /^mend 1 px/i }).click();
      await mender.page.getByRole("button", { name: /^mend · /i }).click();
      await expect(mender.page.getByText("mend done")).toBeVisible();
      expect((await me(mender.page)).balanceMicro).toBeLessThan(before);
    } finally {
      await mender.context.close();
    }

    // The owner, sitting in the Sky, hears about it live and finds it in the inbox.
    await expect(page.getByRole("status").filter({ hasText: /mend/i })).toBeVisible({ timeout: 15_000 });
    expect(await lostOf(page)).toBe(2);
    await page.goto("/inbox");
    await expect(page.getByRole("list", { name: /notifications/ })).toContainText(/mend/i);
  });

  test("Market: list a Gold Pixel from one Friend, buy it from another", async ({ page, friends, browser, chain }) => {
    const seller = friends[0] as string;
    await connectAndBind(page, seller);
    await seedGold(seller);
    await page.goto("/market");
    await page.getByRole("button", { name: /^list/i }).click();
    await page.getByLabel(/price/i).fill("50");
    await page.getByRole("button", { name: /^list .*50/i }).click();
    await expect(page.getByText(/listed/i).first()).toBeVisible();

    const buyer = await openPlayer(browser, chain, { owned: 1 });
    try {
      await connectAndBind(buyer.page, buyer.friends[0] as string);
      const before = (await me(buyer.page)).balanceMicro ?? 0;
      await buyer.page.goto("/market");
      await buyer.page
        .getByRole("button", { name: /^buy .*50/i })
        .first()
        .click();
      await expect(buyer.page.getByRole("status").filter({ hasText: /bought a gold pixel/i })).toBeVisible();
      expect((await me(buyer.page)).balanceMicro).toBe(before - 50_000_000);
    } finally {
      await buyer.context.close();
    }
  });
});
