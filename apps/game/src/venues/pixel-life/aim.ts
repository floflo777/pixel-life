/**
 * Aim preview maths (GDD §2.2/§2.3): the launch speed a power buys and the first 0.5 s of the slide, sampled as the
 * 8 trajectory dots. Uses the sim's constants and launch formula; the sim stays the authority on where you go.
 */
import { launchSpeed as simLaunchSpeed, SimTuning, slideDistance } from "@pl/shared";
import { powerToSim } from "./input";

/** Launch constants (GDD §2.3), read from the sim's tuning so the preview can never drift from the sim. */
export const LAUNCH = {
  vMax: SimTuning.V_MAX,
  mRef: SimTuning.M_REF,
  dampConst: SimTuning.DAMP_CONST,
  dampLin: SimTuning.DAMP_LIN,
} as const;
/** Trajectory preview: 8 dots over the first 0.5 s. */
export const PREVIEW = { dots: 8, seconds: 0.5 } as const;

/** Launch speed (u/s) for power `p` (0..1) and mass `m` (present pixels): the sim's own formula at its power step. */
export function launchSpeed(p: number, m: number): number {
  return simLaunchSpeed(powerToSim(p), m);
}

/**
 * Tap-to-target (GDD §2.2): the power (0..1) whose slide stops `dist` u away for a Friend of mass `m`, using the sim's
 * damping integrator. Clamps to full power when the point is out of reach.
 */
export function powerForDistance(dist: number, m: number): number {
  if (!(dist > 0)) return 0;
  let lo = 0;
  let hi = 1023;
  if (slideDistance(simLaunchSpeed(hi, m), 1) <= dist) return 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (slideDistance(simLaunchSpeed(mid, m), 1) < dist) lo = mid;
    else hi = mid;
  }
  return hi / 1023;
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
