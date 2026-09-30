import { describe, expect, it } from "vitest";
import { CUES, CUE_NAMES } from "../cues";
import { WIND_PATCH, instrumentPatch } from "../music/instruments";
import type { InstrumentName } from "../music/themes";
import { makeSeamlessLoop, patchDuration, renderPatch } from "./render";
import type { Patch } from "./patch";

const SR = 16_000;

function peak(pcm: Float32Array): number {
  let p = 0;
  for (const s of pcm) p = Math.max(p, Math.abs(s));
  return p;
}

describe("renderPatch", () => {
  const patch: Patch = {
    layers: [
      { kind: "tone", at: 0, dur: 0.1, freq: 440, level: 1, fmRatio: 3.5, fmIndex: 2, fmDecay: 0.02 },
      { kind: "noise", at: 0.05, dur: 0.1, level: 0.5, filter: "bandpass", cutoff: 1000, cutoffEnd: 20000 },
    ],
  };

  it("is deterministic and peak-normalized", () => {
    const a = renderPatch(patch, SR);
    const b = renderPatch(patch, SR);
    expect(a).toEqual(b);
    expect(peak(a)).toBeCloseTo(0.8, 5);
    expect(a.length).toBe(Math.round(patchDuration(patch) * SR));
  });

  it("rejects invalid sample rates", () => {
    expect(() => renderPatch(patch, 100)).toThrow(RangeError);
    expect(() => renderPatch(patch, 44_100.5)).toThrow(RangeError);
  });

  it("renders every registered cue as finite, audible, bounded PCM", () => {
    for (const name of CUE_NAMES) {
      const pcm = renderPatch(CUES[name].patch, SR);
      expect(pcm.every(Number.isFinite), name).toBe(true);
      const p = peak(pcm);
      expect(p, name).toBeGreaterThan(0.5);
      expect(p, name).toBeLessThanOrEqual(0.86);
      expect(pcm.length / SR, name).toBeLessThan(2.5);
    }
  });

  it("renders every instrument across the playable range", () => {
    const insts: InstrumentName[] = [
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
    for (const inst of insts) {
      for (const midi of [29, 53, 89]) {
        const pcm = renderPatch(instrumentPatch(inst, midi), SR);
        expect(pcm.every(Number.isFinite), `${inst}@${midi}`).toBe(true);
        expect(peak(pcm), `${inst}@${midi}`).toBeGreaterThan(0.5);
      }
    }
  });

  it("makes a click-free loop whose seam matches the original continuation", () => {
    const pcm = renderPatch(WIND_PATCH, 8000);
    const loop = makeSeamlessLoop(pcm, 8000, 0.5);
    expect(loop.length).toBe(pcm.length - 4000);
    // The sample after the loop end is the loop start, which begins as the original tail continuation.
    expect(loop[0]).toBeCloseTo(pcm[loop.length] ?? 0, 6);
  });
});
