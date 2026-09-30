/**
 * Venue audio: sim beats → `@pl/audio` cue names, plus run music when the shell's audio exposes it. The venue never owns
 * an AudioContext (venue-kit rule); a shell backed by `AudioEngine` can pass the optional `playWith`/`music` extensions
 * for panning, combo pitch ladders and adaptive music, and plain `play(cue)` is the fallback.
 */
import type { VenueAudio } from "@pl/venue-kit";
import { KIND_NAMES } from "./sim-view";

/** Per-play parameters understood by `@pl/audio`'s `AudioEngine.play`. */
export interface CueParams {
  /** Normalised screen x (0 left .. 1 right) for pan. */
  x?: number;
  /** Ladder step (combo count, tooth index). */
  step?: number;
  gain?: number;
  detune?: number;
  delay?: number;
}

/** The subset of `@pl/audio`'s MusicDirector the venue drives. */
export interface VenueMusic {
  play(theme: "run" | "hub", seed?: number | string): void;
  stop(opts?: { at?: "now" | "bar"; fade?: number }): void;
  setIntensity(v: number): void;
  setMood(m: "normal" | "gulp"): void;
  setSlowmo(amount: number): void;
  stinger(name: "combo" | "gulp" | "burp" | "fill" | "results" | "door"): number | null;
}

/** Optional richer audio a shell may lend (structurally satisfied by wrapping an `AudioEngine`). */
export interface VenueAudioExt extends VenueAudio {
  playWith?(cue: string, params: CueParams): void;
  music?: VenueMusic;
}

/** Music intensity per wave phase (drop-in, snack, rush, frenzy, last light). */
export const PHASE_INTENSITY = [0.15, 0.35, 0.6, 0.85, 1] as const;

/** Smash cue for a creature kind. */
export function smashCue(kind: number): string {
  return `smash.${KIND_NAMES[kind] ?? "nib"}`;
}

/** Telegraph cue for a creature kind, or null when it has none. */
export function telegraphCue(kind: number): string | null {
  switch (KIND_NAMES[kind]) {
    case "nib":
      return "tele.nib";
    case "pogo":
      return "tele.pogo";
    case "clank":
      return "tele.clank";
    case "slurp":
      return "tele.slurp";
    case "fizz":
      return "tele.fizz";
    case "snatch":
      return "snatch.cackle";
    default:
      return null;
  }
}

/** Thin wrapper: routes to `playWith` when available, else plain `play`; tracks nothing, allocates little. */
export class RunAudio {
  constructor(private readonly audio: VenueAudioExt) {}

  /** Plays a cue with optional pan/step. */
  cue(name: string, params?: CueParams): void {
    if (params && this.audio.playWith) this.audio.playWith(name, params);
    else this.audio.play(name, params?.gain !== undefined ? { volume: params.gain } : undefined);
  }

  /** The music director, if the shell lends one. */
  get music(): VenueMusic | undefined {
    return this.audio.music;
  }
}
