import { dist, type Vec2 } from "./geometry.js";

/**
 * Hub walk speed in wire units per second: GDD §11.2 says 12 u/s and the wire carries centimetres (1 u = 100).
 * One speed for every family on the wire so server timing and client interpolation agree; family flavour
 * (Hoverer bob, Colossus stomp) is animation only.
 */
export const HUB_WALK_SPEED = 1200;
/** Longest single `move` leg (GDD §11.2: max path 80 u). Longer requests are shortened along their direction. */
export const MAX_MOVE_DISTANCE = 8000;

/** One straight walk broadcast as `moved`: from → to starting at server time `t0` at {@link HUB_WALK_SPEED}. */
export interface Segment {
  readonly fx: number;
  readonly fz: number;
  readonly tx: number;
  readonly tz: number;
  readonly t0: number;
}

/** Walking time of a segment in ms. */
export function segmentDuration(s: Segment, speed = HUB_WALK_SPEED): number {
  return (dist([s.fx, s.fz], [s.tx, s.tz]) / speed) * 1000;
}

/** Position on a segment at server time `t`: `from` before t0, `to` after arrival, linear in between. */
export function positionAt(s: Segment, t: number, speed = HUB_WALK_SPEED): Vec2 {
  const d = segmentDuration(s, speed);
  if (t <= s.t0 || d === 0) return t <= s.t0 ? [s.fx, s.fz] : [s.tx, s.tz];
  const k = Math.min(1, (t - s.t0) / d);
  return [s.fx + (s.tx - s.fx) * k, s.fz + (s.tz - s.fz) * k];
}

/** True while the entity is still walking the segment at server time `t`. */
export function isMoving(s: Segment, t: number, speed = HUB_WALK_SPEED): boolean {
  return t >= s.t0 && t < s.t0 + segmentDuration(s, speed);
}
