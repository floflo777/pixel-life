/**
 * The SFX cue registry. Every cue is a procedural patch plus mixing metadata; the type `CueName`
 * is derived from this table so call sites are checked at compile time.
 *
 * Palette (GDD §8, FriendSDK sound kit): rounded sine/triangle plucks, warm low FM thumps, soft noise
 * ticks and a wooden marimba FM voice. In-run musical cues sit in F major pentatonic (the run music's
 * key); meta/reward cues keep the SDK's C major motifs so they sound like the same family.
 */
import { bell, marimba, noise, note, pluck, thump, tick, tone } from "./synth/builders";
import type { Patch } from "./synth/patch";

/** How the `step` play parameter maps to pitch. */
export type StepMode = "none" | "pentatonic" | "semitone";

/** Cue families, used by the dev page and by reduced-audio policy. */
export type CueGroup = "fling" | "creature" | "pixel" | "run" | "gulp" | "meta" | "hub" | "ui";

/** Mixing and playback metadata for one cue. */
export interface CueDef {
  /** Human label for the dev page and captions tooling. */
  readonly label: string;
  readonly group: CueGroup;
  /** Linear gain applied on top of the normalized render (0..1). */
  readonly gain: number;
  /** 0 (droppable) .. 9 (never stolen by lower cues). */
  readonly priority: number;
  /** Maximum simultaneous voices of this cue; the oldest one is stolen beyond it. */
  readonly maxVoices: number;
  /** Minimum seconds between two starts of this cue (prevents phasing/flams). */
  readonly minInterval: number;
  /** Random pitch spread in ± semitones per play (keeps repeats alive). */
  readonly pitchVariance: number;
  /** How the `step` parameter transposes the cue (e.g. combo count on a pentatonic ladder). */
  readonly step: StepMode;
  /** Essential cues carry gameplay information and survive reduced-audio mode. */
  readonly essential: boolean;
  /** Heavy low-frequency or loud cues are softened in reduced-audio mode. */
  readonly heavy?: boolean;
  /** Music ducking triggered by this cue: depth in dB and hold in seconds. */
  readonly duck?: { readonly db: number; readonly hold: number };
  readonly patch: Patch;
}

const F4 = 65; // run key root (F major pentatonic: F G A C D)
const C5 = 72;

function cue(def: CueDef): CueDef {
  return def;
}

const base = { pitchVariance: 0, step: "none", minInterval: 0.02, maxVoices: 2, essential: true } as const;

/** The registry. Add a cue here and it becomes a valid `CueName` everywhere. */
export const CUES = {
  // ── Fling ────────────────────────────────────────────────────────────────
  "fling.charge": cue({
    ...base,
    label: "Fling charge step (step 0-7 rises)",
    group: "fling",
    gain: 0.45,
    priority: 4,
    maxVoices: 2,
    minInterval: 0.04,
    step: "semitone",
    patch: {
      layers: [
        noise("bandpass", 900, 0, 0.09, 0.5, { cutoffEnd: 1500, q: 4, attack: 0.004, decay: 0.05 }),
        note(55, 0, 0.08, 0.35, { freqEnd: 196 * 1.12, chip: 0.6, attack: 0.003, decay: 0.05 }),
      ],
    },
  }),
  "fling.release": cue({
    ...base,
    label: "Fling release whoosh (thwip)",
    group: "fling",
    gain: 0.7,
    priority: 6,
    pitchVariance: 0.6,
    patch: {
      layers: [
        tone(600, 0, 0.1, 0.55, { freqEnd: 1400, glide: 0.08, wave: "triangle", attack: 0.003, release: 0.03 }),
        noise("bandpass", 1800, 0, 0.22, 0.6, { cutoffEnd: 5200, q: 1.4, attack: 0.02, decay: 0.08 }),
      ],
    },
  }),

  // ── Creatures: smashes (combo-aware pentatonic climb, GDD §8 "pop") ──────
  "smash.nib": cue({
    ...base,
    label: "Smash Nib (grub pop)",
    group: "creature",
    gain: 0.75,
    priority: 5,
    maxVoices: 4,
    step: "pentatonic",
    pitchVariance: 0.15,
    patch: { layers: [pluck(C5, 0, 0.16, 0.8), pluck(C5 + 12, 0.005, 0.07, 0.25), tick(0, 0.35, 2400)] },
  }),
  "smash.pogo": cue({
    ...base,
    label: "Smash Pogo (boing pop)",
    group: "creature",
    gain: 0.75,
    priority: 5,
    maxVoices: 4,
    step: "pentatonic",
    pitchVariance: 0.15,
    patch: {
      layers: [
        pluck(C5 + 5, 0, 0.2, 0.8, { freqEnd: 698 * 1.5, glide: 0.06, vibratoHz: 18, vibratoCents: 25 }),
        tick(0, 0.3),
      ],
    },
  }),
  "smash.clank": cue({
    ...base,
    label: "Smash Clank (flank pop, metallic)",
    group: "creature",
    gain: 0.8,
    priority: 6,
    maxVoices: 3,
    step: "pentatonic",
    pitchVariance: 0.1,
    patch: {
      layers: [
        pluck(F4 + 4, 0, 0.2, 0.7),
        note(F4 + 4, 0, 0.22, 0.35, { fmRatio: 2.76, fmIndex: 1.5, fmDecay: 0.05, decay: 0.08, attack: 0.001 }),
        tick(0, 0.4, 4200),
      ],
    },
  }),
  "smash.snatch": cue({
    ...base,
    label: "Smash Snatch (feather pop)",
    group: "creature",
    gain: 0.75,
    priority: 6,
    maxVoices: 3,
    step: "pentatonic",
    pitchVariance: 0.15,
    patch: {
      layers: [
        pluck(C5 + 7, 0, 0.16, 0.75),
        noise("highpass", 3500, 0, 0.18, 0.35, { cutoffEnd: 6000, attack: 0.005, decay: 0.06 }),
      ],
    },
  }),
  "smash.slurp": cue({
    ...base,
    label: "Smash Slurp (squishy pop)",
    group: "creature",
    gain: 0.8,
    priority: 6,
    maxVoices: 2,
    step: "pentatonic",
    pitchVariance: 0.2,
    patch: {
      layers: [
        pluck(F4 - 5, 0, 0.26, 0.8, { freqEnd: 196 * 0.7, glide: 0.2 }),
        noise("lowpass", 900, 0, 0.2, 0.5, { cutoffEnd: 250, decay: 0.08 }),
      ],
    },
  }),
  "smash.fizz": cue({
    ...base,
    label: "Smash Fizz (pop + mini blast)",
    group: "creature",
    gain: 0.85,
    priority: 7,
    maxVoices: 3,
    step: "pentatonic",
    pitchVariance: 0.3,
    heavy: true,
    patch: {
      layers: [
        pluck(C5 + 2, 0, 0.12, 0.5),
        noise("lowpass", 3500, 0, 0.36, 0.8, { cutoffEnd: 280, attack: 0.002, decay: 0.12 }),
        thump(140, 42, 0, 0.3, 0.7),
      ],
    },
  }),
  "bonk.shell": cue({
    ...base,
    label: "Clank front plate bonk (tonk)",
    group: "creature",
    gain: 0.75,
    priority: 6,
    pitchVariance: 0.3,
    patch: {
      layers: [
        tone(520, 0, 0.18, 0.6, { attack: 0.001, decay: 0.06 }),
        tone(520 * 2.76, 0, 0.14, 0.35, { attack: 0.001, decay: 0.035 }),
        thump(160, 90, 0, 0.12, 0.4),
      ],
    },
  }),
  "crack.shell": cue({
    ...base,
    label: "Clank shell crack (crunch + thump)",
    group: "creature",
    gain: 0.85,
    priority: 7,
    heavy: true,
    patch: {
      layers: [
        noise("bandpass", 1900, 0, 0.05, 0.8, { q: 2, attack: 0.001, decay: 0.015 }),
        noise("bandpass", 1500, 0.03, 0.06, 0.7, { q: 2, attack: 0.001, decay: 0.02, seed: 77 }),
        noise("bandpass", 1200, 0.07, 0.08, 0.5, { q: 2, attack: 0.001, decay: 0.025, seed: 99 }),
        thump(110, 45, 0, 0.3, 0.9),
      ],
    },
  }),
  "bonk.rim": cue({
    ...base,
    label: "Bumper rock bonk (wood)",
    group: "creature",
    gain: 0.6,
    priority: 4,
    pitchVariance: 0.8,
    patch: { layers: [marimba(F4 - 17, 0, 0.22, 0.8, { fmIndex: 1.6 }), tick(0, 0.25, 1500)] },
  }),
  "creature.spawn": cue({
    ...base,
    label: "Creature spawn (soft pop)",
    group: "creature",
    gain: 0.35,
    priority: 2,
    maxVoices: 2,
    pitchVariance: 1,
    essential: false,
    patch: { layers: [pluck(F4 + 7, 0, 0.1, 0.6, { freqEnd: 523, glide: 0.05 }), tick(0, 0.2, 2000)] },
  }),
  "tele.nib": cue({
    ...base,
    label: "Nib telegraph ('pardon!' chirp)",
    group: "creature",
    gain: 0.55,
    priority: 6,
    maxVoices: 3,
    pitchVariance: 0.4,
    patch: {
      layers: [pluck(C5 + 12, 0, 0.07, 0.7, { freqEnd: 1100 }), pluck(C5 + 16, 0.085, 0.09, 0.7, { freqEnd: 1250 })],
    },
  }),
  "tele.pogo": cue({
    ...base,
    label: "Pogo telegraph (crouch giggle)",
    group: "creature",
    gain: 0.5,
    priority: 6,
    maxVoices: 3,
    pitchVariance: 0.6,
    patch: {
      layers: [note(C5 + 7, 0, 0.18, 0.6, { chip: 0.3, vibratoHz: 22, vibratoCents: 80, decay: 0.12, attack: 0.004 })],
    },
  }),
  "tele.clank": cue({
    ...base,
    label: "Clank telegraph (jaw creak)",
    group: "creature",
    gain: 0.55,
    priority: 6,
    patch: {
      layers: [
        noise("bandpass", 500, 0, 0.42, 0.7, { cutoffEnd: 800, q: 6, attack: 0.04, lfoHz: 28, lfoDepth: 0.4 }),
        tone(90, 0, 0.42, 0.35, { freqEnd: 120, wave: "triangle", attack: 0.05 }),
      ],
    },
  }),
  "tele.slurp": cue({
    ...base,
    label: "Slurp telegraph (cheek-puff blubber)",
    group: "creature",
    gain: 0.6,
    priority: 6,
    patch: {
      layers: [
        tone(110, 0, 0.6, 0.7, {
          freqEnd: 150,
          chip: 0.4,
          vibratoHz: 11,
          vibratoCents: 120,
          attack: 0.08,
          release: 0.1,
        }),
        noise("lowpass", 400, 0.1, 0.5, 0.25, { lfoHz: 11, lfoDepth: 0.6 }),
      ],
    },
  }),
  "tele.fizz": cue({
    ...base,
    label: "Fizz fuse tick (accelerating via caller)",
    group: "creature",
    gain: 0.45,
    priority: 6,
    maxVoices: 4,
    minInterval: 0.03,
    pitchVariance: 0.2,
    step: "semitone",
    patch: { layers: [tick(0, 0.8, 5200, { q: 3 }), tone(2400, 0, 0.03, 0.2, { attack: 0.001, decay: 0.01 })] },
  }),
  "snatch.cackle": cue({
    ...base,
    label: "Snatch cackle (3 chirps)",
    group: "creature",
    gain: 0.55,
    priority: 5,
    pitchVariance: 0.5,
    patch: {
      layers: [0, 0.07, 0.14].map((at, i) => pluck(C5 + 19 - i, at, 0.06, 0.6, { freqEnd: 1400 - i * 120, chip: 0.3 })),
    },
  }),
  "slurp.tongue": cue({
    ...base,
    label: "Slurp tongue (wet thwop)",
    group: "creature",
    gain: 0.65,
    priority: 6,
    patch: {
      layers: [
        noise("lowpass", 1400, 0, 0.18, 0.7, { cutoffEnd: 300, attack: 0.005, decay: 0.07 }),
        tone(260, 0, 0.16, 0.5, { freqEnd: 90, attack: 0.003, decay: 0.07 }),
      ],
    },
  }),

  // ── Pixels ───────────────────────────────────────────────────────────────
  bite: cue({
    ...base,
    label: "Bite (glassy tink + pitch-down whoosh)",
    group: "pixel",
    gain: 0.85,
    priority: 8,
    maxVoices: 2,
    minInterval: 0.05,
    duck: { db: 5, hold: 0.4 },
    patch: {
      layers: [
        tone(2600, 0, 0.12, 0.6, { attack: 0.001, decay: 0.04 }),
        tone(3900, 0.04, 0.1, 0.4, { attack: 0.001, decay: 0.035 }),
        tick(0, 0.5, 6000),
        noise("bandpass", 3000, 0.02, 0.45, 0.45, { cutoffEnd: 500, q: 1.2, attack: 0.03, decay: 0.2 }),
      ],
    },
  }),
  "pixel.pop": cue({
    ...base,
    label: "Pixel pop-off (tink per pixel)",
    group: "pixel",
    gain: 0.55,
    priority: 7,
    maxVoices: 4,
    minInterval: 0.03,
    pitchVariance: 0.5,
    patch: { layers: [tone(2300, 0, 0.09, 0.7, { attack: 0.001, decay: 0.03 }), tick(0, 0.35, 7000)] },
  }),
  "pixel.sweep": cue({
    ...base,
    label: "Pixel sweep-back plink (step = combo, ascending)",
    group: "pixel",
    gain: 0.6,
    priority: 7,
    maxVoices: 5,
    minInterval: 0.025,
    step: "pentatonic",
    patch: {
      layers: [
        pluck(F4 + 12, 0, 0.14, 0.8, { chip: 0.15 }),
        pluck(F4 + 24, 0.012, 0.08, 0.25, { chip: 0 }),
        tick(0, 0.12, 5000),
      ],
    },
  }),
  "pixel.clutch": cue({
    ...base,
    label: "Clutch grab sparkle arpeggio",
    group: "pixel",
    gain: 0.6,
    priority: 7,
    patch: {
      layers: [F4 + 24, F4 + 28, F4 + 31, F4 + 36].map((m, i) => pluck(m, i * 0.045, 0.14 + i * 0.03, 0.6 - i * 0.08)),
    },
  }),
  "pixel.tick": cue({
    ...base,
    label: "Loose pixel timer tick",
    group: "pixel",
    gain: 0.3,
    priority: 2,
    maxVoices: 2,
    minInterval: 0.06,
    essential: false,
    patch: { layers: [tick(0, 1, 3800)] },
  }),
  "pixel.lost": cue({
    ...base,
    label: "Pixel lost (descending sigh + dust)",
    group: "pixel",
    gain: 0.6,
    priority: 6,
    maxVoices: 3,
    minInterval: 0.05,
    patch: {
      layers: [
        pluck(F4 + 16, 0, 0.14, 0.6),
        pluck(F4 + 12, 0.12, 0.26, 0.55, { freqEnd: 587, glide: 0.24 }),
        noise("lowpass", 1200, 0.1, 0.25, 0.3, { cutoffEnd: 400, decay: 0.1 }),
      ],
    },
  }),
  "pixel.fall": cue({
    ...base,
    label: "Pixel lost over the edge (tiny falling whistle)",
    group: "pixel",
    gain: 0.5,
    priority: 6,
    maxVoices: 3,
    minInterval: 0.04,
    pitchVariance: 0.4,
    patch: {
      layers: [
        tone(1600, 0, 0.32, 0.5, { freqEnd: 480, attack: 0.01, release: 0.08 }),
        noise("lowpass", 700, 0.3, 0.2, 0.25, { decay: 0.08 }),
      ],
    },
  }),
  ringout: cue({
    ...base,
    label: "Ring-out (falling whistle + cloud poof)",
    group: "pixel",
    gain: 0.8,
    priority: 8,
    maxVoices: 1,
    duck: { db: 4, hold: 0.5 },
    patch: {
      layers: [
        tone(1200, 0, 0.36, 0.6, { freqEnd: 300, wave: "triangle", attack: 0.01, release: 0.05 }),
        noise("lowpass", 1400, 0.33, 0.35, 0.7, { cutoffEnd: 300, attack: 0.01, decay: 0.12 }),
        thump(90, 50, 0.34, 0.25, 0.45),
      ],
    },
  }),
  "gold.glance": cue({
    ...base,
    label: "Gold glance (bell ting)",
    group: "pixel",
    gain: 0.6,
    priority: 7,
    pitchVariance: 0.2,
    patch: { layers: [bell(C5 + 16, 0, 0.6, 0.8)] },
  }),

  // ── Run flow and time ────────────────────────────────────────────────────
  "slowmo.in": cue({
    ...base,
    label: "Slow-mo in (tape dip)",
    group: "run",
    gain: 0.5,
    priority: 5,
    maxVoices: 1,
    patch: {
      layers: [
        noise("bandpass", 2600, 0, 0.36, 0.6, { cutoffEnd: 380, q: 1.5, attack: 0.02, release: 0.1 }),
        tone(440, 0, 0.34, 0.25, { freqEnd: 200, chip: 0.3, attack: 0.02, release: 0.1 }),
      ],
    },
  }),
  "slowmo.out": cue({
    ...base,
    label: "Slow-mo out (tape rise)",
    group: "run",
    gain: 0.45,
    priority: 5,
    maxVoices: 1,
    patch: {
      layers: [
        noise("bandpass", 380, 0, 0.2, 0.6, { cutoffEnd: 2800, q: 1.5, attack: 0.03, release: 0.05 }),
        tone(200, 0, 0.18, 0.25, { freqEnd: 440, chip: 0.3, attack: 0.02, release: 0.05 }),
      ],
    },
  }),
  "run.count": cue({
    ...base,
    label: "Countdown blip (3-2-1; step 0-2)",
    group: "run",
    gain: 0.55,
    priority: 6,
    step: "pentatonic",
    patch: { layers: [pluck(F4 + 12, 0, 0.14, 0.8, { chip: 0.3 }), tick(0, 0.2)] },
  }),
  "run.start": cue({
    ...base,
    label: "Run start (go!)",
    group: "run",
    gain: 0.7,
    priority: 7,
    maxVoices: 1,
    patch: {
      layers: [
        thump(120, 55, 0, 0.25, 0.6),
        ...[F4 + 12, F4 + 16, F4 + 19, F4 + 24].map((m, i) => pluck(m, 0.02 + i * 0.05, 0.16 + i * 0.05, 0.6)),
        noise("highpass", 2500, 0, 0.3, 0.25, { cutoffEnd: 7000, decay: 0.12 }),
      ],
    },
  }),
  "run.end": cue({
    ...base,
    label: "Run end (time up cadence)",
    group: "run",
    gain: 0.75,
    priority: 8,
    maxVoices: 1,
    duck: { db: 6, hold: 0.9 },
    patch: {
      layers: [
        bell(F4 + 19, 0, 0.5, 0.55, { fmIndex: 1.2 }),
        bell(F4 + 12, 0.18, 0.9, 0.6, { fmIndex: 1.2 }),
        pluck(F4 - 12, 0.18, 0.8, 0.5, { decay: 0.4 }),
        pluck(F4 - 5, 0.18, 0.8, 0.3, { decay: 0.4 }),
      ],
    },
  }),

  // ── Old Gulp ─────────────────────────────────────────────────────────────
  "gulp.rumble": cue({
    ...base,
    label: "Old Gulp rumble (sub + noise, 2 s)",
    group: "gulp",
    gain: 0.9,
    priority: 9,
    maxVoices: 1,
    heavy: true,
    duck: { db: 4, hold: 2 },
    patch: {
      layers: [
        tone(45, 0, 2.1, 0.8, { attack: 0.7, release: 0.5, vibratoHz: 3, vibratoCents: 40 }),
        tone(60, 0, 2.1, 0.5, { attack: 0.9, release: 0.5 }),
        noise("lowpass", 140, 0, 2.1, 0.9, { attack: 0.8, release: 0.5, lfoHz: 2.5, lfoDepth: 0.5 }),
      ],
    },
  }),
  "gulp.bite": cue({
    ...base,
    label: "Old Gulp bite (huge thump + crunch)",
    group: "gulp",
    gain: 1,
    priority: 9,
    maxVoices: 1,
    heavy: true,
    duck: { db: 8, hold: 0.8 },
    patch: {
      layers: [
        thump(95, 28, 0, 0.7, 1),
        noise("bandpass", 1300, 0.02, 0.45, 0.7, { cutoffEnd: 350, q: 1.2, attack: 0.002, decay: 0.15 }),
        noise("bandpass", 900, 0.12, 0.3, 0.5, { cutoffEnd: 300, q: 1.5, attack: 0.002, decay: 0.1, seed: 4242 }),
        thump(70, 30, 0.14, 0.5, 0.7),
      ],
    },
  }),
  "gulp.tooth": cue({
    ...base,
    label: "Gulp tooth hit (deep bell; step = tooth 0-2)",
    group: "gulp",
    gain: 0.85,
    priority: 9,
    step: "pentatonic",
    duck: { db: 5, hold: 0.5 },
    patch: {
      layers: [
        bell(F4 - 24, 0, 1.3, 0.8, { fmRatio: 1.4, fmIndex: 3, fmDecay: 0.25 }),
        bell(F4 - 12, 0, 1.0, 0.4, { fmIndex: 1.5 }),
        thump(110, 50, 0, 0.25, 0.5),
      ],
    },
  }),
  "gulp.burp": cue({
    ...base,
    label: "Gulp burp (comic 3-note tuba)",
    group: "gulp",
    gain: 0.85,
    priority: 9,
    maxVoices: 1,
    heavy: true,
    duck: { db: 6, hold: 1 },
    patch: {
      layers: [
        note(46, 0, 0.2, 0.7, { chip: 0.5, fmRatio: 1, fmIndex: 2.2, attack: 0.02, vibratoHz: 7, vibratoCents: 30 }),
        note(41, 0.2, 0.2, 0.7, { chip: 0.5, fmRatio: 1, fmIndex: 2.2, attack: 0.02, vibratoHz: 7, vibratoCents: 30 }),
        note(34, 0.4, 0.55, 0.8, {
          chip: 0.5,
          fmRatio: 1,
          fmIndex: 2.6,
          attack: 0.02,
          freqEnd: 50,
          glide: 0.55,
          vibratoHz: 9,
          vibratoCents: 60,
          release: 0.12,
        }),
        noise("lowpass", 500, 0.4, 0.5, 0.25, { lfoHz: 14, lfoDepth: 0.7 }),
      ],
    },
  }),
  "gulp.inhale": cue({
    ...base,
    label: "Gulp inhale (rising filtered wind, 2 s)",
    group: "gulp",
    gain: 0.75,
    priority: 8,
    maxVoices: 1,
    duck: { db: 3, hold: 2 },
    patch: {
      layers: [
        noise("bandpass", 220, 0, 2, 0.9, {
          cutoffEnd: 2400,
          q: 2,
          attack: 1.2,
          release: 0.2,
          lfoHz: 4,
          lfoDepth: 0.2,
        }),
        tone(80, 0, 2, 0.3, { freqEnd: 160, attack: 1, release: 0.2 }),
      ],
    },
  }),

  // ── Meta: regrow, mend, gold ─────────────────────────────────────────────
  "regrow.sparkle": cue({
    ...base,
    label: "Regrow sparkle (per pixel; step ascends)",
    group: "meta",
    gain: 0.55,
    priority: 5,
    maxVoices: 5,
    minInterval: 0.03,
    step: "pentatonic",
    patch: {
      layers: [
        pluck(C5 + 7, 0, 0.18, 0.7, { chip: 0.18 }),
        note(C5 + 31, 0.02, 0.1, 0.15, { attack: 0.002, decay: 0.03 }),
        tick(0, 0.1, 6500),
      ],
    },
  }),
  "mend.chime": cue({
    ...base,
    label: "Mend chime (two-voice chord)",
    group: "meta",
    gain: 0.65,
    priority: 7,
    maxVoices: 2,
    duck: { db: 3, hold: 0.6 },
    patch: {
      layers: [
        pluck(C5, 0, 1.1, 0.6, { decay: 0.5, release: 0.2, chip: 0.12 }),
        pluck(C5 + 4, 0.06, 1.05, 0.55, { decay: 0.5, release: 0.2, chip: 0.12 }),
        pluck(C5 + 16, 0.12, 0.6, 0.18, { decay: 0.25 }),
      ],
    },
  }),
  "gold.reveal": cue({
    ...base,
    label: "Gold pixel reveal fanfare",
    group: "meta",
    gain: 0.8,
    priority: 9,
    maxVoices: 1,
    duck: { db: 8, hold: 1.4 },
    patch: {
      peak: 0.85,
      layers: [
        note(48, 0, 0.2, 0.3, { freqEnd: 261.6, chip: 0.16, decay: 0.2, attack: 0.009 }),
        ...[72, 76, 79].map((m, i) => pluck(m, 0.13 + i * 0.055, 0.11 + i * 0.05, 0.4 - i * 0.05)),
        ...[36, 60, 64, 67].map((m, i) =>
          note(m, 0.37, 1.1, [0.45, 0.35, 0.28, 0.24][i] ?? 0.2, {
            attack: 0.016,
            decay: 0.8,
            release: 0.3,
            chip: 0.1,
          }),
        ),
        ...[91, 96, 100, 103].map((m, i) => bell(m, 0.42 + i * 0.07, 0.9, 0.22)),
      ],
    },
  }),

  // ── Hub ──────────────────────────────────────────────────────────────────
  "hub.step": cue({
    ...base,
    label: "Hub footstep (soft cloud-grass)",
    group: "hub",
    gain: 0.3,
    priority: 1,
    maxVoices: 3,
    minInterval: 0.08,
    pitchVariance: 1.5,
    essential: false,
    patch: {
      layers: [
        noise("lowpass", 900, 0, 0.06, 0.8, { attack: 0.003, decay: 0.02 }),
        tone(130, 0, 0.05, 0.35, { freqEnd: 90, attack: 0.002, decay: 0.02 }),
      ],
    },
  }),
  "hub.stomp": cue({
    ...base,
    label: "Hub stomp (heavy step / dosukoi)",
    group: "hub",
    gain: 0.55,
    priority: 3,
    maxVoices: 2,
    pitchVariance: 0.8,
    essential: false,
    heavy: true,
    patch: {
      layers: [thump(110, 45, 0, 0.25, 0.9), noise("lowpass", 700, 0.01, 0.3, 0.5, { cutoffEnd: 200, decay: 0.1 })],
    },
  }),
  "emote.wave": cue({
    ...base,
    label: "Emote: wave",
    group: "hub",
    gain: 0.5,
    priority: 3,
    patch: { layers: [pluck(C5 + 7, 0, 0.1, 0.6), pluck(C5 + 4, 0.09, 0.1, 0.55), pluck(C5 + 7, 0.18, 0.14, 0.6)] },
  }),
  "emote.hop": cue({
    ...base,
    label: "Emote: hop",
    group: "hub",
    gain: 0.5,
    priority: 3,
    patch: { layers: [pluck(C5, 0, 0.16, 0.7, { freqEnd: 784, glide: 0.1 })] },
  }),
  "emote.spin": cue({
    ...base,
    label: "Emote: spin",
    group: "hub",
    gain: 0.5,
    priority: 3,
    patch: {
      layers: [C5, C5 + 2, C5 + 4, C5 + 7, C5 + 9, C5 + 12].map((m, i) => pluck(m, i * 0.035, 0.07, 0.45)),
    },
  }),
  "emote.heart": cue({
    ...base,
    label: "Emote: heart",
    group: "hub",
    gain: 0.5,
    priority: 3,
    patch: { layers: [pluck(C5 + 4, 0, 0.18, 0.6), pluck(C5 + 12, 0.11, 0.3, 0.55, { decay: 0.2 })] },
  }),
  "emote.burst": cue({
    ...base,
    label: "Emote: pixel burst (scatter + snap back)",
    group: "hub",
    gain: 0.5,
    priority: 3,
    patch: {
      layers: [
        noise("highpass", 3000, 0, 0.12, 0.4, { decay: 0.05 }),
        ...[0, 1, 2, 3].map((i) => tone(2000 + i * 330, i * 0.02, 0.05, 0.25, { decay: 0.02, attack: 0.001 })),
        pluck(C5 + 12, 0.28, 0.14, 0.6, { freqEnd: 1047 * 1.5, glide: 0.04 }),
      ],
    },
  }),
  "emote.sit": cue({
    ...base,
    label: "Emote: sit",
    group: "hub",
    gain: 0.5,
    priority: 3,
    patch: { layers: [pluck(C5, 0, 0.14, 0.6, { freqEnd: 392, glide: 0.1 }), tick(0.1, 0.2, 1200)] },
  }),
  "emote.flex": cue({
    ...base,
    label: "Emote: flex (squash/stretch boing)",
    group: "hub",
    gain: 0.5,
    priority: 3,
    patch: {
      layers: [
        note(C5 - 5, 0, 0.3, 0.6, { chip: 0.3, freqEnd: 523, glide: 0.3, vibratoHz: 12, vibratoCents: 60, decay: 0.2 }),
      ],
    },
  }),
  "emote.stomp": cue({
    ...base,
    label: "Emote: stomp (dosukoi)",
    group: "hub",
    gain: 0.55,
    priority: 3,
    heavy: true,
    patch: {
      layers: [
        thump(120, 40, 0, 0.3, 0.9),
        noise("lowpass", 800, 0.01, 0.35, 0.5, { cutoffEnd: 200, decay: 0.12 }),
        pluck(F4 - 12, 0, 0.2, 0.3),
      ],
    },
  }),
  "door.enter": cue({
    ...base,
    label: "Venue door enter (whoosh + door chime)",
    group: "hub",
    gain: 0.65,
    priority: 6,
    maxVoices: 1,
    patch: {
      layers: [
        noise("bandpass", 400, 0, 0.45, 0.5, { cutoffEnd: 3000, q: 1, attack: 0.15, release: 0.1 }),
        bell(C5 + 7, 0.2, 0.6, 0.5, { fmIndex: 1.4 }),
        bell(C5 + 12, 0.32, 0.8, 0.5, { fmIndex: 1.4 }),
        tick(0.02, 0.3, 900),
      ],
    },
  }),

  // ── UI ───────────────────────────────────────────────────────────────────
  "ui.click": cue({
    ...base,
    label: "UI click (SDK select pluck)",
    group: "ui",
    gain: 0.45,
    priority: 3,
    maxVoices: 2,
    minInterval: 0.03,
    pitchVariance: 0.1,
    patch: { layers: [pluck(67, 0, 0.08, 0.7, { attack: 0.003, release: 0.02, decay: 0.06, chip: 0.24 })] },
  }),
  "ui.hover": cue({
    ...base,
    label: "UI hover/focus tick",
    group: "ui",
    gain: 0.2,
    priority: 1,
    maxVoices: 1,
    minInterval: 0.05,
    essential: false,
    patch: { layers: [tick(0, 0.8, 4200)] },
  }),
  "ui.back": cue({
    ...base,
    label: "UI back/close",
    group: "ui",
    gain: 0.4,
    priority: 3,
    patch: { layers: [pluck(67, 0, 0.07, 0.6), pluck(60, 0.06, 0.1, 0.55)] },
  }),
  "ui.confirm": cue({
    ...base,
    label: "UI confirm (SDK purchase triplet)",
    group: "ui",
    gain: 0.5,
    priority: 5,
    patch: {
      layers: [
        pluck(48, 0, 0.18, 0.3, { chip: 0.12, decay: 0.12 }),
        ...[60, 64, 67].map((m, i) => pluck(m, [0, 0.065, 0.135][i] ?? 0, [0.1, 0.11, 0.21][i] ?? 0.1, 0.6 - i * 0.08)),
      ],
    },
  }),
  "ui.error": cue({
    ...base,
    label: "UI error (soft low double)",
    group: "ui",
    gain: 0.45,
    priority: 5,
    patch: { layers: [pluck(55, 0, 0.1, 0.6, { chip: 0.35 }), pluck(54, 0.11, 0.16, 0.6, { chip: 0.35 })] },
  }),
  "ui.toggle": cue({
    ...base,
    label: "UI toggle",
    group: "ui",
    gain: 0.4,
    priority: 3,
    patch: { layers: [pluck(72, 0, 0.06, 0.6), tick(0, 0.3)] },
  }),
} satisfies Record<string, CueDef>;

/** Every cue name, checked at compile time. */
export type CueName = keyof typeof CUES;

/** All cue names in registry order (stable numeric ids for the voice limiter). */
export const CUE_NAMES: readonly CueName[] = Object.keys(CUES) as CueName[];

/** Numeric id of each cue (index into `CUE_NAMES`), so hot paths index typed arrays instead of maps. */
export const CUE_ID: Readonly<Record<CueName, number>> = Object.fromEntries(
  CUE_NAMES.map((name, i) => [name, i]),
) as Record<CueName, number>;

/** Returns the definition of a cue (throws on an unknown name coming from untyped callers). */
export function cueDef(name: CueName): CueDef {
  const def: CueDef | undefined = (CUES as Record<string, CueDef>)[name];
  if (!def) throw new TypeError(`Unknown audio cue: ${String(name)}`);
  return def;
}
