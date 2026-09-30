import type { BrowserContext, Page } from "@playwright/test";
import {
  createPublicClient,
  createWalletClient,
  http,
  isHex,
  type Address,
  type Hex,
  type PrivateKeyAccount,
  type TypedDataDefinition,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/** EIP-6963 identity the test wallet announces (uuid must be a v4 UUID for the SDK to accept it). */
export const TEST_WALLET_INFO = Object.freeze({
  uuid: "6c1a5bd4-5f0e-4d8a-9b39-2f6a4e0c7d11",
  name: "Pixel Life Test Wallet",
  rdns: "dev.pixellife.testwallet",
  icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%2358c'/%3E%3C/svg%3E",
});

/** Robinhood Chain 4663 as a hex chain id. */
export const ROBINHOOD_CHAIN_HEX = "0x1237";

/**
 * A throwaway wallet for e2e: fresh random private keys per test, never funded. Keys stay in the
 * Node test process; the page only sees addresses and asks Node to sign through a binding.
 */
export interface TestWallet {
  /** All accounts (index 0 is the one connected first). */
  readonly accounts: readonly PrivateKeyAccount[];
  /** Address of account 0. */
  readonly address: Address;
}

/** Creates a TestWallet with `count` random, unfunded accounts. */
export function createTestWallet(count = 2): TestWallet {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("A test wallet needs at least one account.");
  const accounts = Array.from({ length: count }, () => privateKeyToAccount(generatePrivateKey()));
  // Invariant: count >= 1, so accounts[0] exists.
  const first = accounts[0] as PrivateKeyAccount;
  return Object.freeze({ accounts: Object.freeze(accounts), address: first.address });
}

/** Options for {@link installTestWallet}. */
export interface InstallTestWalletOptions {
  /** Chain the wallet starts on (hex). Defaults to Robinhood 4663. */
  readonly chainId?: string;
  /** Where the in-page provider forwards read calls. Route it to the mock with `routeChainRpc`. */
  readonly rpcUrl: string;
  /** Node-side RPC for eth_sendTransaction (signs + submits). Usually the mock's URL. */
  readonly nodeRpcUrl: string;
  /** Also set `window.ethereum` (legacy injection). Defaults to true; EIP-6963 is always announced. */
  readonly injectWindowEthereum?: boolean;
}

/** Signing requests the page sends to Node through the binding. */
type SignRequest =
  | { kind: "personal_sign"; from: string; data: string }
  | { kind: "eth_signTypedData_v4"; from: string; data: string }
  | { kind: "eth_sendTransaction"; from: string; tx: Record<string, string | undefined> };

const BINDING = "__plTestWalletSign";

/** Page-side provider state exposed as `window.__plTestWallet` for controls and assertions. */
interface PageWalletControls {
  state: { connected: boolean; active: number; chainId: string; requests: string[] };
  switchAccount(index: number): void;
  setChain(chainId: string): void;
  disconnect(): void;
}

declare global {
  interface Window {
    __plTestWallet?: PageWalletControls;
    __plTestWalletSign?: (request: SignRequest) => Promise<Hex>;
  }
}

/**
 * In-page EIP-1193 provider + EIP-6963 announcer. Serialized by Playwright into every frame of the
 * context, so it must be self-contained. It only installs in the top-level frame: the SDK's
 * sandboxed child must never see a wallet.
 */
function pageWallet(config: {
  addresses: string[];
  chainId: string;
  rpcUrl: string;
  info: typeof TEST_WALLET_INFO;
  injectWindowEthereum: boolean;
  binding: string;
}) {
  if (window.top !== window) return;
  type Listener = (value: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  const knownChains = new Set([config.chainId.toLowerCase(), "0x1237", "0x1"]);
  const state = { connected: false, active: 0, chainId: config.chainId, requests: [] as string[] };
  const emit = (event: string, value: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(value);
  };
  const fail = (code: number, message: string) => Object.assign(new Error(message), { code });
  const activeAddress = () => config.addresses[state.active] ?? "";
  const accounts = () => (state.connected ? [activeAddress()] : []);
  const sign = (request: unknown): Promise<string> => {
    const fn = (window as unknown as Record<string, (r: unknown) => Promise<string>>)[config.binding];
    if (!fn) throw fail(-32603, "Test wallet signer binding missing");
    return fn(request);
  };
  const requireFrom = (from: unknown) => {
    if (!state.connected) throw fail(4100, "Unauthorized: connect first");
    if (typeof from !== "string" || from.toLowerCase() !== activeAddress().toLowerCase())
      throw fail(4100, "Unauthorized: unknown account");
    return from;
  };
  let nextId = 1;
  const rpc = async (method: string, params: unknown) => {
    const response = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params: params ?? [] }),
    });
    const body = (await response.json()) as {
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
    };
    if (body.error) throw Object.assign(new Error(body.error.message), body.error);
    return body.result;
  };
  const provider = {
    isPixelLifeTestWallet: true,
    async request({ method, params }: { method: string; params?: unknown[] | object }) {
      state.requests.push(method);
      const list = Array.isArray(params) ? params : [];
      switch (method) {
        case "eth_accounts":
          return accounts();
        case "eth_requestAccounts":
          if (!state.connected) {
            state.connected = true;
            emit("connect", { chainId: state.chainId });
            emit("accountsChanged", accounts());
          }
          return accounts();
        case "eth_chainId":
          return state.chainId;
        case "net_version":
          return String(parseInt(state.chainId, 16));
        case "wallet_requestPermissions":
        case "wallet_getPermissions":
          return state.connected || method === "wallet_requestPermissions"
            ? [{ parentCapability: "eth_accounts" }]
            : [];
        case "wallet_switchEthereumChain": {
          const chainId = String((list[0] as { chainId?: string } | undefined)?.chainId ?? "").toLowerCase();
          if (!knownChains.has(chainId)) throw fail(4902, `Unrecognized chain ${chainId}`);
          if (chainId !== state.chainId) {
            state.chainId = chainId;
            emit("chainChanged", chainId);
          }
          return null;
        }
        case "wallet_addEthereumChain": {
          const chainId = String((list[0] as { chainId?: string } | undefined)?.chainId ?? "").toLowerCase();
          knownChains.add(chainId);
          return null;
        }
        case "personal_sign":
          return sign({ kind: "personal_sign", from: requireFrom(list[1]), data: String(list[0]) });
        case "eth_signTypedData_v4":
          return sign({ kind: "eth_signTypedData_v4", from: requireFrom(list[0]), data: String(list[1]) });
        case "eth_sendTransaction": {
          const tx = (list[0] ?? {}) as Record<string, string | undefined>;
          return sign({ kind: "eth_sendTransaction", from: requireFrom(tx.from), tx });
        }
        case "eth_sign":
          throw fail(4200, "eth_sign is unsafe and unsupported");
        default:
          if (/^(eth|net|web3)_/.test(method)) return rpc(method, params);
          throw fail(4200, `Unsupported method ${method}`);
      }
    },
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(listener);
      return provider;
    },
    removeListener(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
      return provider;
    },
  };
  const controls: PageWalletControls = {
    state,
    switchAccount(index) {
      if (!config.addresses[index]) throw new RangeError(`No test account ${index}`);
      state.active = index;
      emit("accountsChanged", accounts());
    },
    setChain(chainId) {
      state.chainId = chainId.toLowerCase();
      emit("chainChanged", state.chainId);
    },
    disconnect() {
      state.connected = false;
      emit("accountsChanged", []);
      emit("disconnect", { code: 4900, message: "Test wallet disconnected" });
    },
  };
  Object.defineProperty(window, "__plTestWallet", { value: controls, configurable: true });
  if (config.injectWindowEthereum) Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  const detail = Object.freeze({ info: Object.freeze({ ...config.info }), provider });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}

function accountFor(wallet: TestWallet, from: string): PrivateKeyAccount {
  const account = wallet.accounts.find((a) => a.address.toLowerCase() === from.toLowerCase());
  if (!account) throw new Error(`Test wallet does not hold ${from}`);
  return account;
}

const optionalBigInt = (value: string | undefined) => (value === undefined ? undefined : BigInt(value));

/**
 * Installs the test wallet in every page of `context`: an EIP-1193 provider announced via EIP-6963
 * (and `window.ethereum`), with personal_sign / eth_signTypedData_v4 signed in Node by viem.
 * eth_sendTransaction signs and submits to `nodeRpcUrl`; against the mock an unfunded wallet gets
 * "insufficient funds", as on mainnet.
 */
export async function installTestWallet(
  context: BrowserContext,
  wallet: TestWallet,
  options: InstallTestWalletOptions,
): Promise<void> {
  const chainId = options.chainId ?? ROBINHOOD_CHAIN_HEX;
  const transport = http(options.nodeRpcUrl, { retryCount: 0 });
  await context.exposeBinding(BINDING, async (_source, request: SignRequest): Promise<Hex> => {
    const account = accountFor(wallet, request.from);
    switch (request.kind) {
      case "personal_sign":
        return account.signMessage({ message: isHex(request.data) ? { raw: request.data } : request.data });
      case "eth_signTypedData_v4":
        return account.signTypedData(JSON.parse(request.data) as TypedDataDefinition);
      case "eth_sendTransaction": {
        const publicClient = createPublicClient({ transport });
        const id = await publicClient.getChainId();
        const chain = {
          id,
          name: `chain ${id}`,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [options.nodeRpcUrl] } },
        } as const;
        const { tx } = request;
        const walletClient = createWalletClient({ account, transport, chain });
        const gas = optionalBigInt(tx.gas);
        return walletClient.sendTransaction({
          ...(tx.to ? { to: tx.to as Address } : {}),
          ...(tx.data ? { data: tx.data as Hex } : {}),
          value: optionalBigInt(tx.value) ?? 0n,
          ...(gas === undefined ? {} : { gas }),
        });
      }
    }
  });
  await context.addInitScript(pageWallet, {
    addresses: wallet.accounts.map((a) => a.address),
    chainId,
    rpcUrl: options.rpcUrl,
    info: TEST_WALLET_INFO,
    injectWindowEthereum: options.injectWindowEthereum ?? true,
    binding: BINDING,
  });
}

/** Page-side controls for the injected wallet (switch account/chain, disconnect, inspect requests). */
export const walletControls = {
  /** Emits accountsChanged with account `index` (e.g. the "account switch mid-venue" case). */
  switchAccount: (page: Page, index: number) => page.evaluate((i) => window.__plTestWallet?.switchAccount(i), index),
  /** Emits chainChanged (e.g. "0x1" for the wrong-chain case). */
  setChain: (page: Page, chainId: string) => page.evaluate((c) => window.__plTestWallet?.setChain(c), chainId),
  disconnect: (page: Page) => page.evaluate(() => window.__plTestWallet?.disconnect()),
  /** Every EIP-1193 method the page called, in order. */
  requests: (page: Page) => page.evaluate(() => [...(window.__plTestWallet?.state.requests ?? [])]),
};
