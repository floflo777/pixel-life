/**
 * Owner path (architecture §1.3 / §1.6 / §5 "Wallet") against the real stack: the injected EIP-6963 test wallet →
 * discovery of the Friends minted to it on the shared mock chain (SDK in the browser) → pick → fresh gate → SIWE →
 * apps/server verifies the signature and re-checks ownership on the same chain → bound. Then a real run whose replay
 * the server verifies before the scars stick, and the negative identity cases.
 */
import type { Page } from "@playwright/test";
import { popcount, type Hex64 } from "@pl/shared";
import { getAddress } from "viem";
import { connectAndBind, hudPixels, me, playRun, resultStat, runResults, RUN_TIMEOUT_MS } from "../fixtures/flows.js";
import { expect, test, walletControls } from "../fixtures/index.js";
import { runVerification, seedPastRuns } from "../fixtures/seed.js";

const lostOf = async (page: Page) => popcount(((await me(page)).friend?.pub.scars.lost ?? "0".repeat(64)) as Hex64);

const connect = async (page: Page) => {
  await page.goto("/connect");
  await page.getByTestId("connect-wallet").click();
};

test.describe("wallet", () => {
  test("connect → pick Friend → SIWE → bound (server session)", async ({ page, wallet, friends }) => {
    const [first, second] = friends as [string, string];
    await connect(page);
    await expect(page.getByTestId(`pick-${first}`)).toBeVisible();
    await expect(page.getByTestId(`pick-${second}`)).toBeVisible();
    await page.getByTestId(`pick-${first}`).click();
    await expect(page.getByTestId("bound")).toBeVisible();

    const session = await me(page);
    expect(session.identity).toEqual({ kind: "owner", address: getAddress(wallet.address) });
    expect(session.friend?.appearance.tokenId).toBe(first);
    expect(session.economy).toBe("sim");
    await expect(page.getByTestId("hud-friend")).toContainText(`#${first}`);
    await expect(page.getByTestId("hud-friend")).not.toContainText("on loan");

    const asked = await walletControls.requests(page);
    expect(asked).toContain("personal_sign");
    expect(asked).not.toContain("eth_sendTransaction");

    // The owner plays with their own Friend; the balance shows up labelled SIMULATED after the /api/me sync.
    await page.goto("/play");
    await expect(page.getByTestId("hud-rf")).toContainText(/simulated/i);
    await expect(page.getByTestId("hud-friend")).toContainText(`#${first}`);
  });

  test("a newly connected Friend's first runs teach without scarring", async ({ page, friends }) => {
    await connectAndBind(page, friends[0] as string);
    const res = await page.request.post("/api/runs", {
      data: {
        venueId: "pixel-life",
        kind: "free",
        seed: 1,
        inputs: "",
        claimed: {
          score: 0,
          lostDelta: "f".repeat(64),
          recovered: 0,
          smashed: 0,
          ticks: 3600,
          finalHash: "0".repeat(16),
        },
      },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ applied: false, reason: "newbie" });
    expect(popcount(((await me(page)).friend?.pub.scars.lost ?? "0".repeat(64)) as Hex64)).toBe(0);
  });

  test("a verified run leaves server-side scars that persist", async ({ page, friends }) => {
    test.setTimeout(RUN_TIMEOUT_MS + 60_000);
    const tokenId = friends[0] as string;
    // Past the newbie runs, so this run's scars stick.
    await seedPastRuns(tokenId);
    await connectAndBind(page, tokenId);
    expect(popcount(((await me(page)).friend?.pub.scars.lost ?? "0".repeat(64)) as Hex64)).toBe(0);

    await page.goto("/play");
    const submitted = page.waitForResponse((r) => r.url().endsWith("/api/runs") && r.request().method() === "POST", {
      timeout: RUN_TIMEOUT_MS,
    });
    await playRun(page);
    const ack = (await (await submitted).json()) as { runId: string; verified: string; applied: boolean };
    expect(ack.verified).not.toBe("mismatch");
    await expect(runResults(page)).toBeVisible();
    // No verification problem in the Bits toast.
    await expect(page.getByRole("status").filter({ hasText: /\+\d+ bits/ })).not.toContainText(/verify|offline/i);

    const lost = Number(/\d+/.exec(await resultStat(page, "lost"))?.[0]);
    expect(await lostOf(page)).toBe(lost);
    // The server replays the input log in a worker: the browser's sim and the server's must agree bit for bit.
    await expect.poll(() => runVerification(ack.runId), { timeout: 30_000 }).toBe("ok");

    // A reload restores the owner session from the cookie with the same scars.
    await page.reload();
    await expect(page.getByTestId("hud-friend")).toContainText(`#${tokenId}`);
    expect((await hudPixels(page)).present).toBe((await hudPixels(page)).total - lost);
  });

  test.describe("wrong chain", () => {
    test.use({ walletChainId: "0x1" });
    test("asks to switch to Robinhood Chain, then continues", async ({ page, friends }) => {
      await connect(page);
      const sw = page.getByTestId("switch-chain");
      await expect(sw).toBeVisible();
      await expect(sw).toContainText("4663");
      await sw.click();
      await expect(page.getByTestId(`pick-${friends[0] as string}`)).toBeVisible();
      expect(await walletControls.requests(page)).toContain("wallet_switchEthereumChain");
    });
  });

  test.describe("non-owner", () => {
    test.use({ ownedFriends: 0 });
    test("a wallet with no Friends gets the empty state and never signs", async ({ page }) => {
      await connect(page);
      await expect(page.getByTestId("no-friends")).toBeVisible();
      expect(await walletControls.requests(page)).not.toContain("personal_sign");
      expect((await me(page)).identity.kind).not.toBe("owner");
      await expect(page.getByRole("link", { name: /keep playing on loan/ })).toBeVisible();
    });
  });

  test.describe("generation-0", () => {
    test.use({ ownedFriends: 1, ownedGenerationZero: 1 });
    test("hides generation-0 Friends from the picker", async ({ page, friends }) => {
      const [gen1, gen0] = friends as [string, string];
      await connect(page);
      await expect(page.getByTestId(`pick-${gen1}`)).toBeVisible();
      await expect(page.getByTestId(`pick-${gen0}`)).toHaveCount(0);
    });
  });

  test("a Friend transferred away after discovery is refused by the fresh gate", async ({ page, chain, friends }) => {
    const moved = friends[1] as string;
    await connect(page);
    await expect(page.getByTestId(`pick-${moved}`)).toBeVisible();
    await chain.transfer(moved, "0x2222222222222222222222222222222222222222");
    await chain.mine();
    await page.getByTestId(`pick-${moved}`).click();
    await expect(page.getByRole("alert")).toContainText(`doesn't own #${moved}`);
    expect((await me(page)).friend).toBeNull();
    expect(await walletControls.requests(page)).not.toContain("personal_sign");
  });

  test("the server refuses to bind a Friend the session's address does not own", async ({ page, friends }) => {
    await connectAndBind(page, friends[0] as string);
    // Someone else's Friend (alice holds the design Friends on the shared chain).
    const res = await page.request.post("/api/session/friend", { data: { tokenId: "344030" } });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_owner" });
  });

  test("switching wallet account drops the bound Friend and re-runs discovery", async ({ page, friends }) => {
    await connectAndBind(page, friends[0] as string);
    await walletControls.switchAccount(page, 1);
    await expect(page.getByRole("status").filter({ hasText: "changed" })).toBeVisible();
    await expect(page.getByTestId("hud-friend")).toHaveCount(0);
    // Account 1 owns nothing on the mock chain.
    await expect(page.getByTestId("no-friends")).toBeVisible();
    await expect.poll(async () => (await me(page)).friend).toBeNull();
  });
});
