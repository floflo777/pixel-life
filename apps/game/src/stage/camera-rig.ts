import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";

const DEG = Math.PI / 180;

/** Orbit pose of the camera around its focus point. Angles in degrees, pitch = downward tilt. */
export interface OrbitPose {
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
}

/** Limits that keep the Friend's front plate readable (art bible §2/§3). */
export interface OrbitLimits {
  /** Yaw is clamped to baseYaw ± this (front face ≤ 20° off the view vector). */
  readonly maxYawOffset: number;
  readonly minPitch: number;
  readonly maxPitch: number;
  readonly minDistance: number;
  readonly maxDistance: number;
}

/** Hub framing from frame 2: FOV 30°, pitch 28°. */
export const HUB_POSE: OrbitPose = { yaw: 0, pitch: 28, distance: 21, fov: 30 };
/** In-run framing: pitch 32° (the bible overrides the GDD's 38°), FOV 28–30°. */
export const RUN_POSE: OrbitPose = { yaw: 0, pitch: 32, distance: 12, fov: 29 };
/** Default clamps. */
export const DEFAULT_LIMITS: OrbitLimits = {
  maxYawOffset: 20,
  minPitch: 12,
  maxPitch: 60,
  minDistance: 4,
  maxDistance: 60,
};

/** Juice constants (GDD §2.7, art bible §3.1). */
export const SHAKE = { maxOffset: 0.8, maxRollDeg: 1.5, decayPerS: 1.6, hz: 24 } as const;
export const DIP = { pitch: 18, distanceMul: 0.92, rampMs: 160, keys: 4 } as const;
export const PUNCH = { fovMul: 0.94, ms: 150 } as const;

/** Camera offset from its focus for a pose: yaw 0 puts the camera on +Z looking toward −Z. */
export function orbitOffset(yawDeg: number, pitchDeg: number, distance: number): [number, number, number] {
  const y = yawDeg * DEG;
  const p = pitchDeg * DEG;
  const h = Math.cos(p) * distance;
  return [Math.sin(y) * h, Math.sin(p) * distance, Math.cos(y) * h];
}

/**
 * Largest camera distance at which a sprite pixel of `unit` world units still covers `minPx` render
 * pixels at the focus (the readability rule: ≥ 3 render px = ≥ 6 CSS px at pixel-scale 2).
 */
export function maxReadableDistance(fovDeg: number, renderHeightPx: number, unit = 0.15, minPx = 3): number {
  const t = Math.tan((fovDeg * DEG) / 2);
  return (unit * renderHeightPx) / (2 * minPx * t);
}

/** Render pixels one world unit covers at `distance` (vertical, at the screen centre). */
export function pixelsPerUnit(fovDeg: number, renderHeightPx: number, distance: number): number {
  return renderHeightPx / (2 * distance * Math.tan((fovDeg * DEG) / 2));
}

/**
 * Camera distance for a pose on a given viewport: pulls back until `minVisibleWidth` world units fit
 * horizontally (portrait phones), but never past the readability limit for `unit`-sized sprite pixels.
 */
export function framedDistance(
  distance: number,
  fovDeg: number,
  aspect: number,
  renderHeightPx: number,
  minVisibleWidth: number | null,
  unit: number | null = 0.15,
): number {
  let d = distance;
  if (minVisibleWidth !== null && aspect > 0) {
    const halfTan = Math.tan((fovDeg * DEG) / 2) * aspect;
    d = Math.max(d, minVisibleWidth / (2 * halfTan));
  }
  if (unit !== null) d = Math.min(d, Math.max(distance, maxReadableDistance(fovDeg, renderHeightPx, unit)));
  return d;
}

/** Frame-rate independent smoothing weight for a damped lerp at `ratePerS`. */
export function dampFactor(ratePerS: number, dt: number): number {
  return 1 - Math.exp(-Math.max(0, ratePerS) * Math.max(0, dt));
}

/** Clamps a pose to limits around `baseYaw`. Returns a new pose. */
export function clampPose(p: OrbitPose, limits: OrbitLimits, baseYaw = 0): OrbitPose {
  const c = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  return {
    yaw: c(p.yaw, baseYaw - limits.maxYawOffset, baseYaw + limits.maxYawOffset),
    pitch: c(p.pitch, limits.minPitch, limits.maxPitch),
    distance: c(p.distance, limits.minDistance, limits.maxDistance),
    fov: c(p.fov, 10, 90),
  };
}

/** Deterministic value noise in [-1, 1], held constant for 1/hz seconds (the "stepped" shake). */
export function steppedNoise(seed: number, tSeconds: number, hz: number = SHAKE.hz): number {
  const step = Math.floor(tSeconds * hz);
  let h = Math.imul(step ^ Math.imul(seed, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/**
 * Pitch-dip envelope: 0 → 1 over `rampMs` in `keys` stepped keys, holds for `holdMs`, then back
 * down the same way. Stepped, never eased: the brand's motion rule.
 */
export function dipEnvelope(
  elapsedMs: number,
  holdMs: number,
  rampMs: number = DIP.rampMs,
  keys: number = DIP.keys,
): number {
  if (elapsedMs < 0) return 0;
  const q = (v: number): number => Math.min(keys, Math.floor(v * keys + 1e-9) + 1) / keys;
  if (elapsedMs < rampMs) return q(elapsedMs / rampMs);
  if (elapsedMs < rampMs + holdMs) return 1;
  const out = elapsedMs - rampMs - holdMs;
  if (out >= rampMs) return 0;
  return 1 - q(out / rampMs);
}

/** Everything juice-related the rig tracks, exposed for tests and debug overlays. */
export interface RigJuice {
  trauma: number;
  dip: { t: number; holdMs: number } | null;
  punch: number;
}

/**
 * Orbit camera rig: follows a focus point with a damped lerp and dead zone, clamps yaw/pitch/distance,
 * and layers shake, FOV punch and the slow-mo pitch dip on top. Honours reduced motion by skipping
 * every motion effect (the static pose still updates).
 */
export class CameraRig {
  readonly focus = new Vector3();
  readonly goal = new Vector3();
  pose: OrbitPose;
  baseYaw: number;
  limits: OrbitLimits;
  /** Follow rate per second (bible: 4/s in the Hub, GDD: 6/s in-run). */
  followRate = 4;
  /** Focus moves only once the goal leaves this radius (world units): the "dead zone". */
  deadZone = 0;
  reducedMotion: boolean;
  /** World width that should stay visible at the focus (null = fixed distance). */
  minVisibleWidth: number | null = null;
  /** Sprite-pixel size the readability clamp protects (null disables the clamp). */
  readableUnit: number | null = 0.15;
  /** Camera-to-focus distance after framing and dip, as of the last update(). */
  distance = 0;
  private aspect = 16 / 9;
  private renderHeight = 360;
  readonly juice: RigJuice = { trauma: 0, dip: null, punch: 0 };
  private time = 0;
  private readonly seed: number;
  private readonly tmp = new Vector3();

  constructor(
    readonly camera: PerspectiveCamera,
    opts: { pose?: OrbitPose; limits?: OrbitLimits; reducedMotion?: boolean; seed?: number } = {},
  ) {
    this.pose = { ...(opts.pose ?? HUB_POSE) };
    this.baseYaw = this.pose.yaw;
    this.limits = opts.limits ?? DEFAULT_LIMITS;
    this.reducedMotion = opts.reducedMotion ?? false;
    this.seed = opts.seed ?? 1;
  }

  /** Tells the rig the viewport shape and internal render height (the stage calls this on resize). */
  setViewport(aspect: number, renderHeightPx: number): void {
    this.aspect = aspect;
    this.renderHeight = renderHeightPx;
  }

  /** Sets where the rig wants to look; the focus eases toward it in update(). */
  follow(target: Vector3): void {
    this.goal.copy(target);
  }

  /** Jumps focus to the goal (scene cuts, spawns). */
  snap(target?: Vector3): void {
    if (target) this.goal.copy(target);
    this.focus.copy(this.goal);
  }

  /** Adds shake trauma (clamped to 1). No-op under reduced motion. */
  shake(amount: number): void {
    if (this.reducedMotion) return;
    this.juice.trauma = Math.min(1, this.juice.trauma + Math.max(0, amount));
  }

  /** Starts the bite slow-mo dip: pitch → 18°, distance −8 %, held for `holdMs`. No-op under reduced motion. */
  dip(holdMs: number): void {
    if (this.reducedMotion) return;
    this.juice.dip = { t: 0, holdMs };
  }

  /** FOV punch (−6 % for 150 ms). No-op under reduced motion. */
  punch(): void {
    if (this.reducedMotion) return;
    this.juice.punch = PUNCH.ms;
  }

  /** Current dip strength 0..1. */
  dipAmount(): number {
    const d = this.juice.dip;
    return d ? dipEnvelope(d.t, d.holdMs) : 0;
  }

  /** Advances follow and juice by `dt` real seconds and writes the camera transform. */
  update(dt: number): void {
    this.time += dt;
    const g = this.goal;
    const f = this.focus;
    this.tmp.subVectors(g, f);
    const dist = this.tmp.length();
    if (dist > this.deadZone) {
      const excess = this.tmp.multiplyScalar((dist - this.deadZone) / Math.max(dist, 1e-9));
      f.addScaledVector(excess, dampFactor(this.followRate, dt));
    }

    const j = this.juice;
    j.trauma = Math.max(0, j.trauma - SHAKE.decayPerS * dt);
    j.punch = Math.max(0, j.punch - dt * 1000);
    if (j.dip) {
      j.dip.t += dt * 1000;
      if (j.dip.t >= j.dip.holdMs + 2 * DIP.rampMs) j.dip = null;
    }
    if (this.reducedMotion) {
      j.trauma = 0;
      j.dip = null;
      j.punch = 0;
    }

    const base = clampPose(this.pose, this.limits, this.baseYaw);
    const k = this.dipAmount();
    const pitch = base.pitch + (DIP.pitch - base.pitch) * k;
    const framed = framedDistance(
      base.distance,
      base.fov,
      this.aspect,
      this.renderHeight,
      this.minVisibleWidth,
      this.readableUnit,
    );
    const distance = framed * (1 + (DIP.distanceMul - 1) * k);
    this.distance = distance;
    const fov = base.fov * (j.punch > 0 ? PUNCH.fovMul : 1);

    const [ox, oy, oz] = orbitOffset(base.yaw, pitch, distance);
    const cam = this.camera;
    cam.position.set(f.x + ox, f.y + oy, f.z + oz);
    cam.up.set(0, 1, 0);
    cam.lookAt(f);

    const s = j.trauma * j.trauma;
    if (s > 0) {
      const t = this.time;
      cam.position.x += SHAKE.maxOffset * s * steppedNoise(this.seed, t);
      cam.position.y += SHAKE.maxOffset * s * steppedNoise(this.seed + 1, t);
      cam.rotateZ(SHAKE.maxRollDeg * DEG * s * steppedNoise(this.seed + 2, t));
    }
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
