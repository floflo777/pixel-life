/**
 * Creature view states and the mapping from the sim's per-kind state machines (`packages/shared/src/sim/creatures.ts`
 * on feat/sim) to them. The sim constants are mirrored here as numbers because the renderer must not depend on the
 * sim module; `states.test.ts` pins the mapping so a sim renumbering shows up as a failing test, not a wrong pose.
 */
import { CREATURE_KINDS, type CreatureKind } from "./sprites";

/** What a creature view is showing. Every damaging action goes telegraph → attack. */
export type CreatureState =
  | "spawn"
  | "idle"
  | "move"
  | "telegraph"
  | "attack"
  | "airborne"
  | "carry"
  | "stunned"
  | "sleep"
  | "projectile"
  | "flee"
  | "smashed";

/** All view states, for galleries and exhaustive tests. */
export const CREATURE_STATES: readonly CreatureState[] = [
  "spawn",
  "idle",
  "move",
  "telegraph",
  "attack",
  "airborne",
  "carry",
  "stunned",
  "sleep",
  "projectile",
  "flee",
  "smashed",
];

/** Sim state numbers per kind (mirrors feat/sim `creatures.ts`). `FLEEING = 9` is shared by every kind. */
export const SIM_STATES = {
  nib: { CHASE: 0, BOWING: 1, RETREAT: 2, WAITING: 3 },
  pogo: { CROUCHING: 0, HOPPING: 1, RESTING: 2 },
  clank: { WALK: 0, JAWS: 1, RECOVERING: 2 },
  snatch: { CIRCLE: 0, AIM: 1, SWOOPING: 2, CARRY: 3, LEAVING: 4 },
  slurp: { SLEEPING: 0, AWAKE: 1, TONGUING: 2, PUFFING: 3 },
  fizz: { RUSH: 0, FUSED: 1, PROJECTILE: 2 },
  FLEEING: 9,
} as const;

/** Per-kind table: sim state number → view state. */
const SIM_TO_VIEW: Readonly<Record<CreatureKind, readonly CreatureState[]>> = {
  // CHASE, BOWING (0.45 s bow), RETREAT (the "nom" + hop back), WAITING.
  nib: ["move", "telegraph", "attack", "idle"],
  // CROUCHING (0.3 s), HOPPING, RESTING.
  pogo: ["telegraph", "airborne", "idle"],
  // WALK, JAWS (0.6 s jaw open), RECOVERING (just bit).
  clank: ["move", "telegraph", "attack"],
  // CIRCLE, AIM (0.4 s swoop line), SWOOPING, CARRY (pixel in beak), LEAVING.
  snatch: ["move", "telegraph", "attack", "carry", "flee"],
  // SLEEPING, AWAKE, TONGUING (eats a loose pixel), PUFFING (0.7 s cheek puff before the yank).
  slurp: ["sleep", "idle", "attack", "telegraph"],
  // RUSH, FUSED (1.5 s fuse), PROJECTILE (launched by the Friend).
  fizz: ["move", "telegraph", "projectile"],
};

/** The subset of the sim's `Creature` the renderer reads. */
export interface SimCreatureLike {
  readonly kind: number;
  readonly state: number;
  /** Ticks stunned (parry, Slurp sulk). */
  readonly stun: number;
  /** Spawn ripple ticks left. */
  readonly spawn: number;
  readonly dead: boolean;
}

/** Kind name for a sim kind index; throws on an unknown index (a sim/renderer mismatch must be loud). */
export function kindOf(simKind: number): CreatureKind {
  const k = CREATURE_KINDS[simKind];
  if (!k) throw new RangeError(`Unknown creature kind ${simKind}.`);
  return k;
}

/**
 * The view state for a sim creature. Priority: dead → smashed, spawning → spawn, stunned → stunned, fleeing → flee,
 * then the per-kind table. Unknown per-kind states fall back to idle (never throws mid-run).
 */
export function viewStateFromSim(c: SimCreatureLike): CreatureState {
  if (c.dead) return "smashed";
  if (c.spawn > 0) return "spawn";
  if (c.stun > 0) return "stunned";
  if (c.state === SIM_STATES.FLEEING) return "flee";
  return SIM_TO_VIEW[kindOf(c.kind)][c.state] ?? "idle";
}

/** Old Gulp's view phases. */
export type GulpPhase = "hidden" | "rising" | "teeth" | "inhale" | "sinking";

/** Sim Gulp phase numbers (mirrors feat/sim `gulp.ts`). */
export const SIM_GULP = { IDLE: 0, SHADOW: 1, TEETH_OUT: 2, INHALING: 3, SUNK: 4, DONE: 5 } as const;

/** The Gulp view phase for a sim Gulp phase. */
export function gulpPhaseFromSim(phase: number): GulpPhase {
  switch (phase) {
    case SIM_GULP.SHADOW:
      return "rising";
    case SIM_GULP.TEETH_OUT:
      return "teeth";
    case SIM_GULP.INHALING:
      return "inhale";
    case SIM_GULP.SUNK:
      return "sinking";
    default:
      return "hidden";
  }
}

/** Gulp moods in the sim's `GULP_MOODS` order. */
export const GULP_MOODS = ["hungry", "sleepy", "grumpy"] as const;
/** One of Old Gulp's three moods (GDD §3.8). */
export type GulpMood = (typeof GULP_MOODS)[number];

/** Mood name for a sim mood index (unknown → hungry, the default mood). */
export function gulpMoodFromSim(mood: number): GulpMood {
  return GULP_MOODS[mood] ?? "hungry";
}
