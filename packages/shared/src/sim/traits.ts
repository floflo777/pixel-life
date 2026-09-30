/**
 * Family traits (GDD §4) as data: each family maps to one parameter set the world reads. No trait code branches on the
 * family name; the world only asks "is Mitosis on", "what is the grab window", etc.
 */
import * as T from "./tuning.js";

/** Parameters one family changes. Defaults = no trait effect. */
export interface TraitParams {
  /** Grab-back window in ticks (Skeleton: 3.0 s). */
  readonly grabWindow: number;
  /** Loose pixels crawl toward the body on the ground at this speed (Skeleton), u/s. */
  readonly crawl: number;
  /** Mask: fling-release parry. */
  readonly parry: boolean;
  /** Magnet radius multiplier (Family ×2). */
  readonly magnetMult: number;
  /** Loose pixels within HUDDLE_DRIFT_RADIUS drift toward the body at this speed (Family), u/s. */
  readonly drift: number;
  /** Cellular: high-power flings split the body. */
  readonly mitosis: boolean;
  /** Asymmetry: flings curve toward the heavy side. */
  readonly hook: boolean;
  /** Friend damping multiplier (Hoverer: GLIDE_DAMP_MULT). */
  readonly dampMult: number;
  /** Hoverer: hover instead of falling on leaving the island. */
  readonly glide: boolean;
  /** Colossus: stomp at the end of strong flings. */
  readonly quake: boolean;
  /** Sparkling: flings leave a damaging trail. */
  readonly sparkTrail: boolean;
  /** Hollow: kills cost no speed and don't deflect. */
  readonly pierce: boolean;
}

const BASE: TraitParams = {
  grabWindow: T.GRAB_WINDOW,
  crawl: 0,
  parry: false,
  magnetMult: 1,
  drift: 0,
  mitosis: false,
  hook: false,
  dampMult: 1,
  glide: false,
  quake: false,
  sparkTrail: false,
  pierce: false,
};

/** Trait parameters indexed by familyId (FAMILIES order: Skeleton, Mask, Family, Cellular, Asymmetry, Hoverer, Colossus, Sparkling, Hollow). */
export const TRAITS: readonly TraitParams[] = [
  { ...BASE, grabWindow: T.GRAB_WINDOW_SKELETON, crawl: T.SKELETON_CRAWL },
  { ...BASE, parry: true },
  { ...BASE, magnetMult: T.HUDDLE_MAGNET_MULT, drift: T.HUDDLE_DRIFT_SPEED },
  { ...BASE, mitosis: true },
  { ...BASE, hook: true },
  { ...BASE, dampMult: T.GLIDE_DAMP_MULT, glide: true },
  { ...BASE, quake: true },
  { ...BASE, sparkTrail: true },
  { ...BASE, pierce: true },
];

/** Trait parameters of `familyId` (0..8); throws `RangeError` otherwise. */
export function trait(familyId: number): TraitParams {
  const t = TRAITS[familyId];
  if (!t) throw new RangeError("familyId must be 0..8.");
  return t;
}
