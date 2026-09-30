# Pixel Life: architecture (tech lead, 2026-09-30)

Inputs: `final-concept.md` (LOCKED, including the owner EXTENSION: a Club Penguin-like hub with pluggable venues, Pixel Life as the flagship), `brief.md`, and FriendSDK v0.1.4 source at `tmp/vibeathon/friendsdk`. I read the docs and the source. Every SDK claim below cites the file and line it depends on.

---

## 0. Decisions at a glance

| # | Decision |
|---|---|
| D1 | **Two-tier platform. The trusted shell runs the hub and first-party venues in-process. SDK venues run in the sandbox.** The hub, Pixel Life and every first-party venue run as trusted first-party code in the top-level page (`apps/web`), in both guest and wallet mode. Chance-game economy content (the **Seed Pack Booth**) and any community FriendSDK game run as sandboxed SDK children, mounted unmodified through `ConnectedGameHost`, which gets its wallet and Friend context from the shell. |
| D2 | **Guest mode never enters the SDK's gated runtime.** A guest plays hub + Pixel Life with a *loaned* real Friend: its canonical sprite is pre-baked at build time, it is labelled "Loaned", and it has no economy. The SDK gate is never bypassed and never fed sample identities. |
| D3 | **Identity uses the SDK's trusted modules as they are.** We use `createFriendWalletSession` (wallet), `readOwnedFriends` (discovery), `readGenerationEligibility` + `tokenBoundAccount` (gate, same code path as `game-host.tsx:159-165`), `createFriendReader` (sprites), `createFriendSoundKit` (sounds), `RewardReveal` (reveal) and `GameMenu` (picker and confirm dialogs). We then add a **SIWE session**, and the **Worker repeats the fresh-block ownership check server-side**. |
| D4 | **One SDK patch, ~15 lines: an optional `previewClient` factory on `ConnectedGameHost`.** It makes Seed Pack results persist in our server ledger. Without it, the preview ledger is rebuilt per session with 20 RF (`game-host.tsx:191-196`), so Gold Pixels would vanish on reload. It also adds an optional `previewLabel` (the preview-mode toolbar label, default "Local preview") so the shell can say the booth's RF is simulated and its ledger server-side (#33). Everything else in the SDK is kept byte-for-byte. |
| D5 | **Renderer: three.js (WebGL2, imperative, no R3F in the scene). Simulation: a custom deterministic 2.5D fixed-step sim at 60 Hz in `packages/shared`.** The same code runs in the browser and in the Worker, and the Worker uses it to re-simulate Daily Runs (and all runs, CPU permitting). |
| D6 | **One Cloudflare Worker serves everything.** It serves the static assets (`apps/web` dist, including the SDK child documents) plus `/api/*` and `/ws/*`, and hosts the Durable Objects `RoomDO` (hub shard presence) and `DirectoryDO` (shard assignment + online-owner routing). Everything is same-origin, so there is no CORS for the shell and cookies just work. |
| D7 | **Hub movement is click-to-move waypoints, event-driven with no server tick** (Club Penguin's model), so `RoomDO` can use WebSocket Hibernation. Chat is preset phrases only ("safe chat"), so there is no moderation surface. |

**Cloudflare access check** (token verified, nothing deployed, token not printed):
- Workers, Durable Objects, KV, Queues and Pages are reachable. Existing scripts use static assets.
- **D1 returns `Authentication error`**, so the token lacks the D1 permission. **R2 is not enabled on the account.**
- Owner action: add `D1:Edit` to the token. R2 is not needed by this design.
- Fallback that needs no permission change: the DB layer sits behind a `Repo` interface, so it can run on a SQLite-backed Durable Object (`DbDO`) with the same SQL.
- The plan tier is not visible to this token. If replay verification must stay inside Worker CPU limits, we need **Workers Paid**; see section 4.6.

---

## 1. The integration decision (verified against the SDK source)

### 1.1 What the SDK actually does (facts)

| Fact | Source |
|---|---|
| The gated runtime refuses to mount the child unless `readGenerationEligibility(...).eligible === true` at a fresh block, and the chain is 4663. | `src/game-host.tsx:152-181`, `src/identity.ts:14-32` |
| `ConnectedGameHost` accepts external `selectedFriend/account/chainId/publicClient/revision`, then runs the same gate. With missing inputs it renders "Connect a wallet…", and it has no sample fallback. | `game-host.tsx:108-142` |
| The preview ledger is created inside the host with `createGamePreview(definition, { stake: max*10, rfBalance: 20 RF })`. There is no injection point, and it is keyed per `chain:friend:wallet` in a `useRef` Map, so it is lost on reload. | `game-host.tsx:131-133, 191-196` |
| The child iframe is `sandbox="allow-scripts"`, which gives it an opaque origin. | `game-host.tsx:373` |
| Child CSP (CLI build): `default-src 'none'; script-src 'self'; … connect-src 'self' https://rpc.mainnet.chain.robinhood.com; frame-src 'none'`. | `scripts/dev-game.mjs:16` |
| The bridge allows **only** `read, canBuy, buy, play, settle, redeem`, with quantities 1–99. There is no custom message, no save API and no results API. | `src/frame-bridge.ts:3-16, 51-103` |
| The child session trusts only `event.source === window.parent`. The host trusts only `event.source === frame.contentWindow`. | `game-session.tsx:21`, `game-host.tsx:287` |
| Sprite reads are public and need no wallet: `createFriendReader()` reads `familyOf/seedOf/frames` on the registry. | `src/friend-sprites.ts`, `generation-sprites.ts:113-145` |
| `readGenerationEligibility` is pure, with an injected viem client, so it runs in a Worker. | `identity.ts` |
| `GameFrame` / `GameMenu` are exported (`./frame`) and are usable as a picker and confirm dialog outside the runtime. | `game-frame.tsx` |
| The build output has `index.html` (a standalone `GameHost` page) plus `game.html` / `game.js` (the child, with the CSP meta tag). | `dev-game.mjs:150-165` |

### 1.2 Can the sandboxed child call our backend?

- **Transport: yes, if we serve the child from our own origin and send CORS headers.** CSP `'self'` matches the child document's URL origin; this is how the SDK loads `./game.js` under `script-src 'self'` inside the sandbox. So `connect-src 'self'` already covers our API when the child is served from the same host. The request itself is cross-origin with `Origin: null`, so the API must answer `Access-Control-Allow-Origin: *`.
- **Auth: no, not safely.**
  - The opaque origin has no cookies (credentialed CORS to `null` is not something to rely on) and no localStorage or IndexedDB.
  - The SDK bridge has no channel for handing a token to the child.
  - Adding one would mean a side-channel `postMessage` outside the SDK's trust design, and `AGENTS.md` forbids game code from talking to the parent beyond the SDK handshake.
- **Conclusion:** sandboxed children may make **anonymous public reads only**, for example `GET /api/friends/:id/public` to show a Friend's scars. Every authenticated write goes through trusted host code. This is why D1 puts first-party venues in the trusted shell and not in the sandbox.

### 1.3 How guest mode and wallet mode coexist

```
                    ┌─────────────────────── apps/web (trusted top-level page, our origin) ───────────────────────┐
                    │  Landing ─▶ "Play now" (guest, 0 wallet calls)          "Use my Friend" (wallet)            │
                    │                 │                                               │                          │
                    │                 ▼                                               ▼                          │
                    │  IdentityStore { mode:'guest', loaner }        FriendSDK wallet session + readOwnedFriends │
                    │                 │                              + GameMenu picker + readGenerationEligibility│
                    │                 │                              + SIWE → server fresh-block recheck         │
                    │                 └──────────────┬────────────────────────────────┘                          │
                    │                                ▼                                                           │
                    │   Hub (three.js) ── RoomDO WebSocket presence ── native venues (Pixel Life, …) in-process │
                    │                                │                                                           │
                    │               enter "Seed Pack Booth" (owner only)                                         │
                    │                                ▼                                                           │
                    │   <ConnectedGameHost definition=seedPack frameUrl="/venues/seed-pack/game.html"             │
                    │        selectedFriend account chainId publicClient revision previewClient={serverLedger}/> │
                    │        └─ iframe sandbox=allow-scripts ─ GameSession ─ SeedPack UI + RewardReveal + sounds │
                    └───────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Guest.**
  - The guest picks one of ~12 loaners. Their canonical 64 frames are baked into `loaners.json` by `tools/assets` using the SDK reader at build time, so the start costs zero RPC calls and takes under 3 s.
  - The hub shows the guest with a "Visitor · loaned #344030" tag and a dithered outline, so they are never confused with the real owner.
  - Pixel Life is fully playable. Scars live on a **local copy** in `localStorage`, because loaned Friends belong to others and a guest must never scar the real shared state.
  - Guests cannot Regrow with RF, Mend or open Seed Packs; those show "Use your own Friend to …" CTAs.
  - The Seed Pack Booth shows the published odds table and a **labelled demo reveal**: `RewardReveal` with a canned result and the caption "demo animation, no roll".
  - Guests may submit Daily Runs to a separate *Visitors* board.
- **Owner (wallet).**
  - `createFriendWalletSession()` connects, `readOwnedFriends()` lists the Friends, and our picker (built on `GameMenu`) selects one.
  - Then `readGenerationEligibility` + `tokenBoundAccount` runs at a fresh block in the client, the same sequence as `game-host.tsx:159-165`.
  - Then SIWE: `POST /api/session/friend` repeats the eligibility check **server-side** at a fresh block and binds `{address, tokenId, tba}` to the session.
  - Only then does the shell swap the loaner for the owned Friend. Scars, gold and streak come from the server.
  - Account, chain or Friend changes (session `revision`) drop the bound Friend, close the SDK venue (bump `revision` on `ConnectedGameHost`) and re-run both checks.
- **Connected wallet with no eligible Friend.** It behaves as a guest, with the SDK's explanatory copy ("hidden generation-0" and so on) surfaced.

### 1.4 What we keep and what we modify in FriendSDK

| Keep unchanged | Modify (patch, vendored `vendor/rarefriends-friendsdk-0.1.4.tgz` + `pnpm patch`) |
|---|---|
| `runtime` (GameHost, ConnectedGameHost gate, EmbeddedSession, confirmations), `bridge`, `frame`, `game` (parse/define/outcomeForRoll/maximumPrize), `identity`, `owned`, `wallet`, `sprites`, `sounds`, `reveal`, `ui`, child CSP, `build`/`testing` tooling | `ConnectedGameHostProps.previewClient?: (ctx:{friendId:bigint; walletAddress:string; chainId:number; definition:ChanceGameDefinition}) => GameClient`. It is passed through `ConnectedViewport → EligibilityGate`. At `game-host.tsx:192-195` the code becomes `client = props.previewClient?.(ctx) ?? createGamePreview(...)`. The factory is only called **after** the gate passes, so the gate stays authoritative. The patch touches `src/game-host.tsx` and `dist/game-host.js` + `.d.ts`. If the patch is ever dropped, the booth still works with session-local packs. We propose it upstream as "persistent preview ledger". |

We add only **outside** the SDK: SIWE, server-side re-verification, the hub, native venues, and the server ledger client. Nothing inside the SDK sandbox talks to the parent beyond the SDK handshake.

### 1.5 Persistence, the Sky and Mend in each mode

| Concern | Guest | Owner, simulated RF (default) | Owner, real RF (ready, flag `ECONOMY_MODE=live`) |
|---|---|---|---|
| Scars (lost-pixel mask) | `localStorage` on the loaned copy | D1 `friends` row per **tokenId**. Scars belong to the NFT and transfer with it. | same |
| Free regrowth | local, same `regrowth()` fn | lazy, deterministic: `effectiveMask(mask, updatedAt, now, tokenId)`; no cron | same |
| Regrow with RF | disabled (CTA) | server ledger debits `friends.sim_rf_micro`; 50% burn / 50% stream recorded in `rf_ledger` | the TBA calls `PixelLifeSink.regrow(tokenId, px)` via `execute`; the Worker indexes `Regrew` events (cron + client-submitted tx hash, receipt-verified), then clears pixels |
| Mend another Friend | disabled | payer's own Friend pays: 50% burn / 50% credited to the **target Friend's** sim balance; inbox + live push | `PixelLifeSink.mend(payerTokenId, targetTokenId, px)`: 50% burn, 50% transferred to `tokenBoundAccount(target)` |
| Seed Pack (ChanceGame) | odds + demo reveal only | SDK child via `ConnectedGameHost` + patched `previewClient` = `ServerLedgerClient` (D1, server RNG, same accounting as `createGamePreview`: stake / reservedPlays / rewardLiability) | `ConnectedGameHost deployment={seedPackDeployment} walletClient assertActive`: stock SDK live path (Dice RNG, Resume cast) |
| Gold Pixel perks | none | read live from `seedpack_friend.inventory[gold]`, so redeeming removes the perk (no double spend) | read live from the contract inventory of the TBA (Worker `read(friendId)`, cached 30 s) |
| Sky / hub | visible as Visitor; sees everyone | presence via RoomDO + "resting" offline Friends from `/api/sky` | same |
| Daily Run | Visitors board | main board; streak halo | same |

### 1.6 Authentication

1. `GET /api/auth/nonce` returns `{nonce}`. It is stored in D1 `auth_nonces` with a 5 min TTL and is single use.
2. The client builds an EIP-4361 message: domain = our host, chainId 4663, statement "Sign in to Pixel Life. No transaction, no cost.", nonce, issuedAt, expiration +10 min. It calls `personal_sign` through the SDK session's provider (`session.getProvider()`). This is a signature, not a transaction; the UI says so.
3. `POST /api/auth/verify {message, signature}`. The Worker parses the message, checks domain, nonce, expiry and chain, then runs `publicClient.verifyMessage` from viem, which also covers EIP-1271 smart wallets. It then issues an `HttpOnly; Secure; SameSite=Lax` cookie `pl_sess`: an HS256 JWT `{sub: address, iat, exp: 7d, sid}`. Revocation is `sessions.revoked`.
4. `POST /api/session/friend {tokenId}`. The Worker calls `readGenerationEligibility(client, tokenId, address)` using the SDK function against `RPC_URL` at a fresh block, and requires `eligible === true`. It then reads `tokenBoundAccount` at the same block and stores `friend_bindings(sid, tokenId, tba, block, checked_at)`.
5. **When the Worker re-checks ownership** at a fresh block:
   - every RF-spending action (regrow, mend, seed-pack buy/play/redeem);
   - run submission if the last check is older than 10 min;
   - WebSocket join.
   - If the check fails, the binding is dropped and the client gets `403 not_owner`, which triggers a re-pick.
6. **Guests** get `POST /api/guest`, which issues a signed `pl_guest` cookie (random id, 30 d) used only for presence and the Visitors board.

---

## 1b. Hub platform and venues (owner EXTENSION)

### 1b.1 Realtime presence

- **Rooms.** A room is a small authored island map (`plaza`, `pixel-arena`, `seed-booth`, `sky-docks` with the Mend board, `daily-gate`). Each room is **sharded**: `RoomDO` id = `room:{slug}:{shard}`, soft cap 40 and hard cap 60 players, matching Club Penguin room density.
- **DirectoryDO** is a singleton. It assigns shards (fill the lowest non-full shard; honour a `?shard=` invite), tracks counts per room, and keeps `onlineOwners: address → roomShardId` for notification routing. `RoomDO` updates it on join and leave.
- **Interest management.** The room is the interest set. Shards keep N ≤ 60, so every client receives everything in its room shard. Render LOD happens client-side:
  - the nearest 24 Friends as full voxel meshes;
  - the rest as billboard impostors;
  - names only on hover or tap.
  Cross-room there is only the DirectoryDO population badge on the doors.
- **Movement model.**
  - The client sends `move {to:[x,z] int16 cm, seq}` on a tap or click, and while dragging a joystick at most every 125 ms.
  - The server validates that the point is walkable (shared navmesh polygon from `packages/shared/hub`) and clamps speed. It then broadcasts `moved {id, from, to, t0}` (server clock), and clients interpolate along the straight or navmesh path.
  - There is no server tick, so the DO hibernates between messages (WebSocket Hibernation API, `serializeAttachment` for per-socket identity).
- **Message rates, per-socket token buckets in RoomDO.**

  | Message | Rate |
  |---|---|
  | `move` | 8/s, burst 16 |
  | `emote` | 1/s |
  | `say` (preset phrase id) | 1 per 2 s |
  | `venue` (enter/exit status) | 2/s |

  After 3 violations the socket is closed with 4008. Server fan-out is bounded to about 60 × 8 msgs/s worst case. Payloads are compact JSON arrays, roughly 40 B.
- **Join.**
  - The Worker authenticates the upgrade: owner cookie + fresh eligibility, or the guest cookie. It sets the headers `x-pl-id`, `x-pl-kind`, `x-pl-token` and forwards to the DO.
  - The DO sends `welcome {you, roster:[PresenceEntity…], serverTime}`.
  - Appearance is **not** sent over the socket, only `tokenId`, `scarsHash` and `gold`. Clients fetch `/api/friends/:id/appearance` (immutable, CDN-cached) and `/api/friends/:id/public` (scars, gold; cached 15 s) and cache them.
- **Live events relayed by RoomDO:**
  - `venue_state` (a Friend is "in Pixel Life" and shows a bubble);
  - `scars_changed {id, scarsHash}` after a run, regrow or mend;
  - `mended {target, by, px}`, which plays a sparkle on the target in-room;
  - `notify` (routed by DirectoryDO to the owner's socket).
- **Resting Friends.** Offline owners' Friends are served by `GET /api/sky?room=` (at most 30, recently active, preferring ones with scars). They are rendered asleep on the island edges so the world is never empty, and they are Mend targets.

### 1b.2 Venue module contract (`packages/venue-kit`)

```ts
// packages/venue-kit/src/contract.ts
export type VenueKind = "native" | "sdk-frame";
export interface VenueManifest {
  id: string;                    // "pixel-life", "seed-pack"
  name: string; version: string; kind: VenueKind;
  room: string;                  // hub room hosting its door
  requires: { ownedFriend: boolean };   // guests blocked if true
  economy: { sinks: readonly ("regrow" | "mend" | "seedpack")[]; chanceGame?: unknown /* ChanceGameDefinition JSON */ };
  results: { leaderboard?: "score-desc" | "time-asc"; affectsScars: boolean };
  thumbnail: string;             // 16x16 1-bit rows or asset URL
}
export interface VenueIdentity {
  mode: "guest" | "owner";
  friend: FriendView;            // appearance + live scars/gold (from @pl/shared)
  loaned: boolean;
}
/** Capabilities the trusted shell lends to a NATIVE venue. All economy is quote → host-confirmed request. */
export interface VenueHost {
  identity: VenueIdentity;
  stage: SharedStage;            // from @pl/game: three.js renderer, camera rig, input, frame loop
  audio: VenueAudio;             // wraps FriendSDK createFriendSoundKit + our cues; honours mute
  reducedMotion: boolean;
  paused: ReadonlySignal<boolean>;
  economy: {
    quote(action: EconomyAction): Promise<EconomyQuote>;
    request(action: EconomyAction): Promise<EconomyReceipt>;   // shell shows GameMenu confirm; rejects if guest
  };
  seeds: { daily(): Promise<DailySeed>; free(): number };
  reportResult(result: VenueResult): Promise<ResultAck>;       // shell → POST /api/runs
  exit(reason?: "done" | "quit"): void;
}
export interface VenueInstance { pause(p: boolean): void; resize(w: number, h: number): void; unmount(): Promise<void>; }
export interface NativeVenue { manifest: VenueManifest; mount(host: VenueHost): Promise<VenueInstance>; }
/** SDK-frame venue: a stock FriendSDK game (index.tsx + game.json) built with @rarefriends/friendsdk/build. */
export interface SdkFrameVenue { manifest: VenueManifest & { kind: "sdk-frame" }; frameUrl: string; definition: unknown /* ChanceGameDefinition JSON */; hostCss?: Record<string,string>; }
export type Venue = NativeVenue | SdkFrameVenue;
export interface VenueResult { venueId: string; runId: string; seed: number; kind: "free" | "daily"; inputs: Uint8Array; claimed: RunSummary; }
```

**How the FriendSDK model maps onto venues:**
- **A community FriendSDK game becomes a venue without changing a line.**
  - Its `index.tsx` + `game.json` is built by `buildGame()`.
  - `game.html` + `game.js` are served at `/venues/<id>/`.
  - The shell mounts `ConnectedGameHost` in a "booth window" overlay using the hub's identity, with host CSS variables for size.
  - It inherits the gate, the sandbox, the confirmations and the chance-game economy.
  - Its limits are the SDK's: no results or scars reporting, owners only. This is the "Roblox for Rare Friends" pitch: the SDK is the plugin format.
- **Native venues** (ours) get the richer `VenueHost`: the shared WebGL stage, persistent scars and leaderboards.
- **Proposed SDK extension, documented as a capability gap for the RF team:** a bridge method `report(result)` would let sandboxed venues post results. We do not implement it.
- **Phase order:**
  1. P1: hub (plaza + arena + booth rooms) + Pixel Life + Seed Pack Booth.
  2. P2: 1–2 small native venues that reuse Friend physics (e.g. "Pixel Pinball", "Bump Ring"), plus the Gold Pixel market (simulated).
  3. P3: community SDK venues and the handheld 1-bit mode.

---

## 2. Monorepo layout (pnpm workspaces, TypeScript 6 strict, Node 22)

```
/                        package.json (workspaces), pnpm-workspace.yaml, tsconfig.base.json, biome.json, .github/workflows
vendor/rarefriends-friendsdk-0.1.4.tgz     (npm pack of the local SDK) + patches/@rarefriends__friendsdk@0.1.4.patch
packages/shared          @pl/shared   — types, wire protocol, economy constants/quotes, bitmaps, regrowth, deterministic sim, hub navmesh
packages/venue-kit       @pl/venue-kit — venue contract (above) + test harness for native venues
apps/game                @pl/game     — three.js renderer lib: SharedStage, voxel Friend builder, hub scene, Pixel Life venue (NativeVenue)
apps/web                 @pl/web      — Vite + React 19 shell: landing, identity, HUD, pages, net client, venue manager, SDK host mount
apps/seed-pack           @pl/seed-pack — stock FriendSDK game dir (index.tsx, game.json, README.md, assets) → built into apps/web/public/venues/seed-pack
workers/api              @pl/api      — Worker: assets + /api + /ws, RoomDO, DirectoryDO, (DbDO fallback), cron indexer; wrangler.jsonc, migrations/
contracts/               spec only: PixelLifeSink.md, GoldPixelMarket.md, interfaces .sol (not deployed), live-mode runbook
tools/econ-sim           tokenomics Monte Carlo → writes packages/shared/src/economy.generated.ts + apps/seed-pack/game.json
tools/assets             loaners bake (SDK createFriendReader), voxel/greedy-mesh precompute check, creature sprite pipeline (Kenney 1-bit CC0)
tools/mock-rpc           JSON-RPC mock for Robinhood (ownerOf/generation/tokenBoundAccount/logs/frames/chainId/blockNumber) for dev+e2e
tests/e2e                Playwright (guest, wallet, mobile, perf) + injected EIP-1193 wallet fixture
```

Dependency direction: `shared ← venue-kit ← game ← web`. `shared ← api`. `seed-pack` depends only on the SDK and `shared` (economy JSON). There are no cycles. Only `web` and `seed-pack` import the SDK runtime. `api` imports only the SDK's `identity` and `game` modules (pure functions).

### 2.1 Public interfaces (build to these)

```ts
// ── @pl/shared/src/ids.ts
export type TokenIdStr = string;                    // decimal uint256; bigint only at SDK boundary
export type Hex64 = string;                         // 256-bit mask as 64 hex chars, bit i = pixel (i%16, i>>4), same bit order as SDK decodeSpriteBitmap
export const FAMILIES = ["Skeleton","Mask","Family","Cellular","Asymmetry","Hoverer","Colossus","Sparkling","Hollow"] as const;
export type FamilyId = 0|1|2|3|4|5|6|7|8;

// ── @pl/shared/src/friend.ts
export interface FriendAppearance { tokenId: TokenIdStr; familyId: FamilyId; seed: number; frames: readonly Hex64[] /* 64, SDK order: idle[d,u,l,r]x8, walk[..]x8 */; }
export interface ScarState { lost: Hex64; updatedAt: number; version: number; }   // lost ⊆ frontMask(idle-down f0)
export interface FriendPublic { tokenId: TokenIdStr; scars: ScarState; goldHeld: number; glowCracks: number; streak: number; lastSeen: number; economy: "sim" | "live"; }
export interface FriendView { appearance: FriendAppearance; pub: FriendPublic; loaned: boolean; }
export function frontMask(a: FriendAppearance): Hex64;
export function effectiveLost(s: ScarState, now: number, tokenId: TokenIdStr): Hex64;      // deterministic regrowth
export function applyLoss(s: ScarState, lostDelta: Hex64, now: number, tokenId: TokenIdStr): ScarState;
export function applyRestore(s: ScarState, restore: Hex64, now: number, tokenId: TokenIdStr): ScarState;
export function popcount(m: Hex64): number;

// ── @pl/shared/src/economy.ts   (numbers come from economy.generated.ts; micro-RF = 1e-6 RF as JS number-safe int)
export const ECON: { regrowMicroPerPx: number; burnBps: 5000; streamBps: 5000; regrowthMsPerPx: number; simStartMicro: number; simDailyGrantMicro: number; maxPxPerAction: 256; };
export type EconomyAction =
  | { kind: "regrow"; tokenId: TokenIdStr; pixels: Hex64 }
  | { kind: "mend"; payer: TokenIdStr; target: TokenIdStr; pixels: Hex64 };
export interface EconomyQuote { action: EconomyAction; totalMicro: number; burnMicro: number; streamMicro: number; toTargetMicro: number; mode: "sim" | "live"; }
export interface EconomyReceipt { id: string; quote: EconomyQuote; scars: ScarState; balanceMicro?: number; txHash?: `0x${string}`; }
export function quote(action: EconomyAction): EconomyQuote;   // pure; server recomputes, never trusts client quote

// ── @pl/shared/src/sim/*   (deterministic core; ESLint bans Math.random/sin/cos/atan2/pow/exp/log/Date/performance)
export const SIM_HZ = 60, RUN_TICKS = 3600;
export interface SimConfig { seed: number; kind: "free" | "daily"; arena: string; friend: { front: Hex64; lost: Hex64; familyId: FamilyId; goldHeld: number }; }
export type SimInput =
  | { t: number; k: 0 /*fling*/; ang: number /*0..4095*/; pow: number /*0..1023*/ }
  | { t: number; k: 1 /*sweep/steer*/; dir: number /*0..4095*/; on: 0 | 1 };
export interface SimEvent { t: number; type: "hit"|"bite"|"pixelOff"|"pixelBack"|"pixelLost"|"smash"|"edge"|"end"; a?: number; b?: number; x?: number; z?: number; }
export interface Sim { readonly tick: number; readonly done: boolean; step(inputs: readonly SimInput[]): void; view(): SimView; drainEvents(): SimEvent[]; hash(): string; summary(): RunSummary; }
export interface RunSummary { score: number; lostDelta: Hex64; recovered: number; smashed: number; ticks: number; finalHash: string; }
export function createSim(cfg: SimConfig): Sim;
export function replay(cfg: SimConfig, inputs: readonly SimInput[]): RunSummary;
export function encodeInputs(i: readonly SimInput[]): Uint8Array; export function decodeInputs(b: Uint8Array): SimInput[];
export function dailySeed(day: string, secretHmacHex: string): number;   // server-side; client receives seed via /api/daily

// ── @pl/shared/src/protocol.ts   (REST DTOs + WS messages)
export type ClientMsg =
  | ["move", seq: number, x: number, z: number] | ["emote", id: number] | ["say", phraseId: number]
  | ["venue", venueId: string | null] | ["ping", t: number];
export type ServerMsg =
  | ["welcome", you: string, roster: PresenceEntity[], serverTime: number]
  | ["join", e: PresenceEntity] | ["leave", id: string]
  | ["moved", id: string, fx: number, fz: number, tx: number, tz: number, t0: number]
  | ["emote", id: string, emote: number] | ["say", id: string, phraseId: number]
  | ["venue", id: string, venueId: string | null] | ["scars", tokenId: TokenIdStr, scarsHash: string]
  | ["mended", target: TokenIdStr, by: TokenIdStr, px: number] | ["notify", n: InboxItem] | ["pong", t: number] | ["kick", code: number];
export interface PresenceEntity { id: string; kind: "owner" | "guest"; tokenId: TokenIdStr; loaned: boolean; x: number; z: number; venue: string | null; scarsHash: string; goldHeld: number; }

// ── @pl/game (renderer)
export interface SharedStage { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera; onFrame(cb: (dt: number, alpha: number) => void): () => void; input: PointerInput; quality: QualityTier; dispose(): void; }
export function createStage(canvas: HTMLCanvasElement, opts: { quality?: QualityTier; reducedMotion: boolean }): SharedStage;
export function buildFriendModel(a: FriendAppearance, lost: Hex64, opts: { gold: number; lod: 0 | 1 | 2 }): FriendModel;   // front-face-extruded voxels
export interface FriendModel { object: THREE.Object3D; setPose(facing: "down"|"up"|"left"|"right", walking: boolean, frame: number): void; setLost(lost: Hex64): void; dispose(): void; }
export function createHubScene(stage: SharedStage, net: HubNet, identity: () => VenueIdentity): HubScene;
export const pixelLifeVenue: NativeVenue;

// ── @pl/web net client (used by hub scene; implemented in apps/web/src/net)
export interface HubNet { connect(room: string): Promise<void>; send(m: ClientMsg): void; on(cb: (m: ServerMsg) => void): () => void; state(): "idle"|"connecting"|"open"|"closed"; close(): void; }
export interface Api { /* typed fetch wrappers for every endpoint in §4.3, generated from shared DTOs */ }
```

---

## 3. Engine choice

**three.js r17x (WebGL2), imperative scene, React only for DOM UI overlays. Custom deterministic 2.5D sim.**

| Option | Verdict |
|---|---|
| **three.js** | Chosen. `InstancedMesh`/`BatchedMesh` for voxels. Tree-shaken bundle ≈150 KB gz. The most mature mobile WebGL path and the largest agent familiarity. Its WebGPU renderer is optional later. |
| Babylon.js | Heavier (≈1 MB+), and nothing it adds is needed here. |
| PlayCanvas | Editor-centric; awkward in a code-only monorepo. |
| React Three Fiber | Reconciler overhead in hot paths and harder frame-budget control. Rejected for the scene; React stays for HUD and pages. |
| Pixi (2D) + fake depth | Cannot deliver the voxel front-face extrusion, shatter and reassembly that is the visual hook. |

**Physics.** The game is a fling on a flat floating island: circles, point-mass pixel debris, one island polygon with a fall-off edge, and ballistic height.
- **Custom sim, ~1.5k LOC.** Beats Rapier (whose cross-platform determinism needs its enhanced-determinism WASM build, ≈1.4 MB, and brings a 3D rigid-body solver we don't use), matter.js and planck.js (both use `Math.sin/cos/atan2`, which are *implementation-approximated* in ECMAScript, so results differ between V8 on the server and JavaScriptCore in iOS Safari), and cannon-es (same problem, plus a variable-step design).
- **Determinism rules.**
  - Fixed 60 Hz step with a render accumulator and interpolation (`alpha`).
  - float64 using only `+ − × ÷`, `Math.sqrt/floor/round/abs/min/max/imul/fround`. These are IEEE-exact on every engine, and `sqrt` is hardware-rounded; a CI test gates this.
  - Angles are integers 0..4095 with a **committed literal sin table**, generated once and never computed at runtime.
  - PRNG is sfc32 seeded from `SimConfig.seed`.
  - Arrays have stable iteration order; there is no `Map` iteration over object keys in the sim.
  - An ESLint `no-restricted-properties` rule enforces all of the above on `packages/shared/src/sim/**`.
- **Split of sim versus visuals.**
  - Sim owns the gameplay: Friend body, creatures, detached pixel particles (positions, pickup, lost-over-edge), score and timers.
  - Visual-only effects never feed back into the sim: shake, hit-stop (implemented as *render* time dilation over sim ticks), confetti, dust, the 1-bit impact frame, glow cracks.
- **Mass = pixels:** `mass = k * popcount(front & ~lost)`. Family traits are sim parameters keyed by `familyId`, e.g. Hoverer glide = reduced gravity while held, Skeleton = pixelBack attraction.

**Voxel Friend.**
- Each `#` pixel of the SDK 16×16 frame becomes a column of depth 2 with its front face at z=0. The white halo ring from the SDK reference style becomes a 1-voxel back rim.
- Greedy-meshed per frame and cached per `(tokenId, frameIdx, lostHash, lod)`: about 300–700 tris.
- Facing uses the SDK's left/right/up frames. Colossus falls back to the side frames exactly as `spriteFrame()` does.
- The camera yaw is clamped so the front face always reads; the model is never a visual hull.
- In Pixel Life, the player's Friend is an `InstancedMesh`, one instance per pixel column, so pixels can detach into sim particles.
- Gold Pixels are instances with a gold material and a sparkle shader.

**60 fps budget on mid phones** (iPhone 11 / Snapdragon 7-series; frame 16.6 ms):

| Budget | Limit |
|---|---|
| Sim | ≤ 2 ms |
| Render CPU | ≤ 6 ms |
| GPU | ≤ 8 ms |
| Draw calls | ≤ 120 (hub uses `BatchedMesh` for Friends) |
| Triangles | ≤ 150k |
| DPR | cap 2 (tier L: 1.25) |
| Shadows | no shadow maps (blob shadows + dithered toon ramp) |
| Post | one fullscreen pass, only during impact frames |

- Textures ≤ 2 MB total; initial JS ≤ 350 KB gz for landing → guest play.
- Adaptive quality tier from the first 120 frames' p95.

---

## 4. Backend (Cloudflare)

### 4.1 Topology
One Worker, `pixel-life`:
- `assets` binding to `apps/web/dist`; SPA fallback; `_headers` sets CSP for `/venues/*/game.html`, identical to the SDK's `childCsp`.
- `/api/*` via a Hono router.
- `/ws/room/:slug` does auth, then DirectoryDO assigns a shard, then the request is forwarded to `RoomDO`.
- Bindings:
  - `DB` (D1; fallback `DbDO`);
  - `KV_CACHE` (appearance cache, immutable per registry address);
  - `ROOM` and `DIRECTORY` (DO namespaces, SQLite-backed classes);
  - `RL_*` (Workers Rate Limiting);
  - `VERIFY_Q` (Queue for async replay verification);
  - cron `*/1 * * * *` (live-mode chain indexer; a no-op in sim mode).
- Secrets: `SESSION_SECRET`, `DAILY_SECRET`. Vars: `RPC_URL`, `ECONOMY_MODE`, `SITE_ORIGIN`.

### 4.2 D1 schema (`workers/api/migrations/0001_init.sql`)
```sql
CREATE TABLE auth_nonces (nonce TEXT PRIMARY KEY, created_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sessions (sid TEXT PRIMARY KEY, address TEXT NOT NULL, created_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE friend_bindings (sid TEXT PRIMARY KEY, token_id TEXT NOT NULL, address TEXT NOT NULL, tba TEXT NOT NULL, block INTEGER NOT NULL, checked_at INTEGER NOT NULL);
CREATE TABLE friends (
  token_id TEXT PRIMARY KEY, family_id INTEGER NOT NULL, seed INTEGER NOT NULL, tba TEXT,
  last_owner TEXT, lost TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  scar_version INTEGER NOT NULL DEFAULT 0, scar_updated_at INTEGER NOT NULL,
  glow_cracks INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0, streak_day TEXT,
  sim_rf_micro INTEGER NOT NULL DEFAULT 0, sim_granted_day TEXT, last_seen INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX friends_seen ON friends(last_seen DESC);
CREATE TABLE runs (
  id TEXT PRIMARY KEY, token_id TEXT, guest_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('free','daily')), day TEXT,
  seed INTEGER NOT NULL, inputs BLOB NOT NULL, score INTEGER NOT NULL, lost_delta TEXT NOT NULL, final_hash TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 /* 0 pending, 1 ok, -1 mismatch */, created_at INTEGER NOT NULL);
CREATE INDEX runs_friend ON runs(token_id, created_at DESC);
CREATE TABLE daily_best (day TEXT NOT NULL, board TEXT NOT NULL CHECK(board IN ('owners','visitors')), entrant TEXT NOT NULL,
  score INTEGER NOT NULL, run_id TEXT NOT NULL, PRIMARY KEY(day, board, entrant));
CREATE INDEX daily_rank ON daily_best(day, board, score DESC);
CREATE TABLE rf_ledger (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('sim','live')),
  payer_token TEXT, target_token TEXT, pixels INTEGER, total TEXT NOT NULL, burn TEXT NOT NULL, stream TEXT NOT NULL, to_target TEXT NOT NULL,
  tx_hash TEXT UNIQUE, block INTEGER, created_at INTEGER NOT NULL);           -- amounts = base-unit decimal strings (audit), balances use micro ints
CREATE INDEX ledger_time ON rf_ledger(created_at DESC);
CREATE TABLE inbox (id TEXT PRIMARY KEY, token_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER);
CREATE INDEX inbox_friend ON inbox(token_id, created_at DESC);
CREATE TABLE seedpack_house (id INTEGER PRIMARY KEY CHECK(id=1), stake_micro INTEGER NOT NULL, reserved_micro INTEGER NOT NULL, liability_micro INTEGER NOT NULL);
CREATE TABLE seedpack_friend (token_id TEXT PRIMARY KEY, consumables INTEGER NOT NULL DEFAULT 0, inventory TEXT NOT NULL /* JSON int[] per outcome */);
CREATE TABLE seedpack_plays (id INTEGER PRIMARY KEY AUTOINCREMENT, token_id TEXT NOT NULL, outcome_id INTEGER, created_at INTEGER NOT NULL, settled_at INTEGER);
CREATE TABLE chain_cursor (name TEXT PRIMARY KEY, block INTEGER NOT NULL);
-- P2: market_orders, market_fills (simulated Gold Pixel ↔ RF book with creator fee + royalty)
```
**Consistency.**
- Scar writes use compare-and-swap on `scar_version`: read, then `applyLoss`/`applyRestore` in `@pl/shared`, then `UPDATE … WHERE scar_version=?`, retried at most 3 times.
- RF spends are a single `DB.batch()` with a conditional debit (`UPDATE friends SET sim_rf_micro = sim_rf_micro - ? WHERE token_id=? AND sim_rf_micro >= ?`), followed by a `changes()` check inside the same transaction via `RETURNING`.
- Seed-pack accounting mirrors `createGamePreview` exactly: `canBuy` requires `freeStake ≥ maxPrize` and `freeStake + cost ≥ reserve`. It uses the SDK's `outcomeForRoll` and `maximumPrize`, with the server roll from `crypto.getRandomValues` using the same rejection sampling as `samplePreviewRoll`.

### 4.3 Endpoints
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /api/guest | none | issue guest cookie |
| GET | /api/auth/nonce · POST /api/auth/verify · POST /api/auth/logout | — / — / sess | SIWE |
| POST | /api/session/friend | sess | server fresh-block eligibility → binding; returns `FriendView` |
| GET | /api/me | sess/guest | identity, bound Friend, balance, unread inbox count |
| GET | /api/friends/:id/appearance | public | immutable. Worker reads the registry via viem (same calls as the SDK reader) and caches in KV + Cache API with `max-age=31536000` |
| GET | /api/friends/:id/public | public, CORS `*` | `FriendPublic` (effective scars, gold held, streak); 15 s cache. Also the one endpoint sandboxed venues may read |
| POST | /api/runs | sess/guest | `{kind, seed, inputs(b64), claimed}` → for owners, re-verify ownership if >10 min; apply `lostDelta` (owner Friend) ; daily → enqueue verify; returns ack + new scars |
| GET | /api/daily | any | `{day, seed, endsAt}` (seed = HMAC(DAILY_SECRET, day)) |
| GET | /api/daily/:day/board?board=owners\|visitors | public | top 100 + my rank |
| POST | /api/economy/quote | any | pure `quote()` |
| POST | /api/economy/regrow · /api/economy/mend | sess + binding + fresh eligibility | sim: batch debit/credit + ledger + inbox + push. live: `{txHash}` → receipt + event verified |
| POST | /api/seedpack/{read,canBuy,buy,play,settle,redeem} | sess + binding (+ fresh eligibility on buy/play/redeem) | backs `ServerLedgerClient` (implements SDK `GameClient`, `mode:'preview'`) |
| GET | /api/sky?room= | public | resting Friends for a room |
| GET | /api/inbox · POST /api/inbox/read | sess | Mend notifications |
| GET | /api/stats/economy | public | simulated burn / stream / to-Friend totals (labelled SIMULATED) for the "Token Activity" page |
| GET | /ws/room/:slug | sess/guest | upgrade → DirectoryDO → RoomDO |

### 4.4 Durable Objects
- **RoomDO** (one per room shard). Holds presence, validates movement (navmesh), enforces token buckets, and relays events. It uses Hibernation with no tick. Its in-memory roster is rebuilt from socket attachments after wake. The DO is authoritative only for ephemeral presence, never for money or scars.
- **DirectoryDO** (singleton). Handles shard assignment, room populations (for door badges) and `onlineOwners` for pushing notifications. It is tiny state and uses SQLite storage for crash safety.
- **DbDO** exists **only if D1 stays unavailable**. It is a SQLite-backed DO running the same migrations behind the `Repo` interface. It is a single global instance, which is fine at hackathon scale.
- *Not* a DO: per-Friend state. D1 CAS is enough, and it keeps queries (sky, leaderboards) in one place.

### 4.5 Rate limits
Workers Rate Limiting bindings, keyed by IP or address:

| Scope | Limit |
|---|---|
| auth | 10/min/IP |
| guest | 5/min/IP |
| writes | 60/min/address |
| economy | 20/min/address |
| ws connect | 6/min/IP; at most 2 sockets per identity (the older one is kicked) |
| run submit | 1 per 40 s per entrant (SQL check on `runs_friend`) |
| daily | at most 20 submissions per entrant per day; best counts |

WebSocket per-message buckets are in §1b.1.

### 4.6 Anti-cheat (proportionate: no RF depends on run results)
- **Scope.** Runs only affect scars (which cost *the cheater* RF to fix) and status boards, so there is no payout surface.
- **Daily Runs.**
  - Server-issued seed. The client submits the input log (≈50 events, about 300 B).
  - `VERIFY_Q` re-simulates with `replay()` and compares `finalHash` and score.
  - A mismatch sets `verified=-1` and removes the run from the board. Boards show only `verified=1`, or "pending" for a few seconds.
- **Free runs.** Applied immediately. They are re-simulated when the queue has headroom, and a mismatch is logged, not punished.
- **CPU.** Target ≤ 15 ms per replay on warm V8, measured in CI. On the Workers Free plan (10 ms CPU), verification may not fit. The recommendation is **Workers Paid**. The fallback is verifying the top 20 per day plus a random 10%.
- **Economy integrity** is enforced server-side in every mode:
  - price recomputed by `quote()`;
  - conditional debits;
  - fresh ownership check before a spend;
  - Mend cannot target a pixel that isn't lost;
  - at most 256 px per action.
- **Presence.** Server-validated walkable destinations and speed clamps. Preset chat and emote ids only.

### 4.7 Notifications for Mend
1. Write an `inbox` row for the target token.
2. Ask DirectoryDO whether the owner's address is online. If yes, `RoomDO.push(notify)`, which shows a toast plus a sparkle if the Friend is in the same room.
3. Otherwise the badge appears on the next `/api/me` (polled on focus and every 60 s).
4. Copy: "A stranger (#1234) regrew 3 pixels of #344030 and paid its wallet 0.75 RF (simulated)".

P2 option: Web Push (VAPID). No email or Telegram.

---

## 5. Test, QA, CI, deploy

- **Unit (Vitest):**
  - `@pl/shared` bitmaps, regrowth, economy quotes (property tests with fast-check: burn + stream + to_target == total, no negative balances);
  - seed-pack accounting against the SDK `createGamePreview`, running identical action sequences and comparing snapshots;
  - protocol codecs.
- **Sim determinism:**
  - A golden corpus of 200 seeded random input logs, with committed `finalHash` values.
  - It runs in Node, in workerd (`@cloudflare/vitest-pool-workers`), and in Playwright **Chromium, WebKit and Firefox** (a page that imports the sim bundle). All hashes must match.
  - ESLint bans non-deterministic APIs in `sim/**`.
  - A perf test asserts replay ≤ 15 ms median on CI.
- **Worker/DO (vitest-pool-workers + Miniflare):**
  - auth (SIWE happy path, replayed nonce, wrong domain);
  - binding with the mock RPC (owner, non-owner, gen-0, RPC error; each must deny);
  - CAS races (20 concurrent mends + 1 run, where the final mask equals the sequential model);
  - rate limits;
  - RoomDO join, move validation, bucket kicks, hibernation wake.
- **E2E (Playwright, `tests/e2e`):**
  - **Guest:**
    - landing, then Play now: the Friend is visible in under 3 s (asserted);
    - a fling registers hits, and pixels fall off and are swept back;
    - the run ends and the scars persist after reload (localStorage);
    - the hub shows other presences (a second browser context).
  - **Wallet:**
    - `addInitScript` injects an EIP-1193 + EIP-6963 test wallet backed by a viem `privateKeyToAccount` (a random key generated per run; it never holds funds).
    - `page.route` points the Robinhood RPC at `tools/mock-rpc`, and the Worker's `RPC_URL` points to the same mock.
    - Flows: connect, pick the Friend, SIWE, bound; run, scars on the server; Regrow (sim) with balance and ledger; Mend from a second wallet context, then the owner gets a toast.
    - Seed Pack: ConnectedGameHost gate passes, buy, play, settle, reveal, reload, inventory still there (the patch works), redeem, and the gold perk disappears.
    - Negative cases: wrong chain, non-owner, gen-0, account switch mid-venue. The SDK venue must close and rebinding must happen.
    - This reuses the fixture approach of the SDK's `scripts/browser-fixture.mjs`.
  - **SDK conformance:** `npx friendsdk check apps/seed-pack` and `npx friendsdk test apps/seed-pack --width 360`.
  - **Mobile:** Playwright devices iPhone 13 (WebKit) and Pixel 7; touch fling, joystick, safe areas, toolbar overlap, and 360 px width.
- **Perf budget CI:**
  - Chromium with CDP CPU throttling ×4 runs a 20 s scripted hub (40 fake presences) and a Pixel Life run. It asserts p95 frame ≤ 20 ms and zero long tasks over 100 ms after load.
  - `size-limit`: landing ≤ 350 KB gz, total ≤ 1.2 MB gz.
  - Lighthouse CI on the landing page: performance ≥ 85 on mobile.
  - A real-device checklist (a mid Android + an iPhone) runs before each release tag.
- **CI (GitHub Actions):**
  - `install` → `lint + typecheck` → `unit` → `workers tests` → `build` (including SDK patch apply and seed-pack build) → `e2e` (chromium + webkit, sharded) → `perf`.
  - Deploy jobs are gated by environment protection and **run only with owner authorization**.
- **Environments:**
  - `local`: `wrangler dev` with local D1 and DOs, `tools/mock-rpc` or the real public RPC, Vite dev proxy;
  - `staging` (`pixel-life-staging.<sub>.workers.dev`): sim economy, real RPC, test data resettable;
  - `production`: sim economy by default. `ECONOMY_MODE=live` + `SEEDPACK_DEPLOYMENT` + the `PixelLifeSink` address are set only after contracts are reviewed and deployed with explicit authorization.
  - D1 migrations are applied by `wrangler d1 migrations apply` in the deploy job.
  - Pages is not needed: Workers static assets replace it, and DOs require a Worker anyway.

---

## 6. Work breakdown (parallel agent tasks)

Legend: **dep** = must be merged first. Each task owns only its listed paths, to avoid conflicts. Shared types change only via T1's owner (lead) through a PR.

| ID | Task | Owns | Dep | Acceptance criteria |
|---|---|---|---|---|
| T0 | Scaffold: pnpm workspaces, tsconfig, biome/eslint (incl. sim ban rule), vendored SDK tgz + `previewClient` patch, CI skeleton, wrangler.jsonc skeleton | root, vendor/, patches/, .github/ | — | `pnpm i && pnpm -r typecheck && pnpm -r test` green; the patched `ConnectedGameHost` exports the `previewClient` prop type; CI runs on PR |
| T1 | `@pl/shared` interfaces: ids, friend, bitmaps, regrowth, economy (placeholders), protocol, venue-kit contract | packages/shared (non-sim), packages/venue-kit | T0 | Signatures exactly as §2.1/§1b.2; 100% unit coverage of bitmaps, regrowth and quote; fast-check invariants pass |
| T2 | Deterministic sim core + Pixel Life rules (fling, creatures cast AI, bite/pixel-off/sweep/edge-loss, 9 family traits, scoring) | packages/shared/src/sim | T1 | 60 Hz fixed step; golden-hash corpus identical across Node, workerd, Chromium, WebKit and Firefox; replay ≤ 15 ms median; the tuning doc lists every constant |
| T3 | Voxel Friend pipeline + `tools/assets` (loaners bake via SDK `createFriendReader`, Kenney CC0 creature sprites) | apps/game/src/friend, tools/assets | T1 | All 13 Friends in `friends.json` render front-readable in all 4 facings; Colossus fallback matches `spriteFrame`; lost-mask update ≤ 1 ms; ≤ 700 tris/frame LOD0; loaners.json ≤ 60 KB |
| T4 | Renderer core + hub scene: SharedStage, quality tiers, islands (brand palette, dither, iso-ish camera), click/joystick move, remote interpolation, emotes, doors | apps/game/src/stage, apps/game/src/hub | T1, T3 (model API only; can stub) | 60 Friends in scene at p95 ≤ 16.6 ms on throttled CI; tap-to-walk respects navmesh; reduced-motion honoured |
| T5 | Pixel Life venue (NativeVenue): renderer over sim view, juice (hit-stop, shake, slow-mo, 1-bit impact frame), HUD, sounds (SDK kit + custom), results → `host.reportResult` | apps/game/src/venues/pixel-life | T2, T3, T4 | Playable 60 s run on phone; the 3-second GIF test reads the rule; all sim events have feedback; pause/mute/reduced motion work |
| T6 | Web shell: landing (guest in < 3 s), identity store (SDK wallet/owned/eligibility + GameMenu picker + SIWE), HUD, venue manager (native + sdk-frame via ConnectedGameHost), pages (Sky/Mend board, Daily board, inbox, economy/odds, about) | apps/web | T1; integrates T4/T5/T7/T8/T9 | E2E guest + wallet flows in §5 pass; identity changes close the SDK venue; every simulated amount is labelled "simulated" |
| T7 | Worker API + D1: auth, bindings, friends, runs (+ verify queue), economy sim ledger, seed-pack ledger, sky, daily, inbox, stats, appearance cache | workers/api (except DOs) | T1 (T2 for verify) | Endpoint tests in §5; no endpoint accepts client-computed prices; fresh eligibility enforced as specified; seed-pack snapshots equal SDK `createGamePreview` for identical sequences |
| T8 | Realtime: RoomDO, DirectoryDO, client `HubNet`, shard assignment, notify routing | workers/api/src/do, apps/web/src/net | T1 | 60 clients load test (Miniflare) with p95 relay latency ≤ 50 ms local; buckets kick abusers; hibernation wake restores the roster |
| T9 | Seed Pack venue (stock FriendSDK game: GameSession, SDK `RewardReveal`, sounds, odds table) + `ServerLedgerClient` | apps/seed-pack, apps/web/src/venues/seedpack-client.ts | T0, T7 endpoints (can mock) | `friendsdk check` + `friendsdk test --width 360` pass; the gate is never bypassed; results persist across reload (via the patch); redeem removes the Gold Pixel perk |
| T10 | Tokenomics sim → regrow price, regrowth rate, sim grants, Seed Pack table (EV 0.875–0.90, Gold Pixel max prize reserved) | tools/econ-sim → generated files | T1 | Report + generated constants; proves no farmable loop (alt-mend loses ≥ 50%), house stake is never negative in 10^6 sessions |
| T11 | contracts/ spec: `PixelLifeSink` (regrow/mend via TBA `execute`, 50/50 burn/stream/target), Gold Pixel market (fee + royalty), live-mode runbook, event schema for the indexer | contracts/ | T10 | Interfaces compile with forge (no deploy); events map 1:1 to `rf_ledger`; lists capability gaps for the RF team (stream entrypoint address, `report()` bridge proposal) |
| T12 | QA harness: mock RPC, injected wallet fixture, Playwright projects (desktop/mobile/WebKit), perf runner, size-limit, Lighthouse | tools/mock-rpc, tests/e2e | T0 (fixtures can start early) | Suites run in CI in < 15 min; flaky rate < 1% over 20 reruns |
| T13 | Art/audio polish pass: creature cast, islands, UI in brand (off-lime accent strategy), sounds, GIF capture script for the PR | cross-cutting assets | T4, T5 | Judges' GIF of 3 s shows the rule; CC0/own provenance file complete |
| T14 (P2) | Extra native venue ×1–2 + simulated Gold Pixel market | apps/game/src/venues/*, workers/api market | P1 done | Same polish bar; never ship half-finished |
| T15 (P3) | Handheld 1-bit 128×128 mode; community SDK venue loader | apps/web, apps/game | P1 | 1-bit render path at 60 fps; any `friendsdk build` output mounts as a venue |

**Critical path:** T0 → T1 → T2 → T5 → T6 integration → T12 e2e → staging deploy (with owner authorization).

**Parallel from day 1 after T1:** T3, T4, T7, T8, T9, T10, T11, T12.

---

## 7. Risks and owner decisions needed

1. **Token permissions.** D1 is not authorized and R2 is disabled. Either add D1:Edit to the token, or accept the `DbDO` fallback. R2 is not required.
2. **Workers plan.** Paid ($5/mo) is recommended for replay CPU and Queues headroom.
3. **SDK rules and judging.** The SDK docs say every playable preview requires a wallet (README "What you need", AGENTS "Required prototype identity"). Guest mode is an owner decision.
   - Mitigation: guests never touch the SDK runtime, and never use the economy or real Friend state.
   - Every SDK-mounted surface keeps the gate intact.
   - Document this explicitly in the submission README as "guest demo outside the SDK runtime; SDK-gated venues for owners".
4. **SDK patch.** It is small and additive, and falls back gracefully if missing. Propose it upstream.
5. **Real-RF readiness depends on the RF team** for the "stream to active Friends" entrypoint address. Until then, the spec routes the 50% to a documented escrow.

---
## HOSTING DECISION (owner, 2026-09-30, final) — supersedes §4 Cloudflare Workers/D1/DO backend
- **Public URL:** `https://<app>.florent-g.workers.dev` (owner's workers.dev subdomain; may be renamed to floflo777 by the owner — keep the host name configurable). A thin Cloudflare **edge Worker** (`workers/edge`) serves the static client (Workers Static Assets: apps/web dist + SDK child documents with their CSP) and reverse-proxies `/api/*` and `/ws/*` (WebSocket upgrade pass-through) to the origin, adding a shared-secret header `x-pl-origin-key`.
- **Origin (hidden):** `rf-origin.ailog.fr` (Cloudflare-proxied DNS → 51.254.203.108), never shown to users. nginx vhost on ailog accepts only that host, only Cloudflare IP ranges, and requires `x-pl-origin-key`; TLS via Cloudflare Origin cert or Let's Encrypt.
- **Backend on ailog:** Node 22 in Docker — Fastify HTTP API + `ws` WebSocket rooms in-process (hub shards = in-memory `Room` objects implementing the same logic as the RoomDO/DirectoryDO design), PostgreSQL 16 in its own container (named volume), Kysely + SQL migrations (schema = §4.2 translated to Postgres). Replay verification of every Daily Run in a worker thread (no CPU limit).
- docker compose project isolated under `/home/ubuntu/pixel-life/`, own network, bind to 127.0.0.1 on free ports (in use: 3000,3004,3010-3014,3020,3306,4000,4100,5433,8000,8020,8080,8090,8100,8900) → use 3100 (api) and 55432 (postgres). NEVER touch other services.
- Consequences: `workers/api` becomes `apps/server` (Node). Durable Object sections map to in-process classes behind the same interfaces; rate limits via in-memory token buckets; `VERIFY_Q` via a worker_threads pool; KV cache via Postgres + HTTP cache headers.
