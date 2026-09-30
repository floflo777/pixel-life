# Design brief — Rare Friends Vibeathon entry (replaces our previous entry "Nest")

## Goal
Win the Rare Friends Vibeathon with a game that is "hors catégorie": instantly understood, gorgeous, fun to play, a real finished product (not a POC). Build for the JUDGES, not for us.

## Who judges and what they want (evidence in ../context/*.md)
- Organizer `spokesz` (only visible maintainer) + founder **@poopie** (Doodles co-founder, ex-Head of Product CryptoKitties). He started Rare Friends to test "a virtual-pet handheld device business on top of Rare Friends by including $RAREFRIENDS in every device" (physical tamagotchi devices whose purchases burn RF).
- Site vision: "Roblox, Axie, Pump in one". Loop: Create, Play & spend, Share revenue, Grow. Games raise the Friend's "happiness"; gifts (food, toys, decorations), home upgrades, memes. Genres they name: "Minigames, Gachas, Tamas, Virtual-pet, Idles, Familiar Care, Launchpad".
- Roadmap wording (= Economy Potential): "Deploy any asset type for your experience. Pair it with $RAREFRIENDS to get a market. Introduce chance with randomness. Tap into Rare Friends distribution. Earn fees as your assets trade."
- Their own example economies: RF spent in exactly ONE place, published odds (EV 0.875–0.90), the prize is a productive asset you can hold (boosts income) or redeem ("hold-or-redeem is the economy hook"). Their fishing demo sells hats the Friend WEARS.
- Organizer plays entries; all his comments are about access ("any way I can try this singleplayer?", "No playable Friends found"). SDK issue #6: they WANT games with progress over time (pets, idle) but the SDK has no persistence.
- Categories: Character Spotlight (best use of a Generations NFT as the main character), Token Activity (most successful at burning or spending RF — simulated activity does NOT count; the design must be ready for real RF), Economy Potential (best potential for a token economy paired with RF).
- Protocol facts: every Generations/Genesis NFT has an ERC-6551 wallet; ActivationManager actions (hardwire 1 RF Gen-6 … 100k Gen-1, upgrade tiers, promote gen, activate Genesis) are 50% burned / 50% streamed to active Friends by weight. Friends are 16x16 1-bit sprites (64 on-chain frames: idle + walk, 4 facings), 9 families (Skeleton, Mask, Family, Cellular, Asymmetry, Hoverer, Colossus, Sparkling, Hollow), seed = token id. ~62,500 hardwired Friends. Genesis: 1,024 8x8 portraits.
- Brand look: 1-bit ink #111 / paper #eee / one accent #CCFF00; dither not gradients; radius 0; hard offset shadows; stepped motion; Silkscreen pixel font; pastel colour world palette (meadow #B9D984, pond #7DB4DB, sun #F2CE68, coral #ED927E, lilac #B3A0D8) with black outlines; shallow isometric floating islands. BUT: lime+black one-accent is used by ~60% of entries — be on-brand without looking like everyone.

## Competitor bar (../context/competitors/report.md — read it)
- Visual ceiling ~8.5 (Realm lighting, Nook cozy iso, Descent juice, Heist 1-bit). Judges mostly see PR GIFs; most live links are a grey "connect wallet" box.
- Done to death: own Friend as final boss; traits from pixels/seed; dark dungeon + camp; 1 RF box EV 0.9; lime one-accent.
- GAP nobody filled: a high-skill, high-juice core loop with RF as the LIVE tension; Friend as a physical body (voxels, physics, shatter/reassemble); pixels as health (hits knock pixels off, RF regrows them); real-time Friends colliding; instant gorgeous hook playable WITHOUT a wallet.

## Design principles (the "intuition" of Checks VV, Normies, FrenPet — copy the acceleration, not the idea)
1. One-sentence rule visible in a 3-second GIF.
2. The game state is readable ON the Friend itself (its pixels, size, what it wears).
3. A daily reason to return based on loss aversion (FrenPet death timer), not only gains.
4. Irreversible choices create value (Checks burn 2→1, Normies sacrifice to sculpt).
5. Social stakes: see and act on other players' Friends.
6. Every RF spend follows the protocol rule: 50% burned, 50% to active Friends.
7. Guest-first: a visitor plays within 5 seconds, no "connect wallet to see anything". Wallet/NFT unlocks your own Friend + persistence + real RF later.

## Hard constraints
- Use FriendSDK (spokesz/friendsdk v0.1.4, local copy /home/florent/Desktop/Projects/crypto/rarefriends_hackathon/tmp/vibeathon/friendsdk) for wallet, ownership gate, Friend selection, sprites and the RF chance-game economy where it fits; a custom host + our own backend (Cloudflare Workers/D1/Durable Objects) is allowed for persistence and multiplayer.
- Preserve the Friend's original artwork as the recognisable base (costumes/effects/3D extrusion on top are allowed by the SDK rules).
- Assets: CC0 only (Kenney 1-Bit pack is at ../assets/1bit/, 1000+ 16x16 tiles) or our own.
- Real Friend sprites for mocks: ./friends.json (13 real Friends: tokenId, family, 64 frames of 16 rows of '#'/'.').
