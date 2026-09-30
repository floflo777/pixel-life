# Trailer plan

Target: **40 s master in 16:9 (1920 × 1080, 60 fps)** plus a **30 s 9:16 cut (1080 × 1920)** for X and the PR GIF. Most judges see the PR media before they open the link, so the rule has to land in the first 8 seconds.

Rules for every shot:

- Real captures from the public build, no mock-ups. A shot whose feature is not in the final build is cut, not faked.
- Wherever RF appears, the **SIMULATED** label must be on screen and readable.
- Sound: the game's own synthesized cues, no licensed music.
- Captions: lowercase, max 8 words, bottom third, above the SDK toolbar corners.

## Shot list (16:9 master)

| #   | Time    | Shot                                                                                                                     | Caption                                     | What it proves                                                               |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | 0–3 s   | Browser opens the preview URL; a loaned Friend rains onto the island voxel by voxel; "on loan · #id" chip visible        | a real rare friend. its own pixels.         | Character Spotlight: the NFT's canonical sprite is the body. No wallet wall. |
| 2   | 3–7 s   | Drag back, release, fling; three Nibs pop with hit-stop and a "COMBO x3"                                                 | drag. release. fling.                       | One-input core loop, game feel.                                              |
| 3   | 7–12 s  | A Clank bites from behind: slow-mo, 2 pixels fly off, lime timer rings; the Friend sweeps one back, the other crumbles   | every hit knocks a pixel off.               | The rule, shown on the Friend itself.                                        |
| 4   | 12–16 s | Old Gulp takes a wedge of the island; three tooth hits; "GULP BURPED"                                                    | (none)                                      | Depth beyond a single mechanic.                                              |
| 5   | 16–19 s | Results card: the silhouette with the missing pixel, score                                                               | missed pixels stay missing.                 | Persistence: loss is visible and yours.                                      |
| 6   | 19–24 s | Hub plaza: walk the scarred Friend among other real Friends, one emote, pass the venue doors                             | the sky: one world, many venues.            | Club Penguin-like hub; other players' Friends with their real state.         |
| 7   | 24–28 s | Regrow panel: pick 4 missing pixels, quote "2 RF · 1 burned · 1 to active Friends · SIMULATED", confirm; pixels fly back | regrow: 0.5 rf a pixel. half burned.        | Token Activity design: the burn split is shown before paying.                |
| 8   | 28–32 s | Mend a stranger's Friend: stitches appear; their inbox line "a stranger mended #id's ear and paid it 0.5 RF"             | mend a stranger. half goes to their friend. | Directed split into another Friend's ERC-6551 wallet: the social economy.    |
| 9   | 32–36 s | Seed Pack Booth: open a pack, Gold Pixel hero reveal ("1 in 50"), then the gold voxel on the Friend in the hub           | published odds. gold you can wear.          | SDK chance game, hold-or-redeem, Gold visible on the character.              |
| 10  | 36–38 s | ‹if shipped› 128 × 128 1-bit handheld mode, same run                                                                     | same game. 128 × 128. 1-bit.                | Founder's handheld thesis. Cut if not shipped.                               |
| 11  | 38–40 s | End card on paper: the rule sentence, URL, "rf simulated · contracts tested, not deployed"                               | (card text)                                 | Honest status and where to play.                                             |

Optional proof insert (only in a longer "how it works" cut, not in the master): 3 s of a terminal running `forge test` with the pass line, then `--match-contract MainnetFork`. It shows that the contracts exist and run against a fork; nothing is broadcast.

## 9:16 cut (30 s)

Keep 1, 2, 3, 5, 6, 7, 8, 9, 11; drop 4 and 10; trim each by about 1 s.

- Capture the arcade in the 360 px portrait layout, not a crop of 16:9: the island fills the width and the HUD is already laid out for phones.
- Hub shot 6: portrait capture, camera following the Friend.
- Captions sit at about 70 % height, clear of the bottom 72 px of SDK corners.
- Shot 11: URL on its own line in the Silkscreen font, at least 48 px tall.

## PR GIF (6–8 s, loops)

Shots 2 → 3 → 5 only: fling, bite, grab-back, results silhouette. Under 8 MB, 720 px wide, 30 fps. The first frame should already show the Friend mid-fling so the thumbnail reads.

## Capture checklist

- Seeded run (Daily seed or a fixed free-run seed) so shots 2–4 can be re-recorded identically.
- A test owner wallet with at least one hardwired Friend for shots 7–9; second wallet or a friend's session for the Mend recipient.
- Sound on, reduced motion off, "no flashes" off; one clean take with reduced motion on for accessibility B-roll.
- Record the hub with at least 5 other connected players (team sessions) so the plaza is not empty; do not stage bots as real players.
