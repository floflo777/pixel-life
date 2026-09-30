/**
 * Loose Pixels e2e fixtures. Import `test`/`expect` from here instead of `@playwright/test`.
 *
 * Two chains:
 *  - shared (default on the local stack): the `@pl/mock-rpc --admin` process that apps/server also reads. Every test
 *    gets a fresh random wallet and `friends`, fresh Friends minted to it (see `ownedFriends`), so tests are isolated
 *    without resets. Mutate it with `chain` (mint, transfer, mine, fund).
 *  - per-test (`test.use({ sharedChain: false })`, and always against a deployed URL): an in-process `mockRpc` with the
 *    design Friends (`walletFriends`), for harness and SDK-only checks where no server is involved.
 * Either way the public Robinhood RPC is routed to the mock in every page and frame, and the wallet is injected.
 */
import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { defaultWorldSpec, ROBINHOOD_RPC_URL, startMockRpc, type MockRpcServer } from "@pl/mock-rpc";
import { REMOTE_URL, SHARED_RPC_URL } from "../env/stack.js";
import { routeChainRpc, type ChainRpcRoute } from "./rpc-route.js";
import { sharedChain, type SharedChain } from "./shared-chain.js";
import { createTestWallet, installTestWallet, type TestWallet } from "./test-wallet.js";

/** Per-test options, overridable with `test.use({...})`. */
export interface PixelLifeOptions {
  /** Use the shared stack chain (default: true on the local stack, false against a deployed URL). */
  sharedChain: boolean;
  /** Shared chain: number of fresh generation-1 Friends minted to account 0 (`friends`). */
  ownedFriends: number;
  /** Shared chain: number of extra generation-0 (hidden, SDK-ineligible) Friends minted to account 0. */
  ownedGenerationZero: number;
  /** Per-test chain: design token ids owned by account 0 (see docs/design/data/friends.json). */
  walletFriends: readonly string[];
  /** Per-test chain: subset of `walletFriends` that is generation-0. */
  walletGenerationZero: readonly string[];
  /** Number of random accounts in the wallet (account 1+ own nothing: account-switch cases). */
  walletAccounts: number;
  /** false = guest browser with no wallet at all. */
  injectWallet: boolean;
  /** Chain the wallet starts on, e.g. "0x1" for the wrong-chain case. */
  walletChainId: string;
}

/** Fixtures provided to every test. */
export interface PixelLifeFixtures {
  wallet: TestWallet;
  /** Per-test in-process mock (created only when a test asks for it or `sharedChain` is false). */
  mockRpc: MockRpcServer;
  /** The shared stack chain's admin client. */
  chain: SharedChain;
  /** URL the browser's chain route and the wallet's transactions go to. */
  chainUrl: string;
  /** Shared chain: token ids minted to the wallet's account 0 for this test (generation-1 first). */
  friends: readonly string[];
  chainRoute: ChainRpcRoute;
}

export const test = base.extend<PixelLifeOptions & PixelLifeFixtures>({
  sharedChain: [!REMOTE_URL, { option: true }],
  ownedFriends: [2, { option: true }],
  ownedGenerationZero: [0, { option: true }],
  walletFriends: [["344030", "344033"], { option: true }],
  walletGenerationZero: [[], { option: true }],
  walletAccounts: [2, { option: true }],
  injectWallet: [true, { option: true }],
  walletChainId: ["0x1237", { option: true }],

  wallet: async ({ walletAccounts }, use) => {
    await use(createTestWallet(walletAccounts));
  },

  mockRpc: async ({ wallet, walletFriends, walletGenerationZero }, use) => {
    const server = await startMockRpc({
      world: defaultWorldSpec({ [wallet.address]: walletFriends }, walletGenerationZero),
    });
    await use(server);
    await server.close();
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring form for fixture deps.
  chain: async ({}, use) => {
    await use(sharedChain());
  },

  // The per-test mock is cheap (one loopback server, 13 design Friends), so it always starts; it is simply unused on
  // the shared chain.
  chainUrl: async ({ sharedChain: shared, mockRpc }, use) => {
    await use(shared ? SHARED_RPC_URL : mockRpc.url);
  },

  friends: async ({ sharedChain: shared, chain, wallet, ownedFriends, ownedGenerationZero }, use) => {
    if (!shared) return use([]);
    const ids: string[] = [];
    for (let i = 0; i < ownedFriends; i++) ids.push(await chain.mint(wallet.address));
    for (let i = 0; i < ownedGenerationZero; i++) ids.push(await chain.mint(wallet.address, { generation: 0 }));
    await use(ids);
  },

  chainRoute: async ({ context, chainUrl }, use) => {
    await use(await routeChainRpc(context, chainUrl));
  },

  context: async ({ context, wallet, chainUrl, injectWallet, walletChainId }, use) => {
    if (injectWallet) {
      await installTestWallet(context, wallet, {
        rpcUrl: ROBINHOOD_RPC_URL,
        nodeRpcUrl: chainUrl,
        chainId: walletChainId,
      });
    }
    await use(context);
  },

  // Auto-install the RPC route, and mint the wallet's Friends, before any page exists.
  page: async ({ page, chainRoute: _chainRoute, friends: _friends }, use) => {
    await use(page);
  },
});

export { expect };

/** A second (third, ...) player: own context, own wallet, own minted Friends, same routes as the default page. */
export interface Player {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly wallet: TestWallet;
  readonly friends: readonly string[];
}

/** Opens another player on the shared chain (hub presence, Mend from a second wallet, market buyer). */
export async function openPlayer(
  browser: Browser,
  chain: SharedChain,
  options: { owned?: number; injectWallet?: boolean; contextOptions?: Parameters<Browser["newContext"]>[0] } = {},
): Promise<Player> {
  const wallet = createTestWallet(2);
  const friends: string[] = [];
  for (let i = 0; i < (options.owned ?? 1); i++) friends.push(await chain.mint(wallet.address));
  const context = await browser.newContext(options.contextOptions);
  if (options.injectWallet !== false)
    await installTestWallet(context, wallet, { rpcUrl: ROBINHOOD_RPC_URL, nodeRpcUrl: chain.url });
  await routeChainRpc(context, chain.url);
  return { context, page: await context.newPage(), wallet, friends };
}

export { routeChainRpc, type ChainRpcRoute, type RouteChainRpcOptions } from "./rpc-route.js";
export { E2E_TOKEN_BASE, sharedChain, type SharedChain } from "./shared-chain.js";
export {
  createTestWallet,
  installTestWallet,
  walletControls,
  TEST_WALLET_INFO,
  ROBINHOOD_CHAIN_HEX,
  type TestWallet,
  type InstallTestWalletOptions,
} from "./test-wallet.js";
