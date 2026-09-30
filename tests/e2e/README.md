# @pl/e2e — Playwright suite

End-to-end tests for Pixel Life (architecture §5). Every test runs against a **fresh mock Robinhood
Chain** (`@pl/mock-rpc`) with a **fresh random test wallet** injected into the page. No test ever
talks to the real RPC or holds funds.

```sh
npm run e2e:install -w @pl/e2e        # once: chromium + webkit
npm run e2e -w @pl/e2e                # all projects
npm run e2e -w @pl/e2e -- --project desktop-chromium
PL_WEB_URL=https://staging.example npm run e2e -w @pl/e2e   # against a deployed build
```

Projects: `desktop-chromium`, `mobile-pixel7` (Chromium, touch), `mobile-iphone13` (WebKit, touch).
E2E is not part of `npm run check` (it needs browsers); CI runs it as its own job.

WebKit on Ubuntu 24.04 needs `libavif16` (`sudo npx playwright install-deps webkit`).

## What each test gets (`fixtures/index.ts`)

Import `test` / `expect` from `../fixtures/index.js`, never from `@playwright/test`.

| Fixture            | What it is                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wallet`           | `TestWallet`: `walletAccounts` (default 2) random viem accounts. Keys stay in Node; the page asks Node to sign through a binding.                                                                                                                                                                                                                       |
| `mockRpc`          | `startMockRpc()` on a free port. World = every design Friend in `docs/design/data/friends.json`; the wallet's account 0 owns `walletFriends` (default `344030`, `344033`), fixture owners alice/bob own the rest (one of alice's is generation-0). Mutate it mid-test: `mockRpc.world.transfer(id, to)`, `.setFault({ kind: "rpc-error" })`, `.mine()`. |
| `chainRoute`       | `https://rpc.mainnet.chain.robinhood.com` → mock, for every page and frame of the context (including the SDK sandboxed child). `chainRoute.forwarded` lists what it answered.                                                                                                                                                                           |
| `context` / `page` | Wallet injected before any page script: EIP-1193 provider, announced over EIP-6963 (`Pixel Life Test Wallet`, uuid `TEST_WALLET_INFO.uuid`) and as `window.ethereum`. Top-level frame only.                                                                                                                                                             |

Options (`test.use({...})`): `walletFriends`, `walletGenerationZero`, `walletAccounts`,
`injectWallet: false` (guest browser), `walletChainId: "0x1"` (wrong chain).

Wallet methods: `eth_accounts`, `eth_requestAccounts`, `eth_chainId`, `wallet_switchEthereumChain`
(4902 for unknown chains), `wallet_addEthereumChain`, `personal_sign` (SIWE), `eth_signTypedData_v4`,
`eth_sendTransaction` (signed in Node and sent to the mock; an unfunded wallet gets "insufficient
funds", as on mainnet), and any other `eth_*` read, forwarded to the (routed) RPC.
Page controls: `walletControls.switchAccount(page, 1)`, `.setChain(page, "0x1")`,
`.disconnect(page)`, `.requests(page)`.

## Adding specs (later tasks)

1. Put specs in `specs/<area>.spec.ts` (`guest.spec.ts`, `wallet.spec.ts`, `seed-pack.spec.ts`,
   `hub.spec.ts`, …). Use relative URLs: `baseURL` is the web app.
2. The web app is started automatically once `apps/web/index.html` exists (`npm run dev -w @pl/web`
   on port 5173, see `playwright.config.ts`). The web task adds a `dev` script that honours
   `--host/--port/--strictPort` (Vite does).
3. Delete the `test.skip(!webReady, …)` guard in `specs/smoke.spec.ts` once the landing page exists,
   and make its assertions match the real landing.
4. Server flows (SIWE verify, `/api/session/friend`) need the server to read the **same** mock:
   start `apps/server` with `RPC_URL=<mockRpc.url>`. Since `mockRpc` is per test, the server task
   should add a worker-scoped fixture that starts one mock + one server per Playwright worker (or
   let the server take the RPC URL per request in test mode). Do not point the server at the
   public RPC in e2e.
5. Multi-user flows (hub presence, Mend): `browser.newContext()` and call
   `installTestWallet(ctx, createTestWallet(), { rpcUrl: ROBINHOOD_RPC_URL, nodeRpcUrl: mockRpc.url })`
   plus `routeChainRpc(ctx, mockRpc.url)`, with ownership added via `mockRpc.world.mint({...})`.
6. For no-network guarantees (SDK fixture rule), call
   `routeChainRpc(context, mockRpc.url, { allowOrigins: [baseURL] })` and assert `blocked` is empty.
7. Negative identity cases to cover (architecture §5): wrong chain (`walletChainId: "0x1"`),
   non-owner (`walletFriends: []`), gen-0 (`walletGenerationZero`), RPC error (`setFault`), account
   switch mid-venue (`walletControls.switchAccount`), transfer mid-session (`world.transfer`).

`specs/harness.spec.ts` is the harness's own self-test and runs without the web app.

## Mock RPC outside Playwright

- Dev: `npm start -w @pl/mock-rpc -- --port 8545 --owner 0xYourAddress` then point `RPC_URL` (server)
  at `http://127.0.0.1:8545`. The browser SDK hardcodes the public URL, so in dev use a Vite proxy or
  the e2e route.
- Node tests: `startMockRpc({ world })` + `redirectFetch(server.url)` makes SDK calls that hardcode
  the public RPC (e.g. `createFriendReader()`) hit the mock. See `tools/mock-rpc/src/sdk.test.ts`.
