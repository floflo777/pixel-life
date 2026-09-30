import { midiToHz } from "../math";
import type { NoiseLayer, ToneLayer } from "./patch";

type ToneOptions = Partial<Omit<ToneLayer, "kind" | "at" | "dur" | "freq" | "level">>;
type NoiseOptions = Partial<Omit<NoiseLayer, "kind" | "at" | "dur" | "level" | "filter" | "cutoff">>;

/** A tone at a MIDI pitch; `endMidi` (in options as `freqEnd`) can be given in Hz directly. */
export function note(midi: number, at: number, dur: number, level: number, options: ToneOptions = {}): ToneLayer {
  return { kind: "tone", at, dur, freq: midiToHz(midi), level, ...options };
}

/** A tone at a frequency in hertz. */
export function tone(freq: number, at: number, dur: number, level: number, options: ToneOptions = {}): ToneLayer {
  return { kind: "tone", at, dur, freq, level, ...options };
}

/** A rounded pluck in the FriendSDK style: sine with a triangle "chip" blend and a fast decay. */
export function pluck(midi: number, at: number, dur: number, level: number, options: ToneOptions = {}): ToneLayer {
  return note(midi, at, dur, level, { attack: 0.004, decay: dur * 0.6, release: 0.03, chip: 0.2, ...options });
}

/** An FM bell (ratio 3.5 by default, GDD §8 "gold glance"). */
export function bell(midi: number, at: number, dur: number, level: number, options: ToneOptions = {}): ToneLayer {
  return note(midi, at, dur, level, {
    attack: 0.002,
    decay: dur * 0.45,
    release: 0.05,
    fmRatio: 3.5,
    fmIndex: 2.2,
    fmDecay: dur * 0.3,
    ...options,
  });
}

/** A wooden marimba-like FM voice (modulator at ×4, index falling fast). */
export function marimba(midi: number, at: number, dur: number, level: number, options: ToneOptions = {}): ToneLayer {
  return note(midi, at, dur, level, {
    attack: 0.002,
    decay: dur * 0.35,
    release: 0.03,
    fmRatio: 4,
    fmIndex: 3,
    fmDecay: 0.03,
    ...options,
  });
}

/** A soft SDK-style mechanical tick: very short filtered noise. */
export function tick(at: number, level: number, cutoff = 3200, options: NoiseOptions = {}): NoiseLayer {
  return {
    kind: "noise",
    at,
    dur: 0.035,
    level,
    filter: "bandpass",
    cutoff,
    q: 1.2,
    attack: 0.001,
    decay: 0.008,
    release: 0.008,
    ...options,
  };
}

/** Filtered noise (whooshes, puffs, rumbles). */
export function noise(
  filter: NoiseLayer["filter"],
  cutoff: number,
  at: number,
  dur: number,
  level: number,
  options: NoiseOptions = {},
): NoiseLayer {
  return { kind: "noise", at, dur, level, filter, cutoff, attack: 0.01, release: 0.04, ...options };
}

/** A warm low FM thump (kick-like body for impacts). */
export function thump(fromHz: number, toHz: number, at: number, dur: number, level: number): ToneLayer {
  return tone(fromHz, at, dur, level, {
    freqEnd: toHz,
    glide: dur * 0.5,
    attack: 0.002,
    decay: dur * 0.4,
    release: 0.03,
    fmRatio: 1,
    fmIndex: 1.2,
    fmDecay: 0.02,
  });
}
