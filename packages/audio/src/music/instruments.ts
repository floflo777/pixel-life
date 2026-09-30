/** Music instrument patches, rendered once per (instrument, pitch) and cached by the director. */
import { midiToHz } from "../math";
import { bell, marimba, noise, note, thump, tick } from "../synth/builders";
import type { Patch } from "../synth/patch";
import type { InstrumentName } from "./themes";

/** Pitched instruments cache per MIDI note; unpitched ones render once (their `midi` is ignored). */
export function isPitched(inst: InstrumentName): boolean {
  return !(inst === "kick" || inst === "hat" || inst === "brush" || inst === "snare");
}

/** The patch for an instrument at a MIDI pitch. Pure. */
export function instrumentPatch(inst: InstrumentName, midi: number): Patch {
  switch (inst) {
    case "marimba":
      return { layers: [marimba(midi, 0, 0.45, 0.8), note(midi + 12, 0, 0.12, 0.08, { decay: 0.04, attack: 0.002 })] };
    case "musicbox":
      return {
        layers: [
          note(midi, 0, 1.2, 0.8, {
            attack: 0.002,
            decay: 0.45,
            release: 0.1,
            fmRatio: 5.4,
            fmIndex: 0.6,
            fmDecay: 0.15,
          }),
          note(midi + 24, 0, 0.4, 0.12, { attack: 0.001, decay: 0.12 }),
        ],
      };
    case "pluck":
      return { layers: [note(midi, 0, 0.35, 0.8, { attack: 0.004, decay: 0.16, release: 0.04, chip: 0.24 })] };
    case "bass":
      return {
        layers: [
          note(midi, 0, 0.42, 0.9, { wave: "triangle", attack: 0.008, decay: 0.3, release: 0.06 }),
          note(midi, 0, 0.3, 0.3, { attack: 0.004, decay: 0.12 }),
        ],
      };
    case "pad":
      return {
        layers: [
          note(midi, 0, 3.2, 0.5, {
            wave: "triangle",
            attack: 0.35,
            decay: 2.4,
            release: 0.9,
            vibratoHz: 4.2,
            vibratoCents: 6,
          }),
          note(midi, 0, 3.2, 0.4, { attack: 0.5, decay: 2.4, release: 0.9, freqEnd: midiToHz(midi) * 1.004 }),
        ],
      };
    case "drone":
      return {
        tail: 0.02,
        layers: [
          note(midi - 12, 0, 2.8, 0.7, { attack: 0.4, release: 0.8, vibratoHz: 0.8, vibratoCents: 10 }),
          note(midi, 0, 2.8, 0.35, { wave: "triangle", attack: 0.6, release: 0.8 }),
          noise("lowpass", 180, 0, 2.8, 0.25, { attack: 0.6, release: 0.8, lfoHz: 0.7, lfoDepth: 0.5, seed: 9 }),
        ],
      };
    case "bell":
      return { layers: [bell(midi, 0, 2.2, 0.6, { fmIndex: 1.4, decay: 0.9, release: 0.4 })] };
    case "kick":
      return { layers: [thump(150, 44, 0, 0.26, 1), tick(0, 0.15, 1800)] };
    case "hat":
      return {
        layers: [noise("bandpass", 7500, 0, 0.05, 1, { q: 0.9, attack: 0.001, decay: 0.014, release: 0.01, seed: 3 })],
      };
    case "brush":
      return {
        layers: [noise("bandpass", 5200, 0, 0.14, 1, { q: 0.7, attack: 0.02, decay: 0.05, release: 0.03, seed: 5 })],
      };
    case "snare":
      return {
        layers: [
          noise("bandpass", 1800, 0, 0.14, 0.9, { q: 0.8, attack: 0.001, decay: 0.045, seed: 7 }),
          note(50, 0, 0.1, 0.4, { freqEnd: 150, attack: 0.001, decay: 0.03 }),
        ],
      };
  }
}

/** Hub field-ambience loop: soft wind gusts (rendered long, then made seamless by the director). */
export const WIND_PATCH: Patch = {
  tail: 0,
  layers: [
    noise("bandpass", 420, 0, 8.5, 0.8, { q: 0.6, attack: 0.01, release: 0.01, lfoHz: 0.25, lfoDepth: 0.6, seed: 12 }),
    noise("lowpass", 250, 0, 8.5, 0.5, { attack: 0.01, release: 0.01, lfoHz: 0.125, lfoDepth: 0.4, seed: 13 }),
  ],
};
