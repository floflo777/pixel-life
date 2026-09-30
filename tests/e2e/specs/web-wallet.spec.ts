/**
 * Owner path (architecture §1.3 / §1.6 / §5 "Wallet"): connect the injected EIP-6963 test wallet → discover owned
 * Friends (SDK, against the mock chain) → pick → fresh gate → SIWE → server binding → owner identity.
 *
 * The server side is a route mock that does the real checks in Node instead of a running apps/server (which needs
 * PostgreSQL): the SIWE message is parsed, its nonce consumed and its signature verified with viem against the mock
 * chain; `POST /api/session/friend` re-runs the SDK's `readGenerationEligibility` at the mock chain's head, exactly as
 * the server does, and refuses with `not_owner`.
 */
import type { Page } from "@playwright/test";
import { loadDesignFriends, type MockRpcServer } from "@pl/mock-rpc";
import { fromSdkBitmap, type FriendView, type MeRes } from "@pl/shared";
import { readGenerationEligibility } from "@rarefriends/friendsdk/identity";
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { expect, test, walletControls } from "../fixtures/index.js";

interface FakeServer {
  verified: Address | null;
  bound: string | null;
  refusals: number;
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
  const state: FakeServer = { verified: null, bound: null, refusals: 0 };
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
        default:
          return fail(404, "not_found");
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
});
