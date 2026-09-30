import { describe, expect, expectTypeOf, it } from "vitest";
import { RUN_TICKS, type SimInput, SIM_HZ, type RunSummary } from "./sim-types.js";

describe("sim contract", () => {
  it("runs last exactly 60 s at 60 Hz", () => {
    expect(SIM_HZ).toBe(60);
    expect(RUN_TICKS).toBe(60 * SIM_HZ);
  });

  it("input variants are discriminated by k", () => {
    const fling: SimInput = { t: 0, k: 0, ang: 1024, pow: 512 };
    const steer: SimInput = { t: 1, k: 1, dir: 0, on: 1 };
    expect([fling.k, steer.k]).toEqual([0, 1]);
    expectTypeOf<RunSummary["lostDelta"]>().toEqualTypeOf<string>();
  });
});
