/**
 * Wire ↔ world mapping for the hub. The wire (and the navmeshes in `@pl/realtime`) use integer centimetres of the
 * GDD's hub units (12 u/s walk, 40 u plaza). The renderer draws Friends at 0.15 world units per sprite pixel (art
 * bible §2), so a 2.4 u sprite would make the GDD plaza 17 Friends wide. We scale the map down so the plaza reads like
 * frame 2 (~7 Friends across) while keeping every wire number untouched.
 */
import type { Facing } from "@pl/shared";

/** World units per wire centimetre: 40 u plaza → 16 world units, 12 u/s → 4.8 world units/s. */
export const WORLD_PER_WIRE = 0.004;

/** A point on the ground plane in world units (x east, z toward the camera). */
export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

/** Wire (cm) → world units. */
export function toWorld(wx: number, wz: number): GroundPoint {
  return { x: wx * WORLD_PER_WIRE, z: wz * WORLD_PER_WIRE };
}

/** World units → wire (integer cm, int16 range is the caller's concern). */
export function toWire(x: number, z: number): [number, number] {
  return [Math.round(x / WORLD_PER_WIRE), Math.round(z / WORLD_PER_WIRE)];
}

/**
 * Sprite facing for a walk heading on the ground (dx east, dz toward the camera). The camera looks toward −z, so
 * walking toward it shows the "down" frames. Horizontal wins ties so diagonal walks show the readable side profile.
 * A zero vector keeps `prev`.
 */
export function facingFromHeading(dx: number, dz: number, prev: Facing = "down"): Facing {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  if (ax < 1e-9 && az < 1e-9) return prev;
  if (ax >= az * 0.9) return dx > 0 ? "right" : "left";
  return dz > 0 ? "down" : "up";
}

/**
 * Yaw (radians about +Y) that turns a plate at (x, z) toward a camera at (cx, cz), clamped to ±`maxDeg` around the
 * camera's own yaw so the front face stays ≤ 20° off the view vector (art bible §2).
 */
export function plateYaw(x: number, z: number, cx: number, cz: number, cameraYawRad: number, maxDeg = 20): number {
  const toCam = Math.atan2(cx - x, cz - z);
  let d = toCam - cameraYawRad;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const m = (maxDeg * Math.PI) / 180;
  return cameraYawRad + Math.max(-m, Math.min(m, d));
}
