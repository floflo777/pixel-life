/**
 * Engine-independent math for the sim (architecture §3). Angles are integers 0..4095 (4096 = one turn); trigonometry reads
 * the committed literal table in `tables.generated.ts`; everything else uses only + − × ÷ and `Math.sqrt/floor/round/abs/
 * min/max`, which IEEE 754 makes bit-identical on every JS engine.
 *
 * Convention: angle 0 points along +x (screen right), angle 1024 along +z (toward the camera, screen down).
 */
import { POW_115, SIN_QUARTER } from "./tables.generated.js";

/** Integer angle steps in one full turn. */
export const ANGLE_STEPS = 4096;
/** Bit mask that wraps any integer angle into 0..4095. */
export const ANGLE_MASK = 4095;
/** A quarter turn (90°). */
export const QUARTER_TURN = 1024;
/** A half turn (180°). */
export const HALF_TURN = 2048;

/** Wraps any integer angle into 0..4095. */
export function wrapAngle(a: number): number {
  return a & ANGLE_MASK;
}

/** Exact table sine of integer angle `a` (any integer; wrapped). */
export function sinA(a: number): number {
  const x = a & ANGLE_MASK;
  const i = x & 1023;
  switch (x >> 10) {
    case 0:
      return SIN_QUARTER[i] ?? 0;
    case 1:
      return SIN_QUARTER[1024 - i] ?? 0;
    case 2:
      return -(SIN_QUARTER[i] ?? 0);
    default:
      return -(SIN_QUARTER[1024 - i] ?? 0);
  }
}

/** Exact table cosine of integer angle `a` (any integer; wrapped). */
export function cosA(a: number): number {
  return sinA(a + QUARTER_TURN);
}

/** Smallest table index i in 0..1024 whose sine is nearest to `s` (0 ≤ s ≤ 1): a deterministic arcsine. */
function asinIndex(s: number): number {
  let lo = 0;
  let hi = 1024;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((SIN_QUARTER[mid] ?? 0) < s) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && s - (SIN_QUARTER[lo - 1] ?? 0) <= (SIN_QUARTER[lo] ?? 0) - s) return lo - 1;
  return lo;
}

/**
 * Deterministic atan2: the integer angle 0..4095 of vector (x, z), nearest table step. (0, 0) → 0.
 * Uses the arcsine of the smaller component so the search is always on the precise part of the table.
 */
export function angleOf(x: number, z: number): number {
  if (x === 0 && z === 0) return 0;
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const len = Math.sqrt(x * x + z * z);
  const base = az <= ax ? asinIndex(az / len) : QUARTER_TURN - asinIndex(ax / len);
  if (x >= 0) return z >= 0 ? base & ANGLE_MASK : (ANGLE_STEPS - base) & ANGLE_MASK;
  return z >= 0 ? HALF_TURN - base : (HALF_TURN + base) & ANGLE_MASK;
}

/** Signed smallest difference `b − a` between two integer angles, in −2048..2047. */
export function angleDelta(a: number, b: number): number {
  return ((b - a + HALF_TURN) & ANGLE_MASK) - HALF_TURN;
}

/** Integer angle for a whole number of degrees (rounded to the nearest step). */
export function degToAngle(deg: number): number {
  return Math.round((deg * ANGLE_STEPS) / 360);
}

/** Fling power curve p^1.15 for an input power 0..1023 (table lookup; out-of-range inputs clamp). */
export function powerCurve(pow: number): number {
  const i = pow < 0 ? 0 : pow > 1023 ? 1023 : Math.floor(pow);
  return POW_115[i] ?? 0;
}

/** Clamps `v` into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
