import { describe, expect, it } from "vitest";
import { CUES, CUE_ID, CUE_NAMES, cueDef } from "./cues";
import type { CueName } from "./cues";
import { REDUCED_HEAVY_GAIN, cueAllowed, cueLevel, cuePan, cuePlaybackRate, stepSemitones } from "./cue-params";

describe("cue registry", () => {
  it("has sane metadata for every cue", () => {
    for (const name of CUE_NAMES) {
      const def = cueDef(name);
      expect(def.gain, name).toBeGreaterThan(0);
      expect(def.gain, name).toBeLessThanOrEqual(1);
      expect(def.priority, name).toBeGreaterThanOrEqual(0);
      expect(def.priority, name).toBeLessThanOrEqual(9);
      expect(def.maxVoices, name).toBeGreaterThanOrEqual(1);
      expect(def.minInterval, name).toBeGreaterThanOrEqual(0);
      expect(def.pitchVariance, name).toBeLessThanOrEqual(2);
      expect(def.patch.layers.length, name).toBeGreaterThan(0);
    }
  });

  it("assigns unique dense ids", () => {
    const ids = CUE_NAMES.map((n) => CUE_ID[n]);
    expect(new Set(ids).size).toBe(CUE_NAMES.length);
    expect(Math.max(...ids)).toBe(CUE_NAMES.length - 1);
  });

  it("covers the brief's cue list", () => {
    const required: CueName[] = [
      "fling.charge",
      "fling.release",
      "smash.nib",
      "smash.pogo",
      "smash.clank",
      "smash.snatch",
      "smash.slurp",
      "smash.fizz",
      "bite",
      "pixel.pop",
      "pixel.sweep",
      "pixel.fall",
      "slowmo.in",
      "slowmo.out",
      "gulp.rumble",
      "gulp.bite",
      "gulp.tooth",
      "gulp.burp",
      "gulp.inhale",
      "run.start",
      "run.end",
      "regrow.sparkle",
      "mend.chime",
      "gold.reveal",
      "hub.step",
      "emote.wave",
      "door.enter",
      "ui.click",
    ];
    for (const name of required) expect(CUES[name]).toBeDefined();
  });

  it("throws on unknown names from untyped callers", () => {
    expect(() => cueDef("nope" as CueName)).toThrow(TypeError);
  });
});

describe("cue params", () => {
  it("climbs the pentatonic ladder for combo steps", () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => stepSemitones("pentatonic", s))).toEqual([0, 2, 4, 7, 9, 12]);
    expect(stepSemitones("semitone", 3)).toBe(3);
    expect(stepSemitones("none", 5)).toBe(0);
    expect(stepSemitones("pentatonic", 999)).toBe(stepSemitones("pentatonic", 10));
  });

  it("keeps pitch variance within the cue's spread", () => {
    const def = CUES["hub.step"];
    const low = cuePlaybackRate(def, 0, 0, 0);
    const high = cuePlaybackRate(def, 0, 0, 0.999999);
    expect(low).toBeCloseTo(2 ** (-def.pitchVariance / 12), 6);
    expect(high).toBeCloseTo(2 ** (def.pitchVariance / 12), 4);
    expect(cuePlaybackRate(CUES["pixel.sweep"], 5, 0, 0.5)).toBeCloseTo(2, 6);
  });

  it("applies reduced-audio policy", () => {
    expect(cueAllowed(CUES["hub.step"], true)).toBe(false);
    expect(cueAllowed(CUES["hub.step"], false)).toBe(true);
    expect(cueAllowed(CUES.bite, true)).toBe(true);
    const heavy = CUES["gulp.bite"];
    expect(cueLevel(heavy, 1, true)).toBeCloseTo(heavy.gain * REDUCED_HEAVY_GAIN);
    expect(cueLevel(heavy, 1, false)).toBeCloseTo(heavy.gain);
    expect(Math.abs(cuePan(0, true))).toBeLessThan(Math.abs(cuePan(0, false)));
  });
});
