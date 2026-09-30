# PIXEL LIFE — Game Design Document (finished product)

Version 1.0 · 2026-09-30 · owner: lead game design
Source of truth order: `final-concept.md` (LOCKED, incl. EXTENSION) > this GDD > concept-A/B/C.
All RF prices are **parameters** (`P_*`) sized by the tokenomics sim; the values in this document are placeholders only where marked `[TK]`.
Units: **1 u = 1 voxel = 1 sprite pixel**. Time in seconds (s) or milliseconds (ms). The sim runs at a fixed **60 Hz** step.

---

## 0. Summary

> **"Every hit knocks a pixel off your Friend. Grab it back — or regrow it."**

You play a real Rare Friend, built from its on-chain 16x16 sprite as voxels. Drag back and release to fling it across a floating island and smash the **Munchies**, small creatures that eat loose light. Every bite knocks real pixels off the body. You have 2 s to sweep them back. Pixels you miss are scars that stay on your Friend everywhere: in the Hub, in the Sky, on its page and on the share card. Scars heal for free over time, RF regrows them instantly, and strangers can Mend them. A run lasts 60 s. The flagship arcade sits inside **the Sky**, a Club Penguin-like hub where your Friend walks around among other real Friends, still showing its scars. Play venues → earn Crumbs, stamps and belts → decorate your Friend's home island → show off in the Hub (§12).

---

## 1. Pillars, rule, session shape

### 1.1 Pillars (every feature must serve at least one; cut it otherwise)
1. **The Friend is the body.** Its own on-chain pixels are its health bar, its mass, its weapon and its trophy shelf (gold, halo, stitches). You never read a UI bar to know how it is doing.
2. **Every hit is a moment.** Readable in a 3 s GIF. Each contact gets hit-stop, shake, slow-mo or an impact frame, tuned in ms. One input.
3. **Scars heal, care is social.** Loss is visible and persistent but never permanent or punishing. RF is a shortcut and a gift, never a toll. No chores, no idle decay.

### 1.2 One-sentence rule
"Every hit knocks a pixel off your Friend. Grab it back — or regrow it." (It appears on the landing, the loading screen, the share card and the README.)

### 1.3 Target session shape

| Moment | What the player experiences | Design target (measurable) |
|---|---|---|
| **First 5 s** | URL opens on the island. A loaner Friend rains down voxel by voxel (1.2 s). A pulsing ghost hand drags back ("drag to fling"). First fling, first Nib pops with hit-stop and "+10". | First input ≤ 3.0 s after first paint. First pop ≤ 5.0 s (the first Nib spawns 4 u in front of the Friend, telegraphed). No modal, no wallet, no text wall. |
| **First 60 s** | One full run. At about 12 s the first bite comes from behind: slow-mo and "GRAB THEM BACK". The player sweeps pixels back, learning the rule by doing it. At 40 s Old Gulp rises and eats a wedge of the island. At 60 s the results card shows the silhouette with holes and a 3 s GIF of the best moment. | 80 % of guests lose ≥ 1 px and grab back ≥ 1 px in run 1 (tutorial spawns guarantee a bite at 11–13 s). The Play Again button is 1.5x the size of Connect. |
| **Session 2** (same day or next day) | Your Friend (loaner or own) greets you in the Sky Hub with partially healed scars ("5 of 8 px healed while you were away"). The Daily Run stone glows. You meet one new creature (Snatch or Slurp gate on player level 2). Your first cosmetic unlock is a trail. | Session 2 start → first fling ≤ 2 taps. Show exactly one new thing per session for the first 5 sessions (drip table §9.6). |
| **Day 7** | Streak halo is coral (tier 3). The Bestiary is about 70 % filled. At least one stranger has Mended you, or you have Mended someone. You unlocked the Pond island. You know your family trait by heart and play for Daily percentile. Maybe you opened a first Seed Pack or wear a Gold Pixel. | D7 retention target 15 % (owners), 6 % (guests). A median of 3 runs/day. Daily Run participation ≥ 60 % of DAU. |

---

## 2. Core mechanics

### 2.1 The Friend body (voxel build)
- **Source frame:** gameplay body = on-chain **frame 0** (front idle). Colossus has blank front/back frames and uses **frame 16** (side idle), mirrored so that it faces screen-left. (The frame layout in `friends.json`, inferred from pixel counts: 0–7 front idle, 8–15 back, 16–23 / 24–31 sides, 32–63 walk in the same order. Engineering must verify it against the SDK sprite reader.)
- **Pixel IDs:** `pid = row*16 + col` on the source frame. Scars, gold slots and stitches are all stored as sets of `pid`. **Canonical pixel count `N0`** = number of `#` in the source frame (real values: Hoverer #65042 = 42, Hollow #64940 = 44, Asymmetry #64978 = 52, #1969 = 56, Cellular #344034 = 70, Family #65058 = 76, Mask #344030 = 82, Sparkling #65040 = 83, Skeleton #63675 = 92, Colossus #64998 = 96).
- **Extrusion:** each pixel = one voxel of 1 × 1 × 1.5 u (depth 1.5 gives a chunky look). The front face is ink `#111`. The 1-px paper halo (`#eee`) is rendered as an outline shell, not as voxels. The front face **always faces the camera**: body yaw is locked, and tumbling is roll-only, clamped ±25°.
- **Collider:** a circle on the ground plane, `r = clamp(0.45 * bboxW_current, 3.0, 7.0)` u. It is recomputed whenever the pixel count changes.
- **Mass:** `m = current pixel count` (gold pixels count as 1). The reference mass is `M_REF = 70`.
- **Idle life:** a per-row bob (sine, amplitude 0.15 u, 1.6 Hz, 0.08 s phase offset per row) plus a blink (eye holes flash paper for 120 ms every 3–6 s). No frame swapping in-run, so scars stay pixel-exact.

### 2.2 Controls

**States:** `READY` (speed < 30 u/s and cooldown elapsed: can aim), `FLYING` (speed ≥ 14 u/s: you are a weapon), `PREY` (speed < 14 u/s: creatures can bite you). READY and PREY overlap below 14 u/s, so aiming while slow makes you vulnerable. That is the core tension.

| Input | Aim | Power | Release |
|---|---|---|---|
| **Mouse / touch** (default) | Press anywhere (not only on the Friend). The drag vector from the press point sets the fling direction, opposite to the drag. | `p = clamp((dragLen − 12 px) / 168 px, 0, 1)` in CSS px. The 12 px deadzone cancels. | Release. A release under the deadzone cancels, with no cooldown. |
| **Keyboard** | ←/→ or A/D rotate the aim at 200°/s (Shift = 60°/s fine aim). ↑/W snaps to the nearest creature within 20°. | Hold Space/J: power fills 0→1 in 0.8 s in 8 visible steps, then holds at 1. | Release Space. Esc cancels the aim. |
| **Gamepad** | Left stick direction (deadzone 0.2) | Stick magnitude 0.2→1 maps to p 0→1 | Press A (or release the right trigger) |
| **One-switch** (accessibility) | The aim arrow auto-rotates at 90°/s. First press locks the direction. | Power oscillates 0→1→0 over a 1.2 s cycle. Second press fires. | — |
| **Tap-to-target** (accessibility) | Tap a point on the island: fling toward it with the power needed to stop there (distance-solved). | auto | on tap |

- **Trajectory preview:** 8 dots covering the first 0.5 s of path, including the first bounce and the Asymmetry curve. Dots are ink with a paper outline. At p = 1 the last dot pulses lime.
- **Aim slow-mo:** while aiming during `FLYING` (i.e. re-aiming mid-slide), time scale = 0.5 for up to 1.0 s of real time per aim. After that it returns to 1.0, but aiming continues.
- **Launch cooldown:** 250 ms after each release.
- **Pause:** Esc/P, the SDK `paused` prop, tab blur, or the gamepad Start button. Resume has a 3-2-1 step countdown (0.9 s total).
- **Left-hand / mirror HUD** and a **hold-vs-toggle** option for keyboard power.

### 2.3 Physics constants (initial values; all live-tunable in `tuning.json`)

| Constant | Value | Notes |
|---|---|---|
| `V_MAX` | 70 u/s | launch speed at p = 1, m = 70 |
| Launch speed | `v0 = V_MAX * p^1.15 * clamp(sqrt(M_REF/m), 0.80, 1.35)` | Lighter bodies are faster: Colossus 96 → ×0.85 (60 u/s), Hoverer 42 → ×1.29 (90 u/s) |
| Min launch | `p < 0.08` → cancel | |
| Ground damping | `dv/dt = −(10 + 1.8 v)` u/s² | A full fling at 70 u/s travels ≈ 34 u and stops in ≈ 1.6 s |
| Hop visual | parabola apex 3 u for the first 0.25 s of any fling p ≥ 0.4 | visual only; the sim stays on a 2D plane |
| Kill momentum cost | speed ×0.90 per creature popped | Hollow is exempt (trait) |
| Rock/rim bumper restitution | 0.55 | 6–10 bumper rocks per island |
| Shellback front bounce | restitution 0.8, Friend loses 1 px | |
| Creature knockback on Friend | impulse `J / m` (J per creature table) | light Friends get shoved farther |
| Smash threshold | creature dies if `m * v ≥ HP_momentum` | see creature table |
| Island | ellipse 72 × 48 u (Meadow), bumper rocks on 30 % of the rim | islands vary §9.3 |
| Ring-out | Friend centre leaves the island polygon by > 1 u | §2.5 |
| Squash/stretch | stretch along v: `1 + min(v/60, 0.35)`, volume-preserving. Impact squash 0.75 for 80 ms, then 1.10 for 60 ms | stepped: 3 keyframes, no easing (brand motion rule) |

### 2.4 Camera
- Perspective, **FOV 28°**, pitch **38° down**, fixed yaw (the island's long axis is horizontal on screen).
- Framing: the island fills 92 % of the viewport width in portrait and 70 % of the height in landscape. Safe area: HUD margins 12 px, **bottom 72 px corners left clear** for the SDK toolbar (bottom-left) and menu (bottom-right).
- Follow: `target = lerp(islandCentre, friendPos + v*0.12s, 0.35)`, smoothed at 6/s. The camera never lets the island rim leave the frame.
- Punch: FOV −6 % for 150 ms on combo ≥ 5 and on Old Gulp tooth hits.
- Old Gulp event: the camera dollies out 12 % over 0.6 s so the whale fits in frame, then returns.
- Reduced motion: follow weight 0.15, no punch, no dolly (the static framing already fits Gulp).

### 2.5 Pixel damage model

**Which pixels detach.** A bite has a contact direction `a` (unit vector on the ground plane, from creature to Friend centre). It is mapped to sprite space: attacks from the left/right hit the left/right columns, from the far side (behind) the top rows (head/ears), and from the near side the bottom rows (feet).
1. Candidates = **boundary pixels** (≥ 1 empty 4-neighbour, holes count as empty) that are not gold.
2. Score = `dot(normalize(pixelPos − centroid), −a) + 0.15 * exposure` (exposure = empty-neighbour count / 4).
3. Take the top `k` (k = the bite size). Ties are broken by the run's seeded PRNG, so every bite is deterministic and replayable.
4. **Gold rule:** if the best candidate would be a gold pixel, the bite **glances off**. The gold pixel stays, gains one glow crack, and the next best ink pixel is taken instead. Gold is never protection, and never lost.
5. There is no connectivity cascade: floating bits stay attached (the Hoverer's orb, detached ears). Cellular is the only exception (its trait).

**Loose pixels.** A detached pixel becomes a cube with an impulse of 8–14 u/s away from the attacker (random within the cone ±35°), restitution 0.45, and it rests after ≈ 0.6 s.
- **Grab-back window: 2.0 s** (`GRAB_WINDOW`), shown as a lime ring shrinking around the cube. The last 0.5 s blinks at 8 Hz.
- **Grab:** the Friend's collider comes within the magnet radius, **3.0 u while in PREY, 4.5 u while in FLYING**. The pixel then flies back to its slot in 180 ms and scores "+1 px". It is a **Clutch grab** if ≤ 0.3 s were left.
- **The pixel is LOST if:** the window expires (it crumbles to dust), it falls off the island edge, it is eaten by Slurp or carried off the edge by Snatch, or it falls into Old Gulp's mouth.
- Lost pixels in-run are the run's **scars** (persisted at run end, §5.1).

**Loss conditions and safety rails**
| Rule | Value |
|---|---|
| Run end | 60.0 s elapsed ("TIME") or **Crumbled**: current pixels ≤ 50 % of `N0` ("needs a nap"). The score is kept, and a Crumble never adds scars beyond the floor. |
| Persisted floor | A Friend's stored state never goes below `ceil(0.5 * N0)` pixels. |
| Per-run scar cap | `RUN_SCAR_CAP = max(6, round(0.15 * N0))` (Mask 82 → 12). After the cap, bites still knock pixels off for gameplay, but those pixels are drawn with a dotted "safety stitch" and return at run end. |
| Starting a run at the floor | allowed. Its scars don't persist ("resting run", shown by a small bandage icon). |
| Newbie stitches | the first 3 runs with a newly connected own Friend don't persist scars (they teach the stakes with a "practice" label). |
| Guests | loaner scars persist only in local storage, per loaner, and reset at 00:00 UTC. |

**Mass matters.** Fewer pixels means a lighter body, which gives faster flings, longer slides, more ring-outs, and a weaker smash against Clank and Gulp's teeth. The design intent is a trade-off, not a nerf: chipped Friends are better combo sliders and worse tanks. Balance target: bot-sim median score at 70 % body within ±5 % of 100 % body (§9.7).

### 2.6 Ring-out
Leaving the island: 0.35 s fall animation (the Friend tumbles into the cloud sea, stepped rotation), then **3 edge pixels are lost** immediately. They are chosen by the rule above with `a` = the fall direction, and they count toward the cap. The Friend respawns at the island centre after 1.0 s with 1.5 s of invulnerability (blinking at 6 Hz). Loose pixels keep their timers during the fall. Hoverer exception: see its trait.

### 2.7 Juice timings (all in real time; the sim pauses during hit-stop)

| Event | Hit-stop | Slow-mo | Shake trauma | Impact frame | Other |
|---|---|---|---|---|---|
| Pop (single) | 50 ms | — | +0.15 | — | 6 voxel shards, "+10" stepped pop-up |
| Pop in combo ≥ 3 | 80 ms | — | +0.20 | — | combo text scales ×1.2 per step (max ×2) |
| Clank / tooth hit | 120 ms | — | +0.35 | 2 frames if a kill | FOV punch |
| **Bite (pixel loss)** | 90 ms | **0.3× for 400 ms**, then back in 2 steps (0.6×, 1.0×) over 160 ms | +0.30 per px (max +0.6) | 2 frames if ≥ 3 px lost at once | "GRAB THEM BACK" only on the first 2 bites of a player's life |
| Ring-out | 0 | 0.5× for 300 ms | +0.80 | 2 frames | "RING OUT −3" |
| Gold glance | 60 ms | — | +0.2 | — | metallic "tink", 3 gold sparks |
| Clutch grab | 40 ms | — | — | — | chime, "CLUTCH +25" |
| Old Gulp bite | 200 ms | 0.4× for 600 ms | +1.0 | 3 frames | rumble SFX, screen-edge dither |
| Run end | — | 0.5× for 500 ms | — | — | stepped iris to results |

- **Shake:** offset = `trauma² × 0.8 u`, roll = `trauma² × 1.5°`, trauma decays at 1.6/s, noise at 24 Hz (stepped).
- **Impact frame:** the whole frame is rendered in 1-bit (ink/paper, inverted on the second frame), at 16.7 ms per frame. **Max 1 impact sequence per 600 ms** (photosensitivity: < 3 flashes/s).
- **Reduced motion:** no shake, no FOV punch, slow-mo capped at 0.6×, impact frames replaced by a 1-frame 2 px ink border. Hit-stop is kept (it isn't motion).
- **No flashes** setting (separate from reduced motion): disables impact frames only.

### 2.8 Run structure (60 s)

| Phase | Time | Content |
|---|---|---|
| Drop-in | 0.0–2.5 s | The Friend rains in (1.2 s). A "3-2-1" appears as stepped blocks. No spawns. |
| Wave 1 "Snack time" | 2.5–20 s | Nib only (run 1 of a lifetime: scripted, §9.6), then Nib + Pogo. |
| Wave 2 "Rush" | 20–40 s | + Clank, Fizz, Snatch (Slurp from level 2) |
| **Frenzy + Old Gulp** | 40–55 s | Spawn budget ×2. Old Gulp event (§3.7). |
| Last Light | 55–60 s | No spawns. All creatures flee to the rim and pops count ×1.5. The loose-pixel timers still run: the final scramble. |
| Results | 60 s+ | §6.3 |

### 2.9 Scoring

| Source | Points |
|---|---|
| Pop | creature value (§3 table) × combo multiplier × chain multiplier |
| Grab-back | +5 per pixel. Clutch (≤ 0.3 s left) +25 |
| Snatch drop (hit a carrier) | +25 + the grab of the dropped pixel |
| Gulp tooth | +100 each. All 3 = "GULP BURPED" +500 |
| Survival | at run end: `+ round(300 × keptRatio)` where keptRatio = pixels at end / pixels at start (safety-stitched pixels count as kept) |
| Flawless | +500 if 0 px were lost this run (grab-backs are allowed) |
| Ring-out | −50 |

- **Combo (per fling):** kills during one fling (from release until speed < 14 u/s) → multiplier = number of kills (×1, ×2, ×3 … cap ×8). Shown on the Friend as "COMBO x3".
- **Chain (across flings):** each consecutive fling with ≥ 1 kill adds +0.1 to the chain multiplier (cap ×2.0). A bite taken or a whiff (a fling with no kill) resets it to ×1.0. The HUD chain pip bar has 10 pips.
- **Score is deterministic** from seed + input log (server replay, §5.8).

---

## 3. The creature cast — "the Munchies"

**Lore (one line, landing footnote and bestiary):** *Munchies live in the cloud sea and eat loose light. Friends are made of it.*
- **Art rules:** voxel creatures built from **our own 1-bit sprites** (6–12 px tall) with ink bodies and **one pastel accent each**, so they read on colour and on silhouette. Each has a unique silhouette category (round, legs, dome, wings, wide, spiky) so they stay readable at 24 px on a phone and in 1-bit handheld mode.
- **Telegraphs:** every damaging action has a visual *and* an audio telegraph, and a caption icon when captions are on.

### 3.1 Summary table

| # | Name | Role | Size (u) | Accent | HP_momentum (m·v) | Speed (u/s) | Bite | Telegraph | Points | Budget cost | First seen |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Nib** | swarm biter | 5×4 | meadow `#B9D984` belly | 1 (any touch in FLYING) | 9 | 1 px | 0.45 s bow | 10 | 1.0 | run 1, 2.5 s |
| 2 | **Pogo** | hopper | 5×6 | sun `#F2CE68` legs | 1 | hop 16 (arc 0.6 s) | 1 px | 0.30 s crouch | 15 (×2 mid-air) | 1.5 | 20 s / run 1 |
| 3 | **Clank** | armoured beetle | 8×6 | pond `#7DB4DB` shell plate | back/side 1; **front: 2400** | 5 | 2 px | 0.60 s jaw open | 40 | 3.0 | 20 s / run 2 |
| 4 | **Snatch** | thief bird | 7×5 wings | coral `#ED927E` beak | 1 | 14 flying | 0 (steals loose px) | swoop line 0.4 s | 25 | 2.0 | 25 s / run 2 |
| 5 | **Slurp** | lazy toad | 10×6 | lilac `#B3A0D8` tongue | 2 hits (≥ 1 each) | 0 (sits) | 0 direct; tongue yank + eats loose px | 0.70 s cheek puff | 30 | 3.0 | level 2 |
| 6 | **Fizz** | kamikaze mite | 4×4 + fuse | sun spark | 1 | 12 | 3 px area (r 5 u) | 1.5 s fuse, ticking, blink 4→12 Hz | 20 (+chain) | 2.0 | 30 s / run 3 |
| 7 | **Old Gulp** | the run event | 48×20 whale | cloud `#eee` body, ink outline | teeth: 1800 each | — | eats an island wedge | 2.0 s shadow + rumble | 100 / tooth, 500 burp | event | 40 s every run |

### 3.2 Nib (the polite nibbler)
- **Visual:** a round grub, 2 teeth, meadow belly, beady paper eyes. Sprite (5×4, `#` ink, `m` meadow):
```
.###.
#.#.#
#####
m.m.m
```
- **Personality:** polite. It **bows** before every bite (0.45 s head-dip, "pardon!" squeak), then says "nom". It is the tutorial creature, and its fairness teaches the telegraph language.
- **Behaviour:** crawls to the Friend's nearest side (steering, avoids other Nibs by 2 u). If the Friend is PREY and within 2 u at the end of the bow, it bites 1 px, hops back 3 u and waits 1.2 s. It dies to any contact while the Friend is FLYING.

### 3.3 Pogo (the giggling flea)
- **Visual:** a small body on two tall bent sun-yellow legs, antenna. Silhouette is "legs".
- **Personality:** giggles, can't sit still.
- **Behaviour:** hops in 0.6 s arcs (3–4 hops toward the Friend), then a **pounce** hop that bites 1 px on landing if the Friend is PREY within 2.5 u. Hit it mid-air = ×2 points ("AIR POP"). Crouch telegraph 0.3 s before each hop.

### 3.4 Clank (the grumpy beetle)
- **Visual:** a dome with a flat **pond-blue front plate** (clearly a shield), 6 stubby legs. Silhouette is "dome".
- **Personality:** grumpy, slow, turns to face you (turn rate 90°/s).
- **Behaviour:** always rotates to face the Friend. Hitting the plate (angle < 60° from its facing) bounces you back (restitution 0.8) and **costs you 1 px** unless `m·v ≥ 2400` (e.g. m = 80 at 30 u/s), which smashes it head-on as "SHELL CRACK" (+40 bonus). Hitting it from the sides or back pops it. Bite: 2 px, after a 0.6 s jaw-open telegraph, range 2.5 u. It is the check on light Friends, which must flank.

### 3.5 Snatch (the magpie thief)
- **Visual:** ink bird, coral beak, wings flapping in 2 frames. Silhouette is "wings". It flies at hover height 4 u (visible shadow).
- **Personality:** a collector. It cackles and loves shiny things.
- **Behaviour:** ignores the Friend. It targets the **loose pixel** with the most time left (a gold spark effect: if a glanced gold spark exists it goes for that first, cosmetic only), swoops (0.4 s swoop line telegraph), grabs it (the pixel's timer **freezes**) and flies to the nearest rim at 14 u/s. If it reaches the rim, the pixel is lost. Hitting it drops the pixel with a **fresh 1.0 s timer** (+25). If there are no loose pixels it circles, and after 8 s it leaves.

### 3.6 Slurp (the lazy toad)
- **Visual:** a wide flat toad, half-lidded eyes, lilac tongue. Silhouette is "wide". It is the largest regular creature.
- **Personality:** sleeps ("zzz" pixels) until a pixel falls within 14 u, then wakes up.
- **Behaviour:** sits at a rim spot. Once awake, every 3 s it either **eats a loose pixel** within 10 u (tongue 0.25 s, pixel lost: the reason to prioritise grab-backs near it) or, if none exists, **tongue-yanks the Friend** (0.7 s cheek puff telegraph, range 10 u, pulls it 6 u toward itself; you can dodge by flinging during the puff). Takes 2 hits to pop. Hit 1 makes it sulk and shrink (knocked back 4 u, 1.5 s stun). It never bites directly.

### 3.7 Fizz (the over-excited mite)
- **Visual:** a round spiky ball with a sparking fuse. Silhouette is "spiky".
- **Personality:** hyper, fizzing noises that rise in pitch.
- **Behaviour:** rushes toward the Friend. Within 6 u it lights its fuse (1.5 s, blink 4→12 Hz, tick SFX accelerating) and explodes: every pixel-bearing thing within 5 u takes a 3 px bite (Friend: direction = from the Fizz, split into 3 separate single-px bites for fair distribution). It also kills other creatures in range (they count for your combo if you triggered it). **Hitting a Fizz while FLYING launches it** as a projectile along your velocity at 1.2× speed. It explodes on its first contact, which is the best combo tool in the game ("FIZZ BANK").

### 3.8 Old Gulp (the one boss-like event per run)
- **Visual:** a huge cloud whale made of paper voxels with an ink outline, rising from the cloud sea at the rim. Three big square teeth with ink outlines. Its eye is one 3×3 ink block that blinks slowly. It is **not** a Friend and not dark-dungeon. It is the island's weather: a friendly glutton.
- **Beats (default mood "Hungry"):**
| t | Beat |
|---|---|
| 40.0 | Rumble (sub-bass). A **shadow wedge** (90° sector of the island, 25 % of the area, placed on the side where the Friend currently is ± a seeded offset) dithers darker over 2.0 s. Creatures on it flee. |
| 42.0 | Gulp rises and **bites the wedge**: those island voxels fall. Anything on it falls: the Friend → ring-out, loose pixels → lost, creatures → gone (no points). The island is now smaller. |
| 42.5–52.0 | Gulp rests its chin on the new rim, mouth open, its tongue across the island as a lilac slope. The 3 teeth **light up one at a time** (sun glow, 3.0 s each, seeded order). A fling into a lit tooth with `m·v ≥ 1800` is a hit (+100, 120 ms hit-stop, the tooth pops out as 6 "star crumbs" worth +20 each). An unlit tooth bounces you. |
| 3 teeth hit | **"GULP BURPED"** +500. Gulp burps (paper voxel rings) and sinks. The wedge regrows at 55 s as stepped voxel columns. |
| 52.0 (not burped) | **Inhale** for 2.0 s: suction toward the mouth at 22 u/s² on the Friend, loose pixels and creatures. Anything reaching the mouth is lost or eaten (Friend → ring-out). Then it sinks, and the wedge regrows at 55 s. |
- **Moods (seeded per run, one per Daily seed):** *Hungry* (above), *Sleepy* (wedge 15 %, teeth lit 4 s each, no inhale unless 0 teeth hit), *Grumpy* (wedge 25 %, inhale 3 s, teeth lit 2.2 s). Guests' first 2 runs are always Sleepy.

### 3.9 Spawning
- **Spawn points:** 12 rim slots per island. A slot is valid if it is ≥ 12 u from the Friend and not inside Gulp's wedge. Each spawn is preceded by a 0.6 s ground ripple (dither ring) plus a soft pop.
- **Budget:** each 0.25 s tick adds `B(t) * 0.25` to the spawn bank. When the bank ≥ the cheapest allowed creature, spawn a weighted pick, subject to max-alive caps.

| Window | B(t) budget/s | Max alive | Weights (Nib/Pogo/Clank/Snatch/Slurp/Fizz) |
|---|---|---|---|
| 2.5–20 s | 0.8 → 1.4 (linear) | 6 | 70/30/0/0/0/0 |
| 20–40 s | 1.6 → 2.4 | 10 | 35/20/15/12/8/10 |
| 40–55 s | 3.0 (+ Gulp) | 14 | 30/20/15/10/5/20 |
| 55–60 s | 0 | — | flee |

Snatch only spawns if ≥ 1 loose pixel exists. Slurp max 1 alive, Clank max 3.

---

## 4. Family traits (one physics/gameplay trait each)

A trait is shown the first time it triggers, with a one-line toast ("SKELETON · your bones crawl home"). The trait comes from the canonical family and is never purchasable.

| Family (share) | Trait | Exact rule | Counter-weight | Feel |
|---|---|---|---|---|
| **Skeleton** (18 %) | **Reassemble** | Loose pixels crawl back toward the body at 4 u/s during their window. `GRAB_WINDOW` = 3.0 s. | heavy (≈ 92 px) → slow launch; big target for Clank | the undying tank |
| **Mask** (18 %) | **Parry** | Releasing a fling (p ≥ 0.3) within **200 ms before** a bite lands reflects it: no pixel loss, the attacker is stunned 1.5 s, "PARRY +50". It works vs Nib, Pogo and Clank bites, not Fizz. | purely skill; no passive bonus | the duelist |
| **Family** (18 %) | **Huddle** | Grab magnet radius ×2 (6.0 u PREY / 9.0 u FLYING). Loose pixels within 9 u drift toward you at 2 u/s. | no offensive bonus | the gatherer |
| **Cellular** (18 %) | **Mitosis** | A fling with p ≥ 0.85 splits the body into 2 halves (left/right columns of the sprite), launched ±10° apart, each with half the mass (smash power halved, but 2 hitboxes). They re-merge 0.8 s after both stop (halves pull together at 30 u/s). Bites while split apply to the bitten half. | halves are weak vs Clank/teeth; the re-merge window is a vulnerable moment | the double shot |
| **Asymmetry** (18 %) | **Hook** | Flings curve 25° over the first 60 % of their path toward the sprite's heavy side (the side with more pixels lacking a mirror twin; tie → odd tokenId = right). The preview shows the curve. | straight shots need compensation | the trick-shot artist |
| **Hoverer** (2.5 %) | **Glide** | Ground damping ×0.6 (longer slides). On leaving the island it **hovers for 1.0 s** instead of falling; aiming during the hover pushes it back at 20 u/s². Failing it = normal ring-out. | lightest (≈ 42 px) → shoved far by knockback, reaches Crumble faster | the escape artist |
| **Colossus** (2.5 %) | **Quake** | After a fling with p ≥ 0.7, when speed drops below 14 u/s it **stomps**: a radius 7 u shockwave pops Nib/Pogo/Fizz and stuns the others for 1.0 s (no stun on Gulp). | heaviest (≈ 96 px) → launch ×0.85, short slides | the wall |
| **Sparkling** (2.5 %) | **Spark Trail** | Flings leave a 1.5 s spark trail (width 2 u). Creatures crossing it take 1 hit. Loose pixels touched by the trail get +1.0 s of timer (once per pixel). | no defence; trails fade quickly | the chaos painter |
| **Hollow** (2.5 %) | **Pierce** | Kills don't slow you (no ×0.90 momentum cost), and a Hollow passes *through* popped creatures, so combos chain further. | light (≈ 44 px) → weak vs Clank fronts and teeth; big ring-out risk | the glass cannon |

**Balance targets (bot sim, 10k runs/family, §9.7):** median score within ±8 % across families, median persisted scars within ±15 % of the mean, and Daily Run top-1 % share per family within 0.5×–2× of its population share.

### 4.1 Generation (1–6), tier, Genesis
- **Generation is cosmetic only** (it matches the protocol line "Promote: gives your Friend more land"): the Friend's **home island in the Sky** gets more terraces. Gen-6 has 1 terrace and each generation up adds one (Gen-1 = 6 terraces, plus a waterfall). It shows as a small "G3" plate on the Friend page.
- **Tier is cosmetic only** (protocol: "Upgrade changes the reward tier, not the character's appearance"). The home-island **flag** colour steps by tier. Nothing in-run.
- **Rare families** (Hoverer/Colossus/Sparkling/Hollow, 2.5 % each) get a "rare family" badge on the Friend page. The balance targets above make sure this isn't power.
- **Genesis (8×8 portraits):** playable in phase 2. Each pixel becomes a 2×2 voxel block (64 slots → mass counted as 4 per pixel), trait "Heirloom" = cosmetic crown. Open question for art (§10.2).

---

## 5. Meta

### 5.1 Scar persistence
- **Server state per Friend:** `scarSet` (list of pids, ordered by loss time), `goldSlots`, `stitches` (pid → menderId + colour), `glowCracks`, `streak`, `lastRunAt`, `healAnchorAt`.
- **Scars show everywhere:** the in-run body, the Hub avatar, the Sky island, the Friend page, share cards and handheld mode. Missing pixels render as **empty slots with a coral dotted outline** (1 px dashes), never as black. The on-chain art is never modified. "Whole" = exactly the canonical sprite.
- **Scars only come from verified runs** (server replay, §5.8). Unverified or offline runs apply no scars and no ranking. The player is told so plainly.

### 5.2 Free regrowth (scars heal)
| Param | Value `[TK tunes]` |
|---|---|
| `FREE_REGROW_INTERVAL` | 1 px every **30 min** (48 px/day), computed lazily from `healAnchorAt` |
| Order | oldest scar first (FIFO) |
| `NAP_PX` | +3 px instantly when you finish the day's Daily Run (ranked attempt) |
| Idle decay | **none** (locked concept) |
| Display | "next pixel in 12:04 · whole in 3 h 10 m" |
- Expected loss: median 5 px per run (§9.7) → a 3-runs/day player heals fully in about 7.5 h for free. Paying is for impatience, pride, greed (Daily attempt now) and gifting.

### 5.3 Regrow (own Friend) and Mend (someone else's)
| Action | Price | Split | Effect |
|---|---|---|---|
| **Regrow n px** | `n × P_REGROW_PX` `[TK, 0.25–1 RF]` | 50 % burned / 50 % → protocol active-Friends reward stream | the selected scars fill instantly |
| **Regrow all** | `missing × P_REGROW_PX` (bulk discount only if TK wants one: `REGROW_ALL_DISCOUNT = 0`) | same | whole |
| **Mend n px** (another Friend) | `n × P_MEND_PX` (= `P_REGROW_PX` by default) | 50 % burned / 50 % → **that Friend's ERC-6551 wallet** | fills its oldest scars. The pixels carry **your stitch colour** until next knocked off |

**Regrow UX (the Greenhouse or the Friend page):**
```
┌─ regrow #344030 ───────────────────────────┐
│   ................      missing  7 px      │
│   .....#....░.....      free: next 12:04   │
│   .....##..##.....      whole in 3h10m     │
│   .....######.....                         │
│   ....##.##.##....      [ tap slots ]      │
│   ....###..░##....      selected 3         │
│   .....######.....                         │
│   .......##.......      3 × P_REGROW_PX    │
│   ...░#########...      = 1.50 RF  [SIM]   │
│   ...####..####...      50% burned         │
│   ....########....      50% active friends │
│   ...######░###...                         │
│   .....░#..##.....   [ regrow 3 ]  [ all ] │
└────────────────────────────────────────────┘
 ░ = scar slot (coral dotted); tap toggles
```
- The confirm button shows the RF amount, the split, and `SIM` whenever `client.mode = "preview"`.
- Animation: the voxels grow in at 60 ms per px (stepped scale 0 → 0.5 → 1) with an ascending pluck per pixel.
- **Minimum spend** 1 px. Maximum = the missing count. A spend is never allowed on a whole Friend.

**Mend flow:** Sky or Hub → tap a scarred Friend → mini card → [mend 1] [mend 3] [mend all] → confirm with price and split ("50 % burned · 50 % to #344030's wallet") → stitched voxels fly from your Friend to theirs (1.0 s) → the owner is notified.
- Anti-spam: at most 20 Mend notifications per recipient per day are delivered individually; the rest are batched ("+12 more menders today").
- **Self-mend via an alt** is allowed and still burns 50 %, so it isn't farmable (locked concept).

### 5.4 Seed Pack + Gold Pixel
- **Seed Pack** = the **single** chance game (FriendSDK ChanceGame: `buy → play → settle → redeem`). Price `P_SEED_PACK` `[TK]`. Odds are published in-game (a bar chart plus a table), `EV_TARGET` 0.875–0.90, max prize reserved per the SDK. The result is locked at `play`, and the reveal (SDK `RewardReveal`: anticipation → emergence → reveal) is presentation only. Skip is supported.
- **Outcome structure** (weights and values `[TK]`), with every outcome a **hold-or-redeem kept reward** (a single SDK primitive):
| Outcome | Hold (use) | Redeem |
|---|---|---|
| **Sprout** | "plant it": regrow `SPROUT_PX` px | `R_SPROUT` RF |
| **Bloom** | regrow `BLOOM_PX` px | `R_BLOOM` RF |
| **Full Bloom** | restore whole | `R_FULL` RF |
| **Gold Pixel** | wear it (below) | `R_GOLD` RF |
- **Planting = redeem + Regrow in one confirm** (proposal, see §10.1 Q1): the Sprout's RF is redeemed and immediately spent on Regrow through the normal 50/50 split. The kept reward is gone, so it can't be double-spent, and no new primitive is needed.
- **Gold Pixel (worn armour):**
  - Wear: choose any present canonical pixel on the body (not a scar). That voxel becomes **gold** (metallic `#E8B530`, 2-step specular, 1-px glow). `GOLD_WEAR_MAX = 3`.
  - **The perk is read live** from held kept rewards (`client.read()` at session start, at run start and on every Hub load). `worn = min(heldGold, GOLD_WEAR_MAX)`. Redeeming or selling a Gold Pixel turns its voxel back to ink on the next read. Nothing is ever "eaten".
  - **Perk:** free regrowth +20 % speed per worn gold (cap +60 %) `[TK: check sink impact]`, a gold rim on the Sky island, and a shimmer on the share card. **No in-run power**: bites glance off gold onto the next ink pixel (§2.5).
  - **Glow crack:** each glance adds 1 crack (3 stages: 1 hairline, 2 split, 3 dull). The stage is cosmetic only and heals 1 stage per `GLOW_HEAL = 60 min`. **It never forfeits the reward.**
  - **Market** (simulated in MVP): Gold Pixels trade against RF as fixed-price listings. Fees `MKT_CREATOR_FEE` and `MKT_ROYALTY` `[TK]`. The floor is visible (= `R_GOLD`, since anyone can redeem). The contract spec is documented, and trading is labelled SIM.

### 5.5 Daily Run
- Seed = `hash(UTC date)`. Island, Gulp mood and spawn sequence are the same for everyone.
- **1 ranked attempt per Friend per UTC day** (owners). Unlimited unranked practice of the same seed (no scars, marked "practice"). Guests have a separate "guest board" (unverified, top 100 only).
- Rewards are **status only**: board rank and percentile, `NAP_PX` regrow, streak +1, weekly badges (top 1 % = gold banner, top 10 % = silver) on the Sky island for 7 days. **No RF prizes.**
- Scars from the ranked Daily attempt persist (the same rules and cap).

### 5.6 Streak halo
The canonical 1-px paper halo is tinted by consecutive Daily Run days:
| Days | 0–2 | 3–6 | 7–13 | 14–29 | 30+ |
|---|---|---|---|---|---|
| Halo | paper `#eee` | sun | coral | lilac | shimmering gold-white (animated dither, 2 fps) |
- Missing a day drops **one tier** (not a reset): a gentle loss.
- Halo freezes can't be bought (never for RF).

### 5.7 Progression and unlocks (none are pay-to-win, none cost RF)
- **XP** = score / 10 + 50 per completed run + daily challenges (3 per day, 150 XP each, e.g. "clutch-grab 3 pixels", "pop 5 Clanks from behind", "burp Gulp"). XP to next level = `500 + 250 × L`. Level cap 30 (season reset for cosmetics later).
- **Unlock track (cosmetic only):**
| Level | Unlock |
|---|---|
| 2 | Slurp enters the pool · trail "dust" |
| 3 | **Pond** island (slippery: damping ×0.8) · emote wave |
| 5 | stitch colours (5 pastels) · trail "confetti" |
| 6 | **Dusk** island (Snatch-heavy, low light) |
| 8 | hub emote "flex" · home-island prop pack 1 (tree, bench, crystal) |
| 10 | **Snow** island (drift wind 4 u/s²) |
| 12 | trail "ink drips" · results frame "stamp" |
| 15 | **Ink** island (full 1-bit mode) |
| 20 | Practice mutators (big head, low gravity, Nib-only, mirror) — never ranked |
| 25 / 30 | titles "Munchie Mender", "Gulp Whisperer" |
- Islands 3+ carry score multipliers of 1.0 / 1.15 / 1.3 / 1.45 / 1.6 for Quick Runs only. The Daily is always a fixed island.
- **Bestiary:** 7 entries × 3 lore tiers (10/100/1000 pops, or 1/10/50 burps for Gulp) with a lore card per tier.
- **Stamps** (the Club Penguin stamp book, §12.5): 24 stamps for Pixel Life in 4 difficulty colours (e.g. "Flawless", "8× combo", "Fizz bank ×3", "Mend 10 strangers", "Whole on a 30-day halo"). They show on the Friend page and in the stamp book.
- **Soft currency** (name and rates owned by tokenomics, placeholder **"Crumbs"** `SOFT_*`): earned in every venue from score, even on a bad run. It is spent on cosmetics and home-island décor (§12). It is non-transferable and never converts to or from RF. By design it **never buys Regrow** (open question §10.1 Q11).
- **Guest → owner carry-over:** XP, level, unlocks, bestiary and achievements carry over to the wallet account (not loaner scars).

### 5.8 Integrity (design constraints the architecture must meet)
- A deterministic 60 Hz sim (a 2D plane, shared TS module) plus a seeded PRNG. The client uploads its input log, and the server (Durable Object) replays it headless. **Scars, score, rank and XP come only from the replay.**
- An input log is ≤ 8 KB per run (delta-encoded). Runs whose replay diverges are unranked and apply no scars.
- Limits: ranked Daily 1/Friend/day. Quick Runs that apply scars are unlimited (scars are self-harm, not reward). XP from Quick Runs is capped at 5,000/day.

### 5.9 Notifications (in-app inbox; opt-in web push after the first Mend received)
| Trigger | Copy |
|---|---|
| Mended by someone | "a stranger regrew #344030's left ear and paid it 0.5 RF" (region names §9.5; the RF amount is `P_MEND_PX × n / 2`) |
| Fully healed (free) | "#344030 is whole again." |
| Daily seed live (00:00 UTC, only if streak ≥ 3) | "today's island: Pond · Gulp is grumpy." |
| Streak at risk (20:00 local, only if streak ≥ 7) | "your coral halo fades tomorrow." |
| Badge earned | "top 10 % yesterday. silver banner on your island." |
- Max 2 pushes/day, and never for spending prompts.

---

## 6. Screen flow and UX

### 6.1 Flow
```
URL ─▶ [Island: first run, loaner]  ─(60 s)─▶ [Results] ─▶ play again ─▶ [Run]
                                              │
                                              ├─▶ walk into the Sky ─▶ [HUB]
                                              └─▶ bring your own friend ─▶ [Connect]
Returning visitor ─▶ [HUB] (Friend spawns at the Arena door; big [ play ] button)
[HUB] ─▶ Arena door ─▶ [Mode pick: quick · daily · practice] ─▶ [Run] ─▶ [Results] ─▶ back to HUB
[HUB] ─▶ Greenhouse ─▶ [Shop: regrow · seed pack · market · inventory]
[HUB] ─▶ tap any Friend ─▶ [Mini card] ─▶ [Friend page /f/:id] ─▶ mend
[HUB] ─▶ Board stone ─▶ [Daily board]      ⚙ anywhere ─▶ [Settings]
```
**Routes:** `/` (auto: first-visit run or hub), `/play?mode=daily|quick|practice`, `/f/:tokenId`, `/sky`, `/shop`, `/board`, `/handheld`, `/settings`.

**Visual language** (brand, but not "yet another lime-on-black"): paper `#eee` / ink `#111` UI panels, radius 0, hard 4px offset shadows, Silkscreen headings, lowercase mono labels, pastel world palette. **Lime `#CCFF00` is used only for "act now"** (loose-pixel rings, the YOU marker, primary CTA focus). UI motion is stepped (`steps()`), with no easing. The game world uses 3D light, but the UI never blurs.

### 6.2 Landing = the first run (guest in ≤ 3 s)
```
┌────────────────────────────────────┐
│ pixel life      on loan · #65042 ▾ │  ← loaner chip (tap: swap among 13)
│                                    │
│        ·  ☁  floating islands ☁  · │
│      ╭──────────────────────╮      │
│     ╱    ▓▓   (Friend rains  ╲     │
│    │     ▓▓▓▓  in, voxel by   │    │
│     ╲    ▓  ▓   voxel)       ╱     │
│      ╰──────────────────────╯      │
│            ☝ ← drag to fling       │  ← ghost hand loops (1.6 s)
│                                    │
│ every hit knocks a pixel off.      │
│ grab it back — or regrow it.       │
│                                    │
│░░                                ░░│  ← SDK toolbar corners kept clear
└────────────────────────────────────┘
```
- The first input starts the run (the timer waits for the first fling in run 1 only).
- The loaner is a real Friend from `friends.json`'s 13, rotated daily, always labelled **"on loan"**.
- A small `[ connect ]` sits top-right *after* run 1 only.

### 6.3 In-run HUD
```
┌────────────────────────────────────┐
│ ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▯▯▯▯  0:42   SCORE 1 240│ ← time as 60 stepped blocks + number
│ chain ●●●●○○○○○○             ▓▓ 78/82│ ← mini silhouette (live holes, blinking
│                                   ▓▓▓│   loose px) + count
│            COMBO x3                │
│      ◌·        ▓▓                  │  ← ◌ loose pixel with lime timer ring
│   nib    ·  · ▓▓▓▓ · · ·> aim dots  │
│              ▓  ▓                  │
│                                    │
│  ⏸                                 │  ← pause (top-left alt position if mirrored)
│░░                                ░░│
└────────────────────────────────────┘
```
- Silhouette (top-right, 48×48 px): ink = present, coral dotted = scar, lime blink = loose, dotted outline = safety-stitched. It is the only health readout.
- Callouts are stepped pop-ups at the Friend: "+10", "COMBO x3", "−2 PX", "+1 PX", "CLUTCH", "PARRY", "RING OUT".
- Gulp warning: a dither band on the screen edge on the wedge side plus "GULP!" (Silkscreen, 2 blinks).

### 6.4 Results card (and share)
```
┌────────────────────────────────────┐
│ RUN OVER · meadow · gulp: hungry   │
│  ┌──────────┐   kept 78/82 px      │
│  │ ▓▓   ▓▓  │   score   3 410      │
│  │ ▓▓▓▓▓▓░  │   best combo x5      │
│  │ ▓░ ▓▓ ▓  │   gulp burped ✓      │
│  │  ▓▓▓▓▓░  │   grabbed back 11    │
│  └──────────┘   lost 4 (scars)     │
│  [ 3 s GIF of best moment ▶ ]      │
│                                    │
│  [   PLAY AGAIN   ]  [ share ]     │
│  owner:  [ regrow 4 · 2.00 RF SIM ]│
│          heals free in 2h 00m      │
│  guest:  [ bring your own friend ] │
│          these were loaner pixels. │
│          your friend's scars stick │
│          — and heal.               │
│  [ walk into the sky → ]           │
└────────────────────────────────────┘
```
- **Share:** a PNG 1200×630 (silhouette with holes, token id, score, rule line, QR/deep link to `/f/:id`) plus a GIF/MP4 480×480 of 3 s (best moment = the highest-scoring 3 s window, recorded from the render ring buffer at 20 fps). Buttons: native share / copy link / download. A scarred owner card adds "help me mend →".
- Daily results show rank and percentile, "+3 px nap", and the streak tick.

### 6.5 The Sky Hub (see §11 for the full hub design)
```
┌────────────────────────────────────┐
│ the sky · plaza        ●14 here  ⚙ │
│     [home isles]  ◇  ◇   ◇         │ ← other players' home islands (offline state)
│   ┌arena┐       ┌greenhouse┐       │
│   │ ▶▶  │  ▓▓    │ ✿  shop  │      │
│   └─────┘ you ▓  └──────────┘      │
│     ▓ ▓   ▓░▓  ← another Friend,   │
│    #1969  scarred, tap → mini card │
│   ┌daily stone┐      ┌mend well┐   │
│   │ 04:12:55  │      │ 7 need  │   │
│   └───────────┘      └─help────┘   │
│  [ ▶ play ]        [ ☺ emote ]     │
│░░                                ░░│
└────────────────────────────────────┘
```
**Mini card (tap a Friend):**
```
┌ #1969 · asymmetry · G4 ────────┐
│  ▓░▓   49/56 px  · coral halo  │
│  ▓▓▓   stitched by 2 menders   │
│ [ mend 1 · 0.5 RF ] [ mend all ]│
│ [ wave ]  [ friend page ]      │
└────────────────────────────────┘
```

### 6.6 Friend page (`/f/:tokenId`, public and shareable)
```
┌────────────────────────────────────┐
│ #344030 · MASK · G3 · tier 2       │
│ ┌───────────────┐ state: chipped   │
│ │  (big voxel   │ 76/82 px         │
│ │   Friend,     │ heals free: 3h   │
│ │   rotatable   │ halo: coral (9d) │
│ │   ±25°)       │ gold worn: 1     │
│ └───────────────┘ stitches: 3 ▾    │
│ trait: PARRY — release just before │
│        a bite to reflect it        │
│ best daily: top 4% · runs 212      │
│ bestiary 18/21 · badges ▦▦▦▦       │
│ [ mend ]  (owner: [regrow] [wear gold] [seed pack])
│ recent: "a stranger mended its left│
│  ear · 0.5 RF to its wallet"       │
└────────────────────────────────────┘
```

### 6.7 Shop — "the Greenhouse"
```
┌ greenhouse ───────────── RF 42.0 SIM ┐
│ [regrow] [seed pack] [market] [inv]  │
│──────────────────────────────────────│
│ SEED PACK        P_SEED_PACK RF      │
│  sprout     ████████████ 60.0%  ...  │
│  bloom      █████        28.0%       │
│  full bloom █             9.0%       │
│  GOLD PIXEL ▏             3.0%       │
│  expected value 0.90 RF per 1 RF     │
│  max prize reserved ✓ · no rerolls   │
│  [ buy 1 ]  [ buy 5 ]                │
│──────────────────────────────────────│
│ INVENTORY                            │
│  gold pixel ×1  [wear] [redeem R_GOLD] [list]
│  sprout ×2      [plant = regrow 3px] [redeem]
└──────────────────────────────────────┘
```
(The percentages shown are illustrative and replaced by the TK table.) Every RF figure goes through `client.mode` → `SIM` label in preview.

### 6.8 Wallet connect (FriendSDK)
```
┌ bring your own friend ─────────────┐
│ 1 connect wallet   (SDK host modal, │
│   EIP-6963 list)                    │
│ 2 sign in (no gas)                  │
│ 3 pick your friend  (SDK picker)    │
│   ┌──┐┌──┐┌──┐                      │
│   │▓▓││▓ ││▓▓│  #344030 #63675 ...  │
│   └──┘└──┘└──┘                      │
│ 4 it rains in, scars and all ✓      │
│ keep playing loaners →              │
└─────────────────────────────────────┘
```
- The SDK owns the wallet, discovery and the ownership gate (AGENTS.md rule). Our host only styles the frame (`--game-*` variables).
- States: *no wallet* → "no browser wallet — keep playing on loan · get a wallet ↗"; *wrong chain* → "switch to Robinhood Chain (4663)" [switch]; *no hardwired Friend* → "no playable Friend found. Hardwiring starts at 1 RF ↗ · keep playing on loan"; *gate failed/expired* → re-check, 1 retry, then fall back to loaner.

### 6.9 Settings
```
┌ settings ──────────────────────────┐
│ sound      [on] music [━━━━░░] sfx [━━━━━░]
│ mute all   [ ]      (M key)        │
│ reduced motion [ ]  no flashes [ ] │
│ captions (audio cues) [ ]          │
│ controls: drag · keys · pad · one-switch · tap-target
│ aim assist (unranked only) [ ]     │
│ game speed 70 / 85 / 100 % (unranked)
│ mirror HUD (left-handed) [ ]       │
│ quality: auto · high · low · 1-bit │
│ handheld mode ▶                    │
│ stitch colour  ■ ■ ■ ■ ■           │
│ notifications  push [ ]            │
└────────────────────────────────────┘
```
- The OS `prefers-reduced-motion` default is respected. Settings persist in local storage (try/catch, defaults on failure) and on the server for owners.

### 6.10 Loading and error states
| State | Presentation |
|---|---|
| Boot (assets < 900 KB gz before first fling) | The Friend rains in; the voxel count *is* the progress bar. ASCII spinner `| / - \` below. |
| Sprite read slow (> 2 s) | Use the cached sprite, else start as a loaner: "your friend is on its way…" |
| WebGL unavailable / GPU slow (< 40 fps for 3 s) | Step down: no bloom → no shadows → 1-bit 2D renderer (§7), with a toast. |
| Offline | Guests: play normally. Owners: "offline — this run won't leave scars or rank"; the replay is queued if connectivity returns within 10 min. |
| Replay rejected | "we couldn't verify this run — no scars, no rank. your score stays in your local log." |
| RF action failed | Inline under the button: reason + [retry]. Never a full-screen modal. No RF is deducted in the UI until confirmed. |
| Server down | The hub becomes a single-player plaza (no presence) with a banner "the sky is foggy — friends will be back soon". |

**Performance budgets:** 60 fps on iPhone 11 / Pixel 6a at high quality, ≥ 30 fps on a 2019 Android at low. Initial JS ≤ 450 KB gz. First fling possible ≤ 3.0 s on 4G. ≤ 6k instanced voxels in a run, ≤ 25k in the Hub.

---

## 7. Handheld 1-bit 128×128 mode

- **Purpose:** the founder's Sharp Memory LCD device thesis, playable in browser at `/handheld` or from Settings. It is the fallback renderer too.
- **Display:** a 128×128 canvas, **1-bit only** (ink `#111` / paper `#eee`), integer upscaled (×3 or ×4, nearest), inside a drawn device bezel. 30 fps. Shading uses 2×2 Bayer checker only, no greys.
- **Same sim:** the 2D sim is identical, so seeds, Daily Runs and replays are compatible (handheld runs rank on the same board with a ▣ tag).
- **Projection:** a top-down 3/4 view. World-to-screen = 1.5 px/u. The island ellipse is 108×72 px, centred at (64, 70). The Friend is drawn as its **16×16 sprite at 1:1** (the front frame; scars are paper pixels with an ink 1-px dotted rim, each rim dot drawn every other frame so it reads as "missing"). Creatures are 4–8 px sprites. Loose pixels are single 1-px dots in a 5-px dotted ring that shrinks in 4 steps.
- **Screen layout:**
```
y 0–8    ▮▮▮▮▮▮▮▮▮▮░░░  score 3410        (5×5 pixel font)
y 9–119  island + play field
y 120–127 ▓ 78/82          x3  ♥streak
```
- **Input (device-ready):** D-pad ←/→ rotate the aim in 16 steps (22.5°) at 12 steps/s. **A** (hold) charges in 8 steps over 0.8 s, and releasing it flings. **B** = cancel aim / hold 1 s for the menu. Browser mapping: arrows + Z (A) + X (B). Touch: the drag still works.
- **Juice in 1-bit:** hit-stop is unchanged. Shake = ±1 px integer offset. Slow-mo = 15 fps stepping. The impact frame = full-screen inversion for 1 frame (max 1 per 600 ms). There is no colour anywhere: lime rings become dotted rings.
- **Tama screen** (idle, the device home): the Friend on its island with scars, "next px 12:04", streak halo as a dotted/solid ring, and a 3-item menu `play · heal · sky`. The Friend idles through walk frames 32–63 (4 facings) and wanders.
- **Audio:** single-channel square/pulse beeper (a 1-bit style) with 6 cues: fling, pop, bite, grab, gulp, time-up.

---

## 8. Audio direction (all procedural or CC0)

- **Engine:** WebAudio. The SDK sound kit (`select, purchase, action-start, action-ready, anticipation, impact, reveal-common/rare/legendary, reward`) is used where it fits, plus our own synth voices. The `unlock()` happens only on the first gesture. **No music autoplays before the first input.**
- **Palette:** rounded sine/triangle plucks, a warm low FM thump, soft noise ticks, a wooden marimba-like FM voice. No harsh squares except in handheld mode.

**SFX list (with synthesis notes):**
| Cue | Sound |
|---|---|
| aim stretch | a rubber-band creak: filtered noise, pitch rising with p in 8 steps |
| fling release | a "thwip": a triangle sweep of 600→1400 Hz over 80 ms |
| slide | soft grass brush (band-passed noise, gain ∝ v) |
| pop (Nib/Pogo/Fizz) | a pluck; the pitch climbs a pentatonic step per combo count (C D E G A C…) |
| Clank hit (front bounce) | a metallic tonk: 2 inharmonic partials, 180 ms |
| shell crack | a crunch + a low thump |
| bite telegraph | Nib "pardon!" (2-note chirp), Clank jaw creak, Slurp cheek-puff blubber, Fizz fuse tick (accelerating 4→12 Hz) |
| bite / pixel loss | a glassy "tink-tink" per pixel (high sine + a click) under a pitch-down whoosh during slow-mo |
| loose pixel timer | a soft tick at 2 Hz, 8 Hz in the last 0.5 s |
| grab-back | an ascending 3-note pickup (SDK-style). Clutch adds a sparkle arpeggio |
| pixel lost (expired/edge) | a descending 2-note sigh + a dust puff |
| ring-out | a falling whistle (1200→300 Hz, 350 ms) + cloud poof |
| gold glance | a bell "ting" (FM, ratio 3.5) |
| Snatch cackle | 3 fast chirps; wingbeats as noise bursts |
| Slurp tongue | a wet "thwop" (a low-passed noise envelope) |
| Old Gulp | rumble (40–60 Hz sine + noise), bite (a huge low thump + crunch), tooth hit (a deep bell), burp (a comic 3-note tuba), inhale (a rising filtered wind) |
| UI | select/purchase/reward from the SDK kit. Regrow = an ascending pluck per pixel. Mend = a two-voice chord |
| Seed Pack | the SDK reveal-common/rare/legendary. Gold Pixel = legendary + a bell cluster |

**Music:** procedural, **112 BPM**, key of F major pentatonic, mood "sunny lo-fi toy orchestra" (marimba FM, soft kick, brushed-noise hat, triangle bass). The layers enter by phase:
- Drop-in: pad only.
- Wave 1: + marimba ostinato.
- Wave 2: + bass + hats.
- Frenzy: + kick, the ostinato doubles.
- Gulp: a sub drone plus the melody dropping to minor pentatonic for 10 s.
- Last Light: a drum fill, then a stop on 60 s.
- Results: a 4-bar lullaby.
- Hub: a separate slower loop (84 BPM, music-box + field ambience: wind and a distant bell). Every venue door fades to its own theme.
- **Slow-mo:** music playbackRate / detune −5 semitones during slow-mo, back in 2 steps. **Mute:** M key plus a settings toggle, persisted.

---

## 9. Content list and tuning tables

### 9.1 Content inventory (the finished flagship)
| Content | Count |
|---|---|
| Playable Friends | any hardwired Generations NFT (all 9 families). 13 real loaners for guests |
| Creatures | 6 + the Old Gulp event (3 moods) |
| Islands | 5 (Meadow, Pond, Dusk, Snow, Ink) + the Daily rotation among them |
| Modes | Quick Run, Daily Run (ranked), Practice (seeded, mutators L20), Handheld |
| Cosmetics | 6 trails, 5 stitch colours, 8 emotes, 3 home-island prop packs, 4 results frames, 5 halo tiers, badges |
| Bestiary | 7 entries × 3 lore tiers |
| Achievements | 24 |
| Daily challenges | a pool of 30, 3 drawn per day |
| Economy | Regrow, Mend, Seed Pack (4 outcomes), Gold Pixel wear/redeem/market |

### 9.2 Master tuning table (initial)
| Key | Value | Key | Value |
|---|---|---|---|
| RUN_LENGTH | 60 s | GRAB_WINDOW | 2.0 s (Skeleton 3.0) |
| V_MAX | 70 u/s | MAGNET_PREY / FLY | 3.0 / 4.5 u |
| DAMP_CONST / DAMP_LIN | 10 u/s² / 1.8 /s | RUN_SCAR_CAP | max(6, 15 % N0) |
| FLY_THRESHOLD | 14 u/s | CRUMBLE_AT | 50 % N0 |
| READY_THRESHOLD | 30 u/s | RINGOUT_PX | 3 |
| LAUNCH_COOLDOWN | 250 ms | RESPAWN / INVULN | 1.0 s / 1.5 s |
| AIM_SLOWMO | 0.5× max 1.0 s | KILL_SPEED_KEEP | 0.90 |
| HITSTOP pop/combo/heavy/bite | 50/80/120/90 ms | BITE_SLOWMO | 0.3× · 400 ms |
| SHAKE_MAX / DECAY | 0.8 u / 1.6 s⁻¹ | IMPACT_MIN_GAP | 600 ms |
| FREE_REGROW_INTERVAL | 30 min [TK] | NAP_PX | 3 [TK] |
| GOLD_WEAR_MAX | 3 | GOLD_REGROW_BONUS | +20 %/gold, cap 60 % [TK] |
| GLOW_HEAL | 60 min/stage | XP curve | 500 + 250 L |

### 9.3 Islands
| Island | Size (u) | Modifier | Quick-run mult. |
|---|---|---|---|
| Meadow | 72×48 | none; 8 bumper rocks | 1.0 |
| Pond | 72×52 with a central pond (Friends slide over it, damping ×0.5; loose pixels that land in it float 0.5 s longer) | slippery | 1.15 |
| Dusk | 68×46 | low light; Snatch weight ×2; loose pixels glow | 1.3 |
| Snow | 70×48 | wind 4 u/s² changing direction every 10 s (telegraphed with drifting flakes) | 1.45 |
| Ink | 72×48 | full 1-bit render, no colour cues; bumpers only on 15 % of the rim | 1.6 |

### 9.4 Real loaner roster (from `friends.json`)
| Token | Family | N0 | Launch ×(sqrt(70/m)) | Note |
|---|---|---|---|---|
| #65042 | Hoverer | 42 | 1.29 | default first-run loaner (strongest GIF: glides, light) |
| #64940 | Hollow | 44 | 1.26 | |
| #64978 | Asymmetry | 52 | 1.16 | |
| #1969 | Asymmetry | 56 | 1.12 | hook → right (4 unmirrored px on the right) |
| #344034 | Cellular | 70 | 1.00 | |
| #64981 | Cellular | 74 | 0.97 | |
| #65058 | Family | 76 | 0.96 | |
| #63713 | Mask | 80 | 0.94 | |
| #344030 | Mask | 82 | 0.92 | key-art hero |
| #65040 | Sparkling | 83 | 0.92 | |
| #344033 | Asymmetry | 86 | 0.90 | |
| #63675 | Skeleton | 92 | 0.87 | |
| #64998 | Colossus | 96 (side frame) | 0.85 | |
- **Daily loaner rotation:** day-of-year mod 13. Run 1 of a lifetime is always #65042 (Hoverer) or #344030 (Mask), A/B tested.

### 9.5 Body region names (for Mend notifications and scars copy)
The sprite bbox is split into a 3×3 grid: top row = "left ear / crown / right ear", middle = "left arm / heart / right arm", bottom = "left foot / belly / right foot". Name = the region of the scar that was mended. Multi-pixel mends use the most common region, or "a few pixels".

### 9.6 Onboarding drip (new-thing-per-session)
| Session / run | New thing |
|---|---|
| Run 1 (scripted) | 0–10 s: 5 Nibs spawn one by one in front. 11–13 s: a forced bite from behind (a guaranteed 2 px) → "GRAB THEM BACK". 20 s: Pogo. 40 s: Sleepy Gulp. |
| Run 2 | Clank ("hit it from behind"), trait toast |
| Run 3 | Fizz ("bank it!"), Snatch |
| Session 2 | Hub walk-in, Daily stone, Slurp at L2 |
| Session 3 | Mend Well (see who needs help), stitch colour |
| Session 4 | Seed Pack odds page (one "?" hint, no push) |
| Session 5 | Pond island unlock (L3) |

### 9.7 Difficulty curve and balance targets
- **Within a run:** budget 0.8 → 3.0 /s (§3.9). The threat peaks at 40–52 s (Gulp plus Frenzy) and releases in Last Light, so every run ends on a scramble, not a slog.
- **Across runs:** creatures unlock by run count and level (§9.6). Islands raise difficulty via modifiers and are opt-in (the multiplier compensates). **There is no hidden rubber-banding.** The Daily Run rotates island difficulty by weekday: Mon Meadow, Tue Pond, Wed Dusk, Thu Meadow, Fri Snow, Sat Ink, Sun Pond.
- **Targets (verified by a headless bot sim of three skill profiles: novice = random aim ±30°, 400 ms reaction; average = ±12°, 250 ms; expert = ±4°, 150 ms, uses traits):**
| Metric | Novice | Average | Expert |
|---|---|---|---|
| px lost persisted / run (Meadow, Hungry) | 9 | 5 | 1–2 |
| grab-back rate | 45 % | 70 % | 92 % |
| Crumble rate | < 8 % | < 2 % | 0 % |
| Gulp burped | 10 % | 45 % | 90 % |
| score | 1 200 | 3 000 | 6 500 |
- If average-player persisted loss is > 7 px, reduce the Fizz weight first, then raise GRAB_WINDOW by 0.25 s steps.

---

## 10. Open questions

### 10.1 For the tokenomics designer (you own every `[TK]`)
1. **Seed Pack "use" outcomes:** the SDK kept rewards can only be *redeemed*. Do you accept "plant = redeem + auto-Regrow in one confirm" (the RF round-trips through the 50/50 split), or do you want a dedicated consume action (an integration gap)? This decides whether Sprout/Bloom need a use value ≈ 2× redeem as in concept A.
2. `P_REGROW_PX` (0.25–1 RF): should the price scale with the family's `N0` so a 96-px Colossus and a 42-px Hoverer pay the same per % of body? Default: a flat price per pixel.
3. `FREE_REGROW_INTERVAL` (30 min) and `NAP_PX` (3) directly set Regrow demand. What values give your target burn/DAU without making free healing feel slow? I need a sensitivity table (15/30/60 min).
4. The Gold Pixel perk (+20 % free regrowth per gold, cap 60 %) reduces Regrow demand for holders. Is that the right hold incentive vs `R_GOLD`, or do you prefer a purely cosmetic perk?
5. Market: `MKT_CREATOR_FEE`, `MKT_ROYALTY` recipients (game treasury? burn? the Friend's 6551 wallet?), and a listing floor = `R_GOLD`?
6. Mend: should there be a per-sender daily cap, or a minimum `n` so micro-mends don't spam owners? And the notification copy shows the half to the wallet: confirm the rounding (base units, 18 decimals).
7. Regrow's 50 % goes to the "protocol active-Friends reward stream". What is the live path (protocol gameplay-payment entry vs our splitter contract), and how should the preview label it?
8. Guest RF: should guests get a SIM wallet (e.g. 10 SIM RF) to try Regrow/Seed Pack, or should economy screens be view-only until connected?
9. Seed Pack tiers: one price (SDK single consumable) vs multi-tier (an integration gap)? The design assumes one.
10. Should a Daily Run streak ever affect economy (e.g. a Regrow discount)? The design says **no** (status only). Confirm.
11. **Soft currency ("Crumbs" placeholder):** its earn rate per venue (the design proposes `Crumbs = floor(score / 25)`, min 20 per completed run, daily soft cap), the price ladder of the décor/clothes catalogue, and a confirmation that Crumbs never buy Regrow/Mend/Seed Packs (which would cannibalise the RF sink) and never convert to RF. Should RF-priced *premium* décor exist (50/50 split), or does it stay only Gold Pixel + Regrow/Mend? The design leans to **no RF décor in v1**, to keep "RF in one place" readable.
12. Belt trials (§12.4): confirm they carry no RF and no Crumb multiplier (pure status).

### 10.2 For the art director
1. Voxel depth (1.5 u?) and the front-face ink vs side shade values: does the canonical sprite read at 48 px on a phone? Test all 13 loaners.
2. Colossus: is the side frame mirrored to face left acceptable as its "front", and how do scars map when the Hub uses walk frames from other facings (scars defined on the source frame; show scars on side/back frames by pid coincidence, or as a "bandage" count badge)?
3. The Hoverer's detached orb and the Hollow's outline body: halo shell rendering around separate islands of pixels.
4. Creature sprites: finalise the 6 silhouettes at 6–12 px so they read at 24 px on screen *and* in 1-bit handheld. Is one pastel accent per creature enough to separate them from the ink Friend?
5. Old Gulp: paper-cloud whale scale vs the island. Does the wedge bite read in a GIF at 480 px?
6. The impact frame style: pure invert vs ink-on-paper line art (concept B's manga star burst).
7. Palette discipline: lime only for "act now". Gold `#E8B530` vs sun `#F2CE68` separation; scar coral dotted vs Snatch coral beak collision.
8. Island voxel style per biome and the cloud sea (dithered stepped fog, no gradients).
9. Hub art: plaza layout readability at 360 px wide with 40 Friends, name tags, venue door iconography.
10. The share card template (1200×630 + 480×480 GIF) and the loaner "on loan" badge treatment.
11. Genesis 8×8 portrait: a 2×2 voxel blocks look, or keep it out of play until phase 2?

---

## 11. The Sky Hub (the platform) and venues — EXTENSION

The Sky becomes a **Club Penguin-like hub**: a shared island world where you walk with your voxel Friend, see other real Friends live (scars, halos, gold, stitches), emote, Mend, and enter **venues** (mini-games). **Pixel Life is the flagship venue** and the source of the scar/regrow meta, which follows your Friend everywhere. Scope rule: **hub + Pixel Life polished first; phase-2 venues only when each is fully polished; never ship half-finished venues** (no "coming soon" scaffolds on the map).

### 11.1 Layout
```
                 ◇ ◇  home isles ring (other players' Friends, offline state) ◇ ◇
        ◇                                                                      ◇
            ┌── ARENA ISLE ──┐   cloud bridge   ┌── GREENHOUSE ──┐
            │ Pixel Life door│══════╗  ╔═══════│ regrow · seeds  │
            │ (big ring,     │      ║  ║       │ market · inv    │
            │  fling statue) │      ║  ║       └─────────────────┘
            └────────────────┘   ┌──╨──╨──────────────┐
                                 │      THE PLAZA      │  spawn point, fountain,
      ┌── MEND WELL ──┐══════════│  (40 u × 40 u)      │  notice board, emote stage
      │ bubbles of    │          │   daily stone ▮     │
      │ scarred Friends│         └──╥──────────────╥──┘
      └───────────────┘             ║              ║
                          ┌── BOARD CLIFF ──┐  ┌── (phase-2 venue isles appear
                          │ daily + weekly  │  │    here only when shipped)
                          └─────────────────┘  └──
```
- **Plaza** 40×40 u. Four satellite isles (each ≈ 30×24 u) are joined by 6-u wide cloud bridges. The total walkable area ≈ 4,500 u². The camera is the same 38° pitch, orthographic-ish (FOV 20°), following the player at 4/s.
- **Home isle ring:** 12–24 home islands float at the edge (§11.4). They are visible, not walkable. Tap one to see that Friend.

### 11.2 Movement
- **Tap/click to walk** (A* on a navmesh, max path 80 u). **WASD/arrows/stick** move directly. Walk speed 12 u/s (Hoverer 13 with a float bob, Colossus 10 with a stomp dust puff).
- **Animation:** walk frames 32–63 per facing, voxelised per frame (pre-baked meshes). Scars are applied by pid on the front/back frames, see §10.2 Q2.
- **Hub fling (the physics tie-in):** hold on your own Friend to do a **small fling** (p max 0.35, no damage, no scars): the fun way to move and a playful emote. Bumping into other Friends pushes both by `impulse / m` (heavy Friends barely move). There is no hub damage, ever.

### 11.3 Presence, instances, safety
- **Instances ("clouds"):** max **40 Friends** per instance, auto-filled. You join your menders or recent Mend targets first when possible. Up to 3 instances per friend group via share link `/sky?cloud=abcd`.
- **Netcode:** one Durable Object per instance. Position/state updates at 10 Hz, clients interpolate with 120 ms buffer. Emotes and hub flings are events. Offline → single-player plaza (§6.10).
- **Name tags:** `#tokenId` + family icon; the owner's ENS/short address is shown only on the Friend page. Guests show "on loan #65042".
- **Chat-lite v1:** **no free text.** A 16-phrase quick-chat wheel ("hi!", "gg", "nice combo", "help me mend?", "thanks for the stitch!", "daily?", "follow me", "look!", ...). This avoids moderation needs. Free text is phase 2 with filters.
- Block/mute a player: hides their emotes and quick chat for you.

### 11.4 Emotes (8, the wheel; 4 unlocked at start)
wave, hop, spin (a 360° roll-only step spin), heart (paper heart voxels), **pixel burst** (the Friend scatters its pixels 1 u and snaps back, a cosmetic flex of the core mechanic), sit, flex (squash 0.75 ↔ stretch 1.2), stomp ("dosukoi", shockwave dust). Cooldown 1.5 s. Emotes are stepped animations, 6–10 frames.

### 11.5 Venue entrances
- A venue is an **isle with a door** (a voxel archway with the venue's icon plus a live counter "● 6 playing"). Walking into the door (or tapping it) opens the **venue card**: name, 1-line rule, modes, your best, Daily status, [enter]. A 0.4 s stepped iris transition follows.
- The **big [ ▶ play ] HUD button** in the Hub always goes straight into a Pixel Life quick run (1 tap), so the Hub never gates the fun.

### 11.6 Sky and Mend inside the Hub
- Every Friend walking around shows its **real state**. Scarred Friends show coral dotted slots, and the Mend Well lists the 7 most-scarred online/recent Friends as floating bubbles you tap to Mend.
- **Mend in place:** tap a Friend → mini card (§6.5) → confirm → your Friend walks to it, and the stitched voxels arc across (1.0 s). Both Friends play "heart". The owner (if online) sees it live and gets a toast. Otherwise they get an inbox notification (§5.9).
- **Home isles:** each shows the Friend in its current state, with generation terraces, tier flag, badges (weekly), gold rim, halo and up to 6 props (unlocked cosmetics). A tap opens the Friend page.

### 11.7 The common venue contract
Every venue (first-party or community) implements one module interface. The Hub owns identity, economy, persistence, scars and social; **venues own only gameplay.**

```ts
interface VenueManifest {
  id: string; name: string; version: string;
  rule: string;                 // one sentence, shown on the door
  players: { min: number; max: number };   // 1..1 for solo
  modes: ("quick" | "daily" | "practice")[];
  scars: boolean;               // may this venue cause persistent scars? (needs replay)
  deterministic: boolean;       // required if scars or ranked
  maxScarsPerRun: number;       // ≤ RUN_SCAR_CAP; hub enforces
  audio: { theme: string };     // hub crossfades on enter/exit
}

interface VenueContext {
  friend: { tokenId: string; family: Family; frames: Sprite16[]; N0: number;
            scarSet: number[]; goldSlots: number[]; stitches: Record<number,string>;
            isLoaner: boolean };
  seed: string; mode: "quick" | "daily" | "practice";
  input: InputBus;              // unified pointer/keys/pad/one-switch
  settings: { muted: boolean; reducedMotion: boolean; noFlashes: boolean; captions: boolean };
  paused: Signal<boolean>;      // SDK `paused` + tab blur
  physics: FriendBody;          // shared voxel body + mass/trait module (reuse!)
  juice: JuiceKit;              // hitstop/shake/slowmo/impactFrame with global caps
  share: ShareRecorder;         // ring buffer for the 3 s best-moment clip
}

interface VenueResult {
  venueId: string; runId: string; seed: string; mode: string;
  score: number; durationMs: number;
  pixels: { lostPids: number[]; grabbedBack: number };   // [] if scars=false
  xp: number; stamps: string[]; beltTrial?: string;   // hub converts score → Crumbs via SOFT_* rates
  bestMoment?: { startMs: number; endMs: number };
  inputLog: Uint8Array;         // for server replay when deterministic
}

interface Venue { manifest: VenueManifest;
  enter(ctx: VenueContext): Promise<void>;
  exit(reason: "done" | "quit" | "error"): VenueResult; }
```
**Contract rules**
1. **Entry/exit:** the Hub passes the context. The venue must reach playable ≤ 2 s after `enter`. `exit` always returns a result (quit = partial, no scars).
2. **Results:** the Hub renders the shared results card (silhouette, score, venue stats slot, share, regrow CTA) and awards XP, Crumbs (hub-side formula, never venue-side), stamps and bestiary. Venues supply up to 4 stat lines.
3. **Scars:** only `scars: true && deterministic: true` venues can apply scars, only via server replay, always under the shared `RUN_SCAR_CAP` and the 50 % floor. There is a **shared daily cap** across all venues (`DAILY_SCAR_CAP = 3 × RUN_SCAR_CAP`), so no venue can be a scar farm or a griefing vector.
4. **Economy:** venues **never price RF items** in v1. All RF goes through the Hub's single economy: Regrow, Mend, Seed Pack, Gold market. Perks are read by the Hub from held rewards and passed in as context (never read directly by venues).
5. **Quality bar (the SDK list):** keyboard + touch, pause on `paused`, mute, reduced motion, no flashes, 360 px width, SDK corners clear, loading/error/retry states.
6. **Community venues** (the "Roblox for Rare Friends" pitch): an adapter maps a FriendSDK game (`GameComponentProps { friendId, client, paused }`) into a venue with `scars: false`. It gets a door in the Hub after review. Their own ChanceGame economy stays theirs, and they get Rare Friends distribution through our plaza.

### 11.8 Phase-2 venues (only after Pixel Life and the Hub are polished; each must ship complete)

**A. Pixel Putt (solo, async, scarless)**
- *Rule:* "Fling your Friend into the hole in as few shots as you can."
- 9-hole floating course. Every hole is a small island with bumpers, slopes (a constant accel field), a moving cloud platform and a Nib hazard: touching a Nib costs +1 stroke, no pixels. It reuses the fling input, trajectory dots, family traits (Asymmetry hooks around corners, Hoverer saves edge shots, Colossus stomps through Nib walls, Cellular splits for two chances at the hole: the better half counts) and mass (a scarred Friend flies farther, so scars change your shots without costing you pixels).
- Par per hole 2–4, a daily course seed and a weekly board. ~3 min per round. Scarless, so it's a relaxed venue for healing days. Content: 27 holes (3 courses) at launch.

**B. Bump Sumo (live, 2–4 players, scarless)**
- *Rule:* "Shove the other Friends off the island. Last one standing wins." (from concept B)
- A 36×36 u round island that shrinks by 1 ring of voxels every 15 s. Fling-shove with the same mass physics (impulse / m). Pixels knocked off during a bout are **temporary**: they reattach at the bout's end (no persistence, so PvP can't grief or farm scars). Lighter = flies farther (the Smash % made physical). 3 stocks, 90 s bouts. Rooms come via the Hub door (quick match) or a share link. One Durable Object per room, 30 Hz server-authoritative, client prediction for your own body.
- Rewards: XP, a "sumo" title track and emotes. **No RF moves between players, ever.** Kensho-style sponsor banners are a possible later sink, and only through the Hub economy.

### 11.9 Hub/venue scope order
1. Pixel Life flagship (all of §§1–10).
2. Hub v1: plaza + 4 satellites, walking, presence, 8 emotes, quick chat, Mend in place, home isles (visit + décor + open isles), stamp book, Fling Belts, Crumbs catalogue, venue door for Pixel Life, Greenhouse, Board, the first Sky Festival + Lost Pixel hunt.
3. Phase 2a: Pixel Putt. Phase 2b: Bump Sumo (plaza table). Phase 2c: Stack Four table. Then the community venue adapter. Then more venues as roadmap.

---

## 12. Club Penguin lessons, applied

The owner's reference is Club Penguin (2005–2017): its mini-games were short and genuinely pleasant, and the world around them gave every coin a reason to exist. We copy the **structure**, not the art or names.

### 12.1 What made it work, and what we take

| Club Penguin lesson (examples) | Why it worked | Our application |
|---|---|---|
| **One verb, tiny ruleset.** *Cart Surfer* (arrows: lean/trick), *Ice Fishing* (move the line with the mouse), *Bean Counters* (catch and stack bags, dodge anvils), *Aqua Grabber* (steer a claw sub), *Puffle Launch* (time the cannon), *Jet Pack Adventure* (thrust vs fuel), *Hydro Hopper*, *Catchin' Waves* | Understood in one look, playable by a 7-year-old, mastered by a 30-year-old | Pixel Life is **drag-release only**. Every phase-2 venue must pass the same test: one verb, rule on the door in ≤ 12 words (§11.7 `rule`). |
| **Short sessions (1–5 min) and a clean end.** *Thin Ice* (each level is a small puzzle), *Pizzatron 3000* (a shift ends after N pizzas or 5 mistakes) | "One more go" without fatigue, and each game fits a kid's attention or a work break | Runs are exactly **60 s**; Putt rounds ≈ 3 min; Sumo bouts 90 s. No venue may exceed 5 min per session. |
| **You always earned something, even when you lost.** Coins = score-based payout at the end of every game, fail or not | Failure never felt wasted, so players kept retrying | Every completed run pays Crumbs (min 20) + XP. Scars are the only loss, and they heal. |
| **Coins → clothes and igloo furniture → showing off.** Monthly *Penguin Style* catalogue, furniture catalogue, igloo upgrades | Earnings turned into *identity*, visible to everyone in the world | Crumbs → Friend accessories (worn voxels, never covering the canonical face) and home-island décor → seen in the Hub, on the Friend page, on share cards (§12.3). |
| **The igloo.** Your own space, decorated, openable to visitors ("open igloos" list) | A personal stage for status and hosting | Every Friend's **home island** is its igloo (§12.3), visitable in the Hub, with a "open isles" list. |
| **In-world multiplayer tables.** *Find Four* at the Ski Lodge tables, *Sled Racing* at the top of the Ski Hill (4 players), *Mancala* at the Book Room | Multiplayer happened *where people already were*; spectators crowded around | Plaza "tables": the **Bump Sumo ring** sits in the plaza where others can stand and watch (phase 2b); a 2-player **Stack Four** table (phase 2c, §12.6). Joining a table = walking onto a free seat. |
| **A deep status game.** *Card-Jitsu*: white → black belt through won matches, then the Sensei challenge and the ninja title; belts worn visibly | Long-term mastery goal that shows on your character | **Fling Belts** (§12.4): belt trials in Pixel Life, the belt worn as a voxel band on your Friend, the Old Gulp "Ancient" master trial at the end. |
| **Stamps.** A stamp book with 4 difficulty colours (easy/medium/hard/extreme) per game and event | Achievement hunting that gave replay goals to every mini-game | The **Stamp Book** (§12.5): 4 colours, per venue plus Hub/social/event pages, shown on the Friend page. |
| **Parties and events.** Monthly parties (Halloween, Winter Holiday, Music Jam), the fortnightly hidden **pin** | A reason to log in *this week*, a shared moment, free collectibles | **Sky Festivals** + the weekly **Lost Pixel** hunt (§12.6). |
| **Pets that are yours.** Puffles: fed, played with, followed you, had personalities by colour; neglect made them run away, not die | Care loops with warmth, not punishment | **The Friend is the pet.** Scars are the care state, healing is free and warm ("scars heal"), and each family has a hub personality (§12.7). No death, no running away. |
| **Safe social.** Menu-based Safe Chat | Parents trusted it; no moderation disasters | Quick-chat wheel only in v1 (§11.3). |
| **Lesson to avoid:** members-only paywall on most clothes, igloos, games | Players felt locked out of the fun | **Nothing fun or cosmetic is RF-gated** except the Gold Pixel (a chance prize) and paying to skip healing time. Every venue, belt, stamp, island and décor item is earnable by play. |

### 12.2 The Hub loop

```
   ┌───────────────► PLAY VENUES (60 s runs, Putt, Sumo…) ◄──────────────┐
   │                        │                    │                        │
   │               Crumbs + XP + stamps     scars (Pixel Life)            │
   │                        │                    │                        │
   │                        ▼                    ▼                        │
   │         ACCESSORIES & HOME-ISLAND DÉCOR   HEAL: free timer ·         │
   │         (Crumbs catalogue, level unlocks)  Regrow (RF) · Mend (RF)   │
   │                        │                    │                        │
   │                        ▼                    ▼                        │
   └──── SHOW OFF IN THE HUB: walk around, belt band, halo, gold, ────────┘
         stitches from menders, open your isle, festival items
```
- Every loop step is visible on the Friend or its island. **Status = visible things, not numbers.**
- RF lives in exactly two places in this loop: healing (Regrow/Mend) and the Seed Pack/Gold Pixel. Crumbs drive everything cosmetic.

### 12.3 Home island (the "igloo")
- **One per Friend**, persistent, visitable. Base size is set by generation (Gen-6: 1 terrace, up to Gen-1: 6 terraces + a waterfall, §4.1). The tier flag is on the top terrace.
- **Décor grid:** each terrace is a 12×12 u grid with 1 u snapping. Placement cap = 8 items + 4 per terrace. Items are voxel props (the SDK's 18 prop types as a base set: tree, flower, bench, planter, crystal, rock, crate, reeds, bridge, … plus our own: a Munchie plush set, a Gulp tooth trophy, festival items).
- **Catalogue ("the Seed Catalogue"):** rotates 12 items every 2 weeks (Club Penguin's catalogue rhythm), plus an always-available basic shelf of 20 items. Prices in Crumbs `[TK]`. Some items are unlocked only by stamps or belts (e.g. "Gulp tooth trophy" = burp Gulp 50 times). Those are the flex items.
- **Accessories on the Friend:** 1 head slot + 1 hand/side slot. They are voxels attached *outside* the canonical silhouette (hat above the top row, a flag beside it) and must never cover a canonical pixel (the art-preservation rule). They are hidden in-run by default ("show accessories in runs" toggle: cosmetic only, no hitbox).
- **Open isles:** the owner toggles "open". Open isles appear on the Hub's notice board list ("12 open isles"). Visitors walk onto it through a cloud bridge that spawns for the visit, may emote, sign the **guestbook** (a quick-chat phrase + stamp), and see the owner's stamp book and belts. Guestbook entries notify the owner.
- **Edit mode wireframe:**
```
┌ #344030's isle · edit ─────────────┐
│   ▲ terrace 2                       │
│  ┌───────────── grid ────────────┐  │
│  │ · · T · · · · · ▓▓ · · · · · │  │  ← your Friend idles on its isle
│  │ · · · · F · · · ▓░▓· · · · · │  │
│  │ · · · · · · · · · · · B · · · │  │
│  └───────────────────────────────┘  │
│ items 7/12   [rotate] [remove]      │
│ ┌ shelf ─────────────────────────┐  │
│ │ T tree 40  B bench 60  C crystal 150│  (prices in Crumbs, [TK])
│ └────────────────────────────────┘  │
│ [ open isle ☐ ]      [ done ]       │
└─────────────────────────────────────┘
```
(T/F/B/C = tree, fountain, bench, crystal voxel props.)

### 12.4 Status ladder: Fling Belts (the Card-Jitsu lesson)
- Belts are earned by **belt trials**: fixed, hand-tuned seeds in Pixel Life, one per belt, each with a clear requirement. You can retry them without limit (unranked practice rules: no scars). There is no RF, no Crumb multiplier and no time gate.
| Belt | Trial requirement (fixed seed, Meadow unless noted) |
|---|---|
| White | finish any run |
| Yellow | score ≥ 2,000 |
| Orange | combo ×4 in one fling |
| Green | keep ≥ 90 % of your pixels at run end |
| Blue | burp Gulp (Hungry) |
| Red | Dusk island, score ≥ 4,000 |
| Brown | your family trait: 5 trait triggers in one run (5 parries / 5 Fizz-free stomps / 5 hook kills…) |
| Purple | Snow island, Flawless |
| Black | Ink island, score ≥ 6,000 **and** Gulp burped |
| **Gulp Master** (the Sensei moment) | the **Ancient Gulp** trial: Gulp surfaces twice (at 25 s and 45 s), 5 teeth each, Grumpy inhale. It is a weather event, not a Friend boss. |
- **Visible status:** the current belt is a 1-voxel-thick **band** around the Friend's waist row, in the belt colour, in the Hub, on the Friend page, and optionally in runs. Gulp Masters get a paper-cloud trim and the title. Belts are per Friend (they follow the NFT, like its scars).
- Phase 2: each venue may add its own ladder (Putt: "Par Belts"; Sumo: "Ring Ranks"), shown as small pins under the main belt.

### 12.5 The Stamp Book
- Colours: **easy (meadow), medium (sun), hard (coral), extreme (lilac)**. Stamps award XP of 25 / 75 / 150 / 300 and appear in the book with the date earned.
- Pages: one per venue (Pixel Life: 24 stamps: 8 easy, 8 medium, 5 hard, 3 extreme), **Hub** (e.g. "walk every bridge", "wave at 10 Friends", "visit 5 open isles"), **Care** (e.g. "first Mend", "mend 10 strangers", "be mended by 5 different Friends", "whole for 7 days"), **Events** (one page per festival, only earnable during it: the FOMO lever, cosmetic only).
- The book cover shows the total count and a **stamp count ring** (a Club Penguin lesson: a single number people compare).
- Examples (Pixel Life): easy "First Grab" (grab back a pixel), medium "Clutch" (3 clutch grabs in a run), hard "Fizz Bank ×3", extreme "Untouchable" (Flawless on Ink), extreme "Gulp Master".

### 12.6 Parties, tables, pins
- **Sky Festivals:** one per month, 7–10 days, re-decorating the plaza and one venue modifier. Examples: *Gulp's Feast* (October: Gulp comes twice per run, candy-crumb pickups, a free tooth-lantern décor item), *Frost Fair* (December: Snow island Daily all week, the plaza under snow, a free scarf accessory), *Bloom Week* (spring: the Seed Pack reveal gets festival visuals only; **published odds never change during events**), *Music Jam* (every run's pop plucks play the Friend's own family melody). Each festival brings 1 free item for attending, a stamp page, and 3–6 catalogue items. Festivals never change RF prices.
- **Lost Pixel hunt (the pin hunt):** each week one glowing lost pixel is hidden somewhere in the Hub (behind a waterfall, under a bridge, on a home-isle ring). Finding it gives a free collectible **pin** for your home island (52 per year) and a stamp. The hiding spot is the same for everyone that week.
- **In-world tables (phase 2c):** *Stack Four*, a 2-player turn-based table in the plaza: take turns flinging a pixel token into a 7-column board (a light skill shot: a weak fling drops in the aimed column, a sloppy one may bounce to a neighbour); four in a row wins. It takes ~2 min and spectators can stand around. Payout: Crumbs + a stamp, **no RF**. Sled-race lesson: the Bump Sumo ring is a plaza table too (step onto a free starting pad, the bout begins when 2–4 pads are filled or after a 10 s timer).

### 12.7 The Friend as the pet (the puffle lesson)
- **Follows you and has a personality in the Hub.** An idle behaviour per family: Skeleton rattles and occasionally drops a bone-pixel that snaps back, Mask peeks around, Family waves at nearby Friends, Cellular wobbles as if about to split, Asymmetry tilts, Hoverer bobs 1 u above the ground, Colossus sits and makes the plaza shake a little when it stands, Sparkling leaves sparkle dust, Hollow blinks through its hollow. These idle beats happen every 6–12 s.
- **Care without cruelty.** A scarred Friend walks slightly lopsided in the Hub (a 3 % sway per 10 % missing) and perks up with a hop when mended. It never gets sick, dies or runs away. Warmth copy: "it's healing", "someone stitched its ear".
- **Guests** get the same pet warmth with their loaner, and the "bring your own friend" CTA frames ownership as "a Friend that remembers you".
