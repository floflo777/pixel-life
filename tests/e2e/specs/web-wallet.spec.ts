/**
 * Owner path (architecture §1.3 / §1.6 / §5 "Wallet"): connect the injected EIP-6963 test wallet → discover owned
 * Friends (SDK, against the mock chain) → pick → fresh gate → SIWE → server binding → owner identity.
 *
 * The server side is a route mock that does the real checks in Node instead of a running apps/server (which needs
 * PostgreSQL): the SIWE message is parsed, its nonce consumed and its signature verified with viem against the mock
 * chain; `POST /api/session/friend` re-runs the SDK's `readGenerationEligibility` at the mock chain's head, exactly as
 * the server does, and refuses with `not_owner`.
 */
import { existsSync } from "node:fs";
import type { Page } from "@playwright/test";
import { loadDesignFriends, type MockRpcServer } from "@pl/mock-rpc";
import { fromSdkBitmap, playToDto, SEED_PACK, snapshotToDto, type FriendView, type MeRes } from "@pl/shared";
import { createGamePreview, parseChanceGame, RF, type GameClient } from "@rarefriends/friendsdk/game";
import { readGenerationEligibility } from "@rarefriends/friendsdk/identity";
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { expect, test, walletControls } from "../fixtures/index.js";

const SEED_PACK_CHILD = new URL("../../../apps/seed-pack/.friendsdk/game.html", import.meta.url);

interface FakeServer {
  verified: Address | null;
  bound: string | null;
  refusals: number;
  /** Seed-pack ledger ops served, in order (the ServerLedgerClient's traffic). */
  seedpack: string[];
}

/** One persistent Seed Pack ledger per Friend, like the server's (the SDK preview ledger as the reference model). */
const ledgers = new Map<string, GameClient>();
function ledgerFor(tokenId: string): GameClient {
  let l = ledgers.get(tokenId);
  if (!l) {
    l = createGamePreview(parseChanceGame(SEED_PACK), {
      friendId: BigInt(tokenId),
      stake: 1000n * RF,
      rfBalance: 20n * RF,
      draw: () => 42,
    }).client;
    ledgers.set(tokenId, l);
  }
  return l;
}

function friendView(tokenId: string): FriendView {
  const f = loadDesignFriends().find((d) => d.tokenId.toString() === tokenId);
  if (!f) throw new Error(`no design Friend ${tokenId}`);
  const now = Date.now();
  return {
    appearance: {
      tokenId,
      familyId: f.familyId as FriendView["appearance"]["familyId"],
      seed: 0,
      frames: f.frames.map(fromSdkBitmap),
    },
    pub: {
      tokenId,
      scars: { lost: "0".repeat(64), updatedAt: now, version: 0 },
      goldHeld: 0,
      glowCracks: 0,
      streak: 3,
      lastSeen: now,
      economy: "sim",
    },
    loaned: false,
  };
}

/** Route-mocked apps/server identity endpoints with real SIWE and fresh-block ownership checks. */
async function fakeServer(page: Page, mockRpc: MockRpcServer): Promise<FakeServer> {
  const chain = createPublicClient({ transport: http(mockRpc.url) });
  const nonces = new Set<string>();
  const state: FakeServer = { verified: null, bound: null, refusals: 0, seedpack: [] };
  await page.route(
    (u) => u.pathname.startsWith("/api/"),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const key = `${req.method()} ${url.pathname}`;
      const body = (): Record<string, unknown> =>
        req.postData() ? (JSON.parse(req.postData() ?? "{}") as Record<string, unknown>) : {};
      const fail = (status: number, error: string) => route.fulfill({ status, json: { error, message: error } });
      switch (key) {
        case "GET /api/auth/nonce": {
          const nonce = [...crypto.getRandomValues(new Uint8Array(16))]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          nonces.add(nonce);
          return route.fulfill({ json: { nonce } });
        }
        case "POST /api/auth/verify": {
          const { message, signature } = body() as { message: string; signature: Hex };
          const m = parseSiweMessage(message);
          if (!m.address || !m.nonce || !nonces.delete(m.nonce)) return fail(401, "unauthorized");
          if (
            m.chainId !== 4663 ||
            m.domain !== new URL(url.href).host ||
            !message.includes("No transaction, no cost.")
          )
            return fail(401, "unauthorized");
          const ok = await chain.verifyMessage({ address: m.address, message, signature });
          if (!ok) return fail(401, "unauthorized");
          state.verified = getAddress(m.address);
          return route.fulfill({ json: { address: state.verified } });
        }
        case "POST /api/session/friend": {
          if (!state.verified) return fail(401, "unauthorized");
          const { tokenId } = body() as { tokenId: string };
          const e = await readGenerationEligibility(chain, BigInt(tokenId), state.verified);
          if (e.eligible !== true) {
            state.refusals++;
            return fail(403, "not_owner");
          }
          state.bound = tokenId;
          return route.fulfill({ json: friendView(tokenId) });
        }
        case "DELETE /api/session/friend":
          state.bound = null;
          return route.fulfill({ json: { ok: true } });
        case "POST /api/auth/logout":
          state.verified = null;
          state.bound = null;
          return route.fulfill({ json: { ok: true } });
        case "GET /api/me": {
          const me: MeRes = state.verified
            ? {
                identity: { kind: "owner", address: state.verified },
                friend: state.bound ? friendView(state.bound) : null,
                balanceMicro: state.bound ? 20_000_000 : null,
                unread: 0,
                economy: "sim",
              }
            : { identity: { kind: "anon" }, friend: null, balanceMicro: null, unread: 0, economy: "sim" };
          return route.fulfill({ json: me });
        }
        case "POST /api/guest":
          return route.fulfill({ json: { guestId: "g-e2e" } });
        default: {
          const op = /^POST \/api\/seedpack\/(\w+)$/.exec(key)?.[1];
          if (!op) return fail(404, "not_found");
          if (!state.bound) return fail(401, "unauthorized");
          state.seedpack.push(op);
          const l = ledgerFor(state.bound);
          const b = body() as { quantity?: string; playId?: string; outcomeId?: number };
          const q = b.quantity === undefined ? undefined : BigInt(b.quantity);
          if (op === "read") return route.fulfill({ json: snapshotToDto(await l.read()) });
          if (op === "canBuy") return route.fulfill({ json: { ok: await l.canBuy(q ?? 1n) } });
          if (op === "buy") await l.buy(q ?? 1n);
          else if (op === "play") return route.fulfill({ json: { plays: (await l.play(q)).map(playToDto) } });
          else if (op === "settle") return route.fulfill({ json: playToDto(await l.settle(BigInt(b.playId ?? "0"))) });
          else if (op === "redeem") await l.redeem(b.outcomeId ?? 1, q ?? 1n);
          else return fail(404, "not_found");
          return route.fulfill({ json: snapshotToDto(await l.read()) });
        }
      }
    },
  );
  return state;
}

const connect = async (page: Page) => {
  await page.goto("/connect");
  await page.getByTestId("connect-wallet").click();
};

test.describe("wallet", () => {
  test("connect → pick Friend → SIWE → bound", async ({ page, mockRpc, wallet }) => {
    const server = await fakeServer(page, mockRpc);
    await connect(page);
    await expect(page.getByTestId("pick-344030")).toBeVisible();
    await expect(page.getByTestId("pick-344033")).toBeVisible();
    await page.getByTestId("pick-344030").click();
    await expect(page.getByTestId("bound")).toBeVisible();
    expect(server.verified).toBe(getAddress(wallet.address));
    expect(server.bound).toBe("344030");
    await expect(page.getByTestId("hud-friend")).toContainText("#344030");
    await expect(page.getByTestId("hud-friend")).not.toContainText("on loan");

    const asked = await walletControls.requests(page);
    expect(asked).toContain("personal_sign");
    expect(asked).not.toContain("eth_sendTransaction");

    // The owner plays with their own Friend; the balance shows up labelled SIMULATED after the /api/me sync.
    await page.goto("/play");
    await expect(page.getByTestId("hud-rf")).toContainText("SIMULATED");
    await expect(page.getByTestId("hud-friend")).toContainText("#344030");
  });

  test.describe("wrong chain", () => {
    test.use({ walletChainId: "0x1" });
    test("asks to switch to Robinhood Chain, then continues", async ({ page, mockRpc }) => {
      await fakeServer(page, mockRpc);
      await connect(page);
      const sw = page.getByTestId("switch-chain");
      await expect(sw).toBeVisible();
      await expect(sw).toContainText("4663");
      await sw.click();
      await expect(page.getByTestId("pick-344030")).toBeVisible();
      expect(await walletControls.requests(page)).toContain("wallet_switchEthereumChain");
    });
  });

  test.describe("non-owner", () => {
    test.use({ walletFriends: [] });
    test("a wallet with no Friends gets the empty state and never signs", async ({ page, mockRpc }) => {
      const server = await fakeServer(page, mockRpc);
      await connect(page);
      await expect(page.getByTestId("no-friends")).toBeVisible();
      expect(await walletControls.requests(page)).not.toContain("personal_sign");
      expect(server.verified).toBeNull();
      await expect(page.getByRole("link", { name: /keep playing on loan/ })).toBeVisible();
    });
  });

  test("a Friend transferred away after discovery is refused by the fresh gate", async ({ page, mockRpc }) => {
    const server = await fakeServer(page, mockRpc);
    await connect(page);
    await expect(page.getByTestId("pick-344033")).toBeVisible();
    mockRpc.world.transfer(344033n, "0x2222222222222222222222222222222222222222");
    mockRpc.world.mine();
    await page.getByTestId("pick-344033").click();
    await expect(page.getByRole("alert")).toContainText("doesn't own #344033");
    expect(server.bound).toBeNull();
    expect(await walletControls.requests(page)).not.toContain("personal_sign");
  });

  test("switching wallet account drops the bound Friend and re-runs discovery", async ({ page, mockRpc }) => {
    const server = await fakeServer(page, mockRpc);
    await connect(page);
    await page.getByTestId("pick-344030").click();
    await expect(page.getByTestId("bound")).toBeVisible();
    await walletControls.switchAccount(page, 1);
    await expect(page.getByRole("status").filter({ hasText: "changed" })).toBeVisible();
    await expect(page.getByTestId("hud-friend")).toHaveCount(0);
    // Account 1 owns nothing on the mock chain.
    await expect(page.getByTestId("no-friends")).toBeVisible();
    await expect.poll(() => server.bound).toBeNull();
  });

  test("the Seed Pack booth passes the SDK gate and persists packs in the server ledger across reloads", async ({
    page,
    mockRpc,
  }) => {
    test.skip(!existsSync(SEED_PACK_CHILD), "apps/seed-pack is not built (npm run build -w @pl/seed-pack)");
    const server = await fakeServer(page, mockRpc);
    await connect(page);
    await page.getByTestId("pick-344030").click();
    await expect(page.getByTestId("bound")).toBeVisible();

    // In-app navigation keeps the wallet session: bound card → The Sky → the booth door.
    await page.getByRole("link", { name: "enter the sky" }).click();
    await page.getByRole("link", { name: "seed pack booth" }).click();
    const frame = page.locator('iframe[src="/venues/seed-pack/game.html"]');
    await expect(frame).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(() => server.seedpack.includes("read"), { timeout: 15_000 }).toBe(true);

    // Buy one pack inside the sandboxed child; the trusted host asks for confirmation.
    const child = page.frameLocator('iframe[src="/venues/seed-pack/game.html"]');
    await child.getByRole("button", { name: /buy 1/i }).click();
    await page.getByRole("button", { name: /confirm preview/i }).click();
    await expect.poll(() => server.seedpack.includes("buy")).toBe(true);
    expect((await ledgerFor("344030").read()).consumables).toBe(1n);

    // Reload: the pack is still there because the ledger is the server's, not the SDK's session-local preview.
    const before = server.seedpack.length;
    await page.reload();
    // A reload starts a new wallet session: the booth asks to reconnect, then the SDK gate runs again.
    const reconnect = page.getByRole("button", { name: "connect wallet" });
    await expect(reconnect.or(frame)).toBeVisible({ timeout: 15_000 });
    if (await reconnect.isVisible()) await reconnect.click();
    await expect(frame).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(() => server.seedpack.slice(before).includes("read"), { timeout: 15_000 }).toBe(true);
    await expect(child.getByText(/1 pack|packs: 1|× ?1/i).first()).toBeVisible();
  });

  test("switching account mid-venue closes the SDK booth", async ({ page, mockRpc }) => {
    test.skip(!existsSync(SEED_PACK_CHILD), "apps/seed-pack is not built (npm run build -w @pl/seed-pack)");
    await fakeServer(page, mockRpc);
    await connect(page);
    await page.getByTestId("pick-344030").click();
    await page.getByRole("link", { name: "enter the sky" }).click();
    await page.getByRole("link", { name: "seed pack booth" }).click();
    const frame = page.locator('iframe[src="/venues/seed-pack/game.html"]');
    await expect(frame).toHaveCount(1, { timeout: 15_000 });
    await walletControls.switchAccount(page, 1);
    await expect(frame).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Owners only" })).toBeVisible();
    // The flow re-ran discovery for the new account (which owns nothing); let it settle before teardown.
    await page.getByRole("link", { name: "use my friend", exact: true }).click();
    await expect(page.getByTestId("no-friends")).toBeVisible();
  });
});
