/**
 * Contract of the deterministic Pixel Life simulation (architecture §2.1). Types and constants only: T2 implements them
 * under `src/sim/` (e.g. `export const createSim: CreateSim = ...`) and must not change these shapes without a PR to T1.
 */
import type { FamilyId, Hex64 } from "./ids.js";

/** Fixed simulation rate in ticks per second. */
export const SIM_HZ = 60;
/** Ticks in one 60-second run. */
export const RUN_TICKS = 3600;

/** Run flavour: `free` runs apply immediately; `daily` runs use the server seed and are replay-verified. */
export type RunKind = "free" | "daily";

/** Everything that determines a run besides inputs. Two sims with equal configs and inputs produce equal hashes. */
export interface SimConfig {
  seed: number;
  kind: RunKind;
  arena: string;
  /**
   * `gold` (optional, additive): the worn Gold Pixel slots, i.e. `goldSlots(front, lost, tokenId, goldHeld)`. The sim has
   * no token id, so callers pass the slots; bites glance off them (GDD §2.5 rule 4). Absent = no gold on the body.
   */
  friend: { front: Hex64; lost: Hex64; familyId: FamilyId; goldHeld: number; gold?: Hex64 };
}

/** One player input at tick `t`. `k: 0` = fling (angle 0..4095, power 0..1023); `k: 1` = sweep/steer toggle. */
export type SimInput =
  | { t: number; k: 0 /* fling */; ang: number /* 0..4095 */; pow: number /* 0..1023 */ }
  | { t: number; k: 1 /* sweep/steer */; dir: number /* 0..4095 */; on: 0 | 1 };

/**
 * Gameplay event types emitted by the sim for feedback (sound, juice, HUD). The first eight are the original contract;
 * the rest were added by T2 (additive) for renderer juice. `a` / `b` meaning per type (sub-codes in `sim/events.ts`):
 *
 * | type        | a                                   | b                                             | x, z            |
 * | ----------- | ----------------------------------- | --------------------------------------------- | --------------- |
 * | `hit`       | creature id (−1 = bumper/tooth)     | HIT_* (fizz launch, plate, slurp, bumper, tooth) | contact       |
 * | `bite`      | attacker creature id                | pixels knocked off                            | Friend          |
 * | `pixelOff`  | pixel id (row·16 + col)             | attacker creature id                          | cube spawn      |
 * | `pixelBack` | pixel id                            | 1 = clutch grab                               | grabbing body   |
 * | `pixelLost` | pixel id                            | LOST_* reason                                 | where           |
 * | `smash`     | creature id                         | points (0 = not player-caused)                | creature        |
 * | `edge`      | EDGE_* phase (fall/hover/saved/respawn/pixels) | body index or pixels lost          | Friend          |
 * | `end`       | END_* (time, crumble)               | final score                                   | —               |
 * | `spawn`     | creature id                         | kind                                          | ripple centre   |
 * | `despawn`   | creature id                         | kind (fled, eaten, carried off)               | where           |
 * | `telegraph` | creature id                         | kind (see the creature's `state`)             | target point    |
 * | `launch`    | fling angle 0..4095                 | power 0..1023                                 | Friend          |
 * | `combo`     | combo count (≥ 2)                   | points of that pop                            | creature        |
 * | `chain`     | chain multiplier in tenths          | kills of the fling that changed it            | Friend          |
 * | `gulp`      | GULP_EV_* beat                      | tooth index / wedge half-angle / inhale ticks | tooth or mouth  |
 * | `parry`     | creature id                         | kind                                          | creature        |
 * | `glance`    | gold pixel id                       | its glow cracks this run                      | Friend          |
 * | `trait`     | familyId                            | TRAIT_* action                                | Friend          |
 * | `steal`     | Snatch id                           | pixel id                                      | pixel           |
 * | `yank`      | Slurp id                            | 0                                             | Friend          |
 * | `explode`   | Fizz id                             | 1 = banked by the Friend                      | blast centre    |
 * | `crumb`     | points                              | 0                                             | crumb           |
 * | `phase`     | wave phase 0..4 (drop-in, snack, rush, frenzy, last light) | 0                      | —               |
 */
export type SimEventType =
  | "hit"
  | "bite"
  | "pixelOff"
  | "pixelBack"
  | "pixelLost"
  | "smash"
  | "edge"
  | "end"
  | "spawn"
  | "despawn"
  | "telegraph"
  | "launch"
  | "combo"
  | "chain"
  | "gulp"
  | "parry"
  | "glance"
  | "trait"
  | "steal"
  | "yank"
  | "explode"
  | "crumb"
  | "phase";

/** A gameplay event at tick `t`; `a`/`b` are event-specific ids (e.g. creature, pixel), `x`/`z` a world position. */
export interface SimEvent {
  t: number;
  type: SimEventType;
  a?: number;
  b?: number;
  x?: number;
  z?: number;
}

/** One Friend body in a view: the whole Friend, or one Cellular (Mitosis) half. */
export interface SimBodyView {
  /** World position of the body's sprite centroid on the ground plane (u). */
  readonly x: number;
  readonly z: number;
  /** Velocity (u/s) for render interpolation / squash-stretch. */
  readonly vx: number;
  readonly vz: number;
  /** Sprite centroid (sprite units): pixel (col, row) is drawn at x + col + 0.5 − cx, height (maxRow − row + 0.5). */
  readonly cx: number;
  readonly cz: number;
  readonly maxRow: number;
  /** Ground collider radius (u) and mass (present pixels). */
  readonly r: number;
  readonly mass: number;
  /** FLYING (a weapon) vs PREY. */
  readonly flying: boolean;
}

/** The player's Friend in a view. */
export interface SimFriendView {
  readonly bodies: readonly SimBodyView[];
  /** Per pixel id (row·16 + col): 0 not in sprite, 1 on body, 2 loose, 3 lost (new scar), 4 lost (safety stitch, returns at run end), 5 scar from before the run. */
  readonly pixels: Uint8Array;
  /** Per pixel id: owning body index (Mitosis halves). */
  readonly half: Uint8Array;
  /** Per pixel id: 1 = worn Gold Pixel. */
  readonly gold: Uint8Array;
  /** Per pixel id: glow cracks gained this run (gold only). */
  readonly cracks: Uint8Array;
  /** Can aim a new fling now (READY and cooldown elapsed). */
  readonly ready: boolean;
  /** Invulnerable after respawn (blink). */
  readonly invulnerable: boolean;
  /** 0 in play, 1 falling off the edge, 2 waiting to respawn; `ringTicks` = ticks since it started. */
  readonly ringout: number;
  readonly ringTicks: number;
  /** Hoverer hover ticks left (0 = not hovering). */
  readonly hover: number;
  /** Current fling combo (0 = none), chain multiplier in tenths (10 = ×1.0). */
  readonly combo: number;
  readonly chain: number;
  /** Family id (trait) and Asymmetry heavy side (+1 right, −1 left). */
  readonly familyId: number;
  readonly heavySide: number;
}

/** A loose pixel cube. */
export interface SimDebrisView {
  readonly pid: number;
  readonly x: number;
  /** Height above the ground (negative = falling into the cloud sea). */
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  /** Grab-window ticks left and the window it started with (lime ring). */
  readonly left: number;
  readonly window: number;
  /** Snatch id carrying it, or −1. */
  readonly carriedBy: number;
  /** Once lost it would only be a safety-stitched loss (the per-run scar cap is reached). */
  readonly safety: boolean;
}

/** A creature. `kind`: 0 Nib, 1 Pogo, 2 Clank, 3 Snatch, 4 Slurp, 5 Fizz. */
export interface SimCreatureView {
  readonly id: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  /** Heading 0..4095 (0 = +x, 1024 = +z). */
  readonly facing: number;
  /** Per-kind state (sim/creatures.ts constants; 9 = fleeing) and ticks left in it. */
  readonly state: number;
  readonly stateTicks: number;
  /** In a telegraph (wind-up) state. */
  readonly telegraph: boolean;
  readonly hp: number;
  /** Stun ticks left; spawn-ripple ticks left (intangible while > 0). */
  readonly stun: number;
  readonly spawning: number;
}

/** Old Gulp in a view. `phase`: 0 idle, 1 shadow, 2 teeth out, 3 inhaling, 4 sunk, 5 done. */
export interface SimGulpView {
  readonly phase: number;
  /** 0 Hungry, 1 Sleepy, 2 Grumpy. */
  readonly mood: number;
  /** Wedge bisector / half-angle (0..4095); `wedgeOn` = bitten out, `shadow` = telegraphed. */
  readonly wedgeDir: number;
  readonly wedgeHalf: number;
  readonly wedgeOn: boolean;
  readonly shadow: boolean;
  readonly teeth: readonly { readonly x: number; readonly z: number; readonly lit: boolean; readonly hit: boolean }[];
  readonly mouthX: number;
  readonly mouthZ: number;
}

/**
 * Read-only snapshot the renderer draws from (a fresh copy per call; renderers must treat it as immutable).
 * Units: u (1 u = 1 sprite pixel), ticks at SIM_HZ; ground plane x (right) / z (toward the camera).
 */
export interface SimView {
  readonly tick: number;
  readonly score: number;
  readonly done: boolean;
  /** Wave phase 0..4 (drop-in, snack time, rush, frenzy, last light). */
  readonly phase: number;
  readonly arena: {
    readonly name: string;
    /** Island ellipse semi-axes (u); the ground polygon is sampled from it. */
    readonly a: number;
    readonly b: number;
    readonly bumpers: readonly {
      readonly x: number;
      readonly z: number;
      readonly r: number;
      readonly active: boolean;
    }[];
    /** Central pond semi-axes (0 = none) and current wind (u/s²). */
    readonly pondA: number;
    readonly pondB: number;
    readonly windX: number;
    readonly windZ: number;
  };
  readonly friend: SimFriendView;
  readonly debris: readonly SimDebrisView[];
  readonly creatures: readonly SimCreatureView[];
  readonly gulp: SimGulpView;
  /** Gulp star crumbs (+20 when swept) and Sparkling trail samples, each with ticks left. */
  readonly crumbs: readonly { readonly x: number; readonly z: number; readonly left: number }[];
  readonly trail: readonly { readonly x: number; readonly z: number; readonly left: number }[];
  /** Run counters: pixels grabbed back, creatures popped, pixels lost this run, of which persisted, and the allowance. */
  readonly stats: {
    readonly recovered: number;
    readonly smashed: number;
    readonly lost: number;
    readonly persisted: number;
    readonly scarAllowance: number;
    readonly ringouts: number;
  };
}

/** Result of a finished (or replayed) run; `finalHash` is the determinism checksum the server compares. */
export interface RunSummary {
  score: number;
  lostDelta: Hex64;
  recovered: number;
  smashed: number;
  ticks: number;
  finalHash: string;
}

/** A running simulation. `step` advances exactly one tick with the inputs stamped for that tick. */
export interface Sim {
  readonly tick: number;
  readonly done: boolean;
  step(inputs: readonly SimInput[]): void;
  view(): SimView;
  drainEvents(): SimEvent[];
  hash(): string;
  summary(): RunSummary;
}

/** `createSim(cfg)`: builds a sim at tick 0. */
export type CreateSim = (cfg: SimConfig) => Sim;
/** `replay(cfg, inputs)`: headless full run, used by the server to verify claimed summaries. */
export type Replay = (cfg: SimConfig, inputs: readonly SimInput[]) => RunSummary;
/** `encodeInputs(inputs)`: compact binary input log (uploaded base64 in `POST /api/runs`). */
export type EncodeInputs = (i: readonly SimInput[]) => Uint8Array;
/** `decodeInputs(bytes)`: inverse of `encodeInputs`; throws on malformed logs. */
export type DecodeInputs = (b: Uint8Array) => SimInput[];
/** `dailySeed(day, secretHmacHex)`: server-side daily seed; clients receive it via `GET /api/daily`. */
export type DailySeedFn = (day: string, secretHmacHex: string) => number;
