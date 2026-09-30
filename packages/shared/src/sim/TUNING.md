# Pixel Life sim — tuning

Every gameplay constant of the deterministic sim lives in [`tuning.ts`](./tuning.ts) and is listed here with its unit,
its source and the reason for any change from the GDD. `tuning.test.ts` fails if a constant is added to `tuning.ts`
without a row here.

**Changing any value changes run hashes.** In the same PR: bump `SIM_VERSION` in `sim.ts`, regenerate the golden corpus
(`PL_REGEN_GOLDEN=1 npx vitest run packages/shared/src/sim/golden.test.ts`, then `npx prettier --write
packages/shared/src/sim/golden-corpus.json`), re-run the balance report, and say why in the PR.

Units: **u** = one sprite pixel = one voxel; **ticks** at 60 Hz (`sec(s)` = `round(60·s)`); integer angles are
0..4095 (4096 = one turn, 0 = +x, 1024 = +z toward the camera); fling power is 0..1023.

## Friend body and fling (GDD §2.1–§2.3)

| Constant                     | Value        | Unit      | Source / note                                                                                                                                  |
| ---------------------------- | ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `DT`                         | 1/60         | s         | Fixed step (architecture §3).                                                                                                                  |
| `V_MAX`                      | 70           | u/s       | GDD §2.3, launch speed at p = 1, m = 70.                                                                                                       |
| `M_REF`                      | 70           | px        | GDD §2.1 reference mass.                                                                                                                       |
| `MASS_FACTOR_MIN` / `MAX`    | 0.8 / 1.35   | ×         | GDD §2.3 clamp of √(M_REF/m).                                                                                                                  |
| `MIN_POW`                    | 82           | 0..1023   | GDD §2.3 "p < 0.08 cancels" (82/1023 = 0.080).                                                                                                 |
| `DAMP_CONST` / `DAMP_LIN`    | 10 / 1.8     | u/s², 1/s | GDD §2.3 `dv/dt = −(10 + 1.8 v)`. Note: this law gives ≈ 30.8 u / 1.45 s for a 70 u/s fling (the GDD prose says ≈ 34 u / 1.6 s); the law wins. |
| `FLY_THRESHOLD`              | 14           | u/s       | GDD §2.2 FLYING ≥ 14 (weapon), PREY below.                                                                                                     |
| `READY_THRESHOLD`            | 30           | u/s       | GDD §2.2 can aim below 30.                                                                                                                     |
| `LAUNCH_COOLDOWN`            | 15           | ticks     | GDD §2.2, 250 ms.                                                                                                                              |
| `DROP_IN_LOCK`               | 72           | ticks     | GDD §2.8 drop-in: the Friend rains in for 1.2 s; flings before are ignored.                                                                    |
| `KILL_SPEED_KEEP`            | 0.9          | ×         | GDD §2.3 speed ×0.90 per pop (Hollow exempt).                                                                                                  |
| `KILL_DEFLECT`               | 0            | share     | Normal-velocity share removed on a pop. Tested 0.25–0.5: it only added ring-outs, so pops just slow.                                           |
| `COLLIDER_K` / `MIN` / `MAX` | 0.45 / 3 / 7 | ×, u      | GDD §2.1 `r = clamp(0.45·bboxW, 3, 7)`, re-measured on every pixel change.                                                                     |
| `BUMPER_RESTITUTION`         | 0.55         | –         | GDD §2.3 rock/rim bumpers (also unlit teeth).                                                                                                  |
| `STEER_ACCEL`                | 30           | u/s²      | Steer input (`k: 1`): a sweep nudge. Above damping so it moves; not in the GDD (input contract).                                               |
| `STEER_MAX_SPEED`            | 8            | u/s       | Steering stops accelerating here: always below FLY_THRESHOLD, so a sweep is never a weapon.                                                    |

## Pixel damage and loose pixels (GDD §2.5)

| Constant                              | Value     | Unit  | Source / note                                                                                                                     |
| ------------------------------------- | --------- | ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| `BITE_EXPOSURE_W`                     | 0.15      | –     | GDD §2.5 score = dot(dir, −a) + 0.15·exposure.                                                                                    |
| `GRAB_WINDOW`                         | 120       | ticks | GDD §2.5, 2.0 s.                                                                                                                  |
| `CLUTCH_LEFT`                         | 18        | ticks | GDD §2.5 clutch ≤ 0.3 s left.                                                                                                     |
| `PICKUP_DELAY`                        | 18        | ticks | Not in the GDD: a cube must pop off (0.3 s) before it can be swept, or every bite would self-heal.                                |
| `MAGNET_PREY` / `MAGNET_FLY`          | 3.0 / 4.5 | u     | GDD §2.5 magnet radii.                                                                                                            |
| `GRAB_BODY_K`                         | 0         | × r   | Share of the collider radius added to the magnet. Tuned 0.5 → 0.25 → 0: at 0 the average bot grabs back ≈ 71 % (GDD target 70 %). |
| `DEBRIS_SPEED_MIN` / `MAX`            | 8 / 14    | u/s   | GDD §2.5 impulse away from the attacker.                                                                                          |
| `DEBRIS_CONE`                         | 398       | angle | GDD §2.5 ±35° cone.                                                                                                               |
| `DEBRIS_UP_MIN` / `MAX`               | 3 / 7     | u/s   | Upward pop (ballistic height; the cube starts at its pixel's height on the body).                                                 |
| `GRAVITY`                             | 40        | u/s²  | Debris and ring-out fall.                                                                                                         |
| `DEBRIS_RESTITUTION`                  | 0.45      | –     | GDD §2.5.                                                                                                                         |
| `DEBRIS_FRICTION` / `DEBRIS_AIR_DRAG` | 8 / 1.5   | 1/s   | Chosen so a cube rests ≈ 0.6–1 s after popping, 4–8 u away (GDD "rests after ≈ 0.6 s").                                           |
| `DEBRIS_LOST_DEPTH`                   | −4        | u     | A cube that falls this far below the ground (off the edge) is lost.                                                               |
| `SNATCH_DROP_WINDOW`                  | 60        | ticks | GDD §3.5 fresh 1.0 s after hitting a carrying Snatch.                                                                             |
| `PTS_GRAB` / `PTS_CLUTCH`             | 5 / 25    | pts   | GDD §2.9 (a clutch grab scores 25 instead of 5).                                                                                  |

## Ring-out (GDD §2.6)

| Constant         | Value | Unit  | Source / note                                              |
| ---------------- | ----- | ----- | ---------------------------------------------------------- |
| `RINGOUT_MARGIN` | 1     | u     | GDD §2.3 centre more than 1 u off the island.              |
| `RINGOUT_FALL`   | 21    | ticks | GDD §2.6 0.35 s fall, then the pixels go.                  |
| `RINGOUT_PX`     | 3     | px    | GDD §2.6, chosen by the bite rule with a = fall direction. |
| `RESPAWN_AFTER`  | 60    | ticks | GDD §2.6 respawn at the centre after 1.0 s.                |
| `INVULN`         | 90    | ticks | GDD §2.6 1.5 s.                                            |
| `PTS_RINGOUT`    | −50   | pts   | GDD §2.9 (score never goes below 0).                       |

## Run, scoring, combos (GDD §2.8, §2.9)

| Constant                                                            | Value                    | Unit   | Source / note                                                                                   |
| ------------------------------------------------------------------- | ------------------------ | ------ | ----------------------------------------------------------------------------------------------- |
| `WAVE1_START` / `WAVE2_START` / `FRENZY_START` / `LAST_LIGHT_START` | 150 / 1200 / 2400 / 3300 | ticks  | GDD §2.8 phases (2.5 / 20 / 40 / 55 s).                                                         |
| `PTS_SURVIVAL`                                                      | 300                      | pts    | GDD §2.9 `round(300 × kept / start)`, safety stitches count as kept.                            |
| `PTS_FLAWLESS`                                                      | 500                      | pts    | GDD §2.9, no pixel lost this run.                                                               |
| `COMBO_CAP`                                                         | 8                        | ×      | GDD §2.9 combo = kills in the fling, cap ×8.                                                    |
| `CHAIN_BASE` / `CHAIN_STEP` / `CHAIN_CAP`                           | 10 / 1 / 20              | tenths | GDD §2.9 chain ×1.0, +0.1 per killing fling, cap ×2.0; a bite, a ring-out or a whiff resets it. |

Pop points = `round(value × combo × chain × (1.5 in Last Light) × (2 for a Pogo air pop))`, computed in integers.

## Spawning (GDD §3.9)

| Constant            | Value | Unit  | Source / note                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ----- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPAWN_STEP`        | 15    | ticks | GDD §3.9 bank tick every 0.25 s.                                                                                                                                                                                                                                                                                                  |
| `SPAWN_RIPPLE`      | 36    | ticks | GDD §3.9 0.6 s ground ripple (creature intangible meanwhile).                                                                                                                                                                                                                                                                     |
| `SPAWN_MIN_DIST`    | 12    | u     | GDD §3.9 slot valid ≥ 12 u from the Friend (and off Gulp's wedge).                                                                                                                                                                                                                                                                |
| `SPAWN_SLOTS`       | 12    | slots | GDD §3.9.                                                                                                                                                                                                                                                                                                                         |
| `SPAWN_SLOT_RADIUS` | 0.86  | × rim | Slots sit just inside the rim.                                                                                                                                                                                                                                                                                                    |
| `SPAWN_WINDOWS`     | table | –     | GDD §3.9 budget 0.8→1.4 / 1.6→2.4 / 3.0 per s, max alive 6 / 10 / 14, weights as tabled. The next kind is drawn by weight, then waits until the bank can pay for it (a pure "cheapest affordable first" reading starved every creature but Nib). The bank is capped at 6. Snatch needs a loose pixel; Clank ≤ 3, Slurp ≤ 1 alive. |

## Creatures (GDD §3)

`CREATURE_DEFS` (per kind): radius (u) / speed (u/s) / points / cost / hits / bite px / max alive —
Nib 2.2/9/10/1.0/1/1, Pogo 2.2/16/15/1.5/1/1, Clank 3.5/5/40/3.0/1/2 (≤ 3), Snatch 2.8/14/25/2.0/1/0,
Slurp 4.0/0/30/3.0/2/0 (≤ 1), Fizz 1.8/12/20/2.0/1/3. Sizes from the GDD sprite footprints; the rest from §3.1.
`NIB`…`FIZZ` (0..5) and `KIND_COUNT` (6) are the kind ids used in views and events.

| Constant                                                                                               | Value                                    | Source / note                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NIB_BOW`, `NIB_RANGE`, `NIB_HOP_BACK`, `NIB_HOP_TIME`, `NIB_WAIT`, `NIB_SPACING`                      | 27 t, 2 u, 3 u, 12 t, 72 t, 2 u          | GDD §3.2 bow 0.45 s, 2 u, hop back 3 u, wait 1.2 s, 2 u apart.                                                                                                                                        |
| `POGO_CROUCH`, `POGO_HOP`, `POGO_HOP_LEN`, `POGO_APEX`, `POGO_RANGE`, `POGO_HOPS_MIN`, `POGO_REST`     | 18 t, 36 t, 9.6 u, 3 u, 2.5 u, 3, 60 t   | GDD §3.3 crouch 0.3 s, 0.6 s hops at 16 u/s, 3–4 hops then a pounce within 2.5 u. Rest 1 s is ours.                                                                                                   |
| `CLANK_JAW`, `CLANK_RANGE`, `CLANK_TURN`, `CLANK_RECOVER`                                              | 36 t, 2.5 u, 17/tick, 60 t               | GDD §3.4 jaw 0.6 s, 2.5 u, 90°/s. Recovery 1 s is ours.                                                                                                                                               |
| `CLANK_PLATE_COS`, `CLANK_PLATE_RESTITUTION`, `CLANK_FRONT_HP`, `PTS_SHELL_CRACK`                      | 0.5, 0.8, 2400, 40                       | GDD §3.4 plate < 60° from facing, bounce 0.8 and −1 px unless m·v ≥ 2400 ("SHELL CRACK" +40).                                                                                                         |
| `SNATCH_SWOOP_TELEGRAPH`, `SNATCH_SWOOP_SPEED`, `SNATCH_HEIGHT`, `SNATCH_PICK_RADIUS`, `SNATCH_LEAVE`  | 24 t, 18 u/s, 4 u, 1.5 u, 480 t          | GDD §3.5 swoop line 0.4 s, hover 4 u, leaves after 8 s idle. Swoop speed and pick radius are ours.                                                                                                    |
| `SLURP_WAKE`, `SLURP_RANGE`, `SLURP_PERIOD`, `SLURP_TONGUE`, `SLURP_PUFF`, `SLURP_KNOCK`, `SLURP_SULK` | 14 u, 10 u, 180 t, 15 t, 42 t, 4 u, 90 t | GDD §3.6 exactly.                                                                                                                                                                                     |
| `SLURP_YANK_SPEED`                                                                                     | 19 u/s                                   | GDD §3.6 "pulls it 6 u": 19 u/s slides ≈ 6 u under damping.                                                                                                                                           |
| `FIZZ_TRIGGER`, `FIZZ_FUSE`, `FIZZ_FUSED_SPEED`, `FIZZ_BLAST`, `FIZZ_LAUNCH_FACTOR`, `FIZZ_DUD_SPEED`  | 6 u, 90 t, 6 u/s, 5 u, 1.2, 6 u/s        | GDD §3.7 fuse at 6 u for 1.5 s, 5 u blast (3 separate 1-px bites), launched at 1.2× the Friend's velocity. A banked Fizz never hurts the Friend that launched it (our call: "FIZZ BANK" is a reward). |
| `J_NIB`, `J_POGO`, `J_CLANK`, `J_FIZZ`                                                                 | 300, 350, 700, 1100                      | GDD §2.3 knockback impulse J / m; the GDD names J but gives no table, these are ours.                                                                                                                 |
| `FLEE_SPEED_MULT`                                                                                      | 1.2                                      | Last Light: creatures run to the rim at ×1.2 speed (≥ 6 u/s) and leave.                                                                                                                               |

## Old Gulp (GDD §3.8)

| Constant                                                                               | Value                          | Source / note                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GULP_RUMBLE`, `GULP_BITE`, `GULP_TEETH`, `GULP_INHALE`, `GULP_REGROW`                 | 2400, 2520, 2550, 3120, 3300 t | GDD §3.8 beats 40 / 42 / 42.5 / 52 / 55 s.                                                                                                                                                                                                                                                                                                  |
| `GULP_WEDGE_JITTER`                                                                    | ±256 (±22.5°)                  | Seeded offset from the Friend's side.                                                                                                                                                                                                                                                                                                       |
| `GULP_WEDGE_INNER`                                                                     | 0.4 × rim                      | **Deviation.** The GDD's 90° sector has its apex at the island centre; bitten out, it made the centre a knife edge and ≈ 90 % of all bot ring-outs happened there. Gulp now bites only the outer 60 % of the sector (≈ 21 % of the island instead of 25 %), leaving a new rim that faces the centre — "Gulp rests its chin on the new rim". |
| `TOOTH_SPREAD`                                                                         | 0.6 × half-angle               | Teeth stand on that new rim at the bisector and ±0.6 of the half-angle.                                                                                                                                                                                                                                                                     |
| `TOOTH_RADIUS`                                                                         | 3 u                            | Ours (2.5 tested: too hard to hit after deflections).                                                                                                                                                                                                                                                                                       |
| `TOOTH_HP`                                                                             | 1800 m·v                       | GDD §3.8. A lit-tooth hit rebounds like a bumper (otherwise every hit flew into the gap).                                                                                                                                                                                                                                                   |
| `MOUTH_RIM_SHARE`, `MOUTH_RADIUS`, `INHALE_ACCEL`                                      | 0.7 × rim, 3 u, 22 u/s²        | GDD §3.8 suction 22 u/s² toward the mouth; reaching it = eaten / ring-out.                                                                                                                                                                                                                                                                  |
| `PTS_TOOTH`, `PTS_CRUMB`, `PTS_BURP`, `CRUMBS_PER_TOOTH`, `CRUMB_TTL`, `CRUMB_SCATTER` | 100, 20, 500, 6, 180 t, 5 u    | GDD §3.8: +100 per tooth, 6 star crumbs worth +20 each (swept like pixels, 3 s), burp +500.                                                                                                                                                                                                                                                 |
| `GULP_MOODS`                                                                           | table                          | Hungry (weight 2): 90° wedge, teeth lit 3 s, inhale 2 s; Sleepy (1): 54° (15 %), 4 s, inhale only if no tooth hit; Grumpy (1): 90°, 2.2 s, inhale 3 s. GDD §3.8. Mood, jitter and tooth order come from Gulp's own PRNG stream (seed only).                                                                                                 |

## Family traits (GDD §4) — `traits.ts` maps familyId → these

| Constant                                                                                 | Value                                   | Source / note                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GRAB_WINDOW_SKELETON`, `SKELETON_CRAWL`                                                 | 180 t, 4 u/s                            | Skeleton · Reassemble: GDD exactly.                                                                                                                                                                                                      |
| `PARRY_WINDOW`, `PARRY_MIN_POW`, `PARRY_STUN`, `PTS_PARRY`                               | 12 t, 307, 90 t, 50                     | Mask · Parry: fling (p ≥ 0.3) released ≤ 200 ms before a Nib/Pogo/Clank bite lands, from within the bite's reach.                                                                                                                        |
| `HUDDLE_MAGNET_MULT`, `HUDDLE_DRIFT_RADIUS`, `HUDDLE_DRIFT_SPEED`                        | ×2, 9 u, 2 u/s                          | Family · Huddle: GDD exactly.                                                                                                                                                                                                            |
| `MITOSIS_MIN_POW`, `MITOSIS_SPREAD`, `MITOSIS_MERGE_DELAY`, `MITOSIS_PULL_SPEED`         | 921 (p ≥ 0.9), ±114 (10°), 30 t, 40 u/s | Cellular · Mitosis. **Tuned** from GDD p ≥ 0.85 / 0.8 s / 30 u/s: Cellular lost ≈ 2× the pixels of other families. Halves pull together kinematically (they stay PREY).                                                                  |
| `HOOK_ANGLE`, `HOOK_PATH_SHARE`                                                          | 284 (25°), 0.6                          | Asymmetry · Hook: bends over the first 60 % of the predicted slide; heavy side = more unmirrored pixels (mirrored about the 16-px sprite centre); ties → right (the GDD's odd-tokenId rule needs the token id, which `SimConfig` lacks). |
| `GLIDE_DAMP_MULT`, `HOVER_TIME`, `HOVER_PUSH`                                            | 0.8, 60 t, 20 u/s²                      | Hoverer · Glide. **Tuned** damping ×0.6 → ×0.8: at 0.6 the lightest Friend slid across the whole island and scored −36 %.                                                                                                                |
| `QUAKE_MIN_POW`, `QUAKE_RADIUS`, `QUAKE_STUN`                                            | 716 (p ≥ 0.7), 7 u, 60 t                | Colossus · Quake: GDD exactly.                                                                                                                                                                                                           |
| `TRAIL_TTL`, `TRAIL_HALF_WIDTH`, `TRAIL_SAMPLE`, `TRAIL_PIXEL_BONUS`, `TRAIL_MAX_POINTS` | 90 t, 1 u, 3 t, 60 t, 40                | Sparkling · Spark Trail: GDD 1.5 s, width 2 u, +1 s once per pixel. Sampling is ours.                                                                                                                                                    |
| (Hollow · Pierce)                                                                        | —                                       | `pierce` flag: no ×0.9 per pop; passes through.                                                                                                                                                                                          |

## Islands (GDD §9.3)

`ARENAS`: `meadow` 36×24 semi-axes, 8 bumpers · `pond` 36×26, central pond 9×6 (Friend damping ×`POND_DAMP_MULT` = 0.5,
loose pixels +`POND_PIXEL_BONUS` = 30 ticks) · `dusk` 34×23, Snatch weight ×2 · `snow` 35×24, wind 4 u/s² re-aimed every
`WIND_PERIOD` = 600 ticks · `ink` 36×24, 4 bumpers. `scoreMult` (1.0–1.6) is reported for Quick Runs; the sim score is
never multiplied. `ISLAND_VERTICES` = 64 polygon vertices; `BUMPER_RADIUS` = 2.2 u at `BUMPER_RIM` = 0.97 × rim.

## Balance (bot sim, GDD §9.7)

`npx tsx packages/shared/src/sim/scripts/balance.ts 60` — 60 seeded runs × 9 families (one real Friend per family from
`friends.json`) × 3 profiles on Meadow; deterministic. Profiles: novice ±30° aim / 400 ms reaction, average ±12° /
250 ms, expert ±4° / 150 ms (GDD), each plus a drag-aim time of 500 / 300 / 150 ms; novices never steer-sweep.

| Metric (Meadow)         | Novice (target) | Average (target) | Expert (target) |
| ----------------------- | --------------- | ---------------- | --------------- |
| px lost persisted / run | 8.6 (9)         | 5.6 (5)          | 4.8 (1–2)       |
| grab-back rate          | 72 % (45 %)     | 71 % (70 %)      | 84 % (92 %)     |
| Crumble rate            | 2.6 % (< 8 %)   | 0.2 % (< 2 %)    | 0.2 % (0 %)     |
| Gulp burped             | 3 % (10 %)      | 23 % (45 %)      | 41 % (90 %)     |
| score (mean)            | 2 027 (1 200)   | 2 497 (3 000)    | 2 712 (6 500)   |
| ring-outs / run         | 1.08            | 1.14             | 0.91            |

The pixel economy (average ≈ 5 px/run at ≈ 70 % grab-back, tokenomics' "median 5 px per run") is on target.
Known gaps, not fixable by constants alone: the bots barely separate on score (creature supply caps pops at ≈ 50–55
per run for everyone; the GDD's 6 500 expert score needs long combos the bot does not plan), experts still lose ≈ 3 px
per run to ring-outs on failed tooth attempts, and light families (Hoverer 42 px, Hollow 44 px) cannot reach the
m·v thresholds of teeth (1 800) or Clank plates (2 400), so they sit 18–30 % below the median score (GDD target
±8 %). Proposed fix for design: scale `TOOTH_HP` / `CLANK_FRONT_HP` with √(m / M_REF), or cap them at the
lightest Friend's reachable momentum.
