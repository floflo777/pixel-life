/**
 * Pixel Putt tuning (GDD §11.8 A). Every physics constant of the putt sim lives here so the renderer's aim preview, the
 * bot and the tests read the same numbers. Units: u (world units), seconds, ticks at 60 Hz. Changing any value changes
 * replays: bump `PUTT_SIM_VERSION` in the same commit.
 */

/** Sim format version: part of every summary hash so old input logs are never replayed against new physics. */
export const PUTT_SIM_VERSION = 1;

/** Fixed step (s). */
export const DT = 1 / 60;

/** Physics and rules constants. */
export const PUTT = {
  /** Holes per round. */
  holes: 9,
  /** Strokes (penalties included) after which a hole is picked up and scored at this cap. */
  maxStrokes: 8,
  /** Whole-round hard stop (ticks, 15 min): unplayed holes score the cap, so an idle round still ends. */
  maxTicks: 60 * 60 * 15,
  /** Collision substeps per tick (a full-power shot moves ≈ 0.09 u per substep, far below the ball radius). */
  substeps: 4,
  /** Surface / rail lattice (u). Every pad is rasterised on it, rails run along its cell edges. */
  cell: 0.5,
  /** The curled-up Friend's collision radius (u). */
  ballR: 0.45,
  /** Launch speed (u/s) at full power before the mass factor. */
  vMax: 20,
  /** Hop on launch: vertical speed = hopBase + hopK·p (p = power curve 0..1). Short putts barely leave the ground. */
  hopBase: 1.5,
  hopK: 9,
  /** Gravity (u/s²) while airborne. */
  gravity: 32,
  /** Landing faster than this (u/s, vertical) bounces with `bounceK` of the vertical speed. */
  bounceMinVy: 3,
  bounceK: 0.35,
  /** Rolling resistance dv/dt = −(rollA + rollB·v) on the ground. */
  rollA: 2.2,
  rollB: 0.55,
  /** Air drag dv/dt = −airDrag·v while airborne (horizontal). */
  airDrag: 0.15,
  /** Below this speed on flat ground the ball rests (u/s). */
  restSpeed: 0.25,
  /** Ticks below `restSpeed` anywhere (slopes, pinned on a rail) after which the ball rests anyway. */
  restTicks: 20,
  /** A shot is force-stopped after this many ticks (a ball circling in a funnel forever). */
  shotMaxTicks: 900,
  /** Cup radius (u). The ball drops when its centre is inside and it is slower than `sinkSpeed`. */
  cupR: 0.6,
  sinkSpeed: 4.5,
  /** Gentle funnel around the cup: slow balls within `funnelR` are pulled toward it (Club Penguin forgiveness). */
  funnelR: 1.2,
  funnelA: 5,
  funnelMaxV: 3,
  /** Lip-out: a too-fast ball over the cup keeps this much speed and is nudged sideways. */
  lipKeep: 0.8,
  /** Restitution of rails, bumpers (plus a minimum outgoing kick), windmill blades and Nibs. */
  railE: 0.7,
  bumperE: 1.0,
  bumperKick: 6,
  bladeE: 0.6,
  nibE: 0.5,
  /** Windmill blade half thickness and hub radius (u). */
  bladeHalf: 0.2,
  hubR: 0.5,
  /** Nib hazard radius (u). Touching one during a shot costs one penalty stroke (once per shot). */
  nibR: 0.7,
  /** Ticks the ball spends dropping off the course before it is placed back (+1 stroke). */
  fallTicks: 45,
  /** Ticks between a sink (or pick-up) and the next tee: the fanfare. */
  sunkTicks: 100,
  /** Mass: a scarred Friend flies farther (GDD §11.8): speed × (1 + massK · lostFraction). */
  massK: 0.2,
} as const;

/** Round score for the leaderboard (higher is better): the stroke cap of the whole round minus the strokes taken. */
export const PUTT_SCORE_BASE = PUTT.holes * PUTT.maxStrokes;
