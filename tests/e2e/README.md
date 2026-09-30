# @pl/e2e — Playwright suite

End-to-end tests for Loose Pixels (architecture §5) on a **real local stack**, or read-only against a deployed build.

```sh
npm run e2e:install -w @pl/e2e                          # once: chromium + webkit
npm run e2e -w @pl/e2e                                  # full suite, stack started for you
npm run e2e -w @pl/e2e -- --project desktop-chromium --workers=1 hub   # one project, one file, one browser
npm run smoke:prod -w @pl/e2e                           # read-only specs against https://loose-pixels.florent-g.workers.dev
PL_WEB_URL=https://other.example npm run smoke:prod -w @pl/e2e
```

Local runs need Docker (a throwaway `postgres:16-alpine`) unless `E2E_DATABASE_URL` points at a cluster you own.
Software WebGL is CPU-heavy: prefer `--workers=1` and one project locally; CI runs the whole matrix.

## The stack (`playwright.config.ts` `webServer`, `env/`)

| Process                     | Port  | What                                                                                                                                                                                                          |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@pl/mock-rpc --admin`      | 18545 | The shared mock Robinhood Chain. apps/server reads it (`RPC_URL`), every browser's chain RPC is routed to it, and tests drive it over `POST /__admin`.                                                        |
| `env/server.ts`             | 13100 | Fresh Postgres DB (CI service via `E2E_DATABASE_URL`, else Docker), production build of apps/server (migrations on start, test secrets, `GUEST_MODE=on`, sim economy) on 13101 behind `env/edge.ts`.          |
| `env/edge.ts` (in the same) | 13100 | Stand-in for the edge Worker: adds `x-pl-origin-key` and `x-pl-client-ip` (a fresh address per connection, or the test's `x-e2e-client-ip`), so the server runs in its production posture on one loopback IP. |
| `vite preview` of apps/web  | 14173 | `npm run build:all -w @pl/web` then preview; `/api` and `/ws` proxy to 13100. `E2E_SKIP_BUILD=1` reuses `dist/`.                                                                                              |

Locally the servers are reused if already running (`reuseExistingServer`). Ports: `E2E_WEB_PORT`, `E2E_API_PORT`,
`E2E_SERVER_PORT`, `E2E_RPC_PORT`. Server logs: `E2E_SERVER_LOG_LEVEL=info`. WebKit (iPhone 13, guest/read-only specs
only) runs in CI; locally set `E2E_WEBKIT=1` after `sudo npx playwright install-deps webkit`.

## Fixtures (`fixtures/`)

Import `test` / `expect` from `../fixtures/index.js`, never from `@playwright/test`.

| Fixture / helper             | What                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `wallet`                     | Fresh random accounts (default 2), injected as EIP-1193 + EIP-6963 ("Pixel Life Test Wallet"). Keys stay in Node.                              |
| `friends`                    | Fresh Friends minted on the shared chain to account 0 (`ownedFriends`, default 2; `ownedGenerationZero` adds hidden gen-0 ones).               |
| `chain`                      | Shared chain admin: `mint`, `transfer`, `mine`, `fund`, `fault`, `ownerOf`.                                                                    |
| `openPlayer(browser, chain)` | A second browser with its own wallet and Friends (hub presence, Mend, market buyer).                                                           |
| `mockRpc`                    | A per-test in-process mock (`test.use({ sharedChain: false })`): the harness self-test and SDK-only checks.                                    |
| `flows.ts`                   | `connectAndBind`, `playRun` (real run with scripted drag-flings), `runResults`, `resultStat`, `hudPixels`, `me`, `arriveInSky`.                |
| `seed.ts`                    | Direct DB seeding for history the UI can't reach quickly: `seedPastRuns` (past the 3 newbie runs), `seedScars`, `seedGold`, `runVerification`. |

Every test gets fresh wallets and token ids, so tests are isolated without resets and parallel-safe.
Options: `injectWallet: false` (guest browser), `walletChainId: "0x1"` (wrong chain), `walletAccounts`.
Page controls: `walletControls.switchAccount(page, 1)`, `.setChain(page, "0x1")`, `.disconnect(page)`, `.requests(page)`.

## Specs

`web-guest` (landing, Play now < 3 s, a real run → results → local scars, 360 px), `web-wallet` (SIWE bind, newbie runs,
verified run scars with the server replay agreeing, wrong chain, non-owner, gen-0, transfer, account switch),
`seed-pack` (buy/open/keep/redeem on the server ledger), `hub` (presence, moves, emotes and chat on the wire; every
venue and page reachable), `hub-no-webgl` (fallback doors), `economy` and `economy-pages` (pending the pages wiring:
`test.fixme`), `harness`, `sim-determinism`, `smoke`.

`smoke:prod` runs `smoke`, `web-guest`, `hub` and `economy-pages` with one worker: no wallet, no purchases, no runs
posted (the specs skip anything that writes when `PL_WEB_URL` is set).

## Mock RPC outside Playwright

- Dev: `npm start -w @pl/mock-rpc -- --port 8545 --owner 0xYourAddress` then point `RPC_URL` (server) at it.
- Node tests: `startMockRpc({ world })` + `redirectFetch(server.url)` (see `tools/mock-rpc/src/sdk.test.ts`).
