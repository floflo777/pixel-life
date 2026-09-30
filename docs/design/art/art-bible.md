# Pixel Life: art bible (v1, 2026-09-30)

Style frames: `style.html?f=1|2|3` (self-contained, three.js 0.160 from jsDelivr). Renders: `frame1.png` (in-run bite), `frame2.png` (Sky Hub plaza), `frame3.png` (1-bit handheld). Source: `work/src.html` + `work/build.py` (injects the real `friends.json` sprites). Every number below is the value used in those frames, so engineering can lift it directly.

---

## 0. Visual thesis

**"A paper sky and an ink Friend: every Friend is its own 16×16 sprite as a lit ink sculpture, set on pastel islands drawn the way the Rare Friends site draws them. Dither in place of gradients, hard edges in place of blur, and lime only when something needs a tap right now."**

The test for any asset: *if you squint, is the Friend still its on-chain sprite, and is the ink shape the most important thing on screen?*

---

## 1. Palette

### 1.1 Tokens (hex values are exact: colour management is off, and lit colours come from ramps, not from lighting maths)

| Token | Hex | Role | Never |
|---|---|---|---|
| `ink` | `#111111` | outlines, keylines, UI text, 1-bit ink | a large world fill (except Friends) |
| `body` | `#1D1B24` | Friend voxel front faces (a hair warmer than ink, so the bevel and shade still read) | anything that isn't a Friend |
| `paper` | `#EEEEEE` | UI surfaces, the sky's lowest band, the Friend halo, missing-pixel slots | shadows |
| `halo` | `#F4F2EA` | default Friend halo (warm paper) | |
| `signal` | `#CCFF00` | **act now only**: loose-pixel brackets, the sweep timer, the venue doormat, `▶ play`, the `you` tag, chain multiplier | decoration, fills, backgrounds, text on paper without an ink backing |
| `meadow` | `#B9D984` (+ `#C9E39C` checker, `#9CC56C` drip, `#86B05A` tufts) | island tops | creatures |
| `pond` | `#7DB4DB` (+ `#9EC8E4`, `#C5DEEA`, `#E6EEEE` sky ramp) | sky, water, Slurp | |
| `sun` | `#F2CE68` | plaza rim, venue trim, canopies, Pogo | Gold Pixels |
| `gold` | `#E8B530` (+ spec `#FFF8E4`) | **Gold Pixels only** | anything else, ever |
| `coral` | `#ED927E` (+ `#D67A68`) | cliff strata, roofs, benches, scar dotted outline, stitches, Nib, Snatch beak, "−px" callouts | |
| `lilac` | `#B3A0D8` (+ `#8F7BBD`) | deep underside strata, Snatch, Slurp tongue, streak tier 14–29 | the sky (A's pink/lilac drift is banned) |
| `tile` | `#E6E1D2` | plaza checker partner of paper | |
| `trunk` | `#3A3140` | trunks, lamp posts | |

**Shade ramp (one rule for every lit material):** `shade = base × (0.55, 0.56, 0.76)` (a cool lilac multiply), `deep = shade × 0.74`, `light = mix(base, #FFF8E4, 0.26–0.75)`. Ink stays ink in shadow. Shadows are **never grey and never black**. They are the base colour pushed toward lilac.

### 1.2 Light and dark
- **Light (default):** as above. The page chrome around the canvas is `paper` with `ink` 2 px borders.
- **Dark = the site's "invert" ("the LCD's other mode"):** UI cards flip to `ink` fill with `paper` text and `paper` 2 px hard shadows. Lime is unchanged. The world is **not** darkened by the theme. Night is a biome, not a theme.
- **Dusk island (biome):** sky ramp `#2B2840 → #4A4368 → #7A6A9E → #B3A0D8`, `shadeMul (0.42, 0.40, 0.62)`, halos and loose pixels become the brightest things on screen (+30 % bloom). It is still pastel and never a "dark dungeon".

### 1.3 How we stay on-brand without joining the 60 % lime-on-black crowd
1. **The base is paper, not black.** The brand is literally ink *and* paper. We lead with the paper side plus their own `GAME_PALETTE` pastels, which only the organiser's own art uses (the fishing terrain and the create-page trees).
2. **Lime is a verb, not a colour scheme.** It covers at most about 1.5 % of screen pixels per frame, and every lime pixel means "tap/grab/enter now". Count them: in frame 1, the brackets, the sweep bar and the "grab" pill; in frame 2, the doormat, the door pill, `▶ play`, `you` and `tap`.
3. **The Friend is the only large ink mass** in the world. Everything else is pastel with ink keylines, which makes the Friend the figure and the world the ground.
4. **Their construction language, but in 3D:** hard offset shadows, radius 0, Bayer dither in place of gradients, stepped motion, Silkscreen, grid dots. We don't imitate their 2D look. We made a renderer that produces it.

---

## 2. The voxel Friend (rendering spec)

**Source:** on-chain frame 0 (Colossus: frame 16, mirrored to face left). One `#` = one voxel.

| Property | Spec |
|---|---|
| Extrusion | **Front-face extrusion only**: every pixel is a box `1 × 1 × 1.5` (w × h × depth) in sprite units, all at the same depth. No visual hull, no side sculpting, no smoothing. It is a stamped ink plate. |
| Orientation | The front face is always ≤ 20° off the camera's view vector. The body is pitched back by the camera pitch (in-run: `rot.x = −pitch`). Yaw is locked, and tumble is roll-only (±25°, GDD §2.1). |
| Front face colour | `body #1D1B24`, in the flat "base" band. It gets **no** lighting gradient, so the sprite reads as its 2D art. |
| Bevel | 1 render-px `light` strip on the **top edge of every exposed-top voxel** and a half-strength strip on exposed-left edges (sun from the upper left). It comes from a per-instance `aEdge` (top, right, bottom, left exposed). Inner seams get nothing, so the silhouette stays one shape. |
| Side faces | Band shading: the left side goes to `base`, the right side to `shade`. They are visible only as a sliver. |
| Crease lines | **Suppressed inside the Friend mask** (they turn the plate into stacked bars). Only the depth-edge silhouette line is kept. |
| Halo | Screen-space post: `mask dilate` gives a **2 render-px halo** (1 in the Hub at distance) plus a **1 render-px ink keyline**. It matches the brand's "canonical Friend with white halo". The halo colour comes from the mask pass, so **streak tiers tint it** (paper, then sun, coral, lilac, then gold-white dither animated at 2 fps). |
| Holes / eyes | **Small enclosed holes (≤ 4 cells) get a paper back-plate** (`#F3EAD0`) at the back face, so eyes and mouths read as paper, exactly like the 2D art, and stay stable at any angle. Larger enclosed areas (Hollow's body, Hoverer's ring) stay see-through, and the halo rings them. **Eye glow** is an event, not a constant: the back-plate goes to `#FFF1C2` with `0x6E6040` dithered bloom for blinks (120 ms), crits, the streak 30+ tier and Dusk. It is off by default (a constant glow smeared the face in tests). |
| Minimum size | **A sprite pixel must be ≥ 3 render px (≥ 6 CSS px at pixel-scale 2).** So in-run the Friend is ≥ 120 px tall, and in the Hub ≥ 96 px. Below that, holes collapse and the Friend reads as a blob. We tested this: frame 2 v1 at 1.9 render px per pixel failed. The Hub camera and Friend scale (0.15 u per pixel) follow from this rule. |

### 2.1 Pixel states (one look in 3D, in 2D cards and in 1-bit)

| State | 3D | 2D card / silhouette | 1-bit (128×128) |
|---|---|---|---|
| **Present** | ink voxel | ink square | ink |
| **Loose (≤ 2 s to grab)** | the voxel itself, tumbling, still in the Friend mask (keeps its halo) + **4-corner lime brackets** (ink-backed, 1 + 2 px) | lime square with an ink dotted rim | 2×2 ink + blinking 4-corner brackets |
| **Scar (lost)** | the slot is a flush `paper` plate with a **coral 2-px dashed rim** (GDD: coral dotted, never black). The halo treats it as body, so the silhouette stays intact and the hole reads. | paper + coral dots | paper + ink dotted rim, dots on alternate frames |
| **Healing (regrowing)** | a scar plate + a **half-size ink cube** set back in the slot, growing in 4 steps (25/50/75/100 %) | coral dots + a centred ink block | paper + a centred ink dot |
| **Gold Pixel (worn)** | voxel in `gold #E8B530`, `lightMix 0.75` so its bevel and top go almost white (a 2-step specular), **dithered bloom** in `#F2CE68` (radius 5 render px), plus a 4-point pixel sparkle (3 px arms) every 1.2 s, stepped | gold square | ink square + an orbiting 1-px spark (2 fps) |
| **Glow crack (1 to 3)** | an ink zig-zag decal on the gold front face (stage 1 hairline, 2 split, 3 dull: bloom 100 → 60 → 0 %) | gold + a 1 px ink line | spark stops at stage 3 |
| **Mended (stitched)** | ink voxel + a **coral cross-stitch decal** (X plus 4 tick marks crossing into the neighbours, paper centre knot). The mender's colour can replace coral (sun, pond or lilac). | ink square with a coral inner ring | ink + a 1 px paper centre dot |
| **Sprout/regrow VFX** | a paper voxel pops in at 0.5 scale, 2 steps, and flips to ink | | |

The on-chain art is never altered. "Whole" means exactly the canonical sprite.

---

## 3. Lighting and post (the renderer that gives us the look)

The pipeline runs at **pixel-scale 2** (640×360 internal for 1280×720; on phones, internal height = `round(cssH / 2.25)`), with nearest-neighbour upscaling and four passes:

1. **Colour:** `MeshLambertMaterial` patched with `onBeforeCompile` into a **banded ramp**. Irradiance is computed as `lum = (directDiffuse + indirectDiffuse) / (albedo/π)`, then Bayer 4×4 dither (amplitude 0.12) is added, then the value is quantised: `< 0.30 deep`, `< 0.52 shade`, `> 1.22 light` (bevels and gold only), else `base`. Lights: ambient 0.44 white, sun 0.72 white from `(−4, 8, 3.5)`. **Tint lives in the ramps, not in the lights.** So flat top faces sit exactly at the palette hex, which is the pastel flat-fill look of the brand's SVGs.
2. **Normal pass** (override `MeshNormalMaterial`) for crease lines.
3. **Mask pass:** Friends in their halo colour, everything else black (with depth, so occlusion is correct).
4. **Glow pass:** glow colour per object (gold, lamps, the sign's popping pixel), everything else black.
5. **Post (one full-screen shader):**
   - **Sky:** from view direction; a 5-colour pond-to-paper ramp with **dithered transitions only at band edges** (solid bands, 2.6× compressed Bayer zones). No gradients anywhere.
   - **Fog:** linear depth, 3 stepped levels × Bayer, 80 % toward `#E4EEF0`. Distant islands dither into the sky instead of blurring.
   - **Outline:** depth edge `d0 − dn > 0.035·dn + 0.03` draws 1 render-px `ink` **outside** the silhouette (it never eats Friend pixels). Crease: normal Δ > 0.45 at similar depth, mixed 50 % ink, **skipped inside the Friend mask**. Outlines fade with fog.
   - **Halo:** as in §2.
   - **Dithered bloom:** an 11×11 kernel on the glow buffer. Where `a > bayer` the pixel mixes 55 % toward the glow colour, and where `a > bayer + 0.9` it goes to cream. The result is halos made of dots, never blur.
   - **Impact burst (pops):** a local 9-point star (radius 11 → 26 render px, pow 1.6 falloff) in which the image becomes **1-bit inverted** (threshold 0.5 ± dither), with a 2 px ink rim. The full-frame 1-bit impact (GDD §2.7) uses the same code with an infinite radius.
- **Shadows:** `BasicShadowMap` (hard, unfiltered), 2048 in the frames, 1024 on phones. The shadow is just the `shade` band, so it is dithered and lilac-tinted on its edge, never black and never soft. Terrain shadows are baked once. Only Friends, creatures and pixels update each frame.
- **AO:** none at runtime. Contact is sold by the hard shadow plus the keyline. Optionally, vertex-darken the island's first cliff row by 1 band.
- **Posterise:** implicit (every material resolves to base, shade, deep or light). No extra pass.

### 3.1 Camera
- **In-run default:** perspective FOV 28–30°, **pitch 32°** (the GDD's 38° hides the sky and flattens the plate; 32° keeps a sliver of dithered horizon and islands, and the rim stays in frame). Framing and follow as in GDD §2.4.
- **Bite slow-mo dip (frame 1):** during the 0.3× slow-mo, the camera eases (the only eased thing, in 4 stepped keys) to **pitch ≈ 18° (frame 1: 17°), −8 % distance**, and returns over the 160 ms speed ramp. This is the "hero shot" people clip. Reduced motion disables it.
- **Hub:** FOV 30°, pitch 28–34° (frame 2: 28°), distance so that 0.15 u sprite pixels ≥ 3 render px. It follows the player at 4/s with a dead-zone of ¼ of the screen.
- **No camera roll** except shake (GDD).

---

## 4. Island and world kit

- **Grid:** world cell = 2 sprite pixels (0.24 u in the frames), so Friends and world share one pixel rhythm.
- **Island slab:** a noisy ellipse (value noise 0.34 + 0.08), **meadow top** with a sparse 2×2 `#C9E39C` checker patch (the brand's "dense checker over meadow"), grass tufts of 1–2 voxels in `#86B05A`/`#9CC56C`, and single-voxel flowers (coral, lilac, paper, sun). **Strata:** 1 coral + 1 coral-dark row (the brand's coral terrain edge), random meadow drips on the rim (45 %), then a lilac underside stepping down `2 + 0.9·edgeDist + noise` rows. The deepest 2 rows are lilac-dark, so each island hangs like a stalactite. Keep the top **flat** in play (bumps belong to props).
- **Water:** the top is lowered by 0.45 cell, `pond` with 10 % `#E8F2F6` glint voxels (the brand's "water with white dashes").
- **Trees:** a thin trunk (0.7 cell) + a blob canopy at 0.6 cell resolution in one of: paper `#F2EFE4` with sparse white checker (the brand's mono tree), meadow-dark, or sun. **One canopy colour per island side.** Max 3 trees on a play island, placed behind the action line.
- **Clouds:** paper `#F7F7F2` flat voxel slabs (1–3 cells high) with no shadows cast. They sit below and behind islands, and **never cross the play field**.
- **Background islands:** the same builder, R 4–9, 20–30 u away, fogged 2–3 steps. They act as silhouettes that hint at the Hub and other venues.
- **Biome deltas:** Pond (a central pond), Dusk (§1.2), Snow (paper top, pond-light strata, flake voxels on stepped 6 fps paths), **Ink** (the whole island rendered through the handheld path: 1-bit post, no hue). The Ink biome is the in-game proof of the handheld mode.
- **Kenney 1-bit pack (CC0):** used as **2D glyph/decal source only** (UI icons, notice-board pictograms, bestiary frames) and as extrusion sources for props (a 16×16 tile extruded exactly like a Friend gives a matching prop). Never as flat cutouts in the 3D world.

### 4.1 Hub and venue kit (the Sky, Club Penguin–style)
- **Plaza:** a round paper/`#E6E1D2` 2×2 checker floor (reads as "the site's construction grid" at walking scale), a 1-cell **sun rim**, paths in the same checker. 4 lamp posts (ink posts, cream lamp voxel with a small dithered glow), coral benches with ink legs. There is room for 40 Friends: the floor is ≥ 70 % empty at rest.
- **Venue building = a door you can read from across the plaza:**
  1. A paper hall with ink plinth, coral stepped roof and coral-dark corner posts.
  2. **A sign: the venue's icon built as a 16×16 extruded sprite** on a paper board above the roof. Pixel Life's sign is the Mask Friend with its right arm-pixel **popping out**, the only lime glow on the building.
  3. An **inverted marquee card** (ink fill, paper Silkscreen, 2 px paper hard shadow) with the venue name.
  4. A dark doorway, a **lime doormat** (the only lime floor in the world = "walk here to enter") and a lime pill: `● 6 playing · enter`.
  - Every venue follows the same 4 parts, so community venues inherit the look by swapping the 16×16 icon, roof colour and name.
- **Other plaza landmarks:** **Daily Stone** (an ink-framed paper board with sun/lilac/coral top-3 bars and a live countdown), **Greenhouse** (a paper booth with a sun/paper checker awning and a rotating Gold Pixel crown), **Mend Well** (a pond ring with floating paper bubbles, each holding a scarred Friend's 2D silhouette), and bridges (alternating coral/coral-dark planks with ink posts, a gentle sag).
- **No "coming soon" scaffolds** (GDD §11). Unshipped isles simply don't exist yet.
- **Friends in the Hub:** real state everywhere (scars, gold, stitches, streak-tinted halo, belt band on the waist row). **Name tags go under the feet** (Club Penguin placement, which keeps heads and emotes clear): paper, 2 px ink border, 2 px hard shadow, Silkscreen 10 px `#tokenId` + a mono 10 px lowercase status line. **Your** tag is ink with lime text, plus a lime ellipse of dots under your feet. **Emote bubbles** sit above the head: paper, ink border, ink tail, Silkscreen 12 px, one glyph or word.
- **Tag LOD:** a full tag within 8 u of you or on hover/tap, `#id` only up to 16 u, nothing beyond. At most 12 tags visible. Emotes always show.
- **Hub HUD:** your card top-left (live silhouette + px + heal timer), place and balance top-right, emote row + a big **lime `▶ play`** bottom-centre (bottom-left and bottom-right 72 px corners stay clear for the SDK toolbar and menu).
- **Home isles (the igloo):** the same island builder at R 6–10 with generation terraces (1 extra slab per generation step, each 1 row higher and 20 % smaller), a tier flag, a gold rim (a 1-cell `gold` rim + bloom) for gold wearers, and ≤ 12 props from the kit.

---

## 5. The creature cast: the Munchies (aligned with `design/gdd.md` §3)

**AD override of the GDD's "ink bodies + one pastel accent":** Munchies have **pastel bodies with ink features**. They are the *inverse* of the Friend (ink body, paper features). This is the readability rule of the whole game: **ink = Friend = precious; pastel = Munchie = smashable; paper = light/UI.** The frames show why: an ink Nib beside an ink Friend is one blob at 24 px, while a coral Nib pops. Each creature also keeps a unique silhouette category, so the 1-bit mode (where colour vanishes) still works. There, **Munchies render as paper bodies with an ink keyline and dithered fill**, and Friends stay solid ink.

Volume rule: Munchies are **pillowed** (their depth grows with distance from the sprite edge, `1 + 2·(d−1)` voxels, capped at 3). They are rounded toys. The Friend is a flat stamped plate. Shape alone says who is who.

| Munchie | Silhouette | Body / accent | Face | Signature pose / telegraph | 1-bit |
|---|---|---|---|---|---|
| **Nib** (frame 1) | round | coral / paper teeth | 2×2 paper eyes with ink pupils, ink mouth with 2 paper teeth, tiny ink feet | the **bow**: whole-body 20° dip in 2 steps | paper blob + 2 teeth |
| **Pogo** | legs | sun / ink knees | 1 big paper eye | crouch: legs compress 3→1 voxel | 2 long stick legs |
| **Clank** | dome | lilac shell / **pond front plate** with a paper rivet row | eyes above the plate | jaw open: plate splits 2 voxels | dome + solid plate |
| **Snatch** (frame 1) | wings | lilac / **coral beak** | paper eyes | swoop: wings fold to a 3-voxel dart, 0.4 s dotted swoop line on the ground | "M" wings |
| **Slurp** (frame 1) | wide | pond (+ `#5F95BF` feet) / **lilac tongue** | half-lidded paper eyes, ink mouth line | cheek puff: +2 voxels each side; the tongue is a lilac voxel ribbon that arcs to its target | wide bar + dotted tongue |
| **Fizz** | spiky | paper / **sun fuse spark** | ink dot eyes | fuse blink 4→12 Hz, stepped, spark voxel bloom | spiky ball, inverting spark |
| **Old Gulp** | whale (event) | paper cloud voxels, ink outline / sun-lit teeth | one 3×3 ink eye, slow 2-step blink | rises from the cloud sea behind a dithered shadow wedge | paper whale + ink keyline |

- **Sizes** (sprite px): Nib 12×11, Snatch 16×9, Slurp 18×9, Pogo 8×12, Clank 12×9, Fizz 8×8, Gulp 48×20. On screen ≥ 24 px (GDD).
- **Coral collision (GDD Q7):** scars use **coral dotted on paper**, while Nib and Snatch's beak use coral *solid*. Dotted versus solid carries the meaning. Scars also only appear inside a Friend's halo, so the two never touch.
- Death: 6–10 pastel voxel shards (the creature's colours + paper), stepped fall, gone in 0.5 s. No gore, no dark.

---

## 6. UI kit

- **Type:** display **Silkscreen** 400/700 at multiples of 8 px where possible (11, 12, 14, 22, 26, 34 used in the frames). Body: **Archivo Variable** (wdth 87.5 for dense copy). Labels and data: **Sometype Mono** 10–11 px, **lowercase**. Numbers are always Silkscreen 700.
- **Card:** `paper` fill, `2px solid ink`, **`4px 4px 0 ink`** hard shadow (6 px for modal/hero, 2 px for tags and pills), **radius 0**, 8 px grid padding. Inverted card = ink fill, paper text (timer, marquee, `you`).
- **Buttons:** a 44 px min hit target. Primary = **lime fill + ink border + ink text + 2 px shadow** (only for the one "now" action on screen). Secondary = paper card. Pressed = shadow 0 and translate(2px, 2px) (a stepped state, no transition).
- **Pills:** lime pill = urgent tag (`4 loose · grab!`, `tap`, `● 6 playing · enter`).
- **HUD (in-run):** score card top-left (`score` label, Silkscreen 26 px value, `chain ×3` in an ink chip with lime text), **timer top-centre as an inverted card**, **Friend card top-right** (GDD §6.3: a live 16×16 silhouette at 4× in an ink frame, `76/82 px` as the health readout, lime grab pill), **sweep-back bar bottom-centre**: 10 blocks that empty one per 0.2 s (stepped), lime while ≥ 1 loose pixel exists. Callouts are Silkscreen 700 with a 2 px ink outline and a 3 px hard shadow: coral for `−N px`, paper for points, lime for `edge!`/`clutch`.
- **Hub:** §4.1. **Results card:** paper card with the Friend's 16×16 silhouette at 8× (scars in coral dots), a big score and a stepped iris transition.
- **Grid dots** (`#B0B0B0` 2 px every 16 px) are allowed only on "construction" surfaces: menus, the handheld page, the bestiary.

## 7. Motion rules

| Layer | Rule |
|---|---|
| UI | **States flip, nothing eases** (`steps(1,end)`). Bars fill block by block, numbers count in 4 steps, cards appear in 2 frames (50 % → 100 % via a dither mask). |
| Presentation animation (idles, emotes, creature cycles, sparkles, flags) | **Stepped at 12 fps** (Munchie idles 2 frames at 6 fps; emotes 6–10 frames). |
| Simulation (fling, tumble, flying pixels) | Continuous physics at 60 Hz. That's the *feel*. Poses are sampled from it; they aren't easing curves. |
| Camera | Follow is a damped lerp (the only smoothing). The slow-mo dip uses 4 keys. Shake noise is stepped at 24 Hz (GDD). |
| Hit-stop | Pop 50 ms, combo 80 ms, bite 90 ms, Clank/tooth 120 ms, Gulp 200 ms (GDD §2.7). During hit-stop the frame **holds** and only the impact burst and callouts update. |
| Squash/stretch | Along velocity: 1.08 × 0.93 at fling speed, 0.85 × 1.15 for 2 frames on wall contact, back in 2 steps. |
| Speed lines | 6 ink dashes (2 px, a 3-on/1-off pattern) behind the Friend along −velocity, only while FLYING. Frame 1 replaced dithered afterimages, which read as dirt. |
| Reduced motion | No shake, no dip, no speed lines; hit-stop kept; impacts become a 1-frame 2 px ink border (GDD). |

## 8. VFX list (every one pixel-grid aligned, no additive blur)

1. **Pop burst:** the local 1-bit inverted 9-point star (§3) + 6–10 pastel shards.
2. **Bite:** the lost voxels detach with their halo, get lime brackets and tumble; the slow-mo dip starts; `−N px` in coral.
3. **Full-frame impact:** the whole frame in 1-bit, inverted on frame 2 (≤ 1 per 600 ms).
4. **Grab-back:** the pixel snaps home in 3 steps along a straight line, a paper ring pops (2 frames), `+1 px`.
5. **Lost to the edge:** the pixel falls through fog steps and crumbles into 4 paper dots.
6. **Snatch carry:** a pixel under the beak; bracket stays lime and the timer freezes (bar blinks).
7. **Slurp tongue:** a lilac voxel ribbon arcs to the target (3 frames out, 2 back).
8. **Gold glance:** 3 gold sparks + a crack decal step.
9. **Regrow/Mend:** stitched voxels arc from mender to target (1.0 s, stepped), the coral stitch decal draws itself in 4 frames, and both Friends heart-emote.
10. **Sprout:** a paper voxel pops to half size, then to ink.
11. **Streak halo tiers:** halo colour; 30+ = a gold-white dither animated at 2 fps.
12. **Dithered bloom:** gold, lamps, venue sign pixel, eye-glow events.
13. **Gulp shadow wedge:** Bayer 25 → 75 % darkening of the wedge over 2 s in 4 steps.
14. **Trajectory:** 3×3 ink dots with a paper centre, every 2nd sample (aim and the recent path).
15. **Dust:** paper voxels (0.06 u) at landings and Colossus stomps.
16. **Loose-pixel bracket:** 4 L-corners, 4 px arms, ink 3 px behind a 1 px lime line, blinking at 4 Hz for the last 0.6 s.

## 9. Handheld 1-bit 128×128 mode (frame 3)

- Two values only: `ink #111` and `paper #eee`. Shade = ordered Bayer 12/25/50/75 %. **No third colour.** "Now" = blink/brackets/inversion.
- **AD override on scale:** the Friend is drawn at **2× (32 px) in play** and 4× on the Tama/home screen, always on its canonical 16×16 grid. 1:1 (GDD §7) makes the Friend ⅛ of the screen and the creatures unreadable, whereas 2× matches the 3D game's Friend-to-island proportion (≈ 30 % of the island width). The sim projection stays at 1.5 px/u; only the sprite blits scale.
- **Halo:** 1 px paper + 1 px ink keyline, computed in screen pixels (a 3×3 dilate, then a 4-neighbour keyline). This avoids the boxy look of a sprite-space halo.
- **Scars:** paper; at 4× they get an ink dotted rim. **Loose:** 2×2 ink + 4-corner brackets (blink). **Munchies:** paper bodies with ink keylines (inverse of Friends), 2×.
- **Island:** an ellipse top in paper with grid dots every 8 px, then 50 % / 75 % / 100 % dithered strata stepping down to a tapered underside.
- **Top bar** (y 0–8) inverted: `77/82PX`, 10 time blocks, `0:41`. **Bottom bar** (y 119–127) inverted: `GRAB 4` · `+120`. The font is our 3×5 (4 px advance).
- **Impact:** a full-screen inversion for 1 frame + an inverted 9-point starburst ring + a `BONK!` chip.
- **Home (Tama):** the Friend at 4× in a paper window on a 12 % dither field, `SCARS HEAL 4 PX · 3H`, and an inverted `REGROW 2 RF` button.
- Integer upscale only (×3/×4), nearest, 30 fps; slow-mo = 15 fps stepping.

## 10. Performance budget (mid-range phone: Snapdragon 7-series / Apple A13, 60 fps)

| Item | Budget |
|---|---|
| Internal resolution | ≤ 640×360 landscape / 360×640 portrait (pixel-scale 2–3); low tier drops to 480×270 plus the pixel-scale 3 look (still on-style) |
| GPU frame | ≤ 8 ms at the internal resolution (headroom for thermal) |
| Passes | Ship as **2**: an MRT pass (colour + mask + glow via `drawBuffers`) with normals reconstructed from depth derivatives, then the post pass. The style frames use 4 for clarity. |
| Post | Halo dilate by a separable 2-pass (5 taps) or jump-flood instead of 9×9 loops. Bloom on a ¼-res glow buffer with a 3×3 kernel, then dithered upscale. |
| Draw calls | ≤ 60 in-run, ≤ 120 in the Hub |
| Geometry | Static terrain **greedy-meshed** into 1 mesh per island (≈ 8–15k tris). Friend: 1 InstancedMesh per material (≤ 256 voxels). Munchies ≤ 14 alive × ≤ 200 voxels, instanced per type. Total ≤ 150k tris. |
| Hub | 40 Friends × ≤ 100 voxels as one InstancedMesh per material (pre-baked walk frames as instance-offset tables); DOM tags pooled, ≤ 12 visible |
| Shadows | 1024² `BasicShadowMap`, terrain baked once; dynamic casters only (Friend, Munchies, pixels) |
| Textures | none except 16×16 decal atlases (stitch, crack, scar) and one 64×64 font atlas for world text |
| Memory | ≤ 120 MB JS heap + GPU; three.js tree-shaken ≤ 160 kB gz; total first load ≤ 1.2 MB before first fling (GDD: first input ≤ 3 s) |
| Fallback | No WebGL2 or < 30 fps for 3 s → the **handheld 1-bit renderer** at ×3 (same sim, zero shaders). The fallback is a feature. |

## 11. Answers to the GDD's art questions (§10.2)
1. **Depth 1.5 u:** yes (used here). Front face = `body` flat band. It reads at ≥ 6 CSS px per sprite pixel, so 48 px on a phone is too small for in-run. Use ≥ 96 px (≥ 120 px preferred). The 48 px silhouette in the HUD card is 2D and fine.
2. **Colossus:** mirrored side frame = its front. It's accepted: it reads as a quadruped in frame 2. In the Hub, scars on non-source frames show by pid coincidence plus a `−N` bandage badge on the tag when any are hidden.
3. **Hoverer orb / Hollow outline:** the screen-space halo handles disjoint islands and outlines natively (frame 2, right and centre-back). Large enclosed areas get no back-plate.
4. **Silhouettes:** §5. One pastel accent is **not** enough against an ink Friend at 24 px, hence pastel bodies.
5. **Old Gulp:** at ≥ 1.4× the island's short axis on screen, paper voxels with an ink keyline; the wedge reads as a Bayer shadow plus falling voxels, which holds in a 480 px GIF (dither survives GIF palettes; gradients don't).
6. **Impact style:** pure 1-bit invert (local burst on pops, full frame on big events). It is the LCD's other mode, on-brand, and cheap. The manga starburst shape is used as the burst mask.
7. **Palette:** lime = act now only (§1.3). Gold `#E8B530` + near-white spec + sparkle versus flat sun `#F2CE68`. Coral dotted versus solid (§5).
8. **Biomes/cloud sea:** §4. The cloud sea is the sky ramp below the horizon, stepped fog, and paper voxel clouds.
9. **Hub at 360 px:** tags under the feet, LOD (§4.1), 0.15 u/px Friends (≈ 5 Friends across a phone screen), and venue doors read by the lime mat plus the inverted marquee.
10. **Share card:** 1200×630 paper, the Friend at 8× 2D + a frame-1-style 3D render crop, an inverted marquee title, "on loan" = a diagonal ink ribbon with paper Silkscreen, never lime.
11. **Genesis 8×8:** render as 2×2 voxel blocks (the same 16×16 footprint), identical rules. Phase 2.
