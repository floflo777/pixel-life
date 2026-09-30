/**
 * The patch language: a sound is a list of timed layers (tones and filtered noise) rendered offline
 * to PCM. Data only, so cues are easy to review, test and tweak. Units: seconds, hertz, linear gain.
 */

/** Oscillator shapes. Squares are deliberately absent: the palette is rounded (GDD §8). */
export type Wave = "sine" | "triangle";

/** Shared amplitude envelope: smooth attack, exponential decay, smooth release into the layer end. */
export interface Envelope {
  /** Attack time in seconds (sin² ramp, click-free). Default 0.005. */
  readonly attack?: number;
  /** Exponential decay time constant in seconds; omit for a sustained layer. */
  readonly decay?: number;
  /** Release ramp at the end of the layer, in seconds. Default 0.02. */
  readonly release?: number;
}

/** A pitched oscillator with optional glide, FM and vibrato. */
export interface ToneLayer extends Envelope {
  readonly kind: "tone";
  /** Start time in seconds. */
  readonly at: number;
  /** Duration in seconds (the release happens inside it). */
  readonly dur: number;
  /** Start frequency in hertz. */
  readonly freq: number;
  /** End frequency in hertz for an exponential glide; omit for a steady pitch. */
  readonly freqEnd?: number;
  /** Glide time in seconds (default: the whole duration). */
  readonly glide?: number;
  /** Base wave (default sine). */
  readonly wave?: Wave;
  /** Triangle blend 0..1 mixed into a sine for the SDK's "chip" roundness. */
  readonly chip?: number;
  /** Peak level before normalization. */
  readonly level: number;
  /** FM modulator frequency ratio to the carrier (e.g. 3.5 for a bell). */
  readonly fmRatio?: number;
  /** FM modulation index at the start. */
  readonly fmIndex?: number;
  /** Time constant in seconds of the FM index decay (brightness fades like a struck bar). */
  readonly fmDecay?: number;
  /** Vibrato rate in hertz. */
  readonly vibratoHz?: number;
  /** Vibrato depth in cents. */
  readonly vibratoCents?: number;
}

/** Filter modes for noise layers (TPT state-variable filter). */
export type FilterMode = "lowpass" | "bandpass" | "highpass";

/** Deterministic white noise through a sweeping resonant filter. */
export interface NoiseLayer extends Envelope {
  readonly kind: "noise";
  readonly at: number;
  readonly dur: number;
  readonly level: number;
  readonly filter: FilterMode;
  /** Filter cutoff/centre in hertz at the start. */
  readonly cutoff: number;
  /** Cutoff at the end (exponential sweep). */
  readonly cutoffEnd?: number;
  /** Resonance (default 0.707). Band-pass output is normalized to unity peak gain. */
  readonly q?: number;
  /** Seed for the noise generator; the same seed renders the same grain. */
  readonly seed?: number;
  /** Slow cutoff wobble rate in hertz (wind gusts). */
  readonly lfoHz?: number;
  /** Cutoff wobble depth as a ratio (0.5 = ±50 %). */
  readonly lfoDepth?: number;
}

/** One layer of a patch. */
export type Layer = ToneLayer | NoiseLayer;

/** A complete sound: layers plus mastering hints. */
export interface Patch {
  readonly layers: readonly Layer[];
  /** Extra silence appended after the last layer (reverb-free "air"). Default 0.01. */
  readonly tail?: number;
  /** Peak level after normalization (default 0.8). */
  readonly peak?: number;
}
