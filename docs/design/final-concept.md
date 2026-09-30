# FINAL CONCEPT (locked 2026-09-30) — working title "Pixel Life"

Chosen by a 4-judge panel (5-second test, founder persona, organizer persona, tokenomics auditor) over concepts A/B/C (see concept-A/B/C/concept.md, whose ideas are merged below). Legal/gambling concerns are OUT OF SCOPE per the owner (nothing is live) — but technical economic soundness (no double-spend, no farmable drain, funded promises) is IN scope.

## Rule (one sentence)
"Every hit knocks a pixel off your Friend. Grab it back — or regrow it."

## Core (from A)
- One-input arcade: drag back, release, the Friend flings across a small floating island, smashing pixel-eating creatures (give them personality — not generic bugs; design a small cast). Runs ≈60 s. Hit-stop, shake, slow-mo, 1-bit inverted impact frame (from B).
- The Friend = its canonical on-chain 16x16 front sprite extruded to voxels, FRONT FACE always readable (never visual-hull). Pixels = health AND mass: fewer pixels = lighter = flies farther/harder to control.
- A bite knocks pixel-blocks off physically; 2 s to sweep them back; missed / fallen-off-edge pixels are LOST.
- Family traits change physics/moves (from B): e.g. Hoverer glides, Skeleton pixels crawl back, Colossus heavy, Cellular splits, etc. — one clear trait per family (9).

## Persistence without chores
- Lost pixels persist across sessions on YOUR Friend (the scars are visible everywhere), but they ALWAYS come back: slow free regrowth over time. No mandatory daily run, no decay while idle beyond what you lost playing (the 5-second test showed permanent loss scares players — frame it as "scars heal").
- RF = regrow instantly.

## RF economy (single main verb + single chance game)
- REGROW (own Friend): price per pixel TBD by the tokenomics sim (must hurt a bit: order of 0.25–1 RF/px). Split 50% burned / 50% to the protocol's active-Friends reward stream.
- MEND (someone else's Friend, from C's directed split): same price; 50% burned / 50% into THAT Friend's ERC-6551 wallet. Owner gets notified ("a stranger regrew #344030's ear and paid it 0.5 RF"). Self-mend via alt still burns half → not farmable.
- ONE chance game: "Seed Pack" via FriendSDK ChanceGame (published odds, EV ≈ 0.875–0.90, max prize reserved). Headline prize: GOLD PIXEL (hold-or-redeem). Worn = golden armour pixels visible on the Friend with a gameplay/cosmetic perk; perks are READ LIVE from held kept rewards, so redeeming removes the effect (no double-spend; nothing "eaten" that stays redeemable). Getting knocked in play can crack its GLOW (cosmetic, heals) but never forfeits the reward.
- Asset with a market (Economy Potential, their roadmap wording "pair it with RF to get a market… earn fees as your assets trade"): Gold Pixels designed to trade against RF with a creator fee + royalty; simulated market in MVP, contract spec documented.
- REMOVED: player-funded prize pool (farmable by bots), Hex (paid griefing), multiple overlapping sinks.
- No RF ever moves from loser to winner; no RF minted.

## Social / daily
- The Sky: other players' real Friends float on nearby islands in their real state (scars, gold); you can Mend them.
- Daily Run: shared seed, leaderboard (status only), streak halo.

## Access
- Guest in 3 s with a loaned real Friend (clearly labelled), no wallet wall. Wallet (FriendSDK session + ownership gate) unlocks your own Friend + persistence + real-RF-ready mode.
- Bonus: a "handheld" 1-bit 128x128 mode (founder's Sharp Memory LCD) playable in browser.

## Stack direction
FriendSDK v0.1.4 for wallet/identity/ownership gate/sprites/ChanceGame; custom host page + Cloudflare (Workers, D1, Durable Objects) backend for persistence, Sky, Mend ledger; game renderer three.js (voxel Friend) — final engine choice in the architecture phase.

## EXTENSION (owner, 2026-09-30 22:40): the Club Penguin-like hub
The owner's long-term vision: a Club Penguin-like social world with many mini-games. It EXTENDS the locked concept, it doesn't replace it:
- The Sky becomes the HUB: a shared social island world where players walk around with their (voxel) Friend, see other real Friends live, chat-lite/emotes, and enter mini-game "venues".
- "Pixel Life" (the fling arcade) is the FLAGSHIP mini-game and the source of the persistent scar/regrow meta, which follows your Friend everywhere in the hub.
- The hub is designed as a PLATFORM: each venue is a pluggable mini-game module with a common contract (enter/exit, results, RF sinks via the same Regrow/Mend/Seed Pack economy). Pitch to the founder: this is "Roblox for Rare Friends" — community FriendSDK games could become venues.
- Scope rule for the finished product: hub + Pixel Life fully polished first; then 1–2 small but polished extra venues (reuse the same Friend physics); more venues as roadmap. Never ship half-finished venues.
