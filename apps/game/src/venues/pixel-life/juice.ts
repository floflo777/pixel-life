/**
 * Juice timing (GDD §2.7, art bible §7): which feedback each gameplay beat gets, and the real-time clock that turns
 * hit-stops and slow-mo ramps into the stage's `timeScale`. Pure: the caller passes real milliseconds.
 */

/** One slow-mo segment: hold `scale` for `ms` real milliseconds. */
export interface SlowStep {
  readonly scale: number;
  readonly ms: number;
}

/** The feedback a beat asks for. Absent fields mean "none". */
export interface JuicePlan {
  readonly hitStopMs?: number;
  /** Slow-mo segments played in order after the hit-stop (the last one returns to 1.0 afterwards). */
  readonly slow?: readonly SlowStep[];
  /** Shake trauma added (the rig squares it and caps at 1). */
  readonly trauma?: number;
  /** Full-frame 1-bit impact frames (the post scheduler enforces the 600 ms gap). */
  readonly impactFrames?: number;
  /** FOV punch. */
  readonly punch?: boolean;
  /** Camera slow-mo pitch dip, held for this many ms. */
  readonly dipMs?: number;
}

/** A beat the venue recognises (derived from sim events plus a little context). */
export type Beat =
  | { readonly kind: "pop"; readonly combo: number; readonly armoured: boolean }
  | { readonly kind: "plate" }
  | { readonly kind: "bite"; readonly px: number }
  | { readonly kind: "ringout" }
  | { readonly kind: "glance" }
  | { readonly kind: "clutch" }
  | { readonly kind: "gulpBite" }
  | { readonly kind: "tooth" }
  | { readonly kind: "end" };

/** The GDD §2.7 table. */
export function planFor(b: Beat): JuicePlan {
  switch (b.kind) {
    case "pop":
      if (b.armoured) return { hitStopMs: 120, trauma: 0.35, impactFrames: 2, punch: true };
      return b.combo >= 3
        ? { hitStopMs: 80, trauma: 0.2, ...(b.combo >= 5 ? { punch: true } : {}) }
        : { hitStopMs: 50, trauma: 0.15 };
    case "plate":
      return { hitStopMs: 120, trauma: 0.35, punch: true };
    case "bite": {
      const px = Math.max(1, b.px);
      return {
        hitStopMs: 90,
        slow: [
          { scale: 0.3, ms: 400 },
          { scale: 0.6, ms: 80 },
          { scale: 1, ms: 80 },
        ],
        trauma: Math.min(0.6, 0.3 * px),
        ...(px >= 3 ? { impactFrames: 2 } : {}),
        dipMs: 400,
      };
    }
    case "ringout":
      return { slow: [{ scale: 0.5, ms: 300 }], trauma: 0.8, impactFrames: 2 };
    case "glance":
      return { hitStopMs: 60, trauma: 0.2 };
    case "clutch":
      return { hitStopMs: 40 };
    case "gulpBite":
      return { hitStopMs: 200, slow: [{ scale: 0.4, ms: 600 }], trauma: 1, impactFrames: 3, dipMs: 600 };
    case "tooth":
      return { hitStopMs: 120, trauma: 0.35, impactFrames: 2, punch: true };
    case "end":
      return { slow: [{ scale: 0.5, ms: 500 }] };
  }
}

/** Slow-mo floor under reduced motion (GDD: "slow-mo capped at 0.6×"). */
export const REDUCED_SLOW_FLOOR = 0.6;
/** Longest hit-stop we ever hold, so overlapping beats cannot freeze the run. */
export const MAX_HIT_STOP_MS = 250;

/**
 * Real-time clock for hit-stop and slow-mo. Hit-stops extend to the latest end requested (never stack beyond
 * `MAX_HIT_STOP_MS` from now); a new slow-mo replaces the current one only if it is slower, so a string of bites keeps the
 * deepest dip instead of stuttering.
 */
export class TimeWarp {
  private stopUntil = Number.NEGATIVE_INFINITY;
  private slowStart = 0;
  private slow: readonly SlowStep[] = [];

  constructor(public reducedMotion = false) {}

  /** Holds the sim for `ms` starting at `now`. */
  hitStop(now: number, ms: number): void {
    if (!(ms > 0)) return;
    this.stopUntil = Math.max(this.stopUntil, Math.min(now + ms, now + MAX_HIT_STOP_MS));
  }

  /** Starts a slow-mo program at `startAt` (usually the end of the hit-stop). */
  slowmo(startAt: number, steps: readonly SlowStep[]): void {
    if (steps.length === 0) return;
    const cur = this.slowScale(startAt);
    const next = steps[0]?.scale ?? 1;
    if (cur < 1 && next >= cur) return;
    this.slowStart = startAt;
    this.slow = steps;
  }

  /** Applies a plan's timing parts at `now`. */
  apply(now: number, p: JuicePlan): void {
    if (p.hitStopMs) this.hitStop(now, p.hitStopMs);
    if (p.slow) this.slowmo(Math.max(now, this.stopUntil), p.slow);
  }

  /** True while a hit-stop holds the sim. */
  stopped(now: number): boolean {
    return now < this.stopUntil;
  }

  /** Sim time multiplier at `now`: 0 during hit-stop, the slow-mo step, else 1. */
  scale(now: number): number {
    if (this.stopped(now)) return 0;
    return this.slowScale(now);
  }

  /** True while any slow-mo step below 1 is active (for the music detune). */
  slowActive(now: number): boolean {
    return this.slowScale(now) < 1;
  }

  /** Clears everything (pause, run end). */
  reset(): void {
    this.stopUntil = Number.NEGATIVE_INFINITY;
    this.slow = [];
  }

  private slowScale(now: number): number {
    let t = now - this.slowStart;
    if (t < 0) return 1;
    for (const s of this.slow) {
      if (t < s.ms) return this.reducedMotion ? Math.max(REDUCED_SLOW_FLOOR, s.scale) : s.scale;
      t -= s.ms;
    }
    return 1;
  }
}

/** Squash/stretch along velocity (GDD §2.3): stretch `1 + min(v/60, 0.35)`, volume-preserving. */
export function stretchFor(speed: number): { along: number; across: number } {
  const along = 1 + Math.min(Math.max(0, speed) / 60, 0.35);
  return { along, across: 1 / Math.sqrt(along) };
}

/** Impact squash keyframes: 0.75 for 80 ms, 1.10 for 60 ms, then 1 (stepped, no easing). */
export function impactSquash(msSince: number): number {
  if (msSince < 0) return 1;
  if (msSince < 80) return 0.75;
  if (msSince < 140) return 1.1;
  return 1;
}

/** Combo callout scale: ×1.2 per step above 2, capped at ×2 (GDD §2.7). */
export function comboScale(combo: number): number {
  if (combo < 3) return 1;
  return Math.min(2, 1.2 ** (combo - 2));
}
