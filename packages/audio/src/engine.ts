/**
 * The Pixel Life audio engine on WebAudio.
 *
 * Graph:  voices (gain → pan) ─▶ sfx bus ─┐
 *         music director ─▶ duck ─▶ music bus ─┼─▶ master ─▶ limiter ─▶ destination
 *
 * - Nothing is created until `unlock()` runs inside a user gesture (no autoplay, SSR-safe).
 * - Mute and volumes are held in memory only: the caller persists them (settings, local storage).
 * - `play()` is the hot path: it allocates no JS objects (pooled voice slots, typed-array limiter,
 *   cached buffers); the only per-play allocation is the one-shot AudioBufferSourceNode WebAudio requires.
 */
import { CUES, CUE_ID, CUE_NAMES, cueDef } from "./cues";
import type { CueName } from "./cues";
import { cueAllowed, cueLevel, cuePan, cuePlaybackRate } from "./cue-params";
import { createDuckState, requestDuck } from "./duck";
import { clamp, dbToGain } from "./math";
import { MusicDirector } from "./music/director";
import type { MusicHost, SchedulerTimer } from "./music/director";
import { renderPatch } from "./synth/render";
import { VoiceLimiter } from "./voice-limiter";

/** Mixer buses the caller can set. */
export type Bus = "master" | "music" | "sfx";

/** Engine lifecycle. `locked` until a gesture unlocks it; `unsupported` if WebAudio is missing. */
export type EngineStatus = "locked" | "running" | "suspended" | "unsupported" | "disposed";

/**
 * Per-play parameters. The engine never retains this object, so hot callers can keep one
 * instance and mutate it every frame instead of allocating literals.
 */
export interface PlayParams {
  /** Normalized screen x (0 = left, 1 = right) for stereo pan. Default 0.5 (centre). */
  x?: number;
  /** Ladder step (combo count, tooth index, pixel index…); its meaning is the cue's `step` mode. */
  step?: number;
  /** Extra detune in semitones. */
  detune?: number;
  /** Level multiplier (0..2), e.g. fling power. Default 1. */
  gain?: number;
  /** Start delay in seconds (for sequencing per-pixel plinks). Default 0. */
  delay?: number;
}

/** Construction options. Everything is optional; defaults suit the game. */
export interface AudioEngineOptions {
  /** Creates the AudioContext (injected for tests or to share one). Default: `new AudioContext()`. */
  createContext?: () => AudioContext;
  /** Initial mute (from the caller's persisted settings). */
  muted?: boolean;
  /** Initial bus volumes 0..1. */
  volumes?: Partial<Record<Bus, number>>;
  /** Reduced audio (accessibility): fewer voices, no non-essential cues, softer heavy cues, calmer music. */
  reducedAudio?: boolean;
  /** Maximum simultaneous SFX voices. Default 24. */
  maxVoices?: number;
  /** Uniform [0,1) source for pitch variance (cosmetic, so Math.random is fine by default). */
  random?: () => number;
  /** Timer for the music scheduler. */
  timer?: SchedulerTimer;
  /** Suspend audio while the page is hidden. Default true. */
  suspendWhenHidden?: boolean;
}

/** Default bus volumes: music sits under the SFX that carry gameplay information. */
export const DEFAULT_VOLUMES: Readonly<Record<Bus, number>> = { master: 0.8, music: 0.55, sfx: 0.9 };
/** Voice cap in reduced-audio mode. */
export const REDUCED_MAX_VOICES = 10;
/** Crossfade used when a voice is stolen (click-free, adds this much latency to that start only). */
export const STEAL_FADE = 0.008;

interface VoiceSlot {
  readonly gain: GainNode;
  readonly pan: StereoPannerNode;
  source: AudioBufferSourceNode | null;
}

const NO_PARAMS: Readonly<PlayParams> = Object.freeze({});

function audioContextClass(): (new () => AudioContext) | null {
  const g = globalThis as typeof globalThis & { webkitAudioContext?: new () => AudioContext };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** The engine. One per app; `engine.music` is its adaptive music director. */
export class AudioEngine {
  /** Adaptive music (themes, intensity, mood, slow-mo, stingers). */
  readonly music: MusicDirector;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private voices: VoiceSlot[] = [];
  private readonly buffers: (AudioBuffer | undefined)[] = new Array<AudioBuffer | undefined>(CUE_NAMES.length);
  private readonly musicBuffers = new Map<number, AudioBuffer>();
  private readonly limiter: VoiceLimiter;
  private readonly duck = createDuckState();
  private readonly volumes: Record<Bus, number>;
  private readonly random: () => number;
  private readonly createContext: (() => AudioContext) | null;
  private readonly suspendWhenHidden: boolean;
  private isMuted: boolean;
  private reduced: boolean;
  private unsupported = false;
  private disposed = false;
  private pendingUnlock: Promise<boolean> | null = null;
  private listening = false;
  private readonly onVisibility = (): void => this.handleVisibility();

  /** Creates the engine without touching WebAudio (safe during SSR or before any gesture). */
  constructor(options: AudioEngineOptions = {}) {
    this.isMuted = options.muted ?? false;
    this.reduced = options.reducedAudio ?? false;
    this.volumes = { ...DEFAULT_VOLUMES };
    for (const bus of ["master", "music", "sfx"] as const) {
      const v = options.volumes?.[bus];
      if (v !== undefined) this.volumes[bus] = clamp(v, 0, 1);
    }
    this.limiter = new VoiceLimiter(Math.max(1, Math.trunc(options.maxVoices ?? 24)), CUE_NAMES.length);
    if (this.reduced) this.limiter.setLimit(REDUCED_MAX_VOICES);
    this.random = options.random ?? Math.random;
    const factory = options.createContext;
    const Ctor = audioContextClass();
    this.createContext = factory ?? (Ctor ? () => new Ctor() : null);
    this.suspendWhenHidden = options.suspendWhenHidden ?? true;
    this.music = new MusicDirector(options.timer);
  }

  /** Lifecycle status. */
  get status(): EngineStatus {
    if (this.disposed) return "disposed";
    if (this.unsupported) return "unsupported";
    if (!this.ctx) return "locked";
    return this.ctx.state === "running" ? "running" : this.ctx.state === "suspended" ? "suspended" : "locked";
  }

  /** Whether output is muted (the caller persists this value). */
  get muted(): boolean {
    return this.isMuted;
  }

  /** Whether reduced audio is on. */
  get reducedAudio(): boolean {
    return this.reduced;
  }

  /** The audio clock in seconds (0 before unlock), for syncing visuals to scheduled sounds. */
  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Current volume of a bus (0..1). */
  volume(bus: Bus): number {
    return this.volumes[bus];
  }

  /**
   * Creates/resumes the AudioContext. Must be called from a user gesture handler (pointer, key, touch).
   * Resolves true once audio runs, false if unavailable; the game stays playable without sound.
   */
  unlock(): Promise<boolean> {
    if (this.disposed || this.unsupported) return Promise.resolve(false);
    if (this.ctx?.state === "running") return Promise.resolve(true);
    if (this.pendingUnlock) return this.pendingUnlock;
    if (!this.ctx) {
      if (!this.createContext) {
        this.unsupported = true;
        return Promise.resolve(false);
      }
      try {
        this.build(this.createContext());
      } catch {
        this.unsupported = true;
        return Promise.resolve(false);
      }
    }
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(false);
    let resume: Promise<void>;
    try {
      resume = ctx.state === "running" ? Promise.resolve() : ctx.resume();
    } catch {
      return Promise.resolve(false);
    }
    const attempt = resume
      .then(
        () => !this.disposed && ctx.state === "running",
        () => false,
      )
      .finally(() => {
        if (this.pendingUnlock === attempt) this.pendingUnlock = null;
      });
    this.pendingUnlock = attempt;
    return attempt;
  }

  /**
   * Unlocks on the first pointer/key/touch gesture on `target` (e.g. `window`), then removes its listeners.
   * Returns a function that removes them early.
   */
  unlockOnGesture(target: Pick<EventTarget, "addEventListener" | "removeEventListener">): () => void {
    const events = ["pointerdown", "keydown", "touchend"] as const;
    const handler = (): void => {
      void this.unlock().then((ok) => {
        if (ok) detach();
      });
    };
    const detach = (): void => {
      for (const e of events) target.removeEventListener(e, handler, true);
    };
    for (const e of events) target.addEventListener(e, handler, true);
    return detach;
  }

  /** Mutes/unmutes everything (a short ramp, no clicks). Muting also stops SFX voices. */
  setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.isMuted = muted;
    this.applyMaster();
    if (muted) this.stopAll();
  }

  /** Sets a bus volume 0..1. */
  setVolume(bus: Bus, value: number): void {
    this.volumes[bus] = clamp(value, 0, 1);
    if (bus === "master") this.applyMaster();
    else this.ramp(bus === "music" ? this.musicBus : this.sfxBus, this.volumes[bus]);
  }

  /** Turns reduced audio on/off (see `AudioEngineOptions.reducedAudio`). */
  setReducedAudio(reduced: boolean): void {
    this.reduced = reduced;
    this.limiter.setLimit(reduced ? REDUCED_MAX_VOICES : this.limiter.capacity);
    this.music.refresh();
  }

  /**
   * Plays a cue. Returns false when it was not started (locked, muted, filtered by reduced audio,
   * rate-limited or out of voices). Never allocates JS objects beyond the WebAudio source node.
   */
  play(cue: CueName, params: Readonly<PlayParams> = NO_PARAMS): boolean {
    const ctx = this.ctx;
    const out = this.sfxBus;
    if (!ctx || !out || this.isMuted || this.disposed || ctx.state !== "running") return false;
    const def = cueDef(cue);
    if (!cueAllowed(def, this.reduced)) return false;
    const id = CUE_ID[cue];
    const buffer = this.buffers[id] ?? this.renderCue(id, cue);
    const now = ctx.currentTime;
    const delay = Math.max(0, params.delay ?? 0);
    const rate = cuePlaybackRate(def, params.step ?? 0, params.detune ?? 0, this.random());
    const level = cueLevel(def, params.gain ?? 1, this.reduced);
    if (level <= 0) return false;
    const slot = this.limiter.acquire(
      id,
      def.priority,
      now,
      now + delay + buffer.duration / rate,
      def.maxVoices,
      def.minInterval,
    );
    if (slot < 0) return false;
    const voice = this.voices[slot];
    if (!voice) return false;
    let start = now + delay;
    const g = voice.gain.gain;
    g.cancelScheduledValues(now);
    const previous = voice.source;
    if (this.limiter.stolen && previous) {
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + STEAL_FADE);
      try {
        previous.stop(now + STEAL_FADE);
      } catch {
        /* already stopped */
      }
      start = Math.max(start, now + STEAL_FADE);
    }
    g.setValueAtTime(level, start);
    voice.pan.pan.setValueAtTime(cuePan(params.x ?? 0.5, this.reduced), start);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(voice.gain);
    src.start(start);
    voice.source = src;
    if (def.duck) this.duckMusic(def.duck.db, def.duck.hold, start);
    return true;
  }

  /** Ducks the music by `db` for `hold` seconds (merged with any active duck). */
  duckMusic(db: number, hold: number, at?: number): void {
    const ctx = this.ctx;
    const node = this.duckGain;
    if (!ctx || !node) return;
    const now = at ?? ctx.currentTime;
    if (!requestDuck(this.duck, now, db, hold)) return;
    const g = node.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(dbToGain(-this.duck.depthDb), now, 0.015);
    g.setTargetAtTime(1, this.duck.until, 0.18);
  }

  /** Stops every SFX voice now (scene change, pause). Music is controlled via `engine.music`. */
  stopAll(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (!v?.source) continue;
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.01);
      try {
        v.source.stop(now + 0.05);
      } catch {
        /* already stopped */
      }
      v.source = null;
    }
    this.limiter.reset();
  }

  /** Renders cue buffers ahead of time (call after unlock, during a loading moment) to avoid first-play hitches. */
  prewarm(cues: readonly CueName[] = CUE_NAMES): void {
    if (!this.ctx) return;
    for (const cue of cues) {
      const id = CUE_ID[cue];
      if (!this.buffers[id]) this.renderCue(id, cue);
    }
  }

  /**
   * Like `prewarm`, but renders one cue per macrotask so the main thread never blocks for long
   * (a full prewarm is ~200 ms of synthesis at 48 kHz). Resolves when every buffer is ready.
   */
  async prewarmInBackground(cues: readonly CueName[] = CUE_NAMES): Promise<void> {
    for (const cue of cues) {
      if (!this.ctx || this.disposed) return;
      const id = CUE_ID[cue];
      if (!this.buffers[id]) this.renderCue(id, cue);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  /** Number of SFX voices sounding now (for the dev page and tests). */
  activeVoices(): number {
    return this.limiter.activeCount(this.ctx?.currentTime ?? 0);
  }

  /** Releases the AudioContext and listeners. The engine cannot be reused afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.stopAll();
    this.music.detach();
    this.disposed = true;
    if (this.listening && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) {
      try {
        void ctx.close().catch(() => undefined);
      } catch {
        /* close unsupported */
      }
    }
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.musicBus);
    this.master.gain.value = this.isMuted ? 0 : this.volumes.master;
    this.voices = [];
    for (let i = 0; i < this.limiter.capacity; i++) {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      gain.connect(pan);
      pan.connect(this.sfxBus);
      this.voices.push({ gain, pan, source: null });
    }
    if (this.suspendWhenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
      this.listening = true;
    }
    this.music.attach(this.musicHost(ctx));
  }

  private musicHost(ctx: AudioContext): MusicHost {
    const output = this.duckGain;
    if (!output) throw new Error("music host requested before the graph exists");
    const buffers = this.musicBuffers;
    const toBuffer = (pcm: Float32Array): AudioBuffer => this.toBuffer(pcm);
    const isMuted = (): boolean => this.isMuted;
    const isReduced = (): boolean => this.reduced;
    return {
      ctx,
      output,
      buffer(key: number, pcm: () => Float32Array): AudioBuffer {
        let buf = buffers.get(key);
        if (!buf) {
          buf = toBuffer(pcm());
          buffers.set(key, buf);
        }
        return buf;
      },
      get muted() {
        return isMuted();
      },
      get reducedAudio() {
        return isReduced();
      },
    };
  }

  private toBuffer(pcm: Float32Array): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) throw new Error("no AudioContext");
    const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
    buffer.getChannelData(0).set(pcm);
    return buffer;
  }

  private renderCue(id: number, cue: CueName): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) throw new Error("no AudioContext");
    const buffer = this.toBuffer(renderPatch(CUES[cue].patch, ctx.sampleRate));
    this.buffers[id] = buffer;
    return buffer;
  }

  private applyMaster(): void {
    this.ramp(this.master, this.isMuted ? 0 : this.volumes.master);
  }

  private ramp(node: GainNode | null, value: number): void {
    const ctx = this.ctx;
    if (!node || !ctx) return;
    node.gain.setTargetAtTime(value, ctx.currentTime, 0.02);
  }

  private handleVisibility(): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed || typeof document === "undefined") return;
    if (document.hidden) {
      this.stopAll();
      void ctx.suspend().catch(() => undefined);
    } else {
      void ctx.resume().catch(() => undefined);
    }
  }
}
