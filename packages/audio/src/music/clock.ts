/** Tempo-grid maths for the music scheduler and tempo-synced stingers. Pure. */
import { STEPS_PER_BAR } from "./themes";

/** Grid a stinger or transition snaps to. */
export type Quantize = "step" | "beat" | "bar";

/** Seconds per 16th-note step at `bpm`. */
export function stepDuration(bpm: number): number {
  return 60 / bpm / 4;
}

/**
 * Audio-clock time of `step` counted from `origin`, with swing delaying off-beat 8ths
 * (`swing` is a fraction of one step, 0 = straight).
 */
export function stepTime(origin: number, step: number, bpm: number, swing = 0): number {
  const d = stepDuration(bpm);
  const offbeat8th = ((step % 4) + 4) % 4 === 2;
  return origin + step * d + (offbeat8th ? swing * d : 0);
}

/** The step index sounding at `time` (floor), from `origin`. Negative before the origin. */
export function stepAt(origin: number, time: number, bpm: number): number {
  return Math.floor((time - origin) / stepDuration(bpm) + 1e-9);
}

/** Steps per quantize unit (4/4). */
export function quantizeSize(q: Quantize): number {
  return q === "bar" ? STEPS_PER_BAR : q === "beat" ? 4 : 1;
}

/** Smallest step ≥ `step` on the `q` grid: where a tempo-synced stinger must start. */
export function nextQuantizedStep(step: number, q: Quantize): number {
  const size = quantizeSize(q);
  return Math.ceil(step / size) * size;
}

/**
 * Number of steps that fall inside the lookahead window: all steps from `nextStep` whose time is
 * before `now + lookahead`. The scheduler loops this many times per tick.
 */
export function stepsDue(origin: number, nextStep: number, now: number, lookahead: number, bpm: number): number {
  const horizon = now + lookahead;
  const d = stepDuration(bpm);
  const last = Math.floor((horizon - origin) / d - 1e-9);
  return Math.max(0, last - nextStep + 1);
}
