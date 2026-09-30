# Seed Pack Booth

Pixel Life's only chance game, built as a **stock FriendSDK v0.1.4 game directory** (`index.tsx` + `game.json`).
The SDK runtime supplies the wallet, the owned-Friend selection, the fresh eligibility gate, the sandboxed iframe, the
bridge and the trusted confirmations. This component only presents **buy → open → reveal → keep or redeem**.

Every RF amount is **simulated** (the client runs in `preview` mode) and is labelled as such in the UI.
A connected wallet that owns a hardwired Rare Friends Generations NFT (generation ≥ 1) on Robinhood mainnet
(chain 4663) is still required to play; there is no guest path into this venue (DECISIONS D-11).

## Run

From the repository root (`npm ci` applies the SDK patch through `postinstall`):

```sh
npm run dev -w @pl/seed-pack        # friendsdk dev: http://127.0.0.1:4173, needs a real eligible wallet
npm run build -w @pl/seed-pack      # static output in apps/seed-pack/.friendsdk/
npm run sdk:check -w @pl/seed-pack  # friendsdk check
npm run sdk:test -w @pl/seed-pack   # friendsdk test at 360 px and 960 px (Playwright Chromium, mock wallet)
npm run sdk:flow -w @pl/seed-pack   # buy → open → keep → redeem through the real runtime + confirmations
npx vitest run --project @pl/seed-pack
```

`sdk:test` and `sdk:flow` need Playwright's Chromium once: `npx playwright install chromium`.

## Controls

| Action                   | Pointer / touch                                                                              | Keyboard                  |
| ------------------------ | -------------------------------------------------------------------------------------------- | ------------------------- |
| Buy one pack             | **Buy 1**                                                                                    | `B`                       |
| Open a pack              | **Open a pack**                                                                              | `O`                       |
| Resume a pending opening | **Finish opening** (uses no new pack)                                                        | `O`                       |
| Skip the reveal          | **Skip reveal**                                                                              | `Space`, `Enter` or `Esc` |
| Keep / redeem            | **Keep** / **Redeem**                                                                        | `K` / `R`                 |
| Sound on/off             | **Sound on/off**                                                                             | `M`                       |
| Reduced motion           | **Motion on/off** (defaults to the system setting)                                           | —                         |
| Panels                   | **Booth / Odds / Inventory** tabs (phones); **Odds / Inventory** beside the booth (≥ 720 px) | Tab + Enter               |

All targets are ≥ 44 px (tabs and header toggles 32–36 px), the whole UI works at 360 px wide, and the bottom 58 px are
kept clear for the SDK toolbar and menu. Every action is disabled while the runtime is `paused` (its menus or
confirmations are open). Loading, read errors (with **Retry**), cancelled confirmations and action errors all have
visible states.

## Rules (exact; `game.json` = `docs/design/tokenomics/game.json` = `SEED_PACK` in `@pl/shared`)

| Rule                 | Value                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Consumable           | Seed Pack, **5 RF** (`5000000000000000000` base units)                                                                          |
| Sprout               | **56.00 %** (5,600 bps), fixed value **2 RF**                                                                                   |
| Bloom                | **30.00 %** (3,000 bps), fixed value **5 RF**                                                                                   |
| Full Bloom           | **12.00 %** (1,200 bps), fixed value **8 RF**                                                                                   |
| Gold Pixel           | **2.00 %** (200 bps, 1 in 50), fixed value **45 RF**                                                                            |
| Expected value       | **4.48 RF** per pack · RTP **89.60 %** · house edge **10.40 %**                                                                 |
| Price back or better | 44.00 % of packs (Bloom or higher)                                                                                              |
| Backing              | every purchased or pending pack reserves the **45 RF** max prize; a new purchase needs free stake ≥ 45 RF and free + 5·q ≥ 45·q |
| Settlement           | once per play, no reroll; the reveal is presentation only                                                                       |
| Kept rewards         | no expiry; redeem at the fixed value to the Friend's canonical wallet                                                           |

What a kept reward does happens in Pixel Life, not here: Sprout / Bloom / Full Bloom can be planted (redeem + Regrow,
+20 % bonus: 4 / 12 / 19 px). A held Gold Pixel is worn as a gold voxel and speeds free regrowth ×1.25 each (2 count
at most), read live, so redeeming removes the perk; it never gives in-run power (DECISIONS D-04, D-13). Those numbers
live in `src/rules.ts`, a mirror of `@pl/shared` (`ECON`, `plantPixelsForOutcome`) because the SDK checker rejects
imports from outside the game directory; `tests/shared-parity.test.ts` fails if either copy drifts.

## Presentation

- **Art direction** (docs/design/art/art-bible.md): paper sky in pond → paper bands with 2 px checker dither only at
  band edges, ink UI with radius 0 and hard offset shadows, Silkscreen for display text and numbers, stepped motion
  (`steps()`, the SDK reveal's eased keyframes are overridden). **Lime `#CCFF00` is only on the one "act now" button**
  (Buy when you have no pack, Open when you do, Keep on a result). **Gold `#E8B530` appears only for the Gold Pixel.**
- **Reveal scaled by rarity**: SDK `RewardReveal` inside a stage that grows with the tier: Sprout (common) small card,
  Bloom (uncommon) larger, Full Bloom (rare) larger with a 6 px shadow and sun halo, **Gold Pixel (legendary) the hero
  moment**: the whole frame flips to ink, a one-frame 1-bit inversion at the reveal, a stepped 9-ray burst, a dithered
  sun bloom made of dots (no blur), stepped 4-point sparkles, "GOLD PIXEL" with a gold hard shadow, "1 in 50", and the
  SDK `reveal-legendary` cue plus a three-note bell cluster. Rarity is ranked by reward, so the top prize is always the
  hero even if the table changes.
- **Sound**: SDK `createFriendSoundKit` cues (select, purchase, action-start, anticipation, reveal-common / rare /
  legendary, reward). Mute is in the header and on `M`. The sandbox has no storage, so the setting lasts for the session.
- **Reduced motion**: follows `prefers-reduced-motion`, with an in-game override. It disables the burst spin, flash,
  sparkles and reveal animation (the reveal resolves immediately).
- **Font**: Silkscreen 400/700 (SIL OFL 1.1, `assets/fonts/OFL.txt`, from `@fontsource/silkscreen` 5.3.0) is bundled
  as local `woff2`. The child CSP (`font-src 'self'`) allows it and the CLI's file loader emits it next to `game.js`.
  Body text uses the system monospace stack (Archivo / Sometype Mono are not bundled, to keep the child small).
- **Layout**: `host.css` keeps 960 × 640 (3 : 2) on desktop and switches the frame to 3 : 4 below 600 px, so a
  360 px phone gets a 360 × 480 frame. The Pixel Life shell sets the same `--rf-game-*` variables on its wrapper.

## Integration in Pixel Life

The shell mounts the built child (`/venues/seed-pack/game.html`) with `ConnectedGameHost`, reusing its own wallet and
Friend context, and passes `previewClient` (added by `patches/@rarefriends+friendsdk+0.1.4.patch`) so that packs and
rewards live in the server ledger instead of the SDK's session-local preview ledger:

```tsx
<ConnectedGameHost definition={seedPack} frameUrl="/venues/seed-pack/game.html"
  selectedFriend={friend} account={account} chainId={chainId} publicClient={publicClient} revision={revision}
  previewClient={({ friendId, walletAddress, chainId, definition }) => serverLedgerClient(...)} />
```

The factory is called **only after** the SDK's fresh eligibility gate passes, once per verified
chain / Friend / canonical wallet, with the verified canonical wallet address. Without it, the stock
`createGamePreview` ledger is used (20 RF, reset on reload). The child needs no change either way: it only sees the
fixed `GameClient`. See `tests/preview-client-patch.test.tsx`.

The same patch adds an optional `previewLabel` string (threaded to `GameFrame`) that replaces the frame toolbar's
stock "Local preview" in preview mode only. The shell passes a label saying the RF is SIMULATED and the ledger is kept on
the server, since "Local preview" would claim nothing persists (issue #33). Live mode keeps "Live · Robinhood".

## Not implemented here

- Live mode (real RF, Dice RNG). The component already handles a pending play (`settle` returning `outcomeId: null`) by
  offering **Finish opening**, which never consumes another pack, as the SDK requires.
- Buying more than one pack per action, planting, wearing gold and the Gold Pixel market: those belong to the hub.
- No trading, creator fees or wearable NFTs (not SDK v0.1.4 capabilities).
