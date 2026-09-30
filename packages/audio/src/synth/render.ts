import { clamp } from "../math";
import type { Envelope, Layer, NoiseLayer, Patch, ToneLayer } from "./patch";

/** Default render rate; the engine passes the AudioContext rate to avoid resampling. */
export const DEFAULT_SAMPLE_RATE = 48_000;

const TAU = Math.PI * 2;

/** Total length of a patch in seconds (last layer end plus tail). */
export function patchDuration(patch: Patch): number {
  let end = 0;
  for (const layer of patch.layers) end = Math.max(end, layer.at + layer.dur);
  return end + (patch.tail ?? 0.01);
}

function smooth01(x: number): number {
  const t = clamp(x, 0, 1);
  const s = Math.sin((Math.PI / 2) * t);
  return s * s;
}

function envelopeAt(env: Envelope, t: number, dur: number): number {
  const attack = env.attack ?? 0.005;
  const release = env.release ?? 0.02;
  const a = attack > 0 ? smooth01(t / attack) : 1;
  const r = release > 0 ? smooth01((dur - t) / release) : 1;
  const d = env.decay !== undefined ? Math.exp(-t / env.decay) : 1;
  return a * r * d;
}

function triangle(phase: number): number {
  // phase in cycles; aligned so triangle(0) = 0 rising, like a sine.
  const p = phase - Math.floor(phase);
  return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
}

function renderTone(out: Float64Array, layer: ToneLayer, sampleRate: number): void {
  const start = Math.round(layer.at * sampleRate);
  const count = Math.round(layer.dur * sampleRate);
  const f0 = layer.freq;
  const f1 = layer.freqEnd ?? f0;
  const glide = Math.max(1e-4, layer.glide ?? layer.dur);
  const chip = clamp(layer.chip ?? (layer.wave === "triangle" ? 1 : 0), 0, 1);
  const fmRatio = layer.fmRatio ?? 0;
  const fmIndex = layer.fmIndex ?? 0;
  const fmDecay = layer.fmDecay;
  const vibHz = layer.vibratoHz ?? 0;
  const vibDepth = (layer.vibratoCents ?? 0) / 1200;
  let phase = 0;
  let modPhase = 0;
  for (let i = 0; i < count; i++) {
    const idx = start + i;
    if (idx >= out.length) break;
    const t = i / sampleRate;
    let freq = f0 * (f1 / f0) ** Math.min(1, t / glide);
    if (vibHz > 0) freq *= 2 ** (vibDepth * Math.sin(TAU * vibHz * t));
    phase += freq / sampleRate;
    let offset = 0;
    if (fmRatio > 0 && fmIndex > 0) {
      modPhase += (freq * fmRatio) / sampleRate;
      const index = fmDecay !== undefined ? fmIndex * Math.exp(-t / fmDecay) : fmIndex;
      offset = (index * Math.sin(TAU * modPhase)) / TAU;
    }
    const p = phase + offset;
    const wave = (1 - chip) * Math.sin(TAU * p) + chip * triangle(p);
    out[idx] = (out[idx] ?? 0) + layer.level * envelopeAt(layer, t, layer.dur) * wave;
  }
}

function renderNoise(out: Float64Array, layer: NoiseLayer, sampleRate: number): void {
  const start = Math.round(layer.at * sampleRate);
  const count = Math.round(layer.dur * sampleRate);
  const c0 = layer.cutoff;
  const c1 = layer.cutoffEnd ?? c0;
  const k = 1 / Math.max(0.1, layer.q ?? Math.SQRT1_2);
  const nyquistSafe = sampleRate * 0.45;
  const lfoHz = layer.lfoHz ?? 0;
  const lfoDepth = clamp(layer.lfoDepth ?? 0, 0, 0.95);
  let state = (layer.seed ?? 0x5eed) >>> 0 || 1;
  // TPT state-variable filter (Zavalishin): stable for any cutoff, including fast sweeps.
  let ic1 = 0;
  let ic2 = 0;
  for (let i = 0; i < count; i++) {
    const idx = start + i;
    if (idx >= out.length) break;
    const t = i / sampleRate;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const white = (state >>> 0) / 2147483648 - 1;
    let cutoff = c0 * (c1 / c0) ** (t / layer.dur);
    if (lfoHz > 0) cutoff *= 1 + lfoDepth * Math.sin(TAU * lfoHz * t);
    const g = Math.tan((Math.PI * clamp(cutoff, 10, nyquistSafe)) / sampleRate);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = white - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    const y = layer.filter === "lowpass" ? v2 : layer.filter === "bandpass" ? k * v1 : white - k * v1 - v2;
    out[idx] = (out[idx] ?? 0) + layer.level * envelopeAt(layer, t, layer.dur) * y;
  }
}

function renderLayer(out: Float64Array, layer: Layer, sampleRate: number): void {
  if (layer.kind === "tone") renderTone(out, layer, sampleRate);
  else renderNoise(out, layer, sampleRate);
}

/**
 * Renders a patch to mono PCM, peak-normalized to `patch.peak` (default 0.8).
 * Pure and deterministic: no browser APIs, no Math.random; the same patch and rate give identical samples.
 */
export function renderPatch(patch: Patch, sampleRate: number = DEFAULT_SAMPLE_RATE): Float32Array {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192_000) {
    throw new RangeError("sampleRate must be an integer between 8000 and 192000");
  }
  const length = Math.max(1, Math.round(patchDuration(patch) * sampleRate));
  const mix = new Float64Array(length);
  for (const layer of patch.layers) renderLayer(mix, layer, sampleRate);
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(mix[i] ?? 0));
  const gain = peak > 0 ? (patch.peak ?? 0.8) / peak : 0;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (mix[i] ?? 0) * gain;
  return out;
}

/**
 * Makes a buffer loop seamlessly by crossfading its last `fadeSeconds` into its head (equal power).
 * Returns a new, shorter buffer whose end flows into its start without a click.
 */
export function makeSeamlessLoop(pcm: Float32Array, sampleRate: number, fadeSeconds: number): Float32Array {
  const fade = Math.min(Math.floor(pcm.length / 2), Math.max(1, Math.round(fadeSeconds * sampleRate)));
  const length = pcm.length - fade;
  const out = pcm.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const tail = pcm[length + i] ?? 0;
    const head = out[i] ?? 0;
    out[i] = head * Math.sin((Math.PI / 2) * t) + tail * Math.cos((Math.PI / 2) * t);
  }
  return out;
}
