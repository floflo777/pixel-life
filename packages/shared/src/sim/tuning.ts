/**
 * Every gameplay constant of the sim, with its GDD source. Documented one by one in `TUNING.md` (keep both in sync).
 * Durations are stored in ticks (60 Hz); `sec()` converts design seconds. Changing any value changes run hashes:
 * regenerate the golden corpus in the same PR, with a reason.
 */
import { degToAngle } from "./fixed-math.js";

/** Seconds → whole ticks at 60 Hz. */
export function sec(s: number): number {
  return Math.round(s * 60);
}

/** Tick length in seconds (1/60, exact IEEE division). */
export const DT = 1 / 60;

// ── Friend body and fling (GDD §2.1–2.3) ────────────────────────────────────────────────────────────────────────────
/** Launch speed at p = 1 and m = M_REF (u/s). */
export const V_MAX = 70;
/** Reference mass for launch scaling (pixels). */
export const M_REF = 70;
/**
 * Momentum (mass × speed) a body of `mass` pixels needs to break something rated `hp` at the reference mass: a Gulp
 * tooth or a Clank plate. Scaled by √(mass / M_REF) so that, within the launch mass-factor clamp, the launch speed
 * needed is the same for every mass (a light Friend flings faster, so raw m·v would lock it out).
 */
export function smashThreshold(hp: number, mass: number): number {
  return hp * Math.sqrt((mass < 1 ? 1 : mass) / M_REF);
}

/** Launch mass factor clamp: sqrt(M_REF/m) is clamped into [MASS_FACTOR_MIN, MASS_FACTOR_MAX]. */
export const MASS_FACTOR_MIN = 0.8;
/** See MASS_FACTOR_MIN. */
export const MASS_FACTOR_MAX = 1.35;
/** Fling power below this (0..1023 scale, p < 0.08) cancels the fling. */
export const MIN_POW = 82;
/** Ground damping: dv/dt = −(DAMP_CONST + DAMP_LIN·v). */
export const DAMP_CONST = 10;
/** See DAMP_CONST. */
export const DAMP_LIN = 1.8;
/** Speed at/above which the Friend is FLYING (a weapon); below it is PREY (u/s). */
export const FLY_THRESHOLD = 14;
/** Speed below which a new fling can be aimed (READY) (u/s). */
export const READY_THRESHOLD = 30;
/** Cooldown after each accepted fling. */
export const LAUNCH_COOLDOWN = sec(0.25);
/** No fling is accepted before this tick (the Friend is still raining in, GDD §2.8 drop-in). */
export const DROP_IN_LOCK = sec(1.2);
/** Speed multiplier per creature popped (Hollow exempt). */
export const KILL_SPEED_KEEP = 0.9;
/** Share of the normal velocity component removed when a non-Hollow Friend pops a creature (it deflects). */
export const KILL_DEFLECT = 0;
/** Collider radius = clamp(COLLIDER_K · bboxWidth, COLLIDER_MIN, COLLIDER_MAX). */
export const COLLIDER_K = 0.45;
/** See COLLIDER_K. */
export const COLLIDER_MIN = 3;
/** See COLLIDER_K. */
export const COLLIDER_MAX = 7;
/** Restitution against rim bumper rocks. */
export const BUMPER_RESTITUTION = 0.55;
/** Steer (input k=1): acceleration while held, only below STEER_MAX_SPEED (u/s², u/s). */
export const STEER_ACCEL = 30;
/** See STEER_ACCEL. Kept below FLY_THRESHOLD so steering never makes a weapon. */
export const STEER_MAX_SPEED = 8;

// ── Pixel damage and loose pixels (GDD §2.5) ─────────────────────────────────────────────────────────────────────────
/** Exposure weight in the bite score: dot(dir, −a) + BITE_EXPOSURE_W · emptyNeighbours/4. */
export const BITE_EXPOSURE_W = 0.15;
/** Grab-back window (Skeleton uses GRAB_WINDOW_SKELETON). */
export const GRAB_WINDOW = sec(2.0);
/** Clutch grab: grabbed with at most this much time left. */
export const CLUTCH_LEFT = sec(0.3);
/** A loose pixel cannot be grabbed during its first ticks (it visibly pops off first). */
export const PICKUP_DELAY = sec(0.3);
/** Magnet radius beyond `GRAB_BODY_K · collider radius` while PREY / FLYING (u). */
export const MAGNET_PREY = 3.0;
/** See MAGNET_PREY. */
export const MAGNET_FLY = 4.5;
/** Share of the collider radius added to the magnet radius (the pixel must reach the body, not only its centre). */
export const GRAB_BODY_K = 0;
/** Detach impulse range away from the attacker (u/s). */
export const DEBRIS_SPEED_MIN = 8;
/** See DEBRIS_SPEED_MIN. */
export const DEBRIS_SPEED_MAX = 14;
/** Detach cone half-angle around the push direction (integer angle, ±35°). */
export const DEBRIS_CONE = degToAngle(35);
/** Upward detach speed range (u/s). */
export const DEBRIS_UP_MIN = 3;
/** See DEBRIS_UP_MIN. */
export const DEBRIS_UP_MAX = 7;
/** Gravity on debris and falling bodies (u/s²). */
export const GRAVITY = 40;
/** Debris bounce restitution on the ground. */
export const DEBRIS_RESTITUTION = 0.45;
/** Debris horizontal friction per second on the ground, and air drag per second (share of speed removed per second). */
export const DEBRIS_FRICTION = 8;
/** See DEBRIS_FRICTION. Together they make a cube rest ≈ 0.6–1 s after popping off, 4–8 u away (GDD §2.5). */
export const DEBRIS_AIR_DRAG = 1.5;
/** Debris below this height (fallen off the island) is lost (u). */
export const DEBRIS_LOST_DEPTH = -4;
/** Snatch-dropped pixels get a fresh window of this length. */
export const SNATCH_DROP_WINDOW = sec(1.0);
/** Scoring: grab-back / clutch grab points. */
export const PTS_GRAB = 5;
/** See PTS_GRAB. */
export const PTS_CLUTCH = 25;

// ── Ring-out (GDD §2.6) ──────────────────────────────────────────────────────────────────────────────────────────────
/** The Friend's centre must leave the island by more than this to ring out (u). */
export const RINGOUT_MARGIN = 1;
/** Fall animation before the ring-out pixels are lost. */
export const RINGOUT_FALL = sec(0.35);
/** Pixels lost immediately on a ring-out. */
export const RINGOUT_PX = 3;
/** Respawn at the island centre this long after leaving. */
export const RESPAWN_AFTER = sec(1.0);
/** Invulnerability after respawn. */
export const INVULN = sec(1.5);
/** Score penalty for a ring-out. */
export const PTS_RINGOUT = -50;

// ── Run (GDD §2.8, §2.9) ─────────────────────────────────────────────────────────────────────────────────────────────
/** Wave boundaries (ticks): drop-in end, wave 2 start, frenzy start, last light start. */
export const WAVE1_START = sec(2.5);
/** See WAVE1_START. */
export const WAVE2_START = sec(20);
/** See WAVE1_START. */
export const FRENZY_START = sec(40);
/** See WAVE1_START. */
export const LAST_LIGHT_START = sec(55);
/** Survival bonus: round(PTS_SURVIVAL · keptRatio). */
export const PTS_SURVIVAL = 300;
/** Flawless bonus (0 px lost this run; grab-backs allowed). */
export const PTS_FLAWLESS = 500;
/** Combo multiplier cap (kills in one fling). */
export const COMBO_CAP = 8;
/** Chain multiplier in tenths: base, per-killing-fling step and cap (×1.0, +0.3, ×5.0; GDD ×1.0 / +0.1 / ×2.0). */
export const CHAIN_BASE = 10;
/** See CHAIN_BASE. */
export const CHAIN_STEP = 3;
/** See CHAIN_BASE. */
export const CHAIN_CAP = 50;
/**
 * A fling with no pop is a whiff only if nothing useful follows within this grace after it stops FLYING: grabbing back a
 * loose pixel or sweeping a crumb in that time (or during the fling, or knocking a tooth) holds the chain instead.
 */
export const WHIFF_GRACE = sec(0.5);
/** Chain lost by a whiff, in tenths (a bite or a ring-out still resets it to CHAIN_BASE). */
export const CHAIN_WHIFF = 6;

// ── Spawning (GDD §3.9) ──────────────────────────────────────────────────────────────────────────────────────────────
/** Spawn bank tick (budget is added every 0.25 s). */
export const SPAWN_STEP = sec(0.25);
/** Ground ripple telegraph before a creature becomes active. */
export const SPAWN_RIPPLE = sec(0.6);
/** A rim slot is valid only this far from the Friend (u). */
export const SPAWN_MIN_DIST = 12;
/** Rim slots per island. */
export const SPAWN_SLOTS = 12;
/** Slot radius as a share of the rim radius. */
export const SPAWN_SLOT_RADIUS = 0.86;

// ── Old Gulp (GDD §3.8) ──────────────────────────────────────────────────────────────────────────────────────────────
/** Gulp beat ticks: rumble, bite, teeth start, inhale start, wedge regrow. */
export const GULP_RUMBLE = sec(40);
/** See GULP_RUMBLE. */
export const GULP_BITE = sec(42);
/** See GULP_RUMBLE. */
export const GULP_TEETH = sec(42.5);
/** See GULP_RUMBLE. */
export const GULP_INHALE = sec(52);
/** See GULP_RUMBLE. */
export const GULP_REGROW = sec(55);
/** Seeded wedge offset from the Friend's side: ± this integer angle (±22.5°). */
export const GULP_WEDGE_JITTER = degToAngle(22.5);
/** Tooth radius (u) and tooth smash threshold m·v. */
export const TOOTH_RADIUS = 3;
/** See TOOTH_RADIUS. */
export const TOOTH_HP = 1800;
/**
 * Gulp bites the outer part of the wedge only: below this share of the rim radius the island stays, so the new rim is an
 * arc facing the centre (Gulp's chin) and the centre / respawn point never falls. 90° sector → ≈ 21 % of the island.
 */
export const GULP_WEDGE_INNER = 0.4;
/** Teeth stand on the new rim at the bisector and at ± this share of the wedge half-angle. */
export const TOOTH_SPREAD = 0.6;
/** The mouth (inhale target) sits on the bisector at this share of the rim radius, in the gap. */
export const MOUTH_RIM_SHARE = 0.7;
/** Points per tooth, per star crumb and for the burp. */
export const PTS_TOOTH = 100;
/** See PTS_TOOTH. */
export const PTS_CRUMB = 20;
/** See PTS_TOOTH. */
export const PTS_BURP = 500;
/** Star crumbs per tooth, their lifetime and scatter radius (u). */
export const CRUMBS_PER_TOOTH = 6;
/** See CRUMBS_PER_TOOTH. */
export const CRUMB_TTL = sec(3);
/** See CRUMBS_PER_TOOTH. */
export const CRUMB_SCATTER = 5;
/** Inhale suction acceleration (u/s²) and the mouth capture radius (u). */
export const INHALE_ACCEL = 22;
/** See INHALE_ACCEL. */
export const MOUTH_RADIUS = 3;

// ── Knockback on the Friend: impulse J / m (GDD §2.3, J per source; not tabled in the GDD, tuned here) ───────────────
/** Nib bite impulse. */
export const J_NIB = 300;
/** Pogo bite impulse. */
export const J_POGO = 350;
/** Clank bite impulse. */
export const J_CLANK = 700;
/** Fizz explosion impulse. */
export const J_FIZZ = 1100;
/** Slurp tongue-yank speed toward the toad (u/s; ≈ 6 u of travel after damping). */
export const SLURP_YANK_SPEED = 19;
/** Clank front plate bounce restitution and head-on smash threshold. */
export const CLANK_PLATE_RESTITUTION = 0.8;
/** See CLANK_PLATE_RESTITUTION. */
export const CLANK_FRONT_HP = 2400;
/** Clank shell-crack bonus. */
export const PTS_SHELL_CRACK = 40;
/** Clank plate half-angle: hits within this of its facing hit the plate (cos 60° = 0.5). */
export const CLANK_PLATE_COS = 0.5;

// ── Family traits (GDD §4) ───────────────────────────────────────────────────────────────────────────────────────────
/** Skeleton: grab window and crawl speed of loose pixels toward the body (u/s). */
export const GRAB_WINDOW_SKELETON = sec(3.0);
/** See GRAB_WINDOW_SKELETON. */
export const SKELETON_CRAWL = 4;
/** Mask: a fling released at most this long before a bite lands parries it; minimum power; stun; points. */
export const PARRY_WINDOW = sec(0.2);
/** See PARRY_WINDOW. */
export const PARRY_MIN_POW = 307;
/** See PARRY_WINDOW. */
export const PARRY_STUN = sec(1.5);
/** See PARRY_WINDOW. */
export const PTS_PARRY = 50;
/** Family: magnet multiplier, drift radius (u) and drift speed (u/s). */
export const HUDDLE_MAGNET_MULT = 2;
/** See HUDDLE_MAGNET_MULT. */
export const HUDDLE_DRIFT_RADIUS = 9;
/** See HUDDLE_MAGNET_MULT. */
export const HUDDLE_DRIFT_SPEED = 2;
/** Cellular: split power, split spread (±10°), re-merge delay after both halves stop, pull speed. */
export const MITOSIS_MIN_POW = 921;
/** See MITOSIS_MIN_POW. */
export const MITOSIS_SPREAD = degToAngle(10);
/** See MITOSIS_MIN_POW. */
export const MITOSIS_MERGE_DELAY = sec(0.5);
/** See MITOSIS_MIN_POW. */
export const MITOSIS_PULL_SPEED = 40;
/** Asymmetry: total hook angle (25°) and the share of the path it bends over. */
export const HOOK_ANGLE = degToAngle(25);
/** See HOOK_ANGLE. */
export const HOOK_PATH_SHARE = 0.6;
/** Hoverer: damping multiplier, hover time on leaving the island, push-back acceleration (u/s²). */
export const GLIDE_DAMP_MULT = 0.8;
/** See GLIDE_DAMP_MULT. */
export const HOVER_TIME = sec(1.0);
/** See GLIDE_DAMP_MULT. */
export const HOVER_PUSH = 20;
/** Colossus: minimum fling power for the stomp, stomp radius (u) and stun. */
export const QUAKE_MIN_POW = 716;
/** See QUAKE_MIN_POW. */
export const QUAKE_RADIUS = 7;
/** See QUAKE_MIN_POW. */
export const QUAKE_STUN = sec(1.0);
/** Sparkling: trail lifetime, half-width (u), sample interval, loose-pixel timer bonus. */
export const TRAIL_TTL = sec(1.5);
/** See TRAIL_TTL. */
export const TRAIL_HALF_WIDTH = 1;
/** See TRAIL_TTL. */
export const TRAIL_SAMPLE = 3;
/** See TRAIL_TTL. */
export const TRAIL_PIXEL_BONUS = sec(1.0);
/** Hard cap on live trail points (ring buffer). */
export const TRAIL_MAX_POINTS = 40;

// ── Creatures (GDD §3) ───────────────────────────────────────────────────────────────────────────────────────────────
/** Creature kinds (index into CREATURE_DEFS; also the `kind` field of views and events). */
export const NIB = 0;
/** See NIB. */
export const POGO = 1;
/** See NIB. */
export const CLANK = 2;
/** See NIB. */
export const SNATCH = 3;
/** See NIB. */
export const SLURP = 4;
/** See NIB. */
export const FIZZ = 5;
/** Number of regular creature kinds. */
export const KIND_COUNT = 6;

/** Static stats of one creature kind (GDD §3.1). */
export interface CreatureDef {
  /** Display name. */
  readonly name: string;
  /** Ground collider radius (u), from the sprite footprint. */
  readonly radius: number;
  /** Move speed (u/s). */
  readonly speed: number;
  /** Base points per pop. */
  readonly points: number;
  /** Spawn budget cost. */
  readonly cost: number;
  /** Hits to pop (Slurp takes 2). */
  readonly hits: number;
  /** Pixels per bite (0 = does not bite directly). */
  readonly bite: number;
  /** Most alive at once (on top of the window cap). */
  readonly maxAlive: number;
}

/** Creature table indexed by kind. */
export const CREATURE_DEFS: readonly CreatureDef[] = [
  { name: "Nib", radius: 2.2, speed: 9, points: 10, cost: 1.0, hits: 1, bite: 1, maxAlive: 99 },
  { name: "Pogo", radius: 2.2, speed: 16, points: 15, cost: 1.5, hits: 1, bite: 1, maxAlive: 99 },
  { name: "Clank", radius: 3.5, speed: 5, points: 40, cost: 3.0, hits: 1, bite: 2, maxAlive: 3 },
  { name: "Snatch", radius: 2.8, speed: 14, points: 25, cost: 2.0, hits: 1, bite: 0, maxAlive: 99 },
  { name: "Slurp", radius: 4.0, speed: 0, points: 30, cost: 3.0, hits: 2, bite: 0, maxAlive: 1 },
  { name: "Fizz", radius: 1.8, speed: 12, points: 20, cost: 2.0, hits: 1, bite: 3, maxAlive: 99 },
];

/** Nib: bow telegraph, bite range (surface distance, u), hop-back distance (u) and duration, wait after a bite. */
export const NIB_BOW = sec(0.45);
/** See NIB_BOW. */
export const NIB_RANGE = 2;
/** See NIB_BOW. */
export const NIB_HOP_BACK = 3;
/** See NIB_BOW. */
export const NIB_HOP_TIME = sec(0.2);
/** See NIB_BOW. */
export const NIB_WAIT = sec(1.2);
/** See NIB_BOW. Nibs keep this much space between each other (u). */
export const NIB_SPACING = 2;
/** Pogo: crouch telegraph, hop time, max hop length (u), hop apex (u), pounce range (u), hops before a pounce, rest. */
export const POGO_CROUCH = sec(0.3);
/** See POGO_CROUCH. */
export const POGO_HOP = sec(0.6);
/** See POGO_CROUCH. */
export const POGO_HOP_LEN = 9.6;
/** See POGO_CROUCH. */
export const POGO_APEX = 3;
/** See POGO_CROUCH. */
export const POGO_RANGE = 2.5;
/** See POGO_CROUCH. */
export const POGO_HOPS_MIN = 3;
/** See POGO_CROUCH. */
export const POGO_REST = sec(1.0);
/** Clank: jaw telegraph, bite range (u), turn rate (integer angle per tick = 90°/s), recovery. */
export const CLANK_JAW = sec(0.6);
/** See CLANK_JAW. */
export const CLANK_RANGE = 2.5;
/** See CLANK_JAW. */
export const CLANK_TURN = 17;
/** See CLANK_JAW. */
export const CLANK_RECOVER = sec(1.0);
/** Snatch: swoop telegraph, swoop speed (u/s), hover height (u), pickup radius (u), leave after (no loose pixels). */
export const SNATCH_SWOOP_TELEGRAPH = sec(0.4);
/** See SNATCH_SWOOP_TELEGRAPH. */
export const SNATCH_SWOOP_SPEED = 18;
/** See SNATCH_SWOOP_TELEGRAPH. */
export const SNATCH_HEIGHT = 4;
/** See SNATCH_SWOOP_TELEGRAPH. */
export const SNATCH_PICK_RADIUS = 1.5;
/** See SNATCH_SWOOP_TELEGRAPH. */
export const SNATCH_LEAVE = sec(8);
/** Slurp: wake radius, eat/yank range (u), action period, tongue time, cheek-puff telegraph, sulk knockback (u), sulk. */
export const SLURP_WAKE = 14;
/** See SLURP_WAKE. */
export const SLURP_RANGE = 10;
/** See SLURP_WAKE. */
export const SLURP_PERIOD = sec(3);
/** See SLURP_WAKE. */
export const SLURP_TONGUE = sec(0.25);
/** See SLURP_WAKE. */
export const SLURP_PUFF = sec(0.7);
/** See SLURP_WAKE. */
export const SLURP_KNOCK = 4;
/** See SLURP_WAKE. */
export const SLURP_SULK = sec(1.5);
/** Fizz: fuse trigger range (u), fuse time, speed while fused (u/s), blast radius (u), launched speed factor, dud speed. */
export const FIZZ_TRIGGER = 6;
/** See FIZZ_TRIGGER. */
export const FIZZ_FUSE = sec(1.5);
/** See FIZZ_TRIGGER. */
export const FIZZ_FUSED_SPEED = 6;
/** See FIZZ_TRIGGER. */
export const FIZZ_BLAST = 5;
/** See FIZZ_TRIGGER. */
export const FIZZ_LAUNCH_FACTOR = 1.2;
/** See FIZZ_TRIGGER. */
export const FIZZ_DUD_SPEED = 6;
/** Last Light: creatures flee at this multiple of their speed; pops score ×1.5. */
export const FLEE_SPEED_MULT = 1.2;

/** One spawn window (GDD §3.9): budget per second ramps linearly from b0 to b1 over [from, to). */
export interface SpawnWindow {
  readonly from: number;
  readonly to: number;
  readonly b0: number;
  readonly b1: number;
  readonly maxAlive: number;
  /** Weights for Nib, Pogo, Clank, Snatch, Slurp, Fizz. */
  readonly weights: readonly number[];
}

/** Spawn windows; none after LAST_LIGHT_START. */
export const SPAWN_WINDOWS: readonly SpawnWindow[] = [
  { from: WAVE1_START, to: WAVE2_START, b0: 0.8, b1: 1.4, maxAlive: 6, weights: [70, 30, 0, 0, 0, 0] },
  { from: WAVE2_START, to: FRENZY_START, b0: 1.6, b1: 2.4, maxAlive: 10, weights: [35, 20, 15, 12, 8, 10] },
  { from: FRENZY_START, to: LAST_LIGHT_START, b0: 3.0, b1: 3.0, maxAlive: 14, weights: [30, 20, 15, 10, 5, 20] },
];

// ── Old Gulp moods (GDD §3.8) ────────────────────────────────────────────────────────────────────────────────────────
/** One Gulp mood. */
export interface GulpMood {
  readonly name: string;
  /** Wedge half-angle (integer angle): 25 % of the island = 90° sector, 15 % = 54°. */
  readonly wedgeHalf: number;
  /** How long each tooth stays lit. */
  readonly toothLit: number;
  /** Inhale duration. */
  readonly inhale: number;
  /** true = inhale only if no tooth was hit (Sleepy). */
  readonly inhaleOnlyIfNoHit: boolean;
  /** Relative pick weight per run. */
  readonly weight: number;
}

/** Moods: Hungry (default), Sleepy, Grumpy. */
export const GULP_MOODS: readonly GulpMood[] = [
  {
    name: "Hungry",
    wedgeHalf: degToAngle(45),
    toothLit: sec(3.0),
    inhale: sec(2.0),
    inhaleOnlyIfNoHit: false,
    weight: 2,
  },
  {
    name: "Sleepy",
    wedgeHalf: degToAngle(27),
    toothLit: sec(4.0),
    inhale: sec(2.0),
    inhaleOnlyIfNoHit: true,
    weight: 1,
  },
  {
    name: "Grumpy",
    wedgeHalf: degToAngle(45),
    toothLit: sec(2.2),
    inhale: sec(3.0),
    inhaleOnlyIfNoHit: false,
    weight: 1,
  },
];

// ── Islands (GDD §9.3) ───────────────────────────────────────────────────────────────────────────────────────────────
/** One island. `a`/`b` are the ellipse semi-axes (u); modifiers are optional. */
export interface ArenaDef {
  readonly a: number;
  readonly b: number;
  /** Bumper rocks around the rim (evenly spaced). */
  readonly bumpers: number;
  /** Central slippery pond semi-axes (u) or 0: Friend damping ×POND_DAMP_MULT, loose pixels +POND_PIXEL_BONUS. */
  readonly pondA: number;
  /** See pondA. */
  readonly pondB: number;
  /** Snatch spawn weight multiplier. */
  readonly snatchMult: number;
  /** Wind acceleration (u/s²), direction re-seeded every WIND_PERIOD. */
  readonly wind: number;
  /** Quick-run score multiplier (reported only; the sim score is unmultiplied). */
  readonly scoreMult: number;
}

/** Islands by `SimConfig.arena` name. */
export const ARENAS: Readonly<Record<string, ArenaDef>> = {
  meadow: { a: 36, b: 24, bumpers: 8, pondA: 0, pondB: 0, snatchMult: 1, wind: 0, scoreMult: 1.0 },
  pond: { a: 36, b: 26, bumpers: 8, pondA: 9, pondB: 6, snatchMult: 1, wind: 0, scoreMult: 1.15 },
  dusk: { a: 34, b: 23, bumpers: 8, pondA: 0, pondB: 0, snatchMult: 2, wind: 0, scoreMult: 1.3 },
  snow: { a: 35, b: 24, bumpers: 8, pondA: 0, pondB: 0, snatchMult: 1, wind: 4, scoreMult: 1.45 },
  ink: { a: 36, b: 24, bumpers: 4, pondA: 0, pondB: 0, snatchMult: 1, wind: 0, scoreMult: 1.6 },
};
/** Island polygon vertex count (ellipse sampled at integer angles). */
export const ISLAND_VERTICES = 64;
/** Bumper rock radius (u) and its centre as a share of the rim radius. */
export const BUMPER_RADIUS = 2.2;
/** See BUMPER_RADIUS. */
export const BUMPER_RIM = 0.97;
/** Pond: Friend damping multiplier and extra loose-pixel window. */
export const POND_DAMP_MULT = 0.5;
/** See POND_DAMP_MULT. */
export const POND_PIXEL_BONUS = sec(0.5);
/** Snow: wind direction changes this often. */
export const WIND_PERIOD = sec(10);
