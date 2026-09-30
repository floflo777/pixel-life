/**
 * Hub camera follow (pure). The stage's CameraRig does the damped lerp (4/s) and dead zone; this decides where it
 * should look: your Friend, led slightly along its walk, clamped so the view never drifts off the room.
 */

/** Axis-aligned focus limits in world units. */
export interface FocusBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Follow tuning (art bible §3.1: 4/s, dead zone a quarter of the screen). */
export const FOLLOW = { rate: 4, lead: 0.8, height: 1.1, deadZoneFraction: 0.125, ahead: 2.6 } as const;

/** Where the rig should look for a Friend at (x, z) walking along unit heading (hx, hz). */
export function followGoal(
  x: number,
  z: number,
  heading: { readonly x: number; readonly z: number } | null,
  bounds: FocusBounds,
  lead: number = FOLLOW.lead,
): { x: number; y: number; z: number } {
  const gx = x + (heading ? heading.x * lead : 0);
  // Look `ahead` units up-screen: you stand in the lower third with the plaza and doors in front (frame 2).
  const gz = z - FOLLOW.ahead + (heading ? heading.z * lead : 0);
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, gx)),
    y: FOLLOW.height,
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, gz)),
  };
}

/**
 * Dead-zone radius (world units) for a visible width: a quarter of the screen means the focus waits until your Friend
 * is an eighth of the width off-centre. Zero under reduced motion (a steadier, simpler follow).
 */
export function deadZoneFor(visibleWidth: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : visibleWidth * FOLLOW.deadZoneFraction;
}
