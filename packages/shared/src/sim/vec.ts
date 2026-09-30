/** Small 2D vector helpers on the ground plane (x, z). Pure, allocation-free, sqrt-only (deterministic). */

/** Length of (x, z). */
export function len(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

/** Squared distance between two points. */
export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

/** Distance between two points. */
export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(dist2(ax, az, bx, bz));
}

/** Dot product. */
export function dot(ax: number, az: number, bx: number, bz: number): number {
  return ax * bx + az * bz;
}

/** 2D cross product (z-component of a × b in the x/z plane). */
export function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

/** Mutable 2D vector used as an out-parameter to avoid allocation in hot loops. */
export interface V2 {
  x: number;
  z: number;
}

/** Writes the unit vector of (x, z) into `out` (zero vector stays zero) and returns the original length. */
export function normalizeInto(out: V2, x: number, z: number): number {
  const l = Math.sqrt(x * x + z * z);
  if (l === 0) {
    out.x = 0;
    out.z = 0;
    return 0;
  }
  out.x = x / l;
  out.z = z / l;
  return l;
}
