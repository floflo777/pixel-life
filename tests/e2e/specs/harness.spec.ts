/**
 * Self-test of the e2e harness itself (runs without apps/web): the injected wallet behaves like a
 * real EIP-1193/EIP-6963 wallet and the Robinhood RPC is answered by the mock in every browser.
 */
import { ROBINHOOD_RPC_URL } from "@pl/mock-rpc";
import { createPublicClient, http, type Hex } from "viem";
import { expect, test, TEST_WALLET_INFO, walletControls } from "../fixtures/index.js";

const ORIGIN = "http://pl-e2e.test";

test.beforeEach(async ({ page }) => {
  // A blank first-party page: the wallet init script and routes apply as they will to apps/web.
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>harness</title><main>harness</main>" }),
  );
  await page.goto(`${ORIGIN}/`);
});

test("announces itself over EIP-6963 and as window.ethereum", async ({ page }) => {
  const announced = await page.evaluate(
    () =>
      new Promise<{ info: Record<string, string>; same: boolean }>((resolve) => {
        window.addEventListener("eip6963:announceProvider", (event) => {
          const detail = (event as CustomEvent<{ info: Record<string, string>; provider: unknown }>).detail;
          resolve({ info: { ...detail.info }, same: detail.provider === (window as { ethereum?: unknown }).ethereum });
        });
        window.dispatchEvent(new Event("eip6963:requestProvider"));
      }),
  );
  expect(announced.info).toMatchObject({
    uuid: TEST_WALLET_INFO.uuid,
    name: TEST_WALLET_INFO.name,
    rdns: TEST_WALLET_INFO.rdns,
  });
  expect(announced.same).toBe(true);
});

test("connects, reports chain 4663 and signs SIWE messages that verify on the mock", async ({
  page,
  wallet,
  mockRpc,
}) => {
  const ethereum = (method: string, params: unknown[] = []) =>
    page.evaluate(
      ([m, p]) =>
        (window as unknown as { ethereum: { request(a: object): Promise<unknown> } }).ethereum.request({
          method: m,
          params: p,
        }),
      [method, params] as const,
    );
  expect(await ethereum("eth_accounts")).toEqual([]);
  await expect(ethereum("personal_sign", ["0x00", wallet.address])).rejects.toThrow(/Unauthorized/);
  expect(await ethereum("eth_requestAccounts")).toEqual([wallet.address]);
  expect(await ethereum("eth_chainId")).toBe("0x1237");

  const message = `pl-e2e.test wants you to sign in with your Ethereum account:\n${wallet.address}\n\nSign in to Pixel Life. No transaction, no cost.`;
  const hexMessage = `0x${Buffer.from(message).toString("hex")}`;
  const signature = (await ethereum("personal_sign", [hexMessage, wallet.address])) as Hex;
  const client = createPublicClient({ transport: http(mockRpc.url) });
  expect(await client.verifyMessage({ address: wallet.address, message, signature })).toBe(true);

  // Reads go through the page's RPC URL, which the route answers from the mock.
  expect(BigInt((await ethereum("eth_blockNumber")) as string)).toBe(mockRpc.world.head);
});

test("routes direct page fetches to the Robinhood RPC to the mock (CORS included)", async ({
  page,
  mockRpc,
  chainRoute,
}) => {
  const result = await page.evaluate(async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "eth_chainId" },
        { jsonrpc: "2.0", id: 2, method: "eth_blockNumber" },
      ]),
    });
    return (await response.json()) as { result: string }[];
  }, ROBINHOOD_RPC_URL);
  expect(result.map((r) => r.result)).toEqual(["0x1237", `0x${mockRpc.world.head.toString(16)}`]);
  expect(chainRoute.forwarded.length).toBeGreaterThan(0);
});

test("emits accountsChanged / chainChanged and refuses unknown chains", async ({ page, wallet }) => {
  await page.evaluate(() => {
    const w = window as unknown as {
      ethereum: { on(e: string, l: (v: unknown) => void): void };
      events: unknown[];
    };
    w.events = [];
    w.ethereum.on("accountsChanged", (v) => w.events.push(["accounts", v]));
    w.ethereum.on("chainChanged", (v) => w.events.push(["chain", v]));
  });
  await page.evaluate(() =>
    (window as unknown as { ethereum: { request(a: object): Promise<unknown> } }).ethereum.request({
      method: "eth_requestAccounts",
    }),
  );
  await walletControls.switchAccount(page, 1);
  await walletControls.setChain(page, "0x1");
  const switchError = await page.evaluate(() =>
    (window as unknown as { ethereum: { request(a: object): Promise<unknown> } }).ethereum
      .request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xdead" }] })
      .then(
        () => null,
        (e: { code: number }) => e.code,
      ),
  );
  expect(switchError).toBe(4902);
  const events = await page.evaluate(() => (window as unknown as { events: unknown[] }).events);
  expect(events).toEqual([
    ["accounts", [wallet.address]],
    ["accounts", [wallet.accounts[1]?.address]],
    ["chain", "0x1"],
  ]);
  expect(await walletControls.requests(page)).toContain("wallet_switchEthereumChain");
});

test("an unfunded wallet cannot send transactions", async ({ page, wallet }) => {
  const error = await page.evaluate(async (from) => {
    const { ethereum } = window as unknown as { ethereum: { request(a: object): Promise<unknown> } };
    await ethereum.request({ method: "eth_requestAccounts" });
    return ethereum.request({ method: "eth_sendTransaction", params: [{ from, to: from, value: "0x1" }] }).then(
      () => "sent",
      (e: Error) => e.message,
    );
  }, wallet.address);
  expect(error).toMatch(/insufficient funds/i);
});

test.describe("guest browser", () => {
  test.use({ injectWallet: false });
  test("has no wallet at all", async ({ page }) => {
    expect(await page.evaluate(() => "ethereum" in window || "__plTestWallet" in window)).toBe(false);
  });
});

test.describe("fixture world", () => {
  test.use({ walletFriends: ["344030", "65042", "1969"], walletGenerationZero: ["1969"] });
  test("gives the test wallet its Friends (SDK discovery + eligibility against the mock)", async ({
    wallet,
    mockRpc,
  }) => {
    const { readOwnedFriends } = await import("@rarefriends/friendsdk/owned");
    const { readGenerationEligibility } = await import("@rarefriends/friendsdk/identity");
    const client = createPublicClient({ transport: http(mockRpc.url) });
    const owned = await readOwnedFriends(client, wallet.address);
    expect(owned.friends.map((f) => f.id)).toEqual([65042n, 344030n]);
    expect(owned.hiddenCount).toBe(1);
    expect((await readGenerationEligibility(client, 344030n, wallet.address)).eligible).toBe(true);
    expect((await readGenerationEligibility(client, 344030n, wallet.accounts[1]?.address)).eligible).toBe(false);
  });
});
