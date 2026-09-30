/**
 * Bump Sumo tuning (GDD §11.8 B, concept B "Friend Sumo"). Every number the match reads lives here so balance passes
 * touch one file. Units: `u` = one sprite pixel (the Friend's voxel), time in ticks at `SUMO_HZ`, speeds in u/s.
 */

/** Fixed simulation rate (same as the flagship sim). */
export const SUMO_HZ = 60;
/** Seconds per tick. */
export const DT = 1 / SUMO_HZ;
/** Fighters in a match: the player (index 0) and three bot Friends. */
export const FIGHTERS = 4;
/** Rounds per match. All three are always played so every match lasts about the same (~60–90 s). */
export const ROUNDS = 3;

// ── Ring ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Ring radius at the start of each round (u). */
export const RING_R0 = 40;
/** Smallest radius the ring shrinks to (u). */
export const RING_MIN = 13;
/** Fight ticks before the ring starts shrinking (10 s). */
export const SHRINK_START = 600;
/** Shrink speed once it starts (u/s): 40 → 13 u in 15 s, so no round drags. */
export const SHRINK_RATE = 1.8;
/** Hard round limit (30 s of fighting): survivors are ranked by pixels, then by distance to the centre. */
export const ROUND_MAX = 1800;
/** Distance of the four start pads from the centre (u). */
export const PAD_RADIUS = 21;

// ── Phases ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** "Round n" card + "FIGHT!" (2 s, fighters frozen on their pads). */
export const READY_TICKS = 120;
/** Round-over beat before the next round (2.5 s). */
export const END_TICKS = 150;

// ── Movement ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Walking acceleration (u/s²). */
export const MOVE_ACCEL = 95;
/** Walking top speed (u/s); walking never accelerates past it (knockback can). */
export const WALK_MAX = 16;
/** Walk multiplier while charging a shove (you plant your feet). */
export const CHARGE_WALK = 0.35;
/** Ground damping rate (1/s): v *= 1 − k·dt each tick. A 60 u/s knock slides ≈ 19 u. */
export const GROUND_DAMP = 3.2;
/** Damping multiplier while a shove dash is armed (dashes glide). */
export const DASH_DAMP_MULT = 0.25;

// ── Shove ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Ticks of holding to reach a full charge (0.75 s), before the family multiplier. */
export const CHARGE_TICKS = 45;
/** Steps of the stepped charge meter the HUD shows (concept B: 6 blocks). */
export const CHARGE_BLOCKS = 6;
/** A release before this many ticks is a tap: a side-step dodge instead of a shove. */
export const TAP_TICKS = 8;
/** Dash speed at zero and at full charge (u/s), divided by √(family mass multiplier). */
export const DASH_MIN = 34;
export const DASH_MAX = 80;
/** A dash stays armed (hits shove) for at most this many ticks, and ends early below `DASH_END_SPEED`. */
export const DASH_TICKS = 20;
export const DASH_END_SPEED = 18;
/** Ticks after a dash or dodge before the next charge can start. */
export const SHOVE_COOLDOWN = 24;
/** Knockback given to the victim: (SHOVE_MIN + SHOVE_P·p) · √(m_attacker / m_victim), clamped (u/s). */
export const SHOVE_MIN = 26;
export const SHOVE_P = 58;
export const KNOCK_MIN = 18;
export const KNOCK_MAX = 150;
/** The attacker keeps this share of its velocity after landing a shove. */
export const ATTACKER_KEEP = 0.25;
/** The victim keeps this share of its own velocity on top of the knock. */
export const VICTIM_KEEP = 0.2;
/** Ticks a shoved Friend tumbles without control. */
export const HIT_STUN = 16;
/** Restitution of plain (unarmed) bumps. */
export const BUMP_RESTITUTION = 0.5;
/** Relative speed (u/s) above which a plain bump emits a `bump` event (sound). */
export const BUMP_EVENT_SPEED = 12;

// ── Dodge ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Side-step speed (u/s). */
export const DODGE_SPEED = 30;
/** Ticks a dodge ignores shoves (the counterplay to a telegraphed charge). */
export const DODGE_INVULN = 12;

// ── Pixels (health = weight) ──────────────────────────────────────────────────────────────────────────────────────────
/** Pixels knocked off by a shove: 1 + floor(p · HIT_PIXELS_P). */
export const HIT_PIXELS_P = 4;
/** Knock-offs stop at this share of the starting pixels (a Friend never becomes a feather). */
export const PIXEL_FLOOR = 0.5;
/** Loose pixels stay on the ring this long (5 s), then fizzle out until the match ends. */
export const LOOSE_TICKS = 300;
/** A loose pixel can be picked up by its owner after this many ticks (so it visibly flies first). */
export const PICK_DELAY = 20;
/** Pickup reach beyond the fighter's collider radius (u). */
export const PICK_REACH = 2;
/** Debris gravity (u/s²), launch speeds (u/s) and ground damping (1/s). */
export const DEBRIS_G = 140;
export const DEBRIS_SPEED_MIN = 18;
export const DEBRIS_SPEED_MAX = 36;
export const DEBRIS_UP_MIN = 20;
export const DEBRIS_UP_MAX = 34;
export const DEBRIS_DAMP = 5;
/** Depth (u) below the ring at which a falling pixel is gone for the match. */
export const DEBRIS_FALL_DEPTH = 30;
/** A fighter faster than this kicks the loose pixels of others it runs through (u/s). */
export const KICK_SPEED = 6;
/** Minimum physics mass (so an almost-empty Friend still has finite knockback). */
export const MASS_MIN = 12;
/** Collider radius = clamp(K · sprite bbox width, MIN, MAX). */
export const RADIUS_K = 0.42;
export const RADIUS_MIN = 4;
export const RADIUS_MAX = 7;

// ── Ring-out ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Fall duration before a ringed-out Friend is out of the round (0.75 s). */
export const FALL_TICKS = 45;
/** A ring-out is credited to the last shover if the shove landed within this window (3 s). */
export const CREDIT_TICKS = 180;

// ── Family traits ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Hoverer: total hover budget per round (1 s) and the steer-back acceleration while hovering (u/s²). */
export const HOVER_TICKS = 60;
export const HOVER_ACCEL = 30;
/** Mask: a shove released within this many ticks before being hit parries it (200 ms). */
export const PARRY_TICKS = 12;
/** Family: standing still this long braces (mass ×BRACE_MULT, pickup reach ×2). */
export const BRACE_TICKS = 30;
export const BRACE_MULT = 1.5;
/** Skeleton: landed loose pixels crawl home at this speed (u/s). */
export const CRAWL_SPEED = 6;
/** Asymmetry: the dash curves this many angle steps per tick (of 4096) toward the heavy side, for `HOOK_TICKS`. */
export const HOOK_STEP = 24;
export const HOOK_TICKS = 12;
/** Colossus: a dash of p ≥ QUAKE_MIN_P ends in a stomp of this radius (u) and knock (u/s, mass-scaled). */
export const QUAKE_MIN_P = 0.7;
export const QUAKE_RADIUS = 13;
export const QUAKE_KNOCK = 26;
/** Sparkling: dashes drop a trail point every TRAIL_EVERY ticks that lasts TRAIL_TICKS; crossing it slicks you. */
export const TRAIL_EVERY = 3;
export const TRAIL_TICKS = 90;
export const TRAIL_RADIUS = 3;
export const SLICK_TICKS = 40;
/** Slick: damping and walking multipliers. */
export const SLICK_DAMP = 0.3;
export const SLICK_WALK = 0.5;
/** Cellular: a shove of p ≥ SHED_MIN_P splits off one extra pixel and the split takes this share of the knock. */
export const SHED_MIN_P = 0.5;
export const SHED_KNOCK = 0.7;

// ── Scoring (player only) ─────────────────────────────────────────────────────────────────────────────────────────────
/** Points for a ring-out credited to the player. */
export const SCORE_KO = 100;
/** Points for winning a round. */
export const SCORE_ROUND = 300;
/** Points for winning the match. */
export const SCORE_MATCH = 500;
/** Points per pixel the player picks back up. */
export const SCORE_GRAB = 10;

/** Upper bound on match length (3 × (ready + fight + end)); inputs at or beyond it are invalid. */
export const MATCH_MAX_TICKS = ROUNDS * (READY_TICKS + ROUND_MAX + END_TICKS);
