/** Minimum gap between full-frame impact sequences (GDD §2.7: photosensitivity, < 3 flashes/s). */
export const IMPACT_MIN_GAP_MS = 600;
/** Longest sequence the GDD uses (Old Gulp bite). */
export const IMPACT_MAX_FRAMES = 3;
/** How many rendered frames a local pop burst stays up (stepped, no easing). */
export const BURST_FRAMES = 3;

/** What the post pass draws for impacts on the current frame. */
export interface ImpactFrameState {
  /** 0 = none, 1 = full-frame 1-bit, 2 = full-frame 1-bit inverted. */
  readonly fullFrame: 0 | 1 | 2;
  /** Reduced-motion stand-in: a 1-frame ink border. */
  readonly border: boolean;
  /** Local 9-point burst in internal render px (y up), or null. */
  readonly burst: { readonly x: number; readonly y: number; readonly inner: number; readonly outer: number } | null;
}

/** Accessibility switches that change impacts. */
export interface ImpactAccess {
  reducedMotion: boolean;
  /** Separate from reduced motion: disables every inversion (GDD §2.7 "No flashes"). */
  noFlashes: boolean;
}

/**
 * Schedules impact frames under the photosensitivity cap. Requests inside the 600 ms gap are
 * dropped (not queued: a late flash reads as a glitch). Pure; the caller supplies time.
 */
export class ImpactScheduler {
  private lastStart = Number.NEGATIVE_INFINITY;
  private frames: (1 | 2)[] = [];
  private border = false;
  private burst: { x: number; y: number; inner: number; outer: number; left: number } | null = null;

  constructor(public access: ImpactAccess = { reducedMotion: false, noFlashes: false }) {}

  /**
   * Requests a full-frame impact of `frames` frames (1..3). Returns what will actually show:
   * "frame", "border" (reduced motion), or "none" (capped or no-flashes).
   */
  requestFrame(nowMs: number, frames = 2): "frame" | "border" | "none" {
    if (this.access.noFlashes) return "none";
    if (nowMs - this.lastStart < IMPACT_MIN_GAP_MS) return "none";
    this.lastStart = nowMs;
    if (this.access.reducedMotion) {
      this.border = true;
      return "border";
    }
    const n = Math.max(1, Math.min(IMPACT_MAX_FRAMES, Math.round(frames)));
    this.frames = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : 2));
    return "frame";
  }

  /** Requests a local pop burst centred at internal render px (y up). Returns false if suppressed. */
  requestBurst(x: number, y: number, outer = 26, inner = 11): boolean {
    if (this.access.noFlashes) return false;
    this.burst = { x, y, inner, outer, left: BURST_FRAMES };
    return true;
  }

  /** Consumes one rendered frame's worth of impact state. Call once per rendered frame. */
  next(): ImpactFrameState {
    const fullFrame = this.frames.shift() ?? 0;
    const border = this.border;
    this.border = false;
    let burst: ImpactFrameState["burst"] = null;
    if (this.burst) {
      const b = this.burst;
      // Stepped growth: the star opens over its frames instead of popping at full size.
      const k = (BURST_FRAMES - b.left + 1) / BURST_FRAMES;
      burst = { x: b.x, y: b.y, inner: b.inner * k, outer: b.outer * k };
      b.left -= 1;
      if (b.left <= 0) this.burst = null;
    }
    return { fullFrame, border, burst };
  }
}
