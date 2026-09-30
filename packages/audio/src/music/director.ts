/**
 * The adaptive music director: a lookahead scheduler on the WebAudio clock that plays the
 * composer's bars through per-layer gains. Intensity crossfades layers, mood swaps harmony,
 * slow-mo detunes and low-passes the music, stingers land on the beat grid.
 */
import { clamp, expLerp, semitonesToRatio } from "../math";
import { hashString } from "../rng";
import { makeSeamlessLoop, renderPatch } from "../synth/render";
import { nextQuantizedStep, stepAt, stepTime, stepsDue } from "./clock";
import type { Quantize } from "./clock";
import { composeBar } from "./compose";
import type { NoteEvent } from "./compose";
import { WIND_PATCH, instrumentPatch, isPitched } from "./instruments";
import { STINGER_QUANTIZE, stingerEvents } from "./stingers";
import type { StingerName } from "./stingers";
import { LAYERS, LAYER_INDEX, STEPS_PER_BAR, THEMES, layerLevels } from "./themes";
import type { InstrumentName, Mood, ThemeName, ThemeSpec } from "./themes";

/** What the director needs from the engine once audio is unlocked. */
export interface MusicHost {
  readonly ctx: AudioContext;
  /** Music bus input (the engine applies ducking and the music volume after it). */
  readonly output: AudioNode;
  /** Returns a cached AudioBuffer for `key`, rendering `pcm()` on first use. */
  buffer(key: number, pcm: () => Float32Array): AudioBuffer;
  readonly muted: boolean;
  readonly reducedAudio: boolean;
}

/** Timer used to drive the scheduler (injectable for tests). */
export interface SchedulerTimer {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Seconds of audio scheduled ahead of the clock. Covers a missed 25 ms tick or two. */
export const LOOKAHEAD = 0.14;
/** Scheduler tick period in milliseconds. */
export const TICK_MS = 25;
/** Slow-mo pitch drop at full slow-mo (GDD §8: −5 semitones). */
export const SLOWMO_SEMITONES = -5;
/** Music low-pass cutoff range: open → full slow-mo. */
export const FILTER_OPEN_HZ = 18_000;
export const FILTER_SLOWMO_HZ = 650;
/** Intensity ceiling in reduced-audio mode (fewer, calmer layers). */
export const REDUCED_INTENSITY_CAP = 0.6;
/** Voices per layer ring (a note steals the oldest of its layer beyond this). */
const RING = 12;
/** If the scheduler falls this many steps behind (background tab), it skips instead of bursting. */
const MAX_CATCH_UP = 32;
const INSTRUMENT_IDS: readonly InstrumentName[] = [
  "marimba",
  "musicbox",
  "pluck",
  "bass",
  "pad",
  "kick",
  "hat",
  "brush",
  "snare",
  "drone",
  "bell",
];
const WIND_KEY = 1 << 20;

interface PendingStinger {
  readonly step: number;
  readonly ev: NoteEvent;
}

/** Seed input accepted by `play`: a number, or a string such as a Daily seed id. */
export type MusicSeed = number | string;

/** Adaptive, deterministic, generative music. Owned by `AudioEngine` (`engine.music`). */
export class MusicDirector {
  private host: MusicHost | null = null;
  private readonly timer: SchedulerTimer;
  private handle: unknown = null;

  private spec: ThemeSpec | null = null;
  private seed = 0;
  private wantedIntensity = 0;
  private currentMood: Mood = "normal";
  private slowmo = 0;
  private readonly levels = new Float32Array(LAYERS.length);

  private origin = 0;
  private nextStep = 0;
  private barIndex = -1;
  private barEvents: NoteEvent[] = [];
  private cursor = 0;
  private stopStep = -1;
  private stopFade = 0.05;
  private pending: PendingStinger[] = [];

  private mix: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private layerGains: GainNode[] = [];
  private ringGains: GainNode[][] = [];
  private ringSources: (AudioBufferSourceNode | null)[][] = [];
  private readonly ringPos = new Int32Array(LAYERS.length);
  private wind: AudioBufferSourceNode | null = null;

  /** `timer` drives the lookahead loop; defaults to the global setInterval. */
  constructor(timer?: SchedulerTimer) {
    this.timer = timer ?? {
      setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
      clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
    };
  }

  /** The theme currently playing (or requested before unlock), or null. */
  get theme(): ThemeName | null {
    return this.spec?.name ?? null;
  }

  /** Whether notes are being scheduled right now. */
  get playing(): boolean {
    return this.host !== null && this.spec !== null && this.handle !== null;
  }

  /** The requested intensity (0..1) before any reduced-audio cap. */
  get intensity(): number {
    return this.wantedIntensity;
  }

  /** Current harmonic mood. */
  get mood(): Mood {
    return this.currentMood;
  }

  /** Current target level per layer, indexed like `LAYERS` (read-only view for meters). */
  get layerTargets(): Readonly<Float32Array> {
    return this.levels;
  }

  /** Index of the bar most recently composed (−1 before the first). */
  get bar(): number {
    return this.barIndex;
  }

  /** Connects to the unlocked audio graph. Called by the engine; resumes a theme requested earlier. */
  attach(host: MusicHost): void {
    if (this.host) return;
    this.host = host;
    const { ctx } = host;
    this.mix = ctx.createGain();
    this.mix.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = FILTER_OPEN_HZ;
    this.filter.Q.value = 0.9;
    this.mix.connect(this.filter);
    this.filter.connect(host.output);
    this.layerGains = [];
    this.ringGains = [];
    this.ringSources = [];
    for (let l = 0; l < LAYERS.length; l++) {
      const lg = ctx.createGain();
      lg.gain.value = 0;
      lg.connect(this.mix);
      this.layerGains.push(lg);
      const gains: GainNode[] = [];
      const sources: (AudioBufferSourceNode | null)[] = [];
      for (let r = 0; r < RING; r++) {
        const g = ctx.createGain();
        g.connect(lg);
        gains.push(g);
        sources.push(null);
      }
      this.ringGains.push(gains);
      this.ringSources.push(sources);
    }
    if (this.spec) this.begin(0.06);
  }

  /** Disconnects from the graph and stops scheduling (engine disposal). */
  detach(): void {
    this.halt();
    this.stopAllSources(0);
    try {
      this.filter?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.host = null;
    this.mix = null;
    this.filter = null;
  }

  /**
   * Starts (or crossfades to) a theme. Deterministic per seed: the same theme and seed always
   * produce the same bars. Before unlock the request is remembered and starts on unlock
   * (never autoplays without a gesture, because unlock requires one).
   */
  play(theme: ThemeName, seed: MusicSeed = 0): void {
    const nextSeed = typeof seed === "string" ? hashString(seed) : seed >>> 0;
    const spec = THEMES[theme];
    if (this.spec === spec && this.seed === nextSeed && this.playing) return;
    const switching = this.playing;
    this.spec = spec;
    this.seed = nextSeed;
    this.currentMood = "normal";
    if (!this.host) return;
    this.begin(switching ? 0.45 : 0.06);
  }

  /** Stops the music: `at: "bar"` waits for the next downbeat (tempo-synced ending). */
  stop(options: { at?: "now" | "bar"; fade?: number } = {}): void {
    const fade = Math.max(0.01, options.fade ?? 0.3);
    if (!this.playing) {
      this.spec = null;
      return;
    }
    if (options.at === "bar") {
      this.stopStep = nextQuantizedStep(this.nextStep, "bar");
      this.stopFade = fade;
      return;
    }
    this.finish(this.host?.ctx.currentTime ?? 0, fade);
  }

  /** Sets the gameplay intensity 0..1 (run: phase/frenzy; hub: crowd). Layers crossfade over ~0.5 s. */
  setIntensity(value: number): void {
    this.wantedIntensity = clamp(value, 0, 1);
    this.applyLevels(0.25);
  }

  /** Switches harmony: `gulp` = minor pentatonic + sub drone, from the next bar. */
  setMood(mood: Mood): void {
    if (mood === this.currentMood) return;
    this.currentMood = mood;
    this.applyLevels(0.4);
  }

  /** Re-applies levels after an engine setting change (reduced audio). */
  refresh(): void {
    this.applyLevels(0.3);
  }

  /**
   * Slow-mo amount 0..1: detunes the music down to −5 semitones and closes a low-pass filter.
   * Call it with the stepped values of the time-scale ramp (e.g. 1 → 0.5 → 0) for the GDD feel.
   */
  setSlowmo(amount: number): void {
    this.slowmo = clamp(amount, 0, 1);
    const host = this.host;
    if (!host || !this.filter) return;
    const now = host.ctx.currentTime;
    const ratio = semitonesToRatio(SLOWMO_SEMITONES * this.slowmo);
    this.filter.frequency.setTargetAtTime(expLerp(FILTER_OPEN_HZ, FILTER_SLOWMO_HZ, this.slowmo), now, 0.04);
    for (const ring of this.ringSources) {
      for (const src of ring) src?.playbackRate.setTargetAtTime(ratio, now, 0.04);
    }
    this.wind?.playbackRate.setTargetAtTime(ratio, now, 0.04);
  }

  /** Current slow-mo amount. */
  get slowmoAmount(): number {
    return this.slowmo;
  }

  /**
   * Plays a stinger on the next beat/bar of the running theme (tempo-synced).
   * Returns the audio-clock start time, or null if no theme is playing.
   */
  stinger(name: StingerName): number | null {
    const spec = this.spec;
    if (!this.playing || !spec) return null;
    const start = nextQuantizedStep(this.nextStep, STINGER_QUANTIZE[name]);
    for (const ev of stingerEvents(name, spec, this.currentMood)) this.pending.push({ step: start + ev.step, ev });
    return stepTime(this.origin, start, spec.bpm, spec.swing);
  }

  /** Audio-clock time of the next grid point (for syncing gameplay SFX to the music), or null. */
  nextGridTime(q: Quantize): number | null {
    const spec = this.spec;
    const host = this.host;
    if (!this.playing || !spec || !host) return null;
    const step = nextQuantizedStep(stepAt(this.origin, host.ctx.currentTime, spec.bpm) + 1, q);
    return stepTime(this.origin, step, spec.bpm, spec.swing);
  }

  /** Advances the scheduler: schedules every step inside the lookahead window. Driven by the timer. */
  tick(): void {
    const host = this.host;
    const spec = this.spec;
    if (!host || !spec) return;
    const now = host.ctx.currentTime;
    let due = stepsDue(this.origin, this.nextStep, now, LOOKAHEAD, spec.bpm);
    if (due > MAX_CATCH_UP) {
      // Tab was throttled: jump to the present rather than firing a burst of stale notes.
      this.nextStep = Math.max(this.nextStep, stepAt(this.origin, now, spec.bpm) + 1);
      this.barIndex = -1;
      due = stepsDue(this.origin, this.nextStep, now, LOOKAHEAD, spec.bpm);
    }
    for (let i = 0; i < due && this.spec; i++) this.scheduleStep(this.nextStep++);
  }

  private begin(delay: number): void {
    const host = this.host;
    const spec = this.spec;
    if (!host || !spec || !this.mix) return;
    const now = host.ctx.currentTime;
    const start = now + delay;
    const g = this.mix.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (delay > 0.1) g.setTargetAtTime(0, now, delay / 4);
    this.stopAllSources(start);
    this.origin = start;
    this.nextStep = 0;
    this.barIndex = -1;
    this.cursor = 0;
    this.stopStep = -1;
    this.pending = [];
    g.setValueAtTime(0, start);
    g.setTargetAtTime(1, start, 0.03);
    this.applyLevels(0.02, start);
    if (spec.name === "hub") this.startWind(start);
    if (this.handle === null) this.handle = this.timer.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  private finish(when: number, fade: number): void {
    const g = this.mix?.gain;
    if (g) {
      g.cancelScheduledValues(when);
      g.setValueAtTime(g.value, when);
      g.setTargetAtTime(0, when, fade / 4);
    }
    this.stopAllSources(when + fade);
    this.halt();
    this.spec = null;
    this.currentMood = "normal";
  }

  private halt(): void {
    if (this.handle !== null) this.timer.clearInterval(this.handle);
    this.handle = null;
    this.pending = [];
    this.stopStep = -1;
  }

  private effectiveIntensity(): number {
    return this.host?.reducedAudio ? Math.min(this.wantedIntensity, REDUCED_INTENSITY_CAP) : this.wantedIntensity;
  }

  private applyLevels(timeConstant: number, at?: number): void {
    const spec = this.spec;
    if (!spec) return;
    layerLevels(spec, this.effectiveIntensity(), this.currentMood, this.levels);
    const host = this.host;
    if (!host) return;
    const when = at ?? host.ctx.currentTime;
    for (let l = 0; l < this.layerGains.length; l++) {
      this.layerGains[l]?.gain.setTargetAtTime(this.levels[l] ?? 0, when, timeConstant);
    }
  }

  private scheduleStep(step: number): void {
    const spec = this.spec;
    const host = this.host;
    if (!spec || !host) return;
    const when = stepTime(this.origin, step, spec.bpm, spec.swing);
    if (step === this.stopStep) {
      this.finish(when, this.stopFade);
      return;
    }
    const bar = Math.floor(step / STEPS_PER_BAR);
    const inBar = step - bar * STEPS_PER_BAR;
    if (bar !== this.barIndex) {
      this.barIndex = bar;
      this.barEvents = composeBar(spec, this.seed, bar, this.effectiveIntensity(), this.currentMood);
      this.cursor = 0;
      while ((this.barEvents[this.cursor]?.step ?? STEPS_PER_BAR) < inBar) this.cursor++;
    }
    let ev = this.barEvents[this.cursor];
    while (ev && ev.step === inBar) {
      this.playNote(ev, when);
      ev = this.barEvents[++this.cursor];
    }
    if (this.pending.length > 0) {
      let keep = 0;
      for (const p of this.pending) {
        if (p.step === step) this.playNote(p.ev, when);
        else if (p.step > step) this.pending[keep++] = p;
      }
      this.pending.length = keep;
    }
  }

  private playNote(ev: NoteEvent, when: number): void {
    const host = this.host;
    if (!host || host.muted) return;
    const l = LAYER_INDEX[ev.layer];
    if (ev.layer !== "stinger" && (this.levels[l] ?? 0) < 0.001) return;
    const inst = ev.inst;
    const midi = isPitched(inst) ? ev.midi : 0;
    const key = INSTRUMENT_IDS.indexOf(inst) * 256 + (midi & 255);
    const sampleRate = host.ctx.sampleRate;
    const buffer = host.buffer(key, () => renderPatch(instrumentPatch(inst, midi), sampleRate));
    const pos = this.ringPos[l] ?? 0;
    this.ringPos[l] = (pos + 1) % RING;
    const sources = this.ringSources[l];
    const gain = this.ringGains[l]?.[pos];
    if (!sources || !gain) return;
    const old = sources[pos];
    if (old) {
      try {
        old.stop(when);
      } catch {
        /* already stopped */
      }
    }
    const src = host.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = semitonesToRatio(SLOWMO_SEMITONES * this.slowmo);
    src.connect(gain);
    gain.gain.setValueAtTime(ev.vel, when);
    src.start(when);
    sources[pos] = src;
  }

  private startWind(when: number): void {
    const host = this.host;
    if (!host) return;
    const sampleRate = host.ctx.sampleRate;
    const buffer = host.buffer(WIND_KEY, () => makeSeamlessLoop(renderPatch(WIND_PATCH, sampleRate), sampleRate, 0.5));
    const src = host.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.layerGains[LAYER_INDEX.ambience] ?? host.output);
    src.start(when);
    this.wind = src;
  }

  private stopAllSources(when: number): void {
    for (const ring of this.ringSources) {
      for (let i = 0; i < ring.length; i++) {
        const src = ring[i];
        if (!src) continue;
        try {
          src.stop(when);
        } catch {
          /* already stopped */
        }
        ring[i] = null;
      }
    }
    if (this.wind) {
      try {
        this.wind.stop(when);
      } catch {
        /* already stopped */
      }
      this.wind = null;
    }
  }
}
