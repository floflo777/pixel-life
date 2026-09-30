/**
 * What the handheld needs from the simulation: structural subsets of `@pl/shared`'s `SimView` / `Sim` (same field
 * names, units and meanings). The production sim is the shared deterministic `createSim` (the code the server replays);
 * keeping the renderer on a subset lets tests and the frame-3 restaging hand-place views. `SimView` must stay assignable
 * to `HandheldView` (checked at compile time in `mount.ts`, where `createSim` is the default factory).
 *
 * Units: u (1 u = 1 sprite pixel), ticks at SIM_HZ; ground plane x (right) / z (toward the camera), y up.
 */
import type { RunSummary, SimConfig, SimEvent, SimInput } from "@pl/shared";

/** Pixel states in `HandheldFriendView.pixels` (T2 contract). */
export const PX = {
  /** Not part of the sprite. */
  none: 0,
  /** On the body. */
  body: 1,
  /** Knocked off, still grabbable. */
  loose: 2,
  /** Lost this run (a new scar). */
  lost: 3,
  /** Lost behind a safety stitch (returns at run end). */
  stitched: 4,
  /** A scar from before the run. */
  scar: 5,
} as const;

/** One Friend body (the whole Friend, or a Mitosis half). */
export interface HandheldBodyView {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  readonly flying: boolean;
}

/** The player's Friend. */
export interface HandheldFriendView {
  readonly bodies: readonly HandheldBodyView[];
  /** Per pixel id (row·16 + col): see `PX`. */
  readonly pixels: Uint8Array;
  /** Can aim a new fling now. */
  readonly ready: boolean;
  /** Invulnerable after respawn (drawn blinking). */
  readonly invulnerable: boolean;
  /** 0 in play, 1 falling off the edge, 2 waiting to respawn. */
  readonly ringout: number;
  /** Chain multiplier in tenths (10 = ×1.0). */
  readonly chain: number;
  /** Per pixel id: owning body index when a Mitosis Friend has split (absent = everything on body 0). */
  readonly half?: Uint8Array;
}

/** A loose pixel cube. */
export interface HandheldDebrisView {
  readonly pid: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Grab-window ticks left and the window it started with. */
  readonly left: number;
  readonly window: number;
}

/** A creature. `kind`: 0 Nib, 1 Pogo, 2 Clank, 3 Snatch, 4 Slurp, 5 Fizz. */
export interface HandheldCreatureView {
  readonly id: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Heading 0..4095 (0 = +x, 1024 = +z). */
  readonly facing: number;
  readonly telegraph: boolean;
  readonly stun: number;
  /** Spawn-ripple ticks left (intangible while > 0). */
  readonly spawning: number;
}

/** The snapshot the handheld renders from; treat as immutable. */
export interface HandheldView {
  readonly tick: number;
  readonly score: number;
  readonly done: boolean;
  readonly arena: {
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
  };
  readonly friend: HandheldFriendView;
  readonly debris: readonly HandheldDebrisView[];
  readonly creatures: readonly HandheldCreatureView[];
  readonly stats: { readonly recovered: number; readonly smashed: number; readonly lost: number };
  /** Wave phase 0..4 (drop-in, snack time, rush, frenzy, last light); absent = 0. */
  readonly phase?: number;
  /** Old Gulp (absent = never surfaces): teeth ring, telegraph shadow and the bitten-out wedge. */
  readonly gulp?: HandheldGulpView;
  /** Gulp star crumbs to sweep (+20 each). */
  readonly crumbs?: readonly { readonly x: number; readonly z: number; readonly left: number }[];
}

/** Old Gulp as the handheld draws it. `phase`: 0 idle, 1 shadow, 2 teeth out, 3 inhaling, 4 sunk, 5 done. */
export interface HandheldGulpView {
  readonly phase: number;
  readonly wedgeDir: number;
  readonly wedgeHalf: number;
  readonly wedgeOn: boolean;
  readonly shadow: boolean;
  readonly teeth: readonly { readonly x: number; readonly z: number; readonly lit: boolean; readonly hit: boolean }[];
  readonly mouthX: number;
  readonly mouthZ: number;
}

/** A running simulation as the handheld drives it (a structural subset of `@pl/shared` `Sim`). */
export interface HandheldSim {
  readonly tick: number;
  readonly done: boolean;
  step(inputs: readonly SimInput[]): void;
  view(): HandheldView;
  drainEvents(): SimEvent[];
  summary(): RunSummary;
}

/** Builds a sim at tick 0 (production: `createSim` from `@pl/shared`). */
export type HandheldSimFactory = (cfg: SimConfig) => HandheldSim;

/** Encodes the input log for `reportResult` (production: `encodeInputs` from `@pl/shared`). */
export type InputEncoder = (inputs: readonly SimInput[]) => Uint8Array;
