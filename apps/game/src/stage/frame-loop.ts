/** Fixed simulation step (60 Hz, architecture §3). */
export const FIXED_DT = 1 / 60;
/** Longest real frame we account for; anything longer (tab stalls, breakpoints) is clamped to avoid a spiral. */
export const MAX_FRAME_DT = 0.1;
/** Hard cap on fixed steps per frame, a second guard against the spiral of death. */
export const MAX_STEPS_PER_FRAME = 8;

/** Result of advancing the clock by one rendered frame. */
export interface FrameStep {
  /** Real seconds since the previous frame (clamped), for presentation animation. */
  readonly dt: number;
  /** Scaled seconds fed to the accumulator this frame (dt × timeScale). */
  readonly scaledDt: number;
  /** Number of fixed steps to run before rendering. */
  readonly steps: number;
  /** Interpolation factor 0..1 between the last two fixed states. */
  readonly alpha: number;
}

/**
 * Accumulator clock: turns variable rAF timestamps into whole fixed steps plus an interpolation alpha.
 * It's pure (timestamps in, steps out) so it can be tested without a browser.
 */
export class FrameClock {
  private last: number | null = null;
  private acc = 0;
  private scale = 1;

  constructor(readonly fixedDt: number = FIXED_DT) {}

  /** Real-time multiplier on simulation time: 0 = hit-stop, 0.3 = slow-mo, 1 = normal. */
  get timeScale(): number {
    return this.scale;
  }
  set timeScale(s: number) {
    this.scale = Math.max(0, Number.isFinite(s) ? s : 1);
  }

  /** Forgets the previous timestamp so the next frame after a pause doesn't see a huge dt. */
  reset(): void {
    this.last = null;
  }

  /** Advances to `nowMs` (a rAF timestamp) and reports how many fixed steps are due. */
  advance(nowMs: number): FrameStep {
    const dt = this.last === null ? 0 : Math.min(MAX_FRAME_DT, Math.max(0, (nowMs - this.last) / 1000));
    this.last = nowMs;
    const scaledDt = dt * this.scale;
    this.acc += scaledDt;
    let steps = Math.floor(this.acc / this.fixedDt + 1e-9);
    if (steps > MAX_STEPS_PER_FRAME) {
      steps = MAX_STEPS_PER_FRAME;
      this.acc = 0;
    } else {
      this.acc -= steps * this.fixedDt;
      if (this.acc < 0) this.acc = 0;
    }
    return { dt, scaledDt, steps, alpha: Math.min(1, this.acc / this.fixedDt) };
  }
}

/** Rolling window of frame intervals used by the adaptive quality decision. */
export class FrameSampler {
  private readonly samples: number[] = [];
  constructor(readonly capacity: number) {}
  /** Adds a sample; returns true exactly once, when the window has just filled. */
  push(ms: number): boolean {
    if (this.samples.length >= this.capacity) return false;
    this.samples.push(ms);
    return this.samples.length === this.capacity;
  }
  /** Samples collected so far. */
  values(): readonly number[] {
    return this.samples;
  }
  /** Empties the window (e.g. after a tier change, to re-measure). */
  clear(): void {
    this.samples.length = 0;
  }
}
