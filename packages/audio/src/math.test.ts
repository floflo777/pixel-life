import { describe, expect, it } from "vitest";
import { MAJOR_PENTATONIC, MINOR_PENTATONIC, clamp, dbToGain, panForScreenX, scaleStep, smoothstep } from "./math";

describe("math", () => {
  it("clamps and maps NaN to the minimum", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });

  it("walks the pentatonic ladder across octaves", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((s) => scaleStep(MAJOR_PENTATONIC, s))).toEqual([0, 2, 4, 7, 9, 12, 14]);
    expect(scaleStep(MINOR_PENTATONIC, 5)).toBe(12);
    expect(scaleStep(MAJOR_PENTATONIC, -1)).toBe(-3);
  });

  it("pans by screen x within the width", () => {
    expect(panForScreenX(0.5, 0.7)).toBe(0);
    expect(panForScreenX(0, 0.7)).toBeCloseTo(-0.7);
    expect(panForScreenX(1, 0.7)).toBeCloseTo(0.7);
    expect(panForScreenX(3, 1)).toBe(1);
  });

  it("smoothstep and dB conversion behave", () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothstep(0.2, 0.4, 0.1)).toBe(0);
    expect(smoothstep(0.2, 0.4, 0.5)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
  });
});
