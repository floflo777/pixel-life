/**
 * Aim preview maths (GDD §2.2/§2.3): the launch speed a power buys and the first 0.5 s of the slide, sampled as the
 * 8 trajectory dots. Mirrors the sim's constants for the preview only; the sim stays the authority on where you go.
 */

/** Launch constants (GDD §2.3). */
export const LAUNCH = { vMax: 70, mRef: 70, massMin: 0.8, massMax: 1.35, dampConst: 10, dampLin: 1.8 } as const;
/** Trajectory preview: 8 dots over the first 0.5 s. */
export const PREVIEW = { dots: 8, seconds: 0.5 } as const;

/** Launch speed (u/s) for power `p` (0..1) and mass `m` (present pixels). */
export function launchSpeed(p: number, m: number): number {
  const mf = Math.min(LAUNCH.massMax, Math.max(LAUNCH.massMin, Math.sqrt(LAUNCH.mRef / Math.max(1, m))));
  return LAUNCH.vMax * Math.max(0, Math.min(1, p)) ** 1.15 * mf;
}

/**
 * Distances (u) along the launch direction at each preview dot, integrating the ground damping
 * `dv/dt = −(10 + 1.8 v)` at 60 Hz like the sim.
 */
export function previewDistances(p: number, m: number): number[] {
  const out: number[] = [];
  let v = launchSpeed(p, m);
  let d = 0;
  const dt = 1 / 60;
  const steps = Math.round(PREVIEW.seconds * 60);
  let next = 1;
  for (let i = 1; i <= steps && next <= PREVIEW.dots; i++) {
    v = Math.max(0, v - (LAUNCH.dampConst + LAUNCH.dampLin * v) * dt);
    d += v * dt;
    if (i === Math.round((next * steps) / PREVIEW.dots)) {
      out.push(d);
      next++;
    }
  }
  return out.slice(0, PREVIEW.dots);
}

/**
 * Folds preview points back inside an ellipse island (a, b semi-axes) so the dots show the first rim bounce with the
 * bumper restitution; points are (x, z) in u, starting at (x0, z0) along unit (dx, dz).
 */
export function previewPoints(
  x0: number,
  z0: number,
  dx: number,
  dz: number,
  dists: readonly number[],
  a: number,
  b: number,
  restitution = 0.55,
): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  let x = x0;
  let z = z0;
  let ux = dx;
  let uz = dz;
  let prev = 0;
  let scale = 1;
  let bounced = false;
  for (const d of dists) {
    let step = (d - prev) * scale;
    prev = d;
    const nx = x + ux * step;
    const nz = z + uz * step;
    if (!bounced && (nx / a) ** 2 + (nz / b) ** 2 > 1) {
      // Reflect off the ellipse normal at the crossing (approximated at the current point).
      const gx = x / (a * a);
      const gz = z / (b * b);
      const gl = Math.hypot(gx, gz) || 1;
      const nnx = gx / gl;
      const nnz = gz / gl;
      const dot = ux * nnx + uz * nnz;
      ux -= 2 * dot * nnx;
      uz -= 2 * dot * nnz;
      scale = restitution;
      step *= restitution;
      bounced = true;
    }
    x += ux * step;
    z += uz * step;
    pts.push({ x, z });
  }
  return pts;
}
