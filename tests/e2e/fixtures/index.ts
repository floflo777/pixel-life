/**
 * Pixel Life e2e fixtures. Import `test`/`expect` from here instead of `@playwright/test`:
 * every test gets a fresh mock chain (tools/mock-rpc) where a fresh random test wallet owns
 * real design Friends, the Robinhood RPC routed to it, and the wallet injected (EIP-1193 + 6963).
 */
import { test as base, expect } from "@playwright/test";
import { defaultWorldSpec, ROBINHOOD_RPC_URL, startMockRpc, type MockRpcServer } from "@pl/mock-rpc";
import { routeChainRpc, type ChainRpcRoute } from "./rpc-route.js";
import { createTestWallet, installTestWallet, type TestWallet } from "./test-wallet.js";

/** Per-test options, overridable with `test.use({...})`. */
export interface PixelLifeOptions {
  /** Design token ids owned by the test wallet's account 0 (see docs/design/data/friends.json). */
  walletFriends: readonly string[];
  /** Subset of `walletFriends` that is hidden generation-0 (owned, SDK-ineligible). */
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
  mockRpc: MockRpcServer;
  chainRoute: ChainRpcRoute;
}

export const test = base.extend<PixelLifeOptions & PixelLifeFixtures>({
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

  chainRoute: async ({ context, mockRpc }, use) => {
    await use(await routeChainRpc(context, mockRpc.url));
  },

  context: async ({ context, wallet, mockRpc, injectWallet, walletChainId }, use) => {
    if (injectWallet) {
      await installTestWallet(context, wallet, {
        rpcUrl: ROBINHOOD_RPC_URL,
        nodeRpcUrl: mockRpc.url,
        chainId: walletChainId,
      });
    }
    await use(context);
  },

  // Auto-install the RPC route before any page exists.
  page: async ({ page, chainRoute: _chainRoute }, use) => {
    await use(page);
  },
});

export { expect };
export { routeChainRpc, type ChainRpcRoute, type RouteChainRpcOptions } from "./rpc-route.js";
export {
  createTestWallet,
  installTestWallet,
  walletControls,
  TEST_WALLET_INFO,
  ROBINHOOD_CHAIN_HEX,
  type TestWallet,
  type InstallTestWalletOptions,
} from "./test-wallet.js";
