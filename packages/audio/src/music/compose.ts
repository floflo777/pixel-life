/**
 * The generative composer: turns (theme, seed, bar index, intensity, mood) into note events.
 * Pure and deterministic: every bar is derived from hashes of the seed and its position, so any bar
 * can be regenerated independently (seeking, tests, a Daily seed that sounds the same for everyone).
 */
import { MAJOR_PENTATONIC, MINOR_PENTATONIC } from "../math";
import { Rng, hashInts } from "../rng";
import type { InstrumentName, LayerName, Mood, ThemeSpec } from "./themes";
import { BARS_PER_PHRASE, BARS_PER_SECTION, STEPS_PER_BAR } from "./themes";

/** One scheduled note. `step` is the 16th within the bar (or within a stinger). */
export interface NoteEvent {
  readonly layer: LayerName;
  readonly inst: InstrumentName;
  readonly step: number;
  readonly midi: number;
  /** Velocity 0..1. */
  readonly vel: number;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;
/** Gulp mood progression (natural minor degrees): i – VI – VII – i. */
const GULP_PROGRESSION = [0, 5, 6, 0] as const;

/** Ostinato shapes: indices into [root, third, fifth, octave, tenth]. */
const OSTINATO_PATTERNS: readonly (readonly number[])[] = [
  [0, 2, 1, 2, 3, 2, 1, 2],
  [0, 1, 2, 3, 2, 1, 2, 4],
  [0, 2, 3, 2, 0, 2, 4, 2],
  [3, 2, 1, 0, 1, 2, 3, 2],
];

/** Bass shapes: [step, semitones above the chord root]. */
const BASS_PATTERNS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [0, 0],
    [8, 7],
    [12, 0],
  ],
  [
    [0, 0],
    [6, 0],
    [8, 7],
    [14, 12],
  ],
  [
    [0, 0],
    [3, 0],
    [8, 7],
    [10, 5],
  ],
];

/** Melody rhythm templates over two bars (32 steps). Run templates are busier than hub ones. */
const RUN_RHYTHMS: readonly (readonly number[])[] = [
  [0, 4, 6, 8, 12, 16, 20, 22, 24],
  [0, 3, 6, 8, 10, 12, 16, 19, 22, 24],
  [0, 2, 4, 8, 12, 14, 16, 18, 20, 24, 28],
  [0, 6, 8, 12, 16, 22, 24, 26],
];
const HUB_RHYTHMS: readonly (readonly number[])[] = [
  [0, 4, 8, 16, 20, 24],
  [0, 6, 8, 12, 16, 24],
  [0, 8, 12, 16, 22, 24],
  [0, 4, 6, 8, 16, 20],
];

/** Semitones of a scale degree (wrapping octaves) in a 7-note scale. */
function degreeSemis(scale: readonly number[], degree: number): number {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  return oct * 12 + (scale[((degree % n) + n) % n] ?? 0);
}

/** Chord tones (root, third, fifth, octave, tenth) in semitones above the key root. */
export function chordTones(degree: number, minor: boolean): readonly number[] {
  const scale = minor ? MINOR_SCALE : MAJOR_SCALE;
  return [0, 2, 4, 7, 9].map((d) => degreeSemis(scale, degree + d));
}

/** Chord degree for a bar under the theme's seeded progression (or the fixed gulp progression). */
export function chordDegree(theme: ThemeSpec, seed: number, bar: number, mood: Mood): number {
  const inBar = ((bar % BARS_PER_PHRASE) + BARS_PER_PHRASE) % BARS_PER_PHRASE;
  if (mood === "gulp") return GULP_PROGRESSION[inBar] ?? 0;
  const section = Math.floor(bar / BARS_PER_SECTION);
  const progression = theme.progressions[hashInts(seed, section, theme.bpm, 11) % theme.progressions.length] ?? [0];
  return progression[inBar % progression.length] ?? 0;
}

/** Nearest pentatonic pitch (semitones above root, any octave) to `target`. */
function snapToScale(target: number, pent: readonly number[]): number {
  const oct = Math.floor(target / 12);
  let best = target;
  let bestDist = Infinity;
  for (let o = oct - 1; o <= oct + 1; o++) {
    for (const s of pent) {
      const cand = o * 12 + s;
      const dist = Math.abs(cand - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = cand;
      }
    }
  }
  return best;
}

/** Pentatonic ladder (semitones above the root) covering the melody range, low to high. */
function melodyLadder(pent: readonly number[]): number[] {
  const ladder: number[] = [];
  for (let o = 0; o <= 1; o++) for (const s of pent) ladder.push(o * 12 + s);
  ladder.push(24);
  return ladder;
}

/**
 * The melody of one bar. A two-bar motif is generated per phrase and answered with a varied
 * second half, so tunes feel written rather than random. Strong beats snap toward chord tones.
 */
function melodyBar(theme: ThemeSpec, seed: number, bar: number, mood: Mood, out: NoteEvent[]): void {
  const pent = mood === "gulp" ? MINOR_PENTATONIC : MAJOR_PENTATONIC;
  const ladder = melodyLadder(pent);
  const phrase = Math.floor(bar / BARS_PER_PHRASE);
  const inPhrase = ((bar % BARS_PER_PHRASE) + BARS_PER_PHRASE) % BARS_PER_PHRASE;
  const half = inPhrase < 2 ? 0 : 1;
  const rng = new Rng(hashInts(seed, phrase, theme.bpm, 21));
  const rhythms = theme.name === "hub" ? HUB_RHYTHMS : RUN_RHYTHMS;
  const rhythm = rng.pick(rhythms);
  // Contour: a bounded random walk on the ladder, identical for both halves until the answer varies it.
  const contour: number[] = [];
  let pos = 3 + rng.int(3);
  for (let i = 0; i < rhythm.length; i++) {
    contour.push(pos);
    pos = Math.max(0, Math.min(ladder.length - 1, pos + rng.pick([-2, -1, -1, 0, 1, 1, 2])));
  }
  const answer = new Rng(hashInts(seed, phrase, theme.bpm, 22));
  const variedFrom = rhythm.length - 3;
  const barInHalf = inPhrase % 2;
  const minor = mood === "gulp";
  for (let i = 0; i < rhythm.length; i++) {
    const step32 = rhythm[i] ?? 0;
    let idx = contour[i] ?? 0;
    if (half === 1 && i >= variedFrom)
      idx = Math.max(0, Math.min(ladder.length - 1, idx + answer.pick([-2, -1, 1, 2])));
    // The answer's draws happen before this skip so every bar of the phrase sees the same variation.
    if (Math.floor(step32 / STEPS_PER_BAR) !== barInHalf) continue;
    const step = step32 % STEPS_PER_BAR;
    let semis = ladder[idx] ?? 0;
    if (step % 8 === 0) {
      const tones = chordTones(chordDegree(theme, seed, bar, mood), minor);
      const target = (tones[rng.int(3)] ?? 0) + (semis >= 12 ? 12 : 0);
      semis = snapToScale(target, pent);
    }
    const last = half === 1 && barInHalf === 1 && i === rhythm.length - 1;
    out.push({
      layer: "melody",
      inst: theme.instruments.melody,
      step,
      midi: theme.root + 12 + semis,
      vel: last ? 0.85 : step % 4 === 0 ? 0.8 : 0.6,
    });
  }
}

/**
 * Composes one bar. Every layer is written regardless of intensity (the mixer fades layers), except
 * the ostinato doubling, which is a compositional change at high intensity (Frenzy, GDD §8).
 * Events are sorted by step. Deterministic in all inputs.
 */
export function composeBar(theme: ThemeSpec, seed: number, bar: number, intensity: number, mood: Mood): NoteEvent[] {
  const out: NoteEvent[] = [];
  const minor = mood === "gulp";
  const degree = chordDegree(theme, seed, bar, mood);
  const tones = chordTones(degree, minor);
  const section = Math.floor(bar / BARS_PER_SECTION);
  const rng = new Rng(hashInts(seed, bar, theme.bpm, 31));
  const root = theme.root;
  const chordRoot = tones[0] ?? 0;

  // Pad: the triad, held.
  for (let i = 0; i < 3; i++) {
    out.push({ layer: "pad", inst: "pad", step: 0, midi: root + 12 + (tones[i] ?? 0), vel: i === 0 ? 0.8 : 0.6 });
  }

  // Ostinato: 8ths (run) or quarters (hub) arpeggiating the chord; doubles to 16ths in Frenzy.
  const pattern = OSTINATO_PATTERNS[hashInts(seed, section, theme.bpm, 41) % OSTINATO_PATTERNS.length] ?? [0];
  const hub = theme.name === "hub";
  const every = hub ? 4 : 2;
  for (let s = 0, i = 0; s < STEPS_PER_BAR; s += every, i++) {
    const t = tones[pattern[i % pattern.length] ?? 0] ?? 0;
    out.push({
      layer: "ostinato",
      inst: theme.instruments.ostinato,
      step: s,
      midi: root + 12 + t,
      vel: s % 4 === 0 ? 0.8 : 0.6,
    });
    if (!hub && intensity >= 0.8) {
      const t2 = tones[pattern[(i + 3) % pattern.length] ?? 0] ?? 0;
      out.push({ layer: "ostinato", inst: theme.instruments.ostinato, step: s + 1, midi: root + 24 + t2, vel: 0.4 });
    }
  }

  // Bass: seeded groove on the chord root.
  const bassPattern = hub
    ? ([
        [0, 0],
        [8, 7],
      ] as const)
    : (BASS_PATTERNS[hashInts(seed, section, theme.bpm, 51) % BASS_PATTERNS.length] ?? []);
  for (const [step, semis] of bassPattern) {
    out.push({ layer: "bass", inst: "bass", step, midi: root - 12 + chordRoot + semis, vel: step === 0 ? 0.9 : 0.7 });
  }

  // Hats: 8ths with accents (run) or soft brushed backbeat (hub); 16th ghosts at high intensity.
  if (hub) {
    for (const step of [4, 12]) out.push({ layer: "hats", inst: theme.instruments.hats, step, midi: 0, vel: 0.6 });
    if (rng.chance(0.5)) out.push({ layer: "hats", inst: theme.instruments.hats, step: 14, midi: 0, vel: 0.35 });
  } else {
    for (let s = 0; s < STEPS_PER_BAR; s += 2) {
      out.push({ layer: "hats", inst: theme.instruments.hats, step: s, midi: 0, vel: s % 4 === 2 ? 0.75 : 0.45 });
      if (intensity >= 0.85 && rng.chance(0.5)) {
        out.push({ layer: "hats", inst: theme.instruments.hats, step: s + 1, midi: 0, vel: 0.25 });
      }
    }
  }

  // Kick: soft four-ish pulse with a seeded pickup.
  if (!hub) {
    out.push({ layer: "kick", inst: "kick", step: 0, midi: 0, vel: 1 });
    out.push({ layer: "kick", inst: "kick", step: 8, midi: 0, vel: 0.9 });
    if (rng.chance(0.35)) out.push({ layer: "kick", inst: "kick", step: rng.chance(0.5) ? 10 : 6, midi: 0, vel: 0.6 });
  }

  melodyBar(theme, seed, bar, mood, out);

  // Drone (gulp mood): the key root, low, one per bar.
  out.push({ layer: "drone", inst: "drone", step: 0, midi: root - 12, vel: 1 });

  // Hub ambience: a distant bell now and then.
  if (hub && rng.chance(0.3)) {
    const pent = MAJOR_PENTATONIC;
    out.push({
      layer: "ambience",
      inst: "bell",
      step: rng.int(4) * 4,
      midi: root + 36 + (pent[rng.int(pent.length)] ?? 0),
      vel: 0.5,
    });
  }

  out.sort((a, b) => a.step - b.step);
  return out;
}
