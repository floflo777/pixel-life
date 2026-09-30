/**
 * Contract of the Bump Sumo match sim: config, inputs, render view, events. The renderer only reads views and events;
 * the server can re-run a match from `(config, inputs)` with `replaySumo` and compare hashes.
 */
import type { FamilyId, Hex64 } from "../../ids.js";
import type { RunSummary } from "../../sim-types.js";

/** One Friend entering the ring. `lost` = scars it walks in with (they make it lighter; they are never added to). */
export interface SumoFighterConfig {
  front: Hex64;
  lost: Hex64;
  familyId: FamilyId;
}

/** Everything that determines a match besides the player's inputs. Fighter 0 is the player, 1..3 are bots. */
export interface SumoConfig {
  seed: number;
  fighters: readonly SumoFighterConfig[];
  /** Bot skill 0 (gentle) .. 2 (sharp); default 1. */
  botLevel?: number;
}

/**
 * The player's control state from tick `t` on (a new record only when something changes). `dir` is an integer angle
 * 0..4095 (0 = +x / screen right, 1024 = +z / toward the camera); `move` walks along it; `charge` holds the shove.
 */
export interface SumoInput {
  t: number;
  move: 0 | 1;
  dir: number;
  charge: 0 | 1;
}

/** Match phase. */
export const SumoPhase = {
  Ready: 0,
  Fight: 1,
  RoundEnd: 2,
  Done: 3,
} as const;
/** A `SumoPhase` value. */
export type SumoPhase = (typeof SumoPhase)[keyof typeof SumoPhase];

/** A fighter's state machine. */
export const SumoFighterState = {
  Ring: 0,
  Hover: 1,
  Falling: 2,
  Out: 3,
} as const;
/** A `SumoFighterState` value. */
export type SumoFighterState = (typeof SumoFighterState)[keyof typeof SumoFighterState];

/** Per-pixel state in a fighter's `pixels` view (index = row·16 + col). */
export const SumoPx = {
  None: 0,
  Body: 1,
  Loose: 2,
  /** Knocked off the ring (or fizzled): gone until the match ends, then it comes home. */
  Gone: 3,
  /** A persistent scar the Friend walked in with. */
  Scar: 4,
} as const;
/** A `SumoPx` value. */
export type SumoPx = (typeof SumoPx)[keyof typeof SumoPx];

/** One Friend in a view. */
export interface SumoFighterView {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  /** Integer angle the Friend faces / will shove along. */
  readonly facing: number;
  readonly state: SumoFighterState;
  /** Ticks since the fall started (0 unless falling/out). */
  readonly fallTicks: number;
  /** Charge 0..1 (0 when not charging). */
  readonly charge: number;
  /** True while a shove dash is armed. */
  readonly armed: boolean;
  /** True while a dodge ignores shoves. */
  readonly dodging: boolean;
  /** True while braced (Family). */
  readonly braced: boolean;
  /** True while slick (crossed a spark trail). */
  readonly slick: boolean;
  /** Ticks of hit tumble left. */
  readonly stun: number;
  /** Present pixels, pixels it started the match with, physics mass. */
  readonly present: number;
  readonly total: number;
  readonly mass: number;
  readonly radius: number;
  readonly familyId: FamilyId;
  readonly heavySide: number;
  /** Round wins and credited ring-outs this match. */
  readonly wins: number;
  readonly kos: number;
  /** `SumoPx` per pixel id. */
  readonly pixels: Uint8Array;
}

/** A loose pixel on (or falling off) the ring. `y` is height (u); negative while falling. */
export interface SumoDebrisView {
  readonly owner: number;
  readonly pid: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  /** Ticks before it fizzles. */
  readonly left: number;
  readonly falling: boolean;
}

/** One spark-trail point (Sparkling). */
export interface SumoTrailView {
  readonly x: number;
  readonly z: number;
  readonly left: number;
}

/** Render snapshot of the match (fresh objects). */
export interface SumoView {
  readonly tick: number;
  readonly phase: SumoPhase;
  /** 0-based round index. */
  readonly round: number;
  /** Ticks since the current phase began. */
  readonly phaseTicks: number;
  readonly ringR: number;
  readonly fighters: readonly SumoFighterView[];
  readonly debris: readonly SumoDebrisView[];
  readonly trail: readonly SumoTrailView[];
  /** Winner index per finished round (−1 = nobody). */
  readonly roundWinners: readonly number[];
  /** Match winner once done (−1 before). */
  readonly winner: number;
  readonly score: number;
  readonly done: boolean;
}

/**
 * Match events for juice, audio and HUD. Meaning of `a` / `b` / `n` per type:
 *
 * | type        | a                  | b                         | n                     | x, z      |
 * | ----------- | ------------------ | ------------------------- | --------------------- | --------- |
 * | `ready`     | round index        | —                         | —                     | —         |
 * | `fight`     | round index        | —                         | —                     | —         |
 * | `shove`     | fighter            | —                         | power 0..1023         | fighter   |
 * | `dodge`     | fighter            | —                         | —                     | fighter   |
 * | `hit`       | attacker           | victim                    | power 0..1023         | contact   |
 * | `clash`     | fighter            | fighter                   | power 0..1023 (max)   | contact   |
 * | `bump`      | fighter            | fighter                   | relative speed (u/s)  | contact   |
 * | `parry`     | parrying fighter   | reflected attacker        | —                     | contact   |
 * | `pixelOff`  | owner              | pixel id                  | —                     | pixel     |
 * | `pixelBack` | owner              | pixel id                  | 1 = grabbed, 2 = round reset | pixel |
 * | `pixelGone` | owner              | pixel id                  | 1 = fell, 2 = fizzled | pixel     |
 * | `hover`     | fighter            | —                         | —                     | fighter   |
 * | `ringout`   | fighter            | credited fighter or −1    | —                     | fighter   |
 * | `quake`     | fighter            | —                         | —                     | fighter   |
 * | `shrink`    | round index        | —                         | —                     | —         |
 * | `roundEnd`  | winner or −1       | round index               | —                     | —         |
 * | `matchEnd`  | winner             | player's final score      | —                     | —         |
 */
export type SumoEventType =
  | "ready"
  | "fight"
  | "shove"
  | "dodge"
  | "hit"
  | "clash"
  | "bump"
  | "parry"
  | "pixelOff"
  | "pixelBack"
  | "pixelGone"
  | "hover"
  | "ringout"
  | "quake"
  | "shrink"
  | "roundEnd"
  | "matchEnd";

/** One event at tick `t` (see `SumoEventType` for field meanings). */
export interface SumoEvent {
  t: number;
  type: SumoEventType;
  a?: number;
  b?: number;
  n?: number;
  x?: number;
  z?: number;
}

/** Player stats at the end of a match (for the results card). */
export interface SumoStats {
  readonly place: number;
  readonly wins: number;
  readonly kos: number;
  readonly grabbed: number;
  readonly knockedOff: number;
  readonly ringouts: number;
}

/** A running match. `step` applies the inputs stamped for the current tick (others are ignored). */
export interface SumoSim {
  readonly tick: number;
  readonly done: boolean;
  step(inputs: readonly SumoInput[]): void;
  view(): SumoView;
  drainEvents(): SumoEvent[];
  hash(): string;
  /** Summary in the shared run shape: `lostDelta` is always empty (the venue is scarless). */
  summary(): RunSummary;
  stats(): SumoStats;
}
