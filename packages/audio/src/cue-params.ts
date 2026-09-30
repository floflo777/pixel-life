/** Pure per-play parameter maths: pitch, level and pan for one cue start. Allocation-free. */
import type { CueDef, StepMode } from "./cues";
import { MAJOR_PENTATONIC, clamp, panForScreenX, scaleStep, semitonesToRatio } from "./math";

/** Highest step honoured (a combo of 16 is two octaves up: beyond that the plinks get shrill). */
export const MAX_STEP = 10;

/** Level multiplier applied to `heavy` cues when reduced audio is on. */
export const REDUCED_HEAVY_GAIN = 0.5;

/** Pan width at full and reduced audio (reduced keeps sounds nearer the centre). */
export const PAN_WIDTH = 0.7;
export const REDUCED_PAN_WIDTH = 0.35;

/** Semitone offset for a `step` under a step mode (combo 0 = the cue's own pitch). */
export function stepSemitones(mode: StepMode, step: number): number {
  if (mode === "none" || !(step > 0)) return 0;
  const s = Math.min(Math.trunc(step), MAX_STEP);
  return mode === "pentatonic" ? scaleStep(MAJOR_PENTATONIC, s) : s;
}

/**
 * Playback rate for one start: step transposition + caller detune + random spread.
 * `random01` is a uniform sample in [0, 1) supplied by the engine, so this stays pure and testable.
 */
export function cuePlaybackRate(def: CueDef, step: number, detuneSemitones: number, random01: number): number {
  const spread = def.pitchVariance * (random01 * 2 - 1);
  return semitonesToRatio(stepSemitones(def.step, step) + detuneSemitones + spread);
}

/** Linear voice level for one start: registry gain × caller gain, softened for heavy cues in reduced audio. */
export function cueLevel(def: CueDef, gain: number, reducedAudio: boolean): number {
  const heavy = reducedAudio && def.heavy === true ? REDUCED_HEAVY_GAIN : 1;
  return clamp(def.gain * clamp(gain, 0, 2) * heavy, 0, 2);
}

/** Stereo pan for a normalized screen x, narrower in reduced audio. */
export function cuePan(x01: number, reducedAudio: boolean): number {
  return panForScreenX(x01, reducedAudio ? REDUCED_PAN_WIDTH : PAN_WIDTH);
}

/** Whether a cue plays at all under the current accessibility setting. */
export function cueAllowed(def: CueDef, reducedAudio: boolean): boolean {
  return def.essential || !reducedAudio;
}
