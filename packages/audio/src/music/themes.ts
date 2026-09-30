/** Theme specifications and the intensity → layer-level mapping. Pure data and maths. */
import { smoothstep } from "../math";

/** The music themes. `hub` is cozy (84 BPM music box), `run` is energetic (112 BPM toy orchestra). */
export type ThemeName = "hub" | "run";

/** Harmonic mood. `gulp` swaps to minor pentatonic and adds a sub drone (Old Gulp event, GDD §8). */
export type Mood = "normal" | "gulp";

/** Mixer layers. Each has its own gain node so intensity crossfades never retrigger notes. */
export type LayerName = "pad" | "ostinato" | "bass" | "hats" | "kick" | "melody" | "drone" | "ambience" | "stinger";

/** All layers in mixer order. */
export const LAYERS: readonly LayerName[] = [
  "pad",
  "ostinato",
  "bass",
  "hats",
  "kick",
  "melody",
  "drone",
  "ambience",
  "stinger",
];

/** Index of each layer (for typed-array level tables). */
export const LAYER_INDEX: Readonly<Record<LayerName, number>> = Object.fromEntries(
  LAYERS.map((l, i) => [l, i]),
) as Record<LayerName, number>;

/** Synth voices used by the music. */
export type InstrumentName =
  "marimba" | "musicbox" | "pluck" | "bass" | "pad" | "kick" | "hat" | "brush" | "snare" | "drone" | "bell";

/** A theme: tempo, key, instrumentation and when each layer enters as intensity rises. */
export interface ThemeSpec {
  readonly name: ThemeName;
  readonly bpm: number;
  /** Key root as a MIDI note in octave 3 (F3 = 53). */
  readonly root: number;
  /** Swing amount 0..0.5 applied to off-beat 8ths (fraction of a 16th step). */
  readonly swing: number;
  /** Intensity range [enter, full] per layer; `null` = layer unused by this theme. */
  readonly entry: Readonly<Record<LayerName, readonly [number, number] | null>>;
  /** Base mix level per layer (0..1). */
  readonly mix: Readonly<Record<LayerName, number>>;
  readonly instruments: Readonly<{ ostinato: InstrumentName; melody: InstrumentName; hats: InstrumentName }>;
  /** Chord progressions as major-scale degrees (0 = I). One is picked per 8-bar section. */
  readonly progressions: readonly (readonly number[])[];
}

/** Steps (16ths) per bar. All themes are in 4/4. */
export const STEPS_PER_BAR = 16;

/** Bars per phrase (motif length unit) and per section (progression unit). */
export const BARS_PER_PHRASE = 4;
export const BARS_PER_SECTION = 8;

/** The run theme (GDD §8: 112 BPM, F major pentatonic, "sunny lo-fi toy orchestra"). */
export const RUN_THEME: ThemeSpec = {
  name: "run",
  bpm: 112,
  root: 53,
  swing: 0,
  // Drop-in: pad only · Wave 1: + marimba · Wave 2: + bass + hats (+ melody) · Frenzy: + kick, ostinato doubles.
  entry: {
    pad: [-1, 0],
    ostinato: [0.15, 0.3],
    bass: [0.4, 0.5],
    hats: [0.42, 0.55],
    melody: [0.55, 0.68],
    kick: [0.68, 0.78],
    drone: null,
    ambience: null,
    stinger: [-1, 0],
  },
  mix: {
    pad: 0.34,
    ostinato: 0.55,
    bass: 0.6,
    hats: 0.28,
    kick: 0.62,
    melody: 0.42,
    drone: 0.6,
    ambience: 0,
    stinger: 0.6,
  },
  instruments: { ostinato: "marimba", melody: "pluck", hats: "hat" },
  progressions: [
    [0, 5, 3, 4],
    [0, 3, 5, 4],
    [5, 3, 0, 4],
    [0, 4, 5, 3],
    [3, 0, 4, 5],
  ],
};

/** The hub theme (GDD §8: slower 84 BPM loop, music box + field ambience, cozy). */
export const HUB_THEME: ThemeSpec = {
  name: "hub",
  bpm: 84,
  root: 48,
  swing: 0.28,
  entry: {
    pad: [-1, 0],
    melody: [-1, 0],
    ambience: [-1, 0],
    bass: [0.3, 0.45],
    ostinato: [0.55, 0.7],
    hats: [0.75, 0.9],
    kick: null,
    drone: null,
    stinger: [-1, 0],
  },
  mix: {
    pad: 0.3,
    ostinato: 0.34,
    bass: 0.45,
    hats: 0.2,
    kick: 0,
    melody: 0.5,
    drone: 0.5,
    ambience: 0.3,
    stinger: 0.6,
  },
  instruments: { ostinato: "marimba", melody: "musicbox", hats: "brush" },
  progressions: [
    [0, 3, 0, 4],
    [0, 5, 3, 4],
    [3, 4, 0, 0],
    [0, 2, 3, 4],
  ],
};

/** Theme lookup. */
export const THEMES: Readonly<Record<ThemeName, ThemeSpec>> = { run: RUN_THEME, hub: HUB_THEME };

/**
 * Writes the target gain of every layer for `intensity` (0..1) into `out` (indexed by `LAYER_INDEX`).
 * Layers fade in over their entry range, so the mix moves smoothly as gameplay intensity changes.
 * The drone only sounds in the `gulp` mood. Allocation-free.
 */
export function layerLevels(theme: ThemeSpec, intensity: number, mood: Mood, out: Float32Array): Float32Array {
  for (let i = 0; i < LAYERS.length; i++) {
    const layer = LAYERS[i] as LayerName;
    const entry = theme.entry[layer];
    let level: number;
    if (layer === "drone") level = mood === "gulp" ? 1 : 0;
    else level = entry ? smoothstep(entry[0], entry[1], intensity) : 0;
    out[i] = level * theme.mix[layer];
  }
  return out;
}
