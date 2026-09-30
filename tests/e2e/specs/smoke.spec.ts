import { expect, test } from "../fixtures/index.js";
import { noHorizontalOverflow } from "../fixtures/flows.js";

/** First paint of the landing and the server behind it (also the first check of `npm run smoke:prod`). */
test.describe("smoke", () => {
  test.use({ ownedFriends: 0 });

  test("landing renders and offers guest play within the width budget", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Loose Pixels/i);
    await expect(page.getByRole("button", { name: /play now/i })).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test("the API answers through the same origin", async ({ page }) => {
    const res = await page.request.get("/api/me");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ identity: { kind: "anon" }, economy: expect.stringMatching(/sim|live/) });
  });
});
