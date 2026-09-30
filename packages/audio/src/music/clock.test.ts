import { describe, expect, it } from "vitest";
import { nextQuantizedStep, stepAt, stepDuration, stepTime, stepsDue } from "./clock";

describe("clock", () => {
  it("computes step lengths", () => {
    expect(stepDuration(120)).toBeCloseTo(0.125);
    expect(stepDuration(112) * 16).toBeCloseTo((60 / 112) * 4);
  });

  it("applies swing only to off-beat 8ths", () => {
    const d = stepDuration(84);
    expect(stepTime(1, 2, 84, 0.3)).toBeCloseTo(1 + 2 * d + 0.3 * d);
    expect(stepTime(1, 4, 84, 0.3)).toBeCloseTo(1 + 4 * d);
    expect(stepTime(1, 1, 84, 0.3)).toBeCloseTo(1 + d);
  });

  it("quantizes to the next beat or bar (inclusive)", () => {
    expect(nextQuantizedStep(0, "bar")).toBe(0);
    expect(nextQuantizedStep(1, "bar")).toBe(16);
    expect(nextQuantizedStep(5, "beat")).toBe(8);
    expect(nextQuantizedStep(8, "beat")).toBe(8);
    expect(nextQuantizedStep(7, "step")).toBe(7);
  });

  it("counts due steps inside the lookahead window", () => {
    // 120 BPM: a step every 0.125 s. At t=0 with 0.14 s lookahead, steps 0 and 1 are due.
    expect(stepsDue(0, 0, 0, 0.14, 120)).toBe(2);
    expect(stepsDue(0, 2, 0, 0.14, 120)).toBe(0);
    expect(stepsDue(0, 2, 0.2, 0.14, 120)).toBe(1);
    expect(stepsDue(10, 0, 0, 0.14, 120)).toBe(0);
    expect(stepAt(0, 0.26, 120)).toBe(2);
  });
});
