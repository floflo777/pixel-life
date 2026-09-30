# Pixel Life

> Draft of `submissions/pixel-life/README.md` for [spokesz/rarefriends-vibeathon](https://github.com/spokesz/rarefriends-vibeathon). It replaces our earlier entry "Nest" (PR #142). Placeholders are marked `‹TBD›` and are filled in from the final build. Name note at the end.

**Project name**
Pixel Life (working title, see [Name](#name))

**Builder / contact**
[@floflo777](https://github.com/floflo777) · contact via GitHub issues

**Category**
Character Spotlight (primary), Token Activity, Economy Potential

**One sentence**
Your Rare Friend's own on-chain 16×16 pixels are its health in a drag-and-fling arcade inside a Club Penguin-like hub: every hit knocks a pixel off, time heals it for free, and $RAREFRIENDS regrows it (0.5 RF/px, half burned) or mends another player's Friend (1 RF/px, half burned, half paid into that Friend's ERC-6551 wallet).

**Source repository**
https://github.com/floflo777/pixel-life ‹TBD: pinned commit› · TypeScript, three.js, FriendSDK v0.1.4 (with one documented patch), Node 22 + Fastify + PostgreSQL, Foundry. Setup: `npm ci && npm run check`. Details in [Stack](#stack-and-friendsdk-usage).

**Playable preview**
https://pixel-life.florent-g.workers.dev

- **No wallet:** "Play now" starts a run with a loaned real Friend, labelled "on loan". No RF, no economy.
- **Your own Friend:** a browser wallet on Robinhood Chain (4663) holding a hardwired Generations NFT (generation ≥ 1). The FriendSDK gate checks ownership at a fresh block, then our server repeats the check. No RF, gas or transaction is needed: every RF amount is **simulated** and labelled SIMULATED on screen.

---

## What it is

**The rule:** "Every hit knocks a pixel off your Friend. Grab it back, or regrow it."

- **Your Friend is the body.** The Friend's canonical frame 0 (front idle), read from the on-chain registry, is extruded into voxels, one voxel per pixel, front face always toward the camera. Pixel count is its health and its mass: fewer pixels = lighter = faster and harder to control.
- **Scars persist.** Pixels you fail to grab back are missing everywhere afterwards: in the hub, on the Friend's page, on the share card. They grow back for free at 0.5 px/hour. RF skips the wait.
- **Family = playstyle.** Each of the 9 families gets one physics trait (Skeleton pixels crawl back, Mask parries, Cellular splits in two, Hoverer glides off edges, Colossus stomps, ...). Generation and tier are cosmetic only: they size the Friend's home island and colour its flag, matching the protocol's "Promote: more land" and "Upgrade changes the reward tier, not the character's appearance".
- **The hub (the Sky).** A shared floating-island world where you walk your voxel Friend among other players' real Friends, with their real scars, stitches and gold, emote with preset phrases, Mend strangers and enter venues. Pixel Life is the flagship venue; the Seed Pack Booth is the second.

## Stack and FriendSDK usage

| Part                                     | What we use                                                                                                                                                                                                             | Why                                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wallet, Friend discovery, ownership gate | **FriendSDK, unchanged:** `createFriendWalletSession`, `readOwnedFriends`, `readGenerationEligibility` + `tokenBoundAccount` (the same sequence as `ConnectedGameHost`), `GameMenu` picker                              | The SDK rule: games do not reimplement wallet, discovery or gate.                                                                                                                    |
| Sprites, sound, reveal                   | **FriendSDK, unchanged:** `createFriendReader` (on-chain frames), `createFriendSoundKit`, `RewardReveal`                                                                                                                | Canonical art and cues.                                                                                                                                                              |
| Seed Pack Booth (the chance game)        | **Stock FriendSDK game directory** (`apps/seed-pack`: `index.tsx` + `game.json`), sandboxed iframe, mounted through `ConnectedGameHost`                                                                                 | The SDK's only economy primitive; its reserve rules and trusted confirmations stay as they are.                                                                                      |
| Persistence                              | **Custom:** server ledger (PostgreSQL) + **one ~15-line SDK patch** adding an optional `previewClient` factory to `ConnectedGameHost`, called only after the gate passes (`patches/@rarefriends+friendsdk+0.1.4.patch`) | The SDK sandbox has no storage and the bridge has no save API, so scars and kept rewards would vanish on reload. Without the patch the booth falls back to the stock session ledger. |
| Hub, Pixel Life, first-party venues      | **Custom:** three.js renderer in the trusted top-level page, deterministic 60 Hz sim in `@pl/shared`, WebSocket hub rooms                                                                                               | A shared world and a physics venue do not fit the 960 × 640 sandboxed child, and a sandboxed child cannot authenticate to a backend.                                                 |
| Guest mode                               | **Custom, outside the SDK runtime:** loaned Friends' canonical sprites baked at build time with the SDK reader                                                                                                          | Lets anyone play without a wallet while never entering, bypassing or feeding sample identities to the SDK gate. See [judges-faq.md](judges-faq.md).                                  |
| Session auth                             | SIWE (a signature, no transaction) + server-side fresh-block `readGenerationEligibility`                                                                                                                                | The server must know the player owns the Friend before it stores scars or debits the simulated ledger.                                                                               |
| Hosting                                  | Cloudflare edge Worker (static client + proxy) → Node origin                                                                                                                                                            |                                                                                                                                                                                      |

**SDK friction we hit** (each documented for the RF team, not worked around inside the sandbox):

1. No persistence in the sandbox and no save API → the `previewClient` patch above; proposed upstream as a "persistent preview ledger".
2. No results channel from a sandboxed game to its host (the bridge allows only `read/canBuy/buy/play/settle/redeem`) → first-party venues run in the trusted page; we propose an additive `report({kind, payload})` message (contracts/README.md, Q3).
3. `friendsdk check` rejects imports from outside the game directory → the booth mirrors the shared rules in `src/rules.ts`, and a parity test fails if the two copies drift.
4. No trading, creator fees, wearable NFTs or multi-tier consumables in v0.1.4 → the Gold Pixel market is simulated and spec'd (below).

## How to play

| Action      | Mouse / touch                                 | Keyboard                                                                            |
| ----------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Aim + power | press anywhere and drag back (12 px deadzone) | ←/→ or A/D aim (Shift = fine), ↑/W snap to nearest creature, hold Space/J for power |
| Fling       | release                                       | release Space                                                                       |
| Cancel aim  | release inside the deadzone                   | Esc                                                                                 |
| Pause       | on-screen button                              | Esc / P                                                                             |
| Hub: walk   | click / tap the ground                        | ‹TBD›                                                                               |
| Mute        | on-screen toggle                              | M                                                                                   |

Also: gamepad, one-switch and tap-to-target modes, reduced motion, a separate "no flashes" setting, 360 px wide layouts, the SDK corners kept clear. ‹TBD: confirm each against the final build.›

**A run (60 s).** Fling your Friend across a floating island to pop the **Munchies**, six creatures that eat loose light (Nib, Pogo, Clank, Snatch, Slurp, Fizz). Every creature telegraphs before it bites. A bite knocks 1–3 pixels off; you have 2 s to sweep them back before they crumble. At 40 s, **Old Gulp**, a cloud whale, bites a wedge off the island: hit its three lit teeth to make it burp. Falling off the edge costs 3 pixels.

**Limits that keep loss fair:** a run can persist at most `min(12, max(6, round(0.15 × N0)))` scars (N0 = the Friend's pixel count), a Friend never drops below 50 % of its pixels, and play itself never costs or pays RF.

## Costs, odds and rewards

**Everything below is simulated** in the preview. An owner's Friend starts with 20 SIMULATED RF (the same as the SDK preview ledger) and gets 5 SIMULATED RF per day. Guests have no RF. Source of truth: `ECON` and `SEED_PACK` in `packages/shared`, `docs/design/tokenomics/game.json`.

### RF actions

| Action                             | Price               | Split                                                             | Rules                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free regrowth**                  | 0 RF                | none                                                              | 0.5 px/hour per Friend (×1.25 with 1 held Gold Pixel, ×1.5 with 2 or more). Pixels only, never RF.                                                                                                                                |
| **Regrow** (your Friend, instant)  | 0.5 RF / pixel      | 50 % burned · 50 % to the protocol's active-Friends reward stream | You pick the missing pixels; the quote locks them for 15 min.                                                                                                                                                                     |
| **Mend** (another player's Friend) | 1.0 RF / pixel      | 50 % burned · 50 % to **the target Friend's ERC-6551 wallet**     | Target must have missing pixels; not your own Friend; a Friend receives at most 24 px/day of Mends. Stitches stay visible 7 days. Mend = 2 × Regrow so mending your own Friend from a second wallet is never cheaper than Regrow. |
| **Seed Pack**                      | 5 RF                | FriendSDK ChanceGame stake                                        | Table below.                                                                                                                                                                                                                      |
| **Plant a seed**                   | the seed's RF value | as Regrow                                                         | Redeem a Sprout / Bloom / Full Bloom and regrow with it, +20 % bonus pixels: 4 / 12 / 19 px.                                                                                                                                      |

### Seed Pack (the only chance game)

| Outcome            |                 Chance |            Fixed RF value | Use                                                                                      |
| ------------------ | ---------------------: | ------------------------: | ---------------------------------------------------------------------------------------- |
| Sprout             |       56 % (5,600 bps) |                      2 RF | plant (4 px) or redeem                                                                   |
| Bloom              |       30 % (3,000 bps) |                      5 RF | plant (12 px) or redeem                                                                  |
| Full Bloom         |       12 % (1,200 bps) |                      8 RF | plant (19 px) or redeem                                                                  |
| **Gold Pixel**     | 2 % (200 bps, 1 in 50) |                     45 RF | **hold** (worn as a gold voxel on the Friend; free regrowth ×1.25 each, max 2) or redeem |
| **Expected value** |                        | **4.48 RF per 5 RF pack** | RTP 89.6 %, house edge 10.4 %. Money back or better in 44 % of packs.                    |

- One consumable → one result, locked at settlement, no reroll; the reveal is presentation only.
- Every purchased pack reserves the 45 RF max prize (SDK rule); a purchase needs free stake ≥ 45 RF and free + 5·q ≥ 45·q.
- Kept rewards never expire and redeem at their fixed value to the Friend's wallet. They are SDK Friend-bound ERC-1155s, so they travel with the NFT when it is sold.
- The Gold Pixel perk is read live from the held balance, so redeeming it ends the perk (no double use). It never gives in-run power.

### Bits (soft currency)

Earned by playing any venue (10 per run + up to 20 for skill + 50 for the first run of the UTC day; full rate to 250/day, 25 % to 500/day, then 0). Spent on cosmetics and home-island items. **Never bought with RF, never converted to RF, never transferable.**

What does not exist, by design: no player-funded prize pool, no RF for playing, no wagers, no leaderboard RF prize, no RF moving from a loser to a winner, no RF minted.

## Live-readiness (what exists for real RF)

Nothing is deployed. There is no real RF activity to report and we report none. What exists:

| Piece                                                                                                                                                                                                                                                                                           | State                                                                                                                                                                                                               | Check it                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PixelLifeSink.sol`: `regrow` / `mend`, paid by the Friend's own ERC-6551 wallet through `execute`. 50 % burned with `RF.burn`, 50 % to the stream forwarder (Regrow) or to the target Friend's wallet in the same call (Mend). No owner, pause, upgrade or withdraw; holds 0 RF between calls. | spec'd + tested, **not deployed, not audited**                                                                                                                                                                      | `cd contracts && forge test` (22 tests, fuzz runs 1024)                                                            |
| `StreamForwarder.sol`: anyone can push its balance into the live `ActivationManager.fund(RF, amount)` (selector `0x7b1837de`), the permissionless entry we found in the deployed contract.                                                                                                      | spec'd + tested; **needs RF-team sign-off** on using `fund`                                                                                                                                                         | local fork test below                                                                                              |
| Mainnet behaviour                                                                                                                                                                                                                                                                               | checked on an **in-memory local fork**, nothing broadcast: `RF.burn` lowers `totalSupply`; `transfer(0x0)` reverts; real Friend #7730's wallet pays `regrow` through `execute`; `forward()` reaches the real `fund` | `PIXELLIFE_FORK_RPC=https://rpc.mainnet.chain.robinhood.com forge test --match-contract MainnetFork`               |
| Seed Pack                                                                                                                                                                                                                                                                                       | `game.json` passes the SDK's own `parseChanceGame`; live mode is the stock SDK ChanceGame deployment (needs a 10,000 RF stake agreement)                                                                            | `npm run sdk:check -w @pl/seed-pack`, `node --experimental-strip-types docs/design/tokenomics/sim/verify-game.mts` |
| Server                                                                                                                                                                                                                                                                                          | `ECONOMY_MODE=sim` by default; `live` credits pixels only from receipt-verified `Regrew` / `Mended` events                                                                                                          | `apps/server`                                                                                                      |

Runbook, event schema and open questions for the RF team: [contracts/README.md](../../contracts/README.md).

## Hub and venue platform

The roadmap line "Tap into Rare Friends distribution" is what the hub is for. The shell owns identity, the Friend (with its scars and gold), persistence, economy and social; **a venue owns only gameplay** (`packages/venue-kit`):

- **Native venues** (Pixel Life) run in-process and get the Friend body, input, audio, pause, seeds and a quote-then-confirm economy API. They never price RF themselves.
- **SDK-frame venues** are stock FriendSDK games (`index.tsx` + `game.json`) mounted through `ConnectedGameHost`. The Seed Pack Booth is one. **Community FriendSDK games plug in as venues unchanged:** a door in the plaza, the player's Friend already selected, their own ChanceGame economy staying theirs.
- **Pitch for later** (roadmap, not built): venues that price assets paired with RF, with creator fees routed like the Gold Pixel market below; the Friend's scars and gold follow it into every venue.

**Economy Potential, the Gold Pixel market** ("pair it with $RAREFRIENDS to get a market… earn fees as your assets trade"). Today a Gold Pixel already trades with its Friend NFT. `GoldPixelMarket.sol` (spec level, 5 tests) lists Gold Leaves for RF with a 5 % fee: 2 % burned, 2 % to the Friend that grew it, 1 % to the creator. The fully backed wrapper (45 RF escrowed per Leaf) is described in its header and not implemented. Simulated in the preview.

**Handheld mode.** ‹TBD: ship status› A 128 × 128, 1-bit rendering of the same sim (founder's LCD size), same seeds and replays.

## Checks

| Check                                                                                 | Result                              |
| ------------------------------------------------------------------------------------- | ----------------------------------- |
| `npm run check` (lint, format, typecheck, unit + property tests)                      | ‹TBD: N tests pass›                 |
| Deterministic sim golden-hash corpus                                                  | ‹TBD›                               |
| `forge test`                                                                          | ‹TBD: 22/22 pass› · fork test ‹TBD› |
| `friendsdk check` + `friendsdk test` at 360 px and 960 px (Seed Pack)                 | ‹TBD›                               |
| Seed Pack flow through the real SDK runtime (buy → open → keep → redeem, mock wallet) | ‹TBD›                               |
| Playwright e2e, desktop + 360 px phone (guest run, hub, owner flow with test wallet)  | ‹TBD›                               |
| Real-wallet playthrough on the public preview                                         | ‹TBD: done / not done›              |
| Performance on a mid-range phone                                                      | ‹TBD: fps, device›                  |

## Known issues and limitations

- **Simulated economy.** No contract is deployed; RF shown in the preview is simulated and labelled. Live mode needs a security review, the RF team's answer on `ActivationManager.fund`, and a 10,000 RF Seed Pack stake.
- **Guest mode is outside the SDK runtime.** Guests play with loaned Friends and have no economy; their scars live only in their browser (`localStorage`) and reset daily. See [judges-faq.md](judges-faq.md).
- **One SDK patch** (`previewClient`). Without it the booth still works, with session-only packs.
- **Wallets:** injected wallets (EIP-6963) only, as provided by the SDK. Session sign-in is a signature, never a transaction.
- **Anti-cheat is proportionate:** no RF depends on a run result; scars and ranked runs are replayed server-side from the input log.
- **Hub** is click-to-move with preset chat only. ‹TBD: shard caps observed under load›
- **Source repository is private at the time of this draft** and must be made public before submission. ‹TBD›
- ‹TBD: anything that fails in the final checks›

## Credits

- Rare Friends Generations artwork: read from the on-chain registry through FriendSDK and kept as the recognisable base.
- [FriendSDK](https://github.com/spokesz/friendsdk) v0.1.4 (`spokesz/friendsdk@ca3bf18`), Apache-2.0: runtime, identity, sprites, sound kit, reveal. See its NOTICE.
- [Kenney 1-Bit Pack](https://kenney.nl/assets/1-bit-pack), CC0: UI glyphs, decals and prop extrusion sources.
- Silkscreen font, SIL Open Font License 1.1 (`apps/seed-pack/assets/fonts/OFL.txt`). ‹TBD: any other bundled font›
- Creatures, islands and sounds: our own (sounds synthesized in code).

## Name

"Pixel Life" works but is generic and does not say what you do. Alternatives, in order of preference:

1. **Loose Pixels**: the rule in two words ("grab it back"); searchable.
2. **Scar & Mend**: names the two verbs that make the social economy.
3. **The Sky** for the hub/platform, with the flagship venue keeping its own name (keeps room for more venues).
