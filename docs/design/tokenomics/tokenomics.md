# Pixel Life: tokenomics (final prices)

Scope: the locked concept (`../final-concept.md`), including the owner's hub EXTENSION (Club Penguin-like hub with venues). Legal questions are out of scope. The design has to be technically sound: no double spend, no farmable drain, every promise funded, no RF minted, and no RF moving from a loser to a winner.

Files in this folder:
- `tokenomics.md`: this document.
- `game.json`: the Seed Pack in FriendSDK `ChanceGameDefinition` format, verified with the SDK parser.
- `PixelSplitter.sol`: a 79-line sketch. It compiles with forge and solc 0.8, and is not deployed.
- `sim/sim.py`: the Monte-Carlo (Python 3 stdlib only).
- `sim/out_seed42.md`: the full output.
- `sim/verify-game.mts`: the SDK parser and preview-ledger check.

```sh
cd design/tokenomics
python3 sim/sim.py                     # 10,000 players x 90 days + 24-row sensitivity grid (3 seeds/row), ~70 s on 12 cores
python3 sim/sim.py --no-sens --seed 7  # main run only, other seed (~8 s)
node --experimental-strip-types sim/verify-game.mts   # parses game.json with FriendSDK's parseChanceGame (Node >= 22.6, no npm install)
```

---

## 0. Final prices (one table)

| Item | Price | Where the RF goes | Status |
|---|---|---|---|
| **Regrow** (any Friend, instant) | **0.5 RF / pixel** | 50 % burned · 50 % protocol active-Friends stream | PixelSplitter (new, 79 lines). Stream entry needs the RF team. Phase-1 fallback burns 100 %. |
| **Mend** (someone else's Friend, pays them) | **1.0 RF / pixel** (= 2 × Regrow) | 50 % burned · 50 % into **that Friend's ERC-6551 wallet** | PixelSplitter, live-ready (uses `Generations.tokenBoundAccount`) |
| **Free regrowth** | **0.5 px / hour** per Friend (12 px/day). ×1.25 with 1 Gold Pixel, ×1.5 with 2 or more | pixels only, never RF | off-chain server |
| **Seed Pack** (the one chance game) | **5 RF** | FriendSDK ChanceGame stake. Edge swept weekly above the 10,000 RF target: 50 % burned · 50 % stream | **Live-ready: `game.json`, no new contract** |
| Plant a seed | redeem at fixed value, then Regrow with that RF, +20 % bonus pixels (rounded down) | same as Regrow | SDK `redeem` + PixelSplitter |
| Home-island decor (RF tier) | 2 / 5 / 10 / 25 RF. The 10 and 25 RF "crafted" pieces also need a 1,000 / 2,500 Bits blueprint | 50 % burned · 50 % stream | PixelSplitter `spend(DECOR)` |
| Gold Leaf market (roadmap) | listing price in RF, floor 45 RF (backing) | 5 % fee: **2 % burned · 2 % royalty to the origin Friend's wallet · 1 % creator** | GoldLeaf vault + market (spec §6). Simulated in the MVP |
| **Bits** (soft currency) | earned in venues, never sold | not RF, no RF exit | off-chain |
| Seed Pack bankroll | **10,000 RF initial stake** | developer capital in ChanceGame | funding agreement |

Two deliberate changes from the concept text, both required for soundness and both supported by the sim:
1. **Mend costs 2 × Regrow, not the same price.** At equal prices, an alt wallet that "Mends" your own Friend pays 0.5 RF/px and gets 0.25 RF back into your own Friend. That is a 50 % discount on Regrow and it diverts the stream half. At 2 × the alt route costs exactly the Regrow price and burns twice as much. Sim: net 0.500 RF/px and 0.500 RF/px burned, against Regrow's 0.25 burned. The concept's own notification copy still works as written: "a stranger regrew #344030's ear and paid it 0.5 RF" (1 px at 1 RF, half to the Friend).
2. **Seeds have no in-game effect while held.** Using a seed means redeeming it (on-chain burn) and paying a Regrow with the RF it releases. This is the only way to avoid double use of an SDK reward, because a reward can only be removed on-chain through `redeem`, which pays its RF value. See §4.

---

## 1. Every sink and faucet

### 1.1 RF sinks (RF in)

| # | Sink | Price | Burned | To protocol stream | To a specific Friend wallet | Kept by the game | Trigger |
|---|---|---|---:|---:|---:|---:|---|
| S1 | Regrow | 0.5 RF/px | 50 % | 50 % | 0 | 0 | "regrow now" on the result card / before the Daily Run |
| S2 | Mend | 1.0 RF/px | 50 % | 0 | 50 % | 0 | the Sky's Mend board, share-card deep link |
| S3 | Seed Pack | 5 RF | 5.2 % net (half the 10.4 % edge) | 5.2 % net | 0 | 89.6 % returned as redeemable rewards | shop on the island |
| S4 | Planting (redeemed seed RF re-spent as Regrow) | 0.5 RF/px | 50 % | 50 % | 0 | 0 | tap a seed onto a scar |
| S5 | RF decor | 2–25 RF | 50 % | 50 % | 0 | 0 | home island catalog |
| S6 | Gold Leaf trade fee (roadmap) | 5 % of price | 2 % | 0 | 2 % (origin Friend) | 1 % creator | market |

### 1.2 RF faucets (RF out). None of them mints.

| # | Faucet | Funded by | Rule |
|---|---|---|---|
| F1 | Seed Pack rewards (Sprout, Bloom, Full Bloom, Gold Pixel) | the ChanceGame stake, where each pack's max prize is reserved at purchase | fixed RF values, no expiry, redeem pays the Friend wallet |
| F2 | Mend receipts | the mender's payment, forwarded in the same call | 50 % of each Mend. Owner-level cap of 24 px/day from strangers (≤ 12 RF/day) |
| F3 | Protocol stream | 50 % of S1/S4/S5 + 50 % of the swept edge | the protocol distributes it to **all** active Friends by weight (not a game pool) |
| F4 | Gold Leaf unwrap / origin royalty (roadmap) | 45 RF escrowed per Leaf; buyers' fees | 1:1 backed, no admin |

There is **no** player-funded prize pool, no leaderboard RF prize, no RF for play, and no wager. The Daily Run leaderboard is status only. A Mend is a voluntary gift, not a transfer from a loser to a winner. Seed Pack prizes are paid from reserved stake, so no prize depends on another player's future loss.

### 1.3 Non-RF resources

| Resource | Faucet | Sink | Exit to RF |
|---|---|---|---|
| Pixels (per Friend) | free regrowth 0.5 px/h, paid Regrow/Mend/Plant, plant bonus | lost in venue runs (≤ 12 px/run, never below 50 % of the sprite) | **none** |
| Bits (per account) | venue runs (§7) | catalog, island plots, blueprints | **none** |
| Pixel credit (per Friend) | a paid quote that arrives after the pixels already healed for free | auto-applied to the next loss | **none** |

---

## 2. Regrow, Mend and free regrowth: how the sim justifies them

**Rules.** A Friend's pixel count is its canonical frame-0 sprite, 42–92 px in the real sample. A 60 s run loses on average 2–3.5 px after grab-backs, depending on skill, with a cap of 12 px per run and a floor at 50 %. Free regrowth accrues continuously while any pixel is missing and never banks while whole. Regrow and Mend fill specific missing pixels named in a server quote (§5.3).

**Free regrowth = 0.5 px/h.** Averages over 3 seeds, all other prices at baseline:

| free regrowth | avg missing of an active Friend | share of lost px healed free | RF burned/day | ever paid |
|---|---:|---:|---:|---:|
| 0.25 px/h | 31.0 % | 69 % | 3,889 | 67.3 % |
| **0.5 px/h** | **17.1 %** | **87 %** | **2,244** | **65.4 %** |
| 1.0 px/h | 7.3 % | 92 % | 1,429 | 61.8 % |
| 2.0 px/h | 7.0 % | 94 % | 1,151 | 60.4 % |

- At 0.25 px/h the Friend is a third gone most of the time. That breaks the locked "scars heal" promise, which exists because the 5-second test showed permanent-feeling loss scares players.
- At 1.0 px/h and above, scars barely register and burn drops 36 %.
- 0.5 px/h keeps scars visible (about 1 px in 6 missing) while 87 % of damage heals for free. A casual player who plays 2 runs a day is whole by the next day without paying. A heavy player (6+ runs a day) runs a deficit and pays, plants, or lives with scars.

**Regrow = 0.5 RF/px.**

| Regrow price | burned/day (elasticity 1) | burned/day (elasticity 2) | ever paid (e=1 / e=2) | Mend price (2×) |
|---|---:|---:|---:|---:|
| 0.25 | 1,608 | 2,025 | 69.3 % / 75.2 % | 0.5 |
| **0.5** | **2,244** | **2,244** | **65.4 % / 65.4 %** | **1.0** |
| 0.75 | 2,578 | n/a | 63.0 % | 1.5 |
| 1.0 | 3,124 | 2,722 | 61.5 % / 59.2 % | 2.0 |

The sim's burn rises with price across the tested range because the demand model is at most elasticity 2 and whales and completionists are nearly price-blind. I do **not** pick the burn-maximising price. The reasons:
1. **Participation.** "Ever paid" falls by about 4–6 points from 0.5 to 1.0. Token Activity is judged on spending, and a broad base of small payers is the story.
2. **The social loop needs cheap gifts.** At 1.0 RF Regrow, Mend would be 2 RF/px and a typical ear (3 px) would cost 6 RF to gift.
3. **It anchors the Seed Pack.** A Sprout at 2 RF plants 4 px, a Bloom at 5 RF plants 12 px and a Full Bloom at 8 RF plants 19 px. Those numbers are readable.
4. **It hurts a bit.** A bad run (−5 px) costs 2.5 RF, which is 2.5 × the cost of hardwiring a Gen-6 Friend.
5. **The price is one immutable constant in the splitter.** 0.75 RF is the documented upside lever if live elasticity turns out low.

---

## 3. Seed Pack (FriendSDK ChanceGame, one consumable, one table)

`game.json` (18-decimal strings, weights sum to 10,000):

| # | Outcome | chanceBps | Chance | Fixed RF value | EV contribution | Use |
|---|---|---:|---:|---:|---:|---|
| 1 | Sprout | 5,600 | 56 % | 2 RF | 1.120 | plant: 4 px, the bonus rounds down (or redeem 2 RF) |
| 2 | Bloom | 3,000 | 30 % | 5 RF | 1.500 | plant: 12 px, 10 paid + 2 bonus (or redeem 5 RF) |
| 3 | Full Bloom | 1,200 | 12 % | 8 RF | 0.960 | plant: 19 px, 16 paid + 3 bonus (or redeem 8 RF) |
| 4 | **Gold Pixel** | 200 | 2 % (1 in 50) | **45 RF** | 0.900 | **hold** (perk, §4) or redeem 45 RF |
| | **Total** | 10,000 | | | **4.480 RF** | **RTP 89.6 %, edge 10.4 % (0.52 RF/pack)** |

- **Player-facing odds:** you get your money back or better (Bloom or higher) in 44 % of packs, 8+ RF in 14 %, and Gold in 2 %. The reveal (SDK `RewardReveal`) is presentation only. The outcome is fixed by Dice at `play`/`settle`, and there is no reroll.
- **Per-pack risk:** σ = 6.15 RF, max prize 45 RF (9 × price), worst single-pack result for the house −40 RF.
- **Reserve math (SDK rule):** a purchase of q packs needs `free ≥ 45` and `free + 5q ≥ 45q`, so each in-flight pack needs 40 RF of free stake. One 99-pack purchase (the bridge maximum) needs 3,960 RF free. Settlement replaces the 45 RF reserve with the actual reward's value. Kept rewards stay reserved until redeemed, with no expiry, including after the Friend is sold.
- **Parser check** (`node --experimental-strip-types sim/verify-game.mts`, using the SDK's own `src/game.ts`):
  ```
  parsed: Pixel Life: Seed Pack / Seed Pack / price 5.0000 RF / outcomes 4
  bps total 10000 | EV 4.4800 RF | RTP 89.60% | max prize 45.0000 RF
  roll buckets 5600 / 3000 / 1200 / 200
  canBuy(1) with 50 RF stake: true | canBuy(2): false (needs free + 2x5 >= 2x45)
  after buy: stake 55.0000 reserved 45.0000 free 10.0000
  settled outcome 4 (Gold Pixel); liability 45.0000 free 10.0000
  re-settle rejected: Play is already settled.
  after redeem: Friend RF 140.0000 stake 10.0000 liability 0.0000 inventory 0,0,0,0
  ```

### 3.1 Bankroll sizing with variance

House P&L per pack has mean +0.52 and σ 6.15. For a drift-positive random walk, P(the drawdown ever exceeds x) ≈ exp(−2μx/σ²) = exp(−0.0275·x). That gives 250 RF at 1e-3 and 500 RF at 1e-6. The sim measured the same thing directly:
- Cold start, exact draws, first 2,000 packs × 2,000 paths: worst cumulative loss p50 22, **p99 211, p99.9 368**, max 428 RF.
- 90-day main run: worst peak-to-trough drawdown 325 RF.

**Stake = 10,000 RF** = two concurrent 99-pack crates (7,920) + p99.9 drawdown (368) + a margin for normal concurrency. **Sweep policy:** every 7 days, `withdrawSurplus(splitter, free − 10,000)` followed by `splitter.flush()`, which burns 50 % and streams 50 %. Only profit above the 10,000 target ever leaves. A monitoring alert fires below 6,000 free, which pauses sweeps.

| Stake (sweep target) | min free stake | packs refused by the reserve rule (3 × 90 days) |
|---|---:|---:|
| 3,000 | 3,000 | 11,274 |
| 5,000 | 5,000 | 951 |
| **10,000** | **10,000** | **0** |
| 10,000 with 99-pack crates ×10 more often | 10,000 | 1,188 (0.2 % of packs, only during crate bursts) |

A refusal only blocks a **new purchase**, takes no payment, and never blocks play, settlement or redemption (SDK behaviour).

**Liability growth:** kept rewards stay backed by the stake that the purchases themselves funded. At day 90 the stake is 93,570 RF, of which 79,867 is kept liability (1,497 held Gold Pixels = 67,365 RF). That is RF parked as backing, out of circulation. It is not burned and cannot be withdrawn by the developer.

---

## 4. Gold Pixel: the hold perk and its live-read rule

**Hold value (real, not pay-to-win):**
- **Sunlit:** free regrowth ×1.25 per held Gold Pixel, counting at most 2 (×1.5). For a player in deficit that is +3 px/day per Gold, or 1.5 RF/day of Regrow they no longer need to buy.
- **Worn:** gold armour voxels on the Friend everywhere in the hub: the Sky, venues and the home island. The glow can crack when knocked in a run (cosmetic, heals). The reward is never forfeited.
- **What it does not touch:** run physics, score, Daily Run rank, Bits earnings, Seed Pack odds, and anything else that resolves a competition. It only shortens the scar-healing wait, which RF can already buy at 0.5 RF/px.

**Why holding is rational:** the 45 RF stays redeemable forever with no expiry, so holding costs only liquidity. Anyone who plays often enough to run a pixel deficit, or wants the look, is better off holding. Anyone who needs RF redeems. In the sim, 60–95 % of engaged profiles hold. **Burn cost of the perk:** 2,244 RF/day with the perk against 2,307 with it off (−2.7 %). At +50 %/Gold the cost rises to −5.5 %, so +25 % is the chosen setting.

**Live-read rule (no double spend):**
```
gold(friendId, interval) = min over [t0, t1] of
    ChanceGame.balanceOf(tokenBoundAccount(friendId), 4)          // SDK kept reward, outcome id 4
  + GoldLeaf.balanceHeldBy(tokenBoundAccount(friendId))           // wrapped form (§6), only when held by a Friend wallet
perk multiplier = 1 + 0.25 * min(gold, 2)
```
- The server indexes `TransferSingle(from = TBA, to = 0, id = 4)` (redeem) and Leaf `Transfer` events. It uses the **minimum balance over each 1-hour accrual interval**, so perk accrual ends at the redeem block.
- A Gold exists either as the SDK ERC-1155 or as a Leaf, never both, because wrapping requires the ERC-1155 to be redeemed first.
- Shuttling one Leaf across N Friends earns at most one Gold's worth of perk in total, because every interval uses the minimum balance.
- Nothing the perk produced is RF-redeemable (only pixels), so "use then redeem" extracts nothing.
- The SDK ERC-1155 is `FriendBoundInventory` (transfers revert), so the Gold, and the perk, travel with the Friend NFT when it is sold. That matches the protocol's "rewards belong to the Friend".

---

## 5. Exact flows

### 5.1 Burn, protocol stream, and directed to a Friend wallet

```
REGROW  payer --(px*0.5 RF)--> PixelSplitter.regrow ─┬─ 50 % RF.burn()
                                                      └─ 50 % streamSink (ActivationManager stream entry; phase 1: burned)
MEND    payer --(px*1.0 RF)--> PixelSplitter.mend   ─┬─ 50 % RF.burn()
                                                      └─ 50 % Generations.tokenBoundAccount(target)  (same tx)
SEED    Friend TBA --(5 RF)--> ChanceGame.buy -> stake;  play -> Dice -> settle -> ERC-1155 reward minted to TBA
        redeem (owner or TBA) -> reward burned, fixed RF -> TBA
PLANT   ChanceGame.redeem(seed) -> RF to TBA ; TBA.execute(approve) ; TBA.execute(PixelSplitter.regrow) -> as REGROW
EDGE    team: ChanceGame.withdrawSurplus(PixelSplitter, free − 10,000) weekly ; anyone: PixelSplitter.flush() -> 50/50
DECOR   payer --(2..25 RF)--> PixelSplitter.spend(DECOR) -> 50/50 burn/stream
MARKET  buyer --(P RF)--> GoldLeafMarket: 95 % seller, 2 % burn, 2 % origin Friend TBA, 1 % creator   (roadmap)
```

### 5.2 Simulated flows, main run (seed 42, 10,000 players, 90 days, stake 10,000)

| | Total | Per day (d1–90) | Per day (d31–90) |
|---|---:|---:|---:|
| **RF burned** | 209,062 | **2,323** | 1,834 |
| **RF to the protocol active-Friends stream** | 165,304 | **1,837** | 1,433 |
| **RF directed to specific Friend wallets (Mend)** | 43,759 | **486** | — |
| of which alt self-return / received by bot-owned Friends | 14,571 / 4,676 | | |
| Spend: Regrow 148,557 · planted seeds 103,640 · Mend strangers 58,376 · alt self-Mend 29,142 · Seed Packs 548,350 (109,670 packs) · RF decor 24,855 | | | |

In context: on 2026-09-30 the protocol stream was reset to 193,586 RF/week, about 27,700 RF/day (see `rarefriends-nest/docs/economics.md`). A 10k-player Pixel Life cohort adds about 1,800 RF/day, roughly +6.6 %. Phase 1, with the stream half burned because the entry point does not exist yet, burns 4,021 RF/day instead.

The population is a single cohort with no new-player inflow, so the active count decays from 7,136 to 2,468 by day 90 (churners and casuals leave). The late-day numbers are therefore a lower bound for a live product.

### 5.3 Server credit (off-chain pixels ↔ on-chain payment)

- The server issues a quote (`quoteId`, Friend, a list of specific missing pixels, price) and **locks** those pixels for 15 min. Free regrowth skips locked pixels.
- The splitter rejects a reused `quoteId` (`usedQuote`), so the same quote cannot be paid twice.
- The server credits once per `quoteId`, after the configured confirmations, from the `Regrow`/`Mend` event.
- A payment that lands after the lock expired regrows whatever is still missing. Any surplus becomes pixel credit (pixels only, Friend-bound).

---

## 6. Gold Pixel market ("pair it with RF to get a market / earn fees as your assets trade")

- **Phase 0 (works today, no contract):** Gold Pixels are Friend-bound ERC-1155s in the Friend's wallet. They already trade **with the Friend NFT** on any NFT marketplace. A Friend with 2 Golds carries 90 RF of redeemable value plus the perk, and the Sky shows it.
- **Phase 1 (simulated in the MVP; contract spec):**
  - **GoldLeaf vault, ERC-721, fully backed.** It needs no SDK change:
    1. The TBA calls `vault.prepare(friendId)`, which snapshots `b0 = ChanceGame.balanceOf(TBA, 4)`.
    2. The owner calls `ChanceGame.redeem(friendId, 4, k)`. 45k RF goes to the TBA, and redeem is the only way the balance can fall because transfers revert.
    3. The TBA calls `vault.wrap(friendId)`. The vault requires the balance to be `b0 − k'`, pulls 45·k' RF, and mints k' Leaves with `originFriendId` and a "grown by #id" provenance.

    Unwrap burns a Leaf and pays exactly 45 RF. There is no admin, no withdraw and no rehypothecation. A cleaner alternative is an RF-team `redeemTo(recipient, data)` callback in a future ChanceGame.
  - **GoldLeafMarket, fixed-price RF listings.** 5 % fee on the RF price: **2 % burned, 2 % royalty to the origin Friend's wallet** ("earn fees as your assets trade, beyond your own sales"; the Friend that grew the Gold keeps earning), and 1 % to the game creator. The practical floor is 45 RF, because anyone can unwrap for 45. The premium prices the perk, status and provenance.
- **Phase 2 (roadmap):** a fungible `gLEAF` in a Uniswap v4 RF pool with a fee hook (1 % burn / 1 % creator). This mirrors the protocol's own PoolManager + Hook market, at the cost of losing the per-origin royalty.
- **Scale, as an assumption rather than a sim result:** 1,500 Leaves with 5 % weekly turnover at 55 RF gives about 4,100 RF/week of volume and about 83 burned + 83 to origin Friends + 41 to the creator per week. The market's value is Economy Potential, not burn.

---

## 7. Hub extension: Bits (soft currency) and home-island decor

**Bits** are the Club Penguin coin: earned by playing any venue, spent on visible identity and the home island ("igloo").

| Rule | Value |
|---|---|
| Earn per venue run | 10 base + up to 20 for skill (fewer pixels lost) + 50 for the first run of the UTC day |
| Daily soft cap (per **account**, shared by all venues) | full rate up to 250/day, 25 % rate up to 500/day, 0 after. Adding venues never raises the cap. |
| Bound to | the player account (wallet), **not** the Friend NFT. Bits items sit in the account wardrobe and can be put on any Friend it owns. |
| Never | bought with RF, transferred, traded, redeemed, converted, used for pixels / Seed Packs / Mend / Gold / market, or paid as a prize |
| Bits catalog | furniture, plants and places to play (150–2,500), Friend accessories as overlays (the canonical sprite is kept), emotes. 40 items at launch, **12 new each month**, some retired (time-scarcity, not trade-scarcity). |
| Island plots | 1,000 / 2,000 / 4,000 / 8,000 / 16,000 Bits (escalating long-tail sink). The base island size comes from the on-chain generation (Promote = "more land"), free, read from chain. |
| Status ladders | venue belts (verified replays) and stamps. **Neither awards Bits**, so completion is not farmable. |

**RF decor** is the premium tier of the same catalog: landmarks, animated pieces, gilding. It costs 2 / 5 / 10 / 25 RF and goes 50/50 burn/stream through the splitter. The 10 and 25 RF **crafted** pieces also need a Bits blueprint (1,000 / 2,500). Whales therefore have to play, and grinders cannot skip RF. RF decor is bound to the Friend (it travels with the NFT), which is fine because its RF was already burned or streamed. It is non-redeemable, so it needs no prize reserve (SDK README: "cosmetics or upgrades without an RF redemption promise do not need a prize reserve").

**How RF stays relevant:** Bits buy time-and-skill identity. RF buys what Bits never can: instant healing (Regrow), paying a Friend (Mend), luck and the Gold Pixel (Seed Pack), the market, and the top decor tier. Pixels are only ever healed by time or RF.

**Why Bits cannot be farmed into RF value:**
1. There is no conversion path in either direction.
2. Bits items are account-bound, so selling a Friend NFT does not carry them.
3. There is no Bits-denominated leaderboard prize.
4. The per-account cap bounds bot output. In the sim, bots minted 23.9 % of all Bits and extracted 0 RF.
5. Sybil accounts only multiply cosmetics nobody can sell.

**Inflation check, 90 days (sim):**
- 58.3 M Bits minted, 40.8 M spent (70 % overall). Engaged humans spend 93–98 % (casual 83 %, churner 76 %).
- Unspent Bits per alive **human** player is flat: **371 on day 30, 380 on day 60, 415 on day 90**. Bots hoard their capped 45,000 each, which has no exit and is harmless.
- Regulars own 31 of 64 catalog items by day 90 and whales 54, so the catalog pacing still has headroom.

| Bits sensitivity (3 seeds) | spent / minted | unspent per human, d90 |
|---|---:|---:|
| baseline | 70 % | 414 |
| faucet × 2 | 78 % | 923 |
| no monthly drops | 68 % | 775 |

Drops and plots are what keep stocks bounded. Operational rule: if an engaged player's unspent stock exceeds 10 days of earnings, ship a drop. Never reprice existing items.

**Venue platform rule:** every venue reports results to the shared Bits faucet (with the shared cap) and may use the RF sinks only through the same splitter. A venue can never create an RF faucet, pool or wager. A venue-specific chance game needs its own ChanceGame deployment and reserve.

---

## 8. Live-ready vs needs a contract

| Piece | Status |
|---|---|
| Seed Pack buy / play / settle / redeem, odds, reserves | **Live-ready with FriendSDK:** deploy ChanceGame with `game.json` (parser-verified), fund 10,000 RF. `createGamePreview` in the MVP, labelled simulated. |
| Gold Pixel hold perk | **Live-ready (read-only):** `ChanceGame.balanceOf(tokenBoundAccount(id), 4)` plus the redeem event index |
| Plant | SDK `redeem`, then **PixelSplitter** |
| Regrow, Mend, RF decor, edge flush | **PixelSplitter** (new, sketch below). The Mend half is live-ready because it only needs `tokenBoundAccount`. |
| Regrow's stream half | **Needs the RF team.** The public ActivationManager ABI exposes `claim/claimBatch/hardwire/promote/upgrade/activate/streams` and no funding entry. Two questions: (a) does a plain RF transfer get rolled into the next 7-day stream? (b) or can they add `fund(asset, amount)`? Until then `streamSink = address(0)`, which burns 100 %. |
| `RF.burn()` | Burns are observed as `Transfer(ActivationManager → 0x0)`. Confirm a public `burn(uint256)` exists; otherwise the splitter needs the RF team's burn path. |
| Gold Leaf vault + market | new contracts (spec §6), simulated in the MVP |
| Pixel state, Bits, catalogs, quotes | off-chain (Cloudflare D1 / Durable Objects), with a daily Merkle root of pixel masks (answers friendsdk issue #6) |

### PixelSplitter spec
- Immutable `rf`, `generations`, `streamSink`, `regrowPrice = 0.5e18`, and `mendPrice = 1e18`. The constructor enforces `mend ≥ 2 × regrow`.
- `regrow(friendId, px, quoteId)`: 50 % burn, 50 % streamSink (or burn).
- `mend(friendId, px, quoteId)`: 50 % burn, 50 % to `tokenBoundAccount(friendId)` in the same call.
- `spend(DECOR, friendId, amount, quoteId)`: 50/50.
- `flush()`: splits any RF balance (the swept edge) 50/50.
- Each `quoteId` is usable once. The target must be hardwired (generation ≥ 1). `px` is in 1..256.
- No owner, admin, withdraw, pause or upgrade. The contract holds no RF between calls. Events feed the server credit.

Full file: `PixelSplitter.sol` (79 lines). It compiles with forge and solc 0.8 against the SDK's vendored OpenZeppelin, with lint notes only. It is not deployed, audited or tested.

```solidity
// SPDX-License-Identifier: Apache-2.0
// SKETCH ONLY. Compiles (forge, solc 0.8.36); not tested, audited or deployed. Needs RF-team answers on burn() and the stream entry.
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
interface IRFBurnable { function burn(uint256 amount) external; }
interface IGenerations { function generation(uint256 id) external view returns (uint8);
    function tokenBoundAccount(uint256 id) external view returns (address); }

/// Every RF in is split 50 % burned / 50 % forwarded in the same call. No owner, admin, withdraw, upgrade or mint.
contract PixelSplitter {
    using SafeERC20 for IERC20;
    IERC20 public immutable rf;
    IGenerations public immutable generations;
    address public immutable streamSink;   // protocol stream entry; address(0) = burn it too (phase 1)
    uint256 public immutable regrowPrice;  // 0.5e18 per pixel
    uint256 public immutable mendPrice;    // 1.0e18 per pixel (= 2 x regrow: self-Mend via an alt is never cheaper)
    uint32 public constant MAX_PX = 256;
    enum Kind { REGROW, DECOR, EDGE }
    mapping(bytes32 => bool) public usedQuote;

    constructor(IERC20 rf_, IGenerations gen_, address streamSink_, uint256 regrow_, uint256 mend_) {
        require(mend_ >= 2 * regrow_, "mend < 2x regrow");
        (rf, generations, streamSink, regrowPrice, mendPrice) = (rf_, gen_, streamSink_, regrow_, mend_);
    }
    function regrow(uint256 friendId, uint32 px, bytes32 quoteId) external {
        uint256 paid = _take(friendId, px, regrowPrice, quoteId);
        _split(paid);                                              // + emit Regrow(...)
    }
    function mend(uint256 friendId, uint32 px, bytes32 quoteId) external {
        uint256 paid = _take(friendId, px, mendPrice, quoteId);
        address wallet = generations.tokenBoundAccount(friendId);
        _burn(paid / 2);
        rf.safeTransfer(wallet, paid - paid / 2);                  // + emit Mend(...)
    }
    function spend(Kind kind, uint256 friendId, uint256 amount, bytes32 quoteId) external { /* DECOR: take, _split */ }
    function flush() external { uint256 bal = rf.balanceOf(address(this)); if (bal > 0) _split(bal); }
    function _take(uint256 friendId, uint32 px, uint256 price, bytes32 quoteId) private returns (uint256 paid) {
        require(px > 0 && px <= MAX_PX && !usedQuote[quoteId], "bad quote");
        require(generations.generation(friendId) >= 1, "not hardwired");
        usedQuote[quoteId] = true;
        paid = uint256(px) * price;
        rf.safeTransferFrom(msg.sender, address(this), paid);
    }
    function _split(uint256 amount) private {
        uint256 half = streamSink == address(0) ? 0 : amount / 2;
        _burn(amount - half);
        if (half > 0) rf.safeTransfer(streamSink, half);
    }
    function _burn(uint256 amount) private { if (amount > 0) IRFBurnable(address(rf)).burn(amount); }
}
```
(The excerpt above is shortened. `PixelSplitter.sol` has the events and the full `spend`.)

---

## 9. Attack analysis

| Attack | What the attacker tries | Mitigation | Sim / math evidence |
|---|---|---|---|
| **Bots** | play thousands of runs to extract value | Play pays no RF. Bits are account-capped at 500/day with no exit. The Daily Run leaderboard is status only and uses server replay of the input log. | 310 bot owners × 5 Friends × ~12 runs/day: **0 RF spent, 0 RF extracted from play**. They minted 23.9 % of Bits, which cannot leave. |
| Bots farming gifts | stay damaged so strangers Mend them | The Sky's Mend board lists **one Friend per owner**, ranked by owner activity signals, with a per-owner cap of 24 px/day (≤ 12 RF/day). Gifts are voluntary. | **0.167 RF/owner/day** received by bots (it was 0.79 before the one-per-owner rule) |
| **Sybils with many NFTs** | multiply free regrowth, perks or Bits | Free regrowth yields pixels only. The perk needs a real 45 RF-backed Gold per Friend (cap 2). Each sybil Friend costs ≥ 1 RF to hardwire (0.5 burned). Sybil Bits only buy unsellable cosmetics. | there is no RF exit to multiply |
| **Alts self-mending** | Mend your own Friend from an alt to get half back | Mend = 2 × Regrow, so net = Regrow price. The constructor enforces this. | net **0.500 RF/px** (= Regrow), burns 0.500 against Regrow's 0.25. At the concept's 1× price: net 0.25 (a 50 % discount) and −9.5 % burn (2,031 vs 2,244/day) |
| **Wash trading the market** | inflate Gold Leaf volume or price, farm royalties | 5 % fee against at most 2 % royalty recouped (only if you own the origin Friend): −3 % per trade. No volume-based rewards anywhere. 45 RF floor backing. | analytic |
| **Redeem after use** | enjoy an item's effect, then redeem it for RF | Seeds have no held effect; using one is redeeming it. The Gold perk is read live with a min-balance interval and ends at the redeem block. Its outputs are pixels, with no RF exit. Leaf and ERC-1155 are mutually exclusive. | no path; the verified preview ledger shows the reward burned on redeem |
| **Reserve exhaustion** | drain the stake or make prizes unpayable | SDK: every pack reserves 45 RF at purchase, and a new purchase is refused unless it is fully backed. Play, settle and redeem are never blocked. The stake is 10,000 RF with sweeps only above target, plus a monitoring alert. | 0 refusals at 10k. 951 at 5k. p99.9 cold-start drawdown 368 RF |
| Quote races / double credit | pay once, get pixels twice; or pay twice by accident | `usedQuote` on-chain, one credit per `quoteId` off-chain, 15 min pixel lock, surplus becomes pixel credit | n/a |
| RNG / reveal manipulation | reroll or pick outcomes client-side | Dice oracle and a result locked at `play`. The reveal is presentation only (SDK rule). | n/a |
| Stream-half recapture | regrow to earn from the stream | Your share equals your weight / total weight (≈ 1.06 B). A Genesis at 2 M weight recovers 0.09 % of spend. | n/a |
| Guest mode | farm with loaner Friends | Guests have no RF and local-only Bits. A one-time claim on connect is capped at 500 Bits. | n/a |

---

## 10. Simulation: model, key outputs, sensitivity

### Model
- **Population:** 10,000 players, seeded (`random.Random(42)`), event-ordered sessions within each UTC day. Friend sizes are drawn from 12 real frame-0 sprites (42–92 px).

| Profile | Share | Active days | Sessions × runs | px lost / run | Pays | Other |
|---|---:|---:|---|---:|---|---|
| casual | 38 % | 50 % | 1 × 2 | 3.0 | rarely | |
| regular | 22 % | 85 % | 2 × 2 | 2.5 | | |
| whale | 2 % | | 3 × 3 | | always pays to full | 0.2 % of sessions buy a 99-pack crate |
| completionist | 6 % | | | 2.0 | stays whole | holds Gold |
| bot farmer | 3 % | | 5 Friends, 3 × 4 each | 1.0 | never | |
| alt-network mender | 2 % | | | | Mends own main from alts | 5 Friends |
| churner | 27 % | | 2 × 3 | 3.5 | | 12 %/day churn |

- **Behaviour:** payment probability grows with missing share and is scaled by (reference price / price)^elasticity. Daily RF budgets apply. Seeds are planted first. Excess seeds above 20 RF are redeemed. 0.5 % of sessions redeem a held Gold for liquidity. Mends go to the most damaged of 5 random Sky Friends. RF decor and Bits purchases are profile-driven.
- **Stated limitations:**
  - Behaviour parameters are assumptions, not measured.
  - It is a single cohort with no inflow.
  - Mend and decor demand are not price-elastic.
  - The market is not simulated (analytic only).

### Key outputs (seed 42)
- **Burned:** 2,323 RF/day (days 31–90: 1,834).
- **Protocol stream:** 1,837/day.
- **Friend wallets:** 486/day.
- **Share of players who ever pay RF: 65.8 %.**

  | casual | regular | whale | completionist | churner | alt | bots |
  |---:|---:|---:|---:|---:|---:|---:|
  | 40.7 % | 97.4 % | 99.5 % | 99.3 % | 70.8 % | 97.1 % | 0 % |

  Ever Regrow 50.8 %, ever Seed Pack 49.4 %, ever RF decor 23.7 %.
- **Pixel balance:** 4.74 M px lost.

  | Healed by | Share of lost pixels |
  |---|---:|
  | free regrowth | **86.4 %** |
  | paid Regrow | 6.3 % |
  | planted | 4.5 % |
  | mended | 1.8 % |

  Average missing share of an active Friend: **17.1 %**.
- **Bankroll:**
  - Stake 10,000 → 93,570 (liability 79,867; 1,497 Golds held).
  - Min free stake 10,000. 0 refused packs.
  - Realized house P&L +57,258. Edge swept 53,555 (50/50).
  - Worst drawdown 325 RF.

| day | active | px lost | px free-healed | avg missing | burned | → stream | → Friend wallets | packs | stake | kept liability | Bits minted | Bits spent |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 7,136 | 104,795 | 31,296 | 10.7 % | 2,760 | 2,120 | 641 | 1,785 | 16,792 | 5,757 | 1,189,179 | 58,800 |
| 7 | 5,759 | 78,809 | 65,886 | 15.0 % | 7,006 | 6,252 | 754 | 1,619 | 27,535 | 17,535 | 952,493 | 677,450 |
| 30 | 3,942 | 52,799 | 47,064 | 15.2 % | 1,963 | 1,463 | 500 | 1,531 | 50,786 | 39,931 | 666,770 | 512,050 |
| 60 | 3,073 | 45,495 | 40,313 | 17.2 % | 1,595 | 1,202 | 392 | 1,174 | 76,863 | 63,893 | 552,861 | 379,800 |
| 90 | 2,468 | 39,483 | 35,316 | 18.6 % | 1,339 | 992 | 348 | 1,169 | 93,570 | 79,867 | 472,638 | 315,050 |

Days 7 and 14 include the weekly edge sweep.

### Sensitivity (each row = mean of 3 full runs, seeds 42–44; RF/day averaged over 90 days)

| scenario | burned/day | stream/day | Friend wallets/day | packs/day | ever paid | avg missing | free/lost px | refused packs | Bits unspent/human d90 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **baseline** (0.5 / 1.0 / 0.5 px/h / 5 RF) | **2,244** | **1,777** | **467** | 1,141 | 65.4 % | 17.1 % | 87 % | 0 | 414 |
| Regrow 0.25 | 1,608 | 1,368 | 240 | 1,122 | 69.3 % | 16.7 % | 82 % | 0 | 406 |
| Regrow 0.75 | 2,578 | 1,909 | 670 | 1,133 | 63.0 % | 17.5 % | 89 % | 0 | 410 |
| Regrow 1.00 | 3,124 | 2,271 | 854 | 1,152 | 61.5 % | 17.6 % | 90 % | 0 | 417 |
| free 0.25 px/h | 3,889 | 3,020 | 869 | 1,129 | 67.3 % | 31.0 % | 69 % | 0 | 416 |
| free 1.0 px/h | 1,429 | 1,225 | 204 | 1,139 | 61.8 % | 7.3 % | 92 % | 0 | 418 |
| free 2.0 px/h | 1,151 | 1,037 | 114 | 1,136 | 60.4 % | 7.0 % | 94 % | 0 | 406 |
| Regrow 0.25 + free 0.25 | 2,501 | 2,061 | 440 | 1,139 | 72.5 % | 29.3 % | 63 % | 0 | 408 |
| Regrow 1.0 + free 1.0 | 1,907 | 1,493 | 414 | 1,139 | 58.8 % | 7.5 % | 95 % | 0 | 409 |
| Mend = 1 × Regrow (concept text) | 2,031 | 1,778 | 253 | 1,134 | 65.1 % | 17.1 % | 86 % | 0 | 405 |
| Seed Pack 3 RF (table scaled) | 2,270 | 1,808 | 462 | 1,861 | 68.3 % | 17.1 % | 86 % | 0 | 412 |
| Seed Pack 8 RF (table scaled) | 2,161 | 1,686 | 476 | 714 | 59.5 % | 17.2 % | 87 % | 99 | 403 |
| Gold perk off | 2,307 | 1,835 | 472 | 1,120 | 65.0 % | 17.2 % | 86 % | 0 | 410 |
| Gold perk +50 %/Gold | 2,179 | 1,709 | 470 | 1,136 | 65.4 % | 17.2 % | 87 % | 0 | 411 |
| elasticity 2, Regrow 0.25 | 2,025 | 1,773 | 252 | 1,153 | 75.2 % | 16.0 % | 76 % | 0 | 411 |
| elasticity 2, Regrow 1.0 | 2,722 | 1,936 | 786 | 1,131 | 59.2 % | 17.8 % | 91 % | 0 | 404 |
| elasticity 2, Seed Pack 8 RF | 2,101 | 1,614 | 487 | 490 | 59.5 % | 17.3 % | 87 % | 495 | 410 |
| phase 1: stream half burned | 4,021 | 0 | 467 | 1,141 | 65.4 % | 17.1 % | 87 % | 0 | 414 |
| stake 3,000 | 2,236 | 1,761 | 474 | 1,080 | 64.9 % | 17.2 % | 87 % | 11,274 | 412 |
| stake 5,000 | 2,230 | 1,762 | 469 | 1,129 | 65.4 % | 17.2 % | 87 % | 951 | 415 |
| crates × 10 (stake 10,000) | 2,431 | 1,961 | 471 | 1,930 | 65.3 % | 17.2 % | 87 % | 1,188 | 414 |
| Bits faucet × 2 | 2,220 | 1,751 | 469 | 1,119 | 64.7 % | 17.2 % | 87 % | 0 | 923 |
| no monthly catalog drops | 2,262 | 1,793 | 469 | 1,143 | 65.4 % | 17.1 % | 87 % | 0 | 775 |

**What the sensitivity grid shows:**
- **Free regrowth rate** is the strongest lever on both burn and player pain. 0.5 px/h is the knee.
- **Regrow price** trades participation against burn. 0.5 is chosen for breadth and the social loop, and 0.75 is the upside lever.
- **Mend at 2 ×** is strictly better than at 1 × (+10 % burn, +85 % to Friend wallets, alt arbitrage closed).
- **A 5 RF Seed Pack** sits between 3 RF (more packs, same burn) and 8 RF (fewer packs, more refusals, lower participation).
- **The Gold perk** costs 2.7 % of burn for a real hold incentive.
- **The 10,000 RF stake** is the smallest tested size with zero refusals under normal load.
- **Bits stocks** stay bounded under a doubled faucet.
