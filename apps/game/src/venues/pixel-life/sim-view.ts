/**
 * The renderer's view of the deterministic sim. `@pl/shared` on main still exposes the minimal `SimView`; T2 (branch
 * `feat/sim`) extends it additively with the fields below. Until that lands this file mirrors those shapes so the venue
 * can be built and tested; after the merge these become re-exports of `@pl/shared` and `asFullView` a no-op.
 */
import type { RunSummary, Sim, SimConfig, SimEvent, SimInput, SimView } from "@pl/shared";

/** One Friend body (the whole Friend, or one Cellular half). Units: u (1 u = 1 sprite pixel) on the ground plane. */
export interface BodyView {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  /** Sprite centroid (sprite units). */
  readonly cx: number;
  readonly cz: number;
  readonly maxRow: number;
  readonly r: number;
  readonly mass: number;
  readonly flying: boolean;
}

/** Pixel states in `FriendSimView.pixels` (per pixel id row·16 + col). */
export const PX = { none: 0, body: 1, loose: 2, lost: 3, safety: 4, oldScar: 5 } as const;

/** The player's Friend. */
export interface FriendSimView {
  readonly bodies: readonly BodyView[];
  readonly pixels: Uint8Array;
  readonly half: Uint8Array;
  readonly gold: Uint8Array;
  readonly cracks: Uint8Array;
  readonly ready: boolean;
  readonly invulnerable: boolean;
  /** 0 in play, 1 falling, 2 waiting to respawn. */
  readonly ringout: number;
  readonly ringTicks: number;
  readonly hover: number;
  readonly combo: number;
  /** Chain multiplier in tenths (10 = ×1.0). */
  readonly chain: number;
  readonly familyId: number;
  readonly heavySide: number;
}

/** A loose pixel cube (y = height above ground, negative = falling). */
export interface DebrisView {
  readonly pid: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  /** Grab-window ticks left and the window it started with. */
  readonly left: number;
  readonly window: number;
  readonly carriedBy: number;
  readonly safety: boolean;
}

/** Creature kinds (`CreatureView.kind`). */
export const KIND = { nib: 0, pogo: 1, clank: 2, snatch: 3, slurp: 4, fizz: 5 } as const;
/** Kind names by index (audio cue suffixes, labels). */
export const KIND_NAMES = ["nib", "pogo", "clank", "snatch", "slurp", "fizz"] as const;
/** A creature kind name. */
export type KindName = (typeof KIND_NAMES)[number];

/** A creature. `facing` 0..4095 (0 = +x, 1024 = +z); `state` per kind (9 = fleeing). */
export interface CreatureView {
  readonly id: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  readonly facing: number;
  readonly state: number;
  readonly stateTicks: number;
  readonly telegraph: boolean;
  readonly hp: number;
  readonly stun: number;
  readonly spawning: number;
}

/** Old Gulp. `phase`: 0 idle, 1 shadow, 2 teeth out, 3 inhaling, 4 sunk, 5 done. `mood`: 0 hungry, 1 sleepy, 2 grumpy. */
export interface GulpView {
  readonly phase: number;
  readonly mood: number;
  readonly wedgeDir: number;
  readonly wedgeHalf: number;
  readonly wedgeOn: boolean;
  readonly shadow: boolean;
  readonly teeth: readonly { readonly x: number; readonly z: number; readonly lit: boolean; readonly hit: boolean }[];
  readonly mouthX: number;
  readonly mouthZ: number;
}

/** Everything the renderer draws from (T2's extended `SimView`). */
export interface FullSimView extends SimView {
  readonly done: boolean;
  /** Wave phase 0..4 (drop-in, snack time, rush, frenzy, last light). */
  readonly phase: number;
  readonly arena: {
    readonly name: string;
    readonly a: number;
    readonly b: number;
    readonly bumpers: readonly {
      readonly x: number;
      readonly z: number;
      readonly r: number;
      readonly active: boolean;
    }[];
    readonly pondA: number;
    readonly pondB: number;
    readonly windX: number;
    readonly windZ: number;
  };
  readonly friend: FriendSimView;
  readonly debris: readonly DebrisView[];
  readonly creatures: readonly CreatureView[];
  readonly gulp: GulpView;
  readonly crumbs: readonly { readonly x: number; readonly z: number; readonly left: number }[];
  readonly trail: readonly { readonly x: number; readonly z: number; readonly left: number }[];
  readonly stats: {
    readonly recovered: number;
    readonly smashed: number;
    readonly lost: number;
    readonly persisted: number;
    readonly scarAllowance: number;
    readonly ringouts: number;
  };
}

/** Narrows a sim view to the full shape; throws if the sim only provides the minimal contract. */
export function asFullView(v: SimView): FullSimView {
  if (!("friend" in v) || !("debris" in v)) throw new TypeError("This sim does not expose the renderer view.");
  return v as FullSimView;
}

/**
 * The sim implementation the venue runs: injected so the venue works with the real `@pl/shared` sim (once merged) and
 * with the local fake used by the dev page and tests.
 */
export interface SimModule {
  /** Short label shown in the dev overlay ("fake", "shared@1"). */
  readonly name: string;
  createSim(cfg: SimConfig): Sim;
  /** Compact input log for `reportResult` (the server replays it). */
  encodeInputs(inputs: readonly SimInput[]): Uint8Array;
}

/** Sub-codes carried in `SimEvent.a` / `.b` (mirror of T2's `sim/events.ts`). */
export const EV = {
  LOST_TIMEOUT: 0,
  LOST_EDGE: 1,
  LOST_SNATCH: 2,
  LOST_SLURP: 3,
  LOST_GULP: 4,
  LOST_RINGOUT: 5,
  LOST_END: 6,
  EDGE_FALL: 0,
  EDGE_HOVER: 1,
  EDGE_SAVED: 2,
  EDGE_RESPAWN: 3,
  EDGE_PIXELS: 4,
  GULP_RUMBLE: 0,
  GULP_BITE: 1,
  GULP_TOOTH_LIT: 2,
  GULP_TOOTH_HIT: 3,
  GULP_BURP: 4,
  GULP_INHALE: 5,
  GULP_SINK: 6,
  GULP_REGROW: 7,
  GULP_EATEN: 8,
  END_TIME: 0,
  END_CRUMBLE: 1,
  HIT_LAUNCH_FIZZ: 0,
  HIT_PLATE: 1,
  HIT_SLURP: 2,
  HIT_BUMPER: 3,
  HIT_TOOTH_BOUNCE: 4,
} as const;

/** Every event type the venue reacts to (T2's extended `SimEventType`); unknown types are ignored. */
export type AnyEventType =
  | SimEvent["type"]
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

/** A sim event with the extended type union. */
export interface AnyEvent extends Omit<SimEvent, "type"> {
  readonly type: AnyEventType;
}

/** A finished run as the venue keeps it. */
export interface FinishedRun {
  readonly summary: RunSummary;
  readonly inputs: readonly SimInput[];
  readonly view: FullSimView;
}
