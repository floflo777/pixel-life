/**
 * Small, allocation-free audio maths shared by the renderer, the engine and the music system.
 * Audio is presentation, not simulation: floating-point transcendental functions are fine here.
 */

/** Clamps `value` into `[min, max]`; NaN collapses to `min` so bad input can never reach an AudioParam. */
export function clamp(value: number, min: number, max: number): number {
  if (!(value >= min)) return min;
  return value > max ? max : value;
}

/** Converts a MIDI note number (69 = A4 = 440 Hz) to a frequency in hertz. */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Converts a pitch offset in semitones to a playback-rate ratio (12 semitones = ×2). */
export function semitonesToRatio(semitones: number): number {
  return 2 ** (semitones / 12);
}

/** Converts decibels to linear gain (0 dB = 1, −6 dB ≈ 0.5). */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Major pentatonic intervals in semitones from the root (C D E G A). */
export const MAJOR_PENTATONIC: readonly number[] = [0, 2, 4, 7, 9];
/** Minor pentatonic intervals in semitones from the root (C Eb F G Bb). */
export const MINOR_PENTATONIC: readonly number[] = [0, 3, 5, 7, 10];

/**
 * Semitone offset of the `step`-th note of a repeating scale (step 0 = root, negative steps go down).
 * Used for combo-aware pitch climbs: step 5 of the major pentatonic is one octave up.
 */
export function scaleStep(scale: readonly number[], step: number): number {
  const size = scale.length;
  const index = Math.trunc(step);
  const octave = Math.floor(index / size);
  const degree = index - octave * size;
  return octave * 12 + (scale[degree] ?? 0);
}

/**
 * Maps a normalized screen x (0 = left edge, 1 = right edge) to a stereo pan in [−width, width].
 * Width < 1 keeps edge sounds audible in both ears, which matters on phones and for one-sided hearing.
 */
export function panForScreenX(x01: number, width: number): number {
  const w = clamp(width, 0, 1);
  return clamp((clamp(x01, 0, 1) * 2 - 1) * w, -1, 1);
}

/** Smooth 0→1 ramp between `edge0` and `edge1` (cubic Hermite), used to crossfade music layers. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Exponential interpolation between two positive values (perceptually even for frequencies). */
export function expLerp(from: number, to: number, t: number): number {
  return from * (to / from) ** clamp(t, 0, 1);
}
