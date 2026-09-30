/**
 * The Sky (hub, GDD §11–12) against the real server's WebSocket rooms: two browsers in the plaza see each other
 * arrive, move, emote, chat and leave (asserted on the wire, the ServerMsg frames each browser receives), and every door
 * opens its venue or page and leads back to the Sky. Guests only, so it also runs in `npm run smoke:prod`.
 */
import type { Page, WebSocket } from "@playwright/test";
import type { ServerMsg } from "@pl/shared";
import { REMOTE_URL } from "../env/stack.js";
import { arriveInSky as arrive } from "../fixtures/flows.js";
import { expect, openPlayer, test } from "../fixtures/index.js";

/** Every hub message a page receives on its room socket(s), parsed. Attach before navigating. */
function hubFrames(page: Page): ServerMsg[] {
  const frames: ServerMsg[] = [];
  page.on("websocket", (ws: WebSocket) => {
    if (!ws.url().includes("/ws/room/")) return;
    ws.on("framereceived", ({ payload }) => {
      try {
        const msg = JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8")) as unknown;
        if (Array.isArray(msg)) frames.push(msg as ServerMsg);
      } catch {
        // Not a hub message (binary keep-alive, ...).
      }
    });
  });
  return frames;
}

/** The welcome's `you` id (this browser's presence id in the room). */
const selfId = (frames: readonly ServerMsg[]): string | null => {
  const w = frames.find((m) => m[0] === "welcome");
  return w ? (w[1] as string) : null;
};

test.describe("the sky", () => {
  test.use({ ownedFriends: 0 });

  test("two players see each other arrive, move, emote, chat and leave", async ({ page, browser, chain }) => {
    test.skip(!!REMOTE_URL, "needs a private plaza");
    const a = hubFrames(page);
    await arrive(page);
    await expect.poll(() => selfId(a)).not.toBeNull();
    const idA = selfId(a) as string;

    const other = await openPlayer(browser, chain, { owned: 0, injectWallet: false });
    const b = hubFrames(other.page);
    let idB = "";
    try {
      await arrive(other.page);
      await expect.poll(() => selfId(b)).not.toBeNull();
      idB = selfId(b) as string;
      // B's welcome roster has A; A hears B join.
      const welcomeB = b.find((m) => m[0] === "welcome") as Extract<ServerMsg, ["welcome", ...unknown[]]>;
      expect(welcomeB[2].map((e) => e.id)).toContain(idA);
      await expect.poll(() => a.some((m) => m[0] === "join" && m[1].id === idB)).toBe(true);

      // A walks (tap-to-walk on open ground; touch devices tap) and B sees the move. A few spots, in case one is an
      // obstacle (fountain, sign) the navmesh refuses.
      const box = await page.locator(".sky-stage canvas").first().boundingBox();
      if (!box) throw new Error("the Sky stage has no box");
      const touch = test.info().project.use.hasTouch === true;
      await expect
        .poll(
          async () => {
            const [fx, fy] = [0.2 + Math.random() * 0.6, 0.45 + Math.random() * 0.2];
            const [x, y] = [box.x + box.width * fx, box.y + box.height * fy];
            if (touch) await page.touchscreen.tap(x, y);
            else await page.mouse.click(x, y);
            await page.waitForTimeout(700);
            return b.some((m) => m[0] === "moved" && m[1] === idA);
          },
          { timeout: 15_000 },
        )
        .toBe(true);

      // A emotes and says a quick-chat phrase; B receives both.
      await page.getByRole("group", { name: "Emotes" }).getByRole("button").first().click();
      await expect.poll(() => b.some((m) => m[0] === "emote" && m[1] === idA)).toBe(true);
      await page.getByRole("button", { name: /say…/ }).click();
      await page.getByRole("menuitem", { name: "hi!" }).click();
      await expect.poll(() => b.some((m) => m[0] === "say" && m[1] === idA)).toBe(true);
    } finally {
      await other.context.close();
    }
    await expect.poll(() => a.some((m) => m[0] === "leave" && m[1] === idB), { timeout: 15_000 }).toBe(true);
  });

  /** Every venue and page a door leads to (apps/web/src/hub/doors.ts + the venue registry). */
  const destinations: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
    {
      name: "Loose Pixels",
      path: "/play",
      ready: (p) => expect(p.locator('[data-testid="play"][data-venue="pixel-life"] .live-stage')).toBeVisible(),
    },
    ...["handheld", "pixel-putt", "bump-sumo"].map((id) => ({
      name: id,
      path: `/play?venue=${id}`,
      ready: (p: Page) => expect(p.locator(`[data-testid="play"][data-venue="${id}"] .live-stage`)).toBeVisible(),
    })),
    {
      name: "Seed Pack booth",
      path: "/venue/seed-pack",
      ready: (p) => expect(p.getByRole("heading", { name: /seed pack booth/i }).first()).toBeVisible(),
    },
    {
      name: "Greenhouse",
      path: "/regrow",
      ready: (p) => expect(p.locator("main")).toContainText(/regrow/i),
    },
    { name: "Daily Stone", path: "/board", ready: (p) => expect(p.locator("main")).toContainText(/daily/i) },
    { name: "Mend board", path: "/mend", ready: (p) => expect(p.locator("main")).toContainText(/mend/i) },
  ];
  for (const d of destinations) {
    test(`${d.name} opens from the Sky and leads back`, async ({ page }) => {
      await arrive(page);
      await page.goto(d.path);
      await d.ready(page);
      await expect(page.locator("main")).not.toContainText(/failed to load|no such (game|booth)/i);
      await page.goBack();
      await expect(page).toHaveURL(/\/sky$/);
      await expect(page.getByTestId("sky")).toBeVisible();
    });
  }
});
