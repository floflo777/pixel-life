import { describe, expect, it } from "vitest";
import { Rng } from "./rng.js";

describe("sfc32 Rng", () => {
  it("is a pure function of (seed, stream) with committed reference outputs", () => {
    const a = new Rng(12345, 1);
    const b = new Rng(12345, 1);
    const xs = Array.from({ length: 5 }, () => a.u32());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b.u32()));
    // Reference vector: changing it changes every run hash (golden corpus).
    expect(xs).toMatchInlineSnapshot(`
      [
        4007762049,
        272008803,
        3209806752,
        3731599668,
        318327572,
      ]
    `);
  });

  it("separates streams and nearby seeds", () => {
    expect(new Rng(1, 1).u32()).not.toBe(new Rng(1, 2).u32());
    expect(new Rng(1, 1).u32()).not.toBe(new Rng(2, 1).u32());
  });

  it("float/int/range stay in bounds and are roughly uniform", () => {
    const r = new Rng(7, 3);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const k = r.int(10);
      buckets[k] = (buckets[k] ?? 0) + 1;
      const g = r.range(-2, 3);
      expect(g).toBeGreaterThanOrEqual(-2);
      expect(g).toBeLessThan(3);
    }
    for (const n of buckets) expect(Math.abs(n - 2000)).toBeLessThan(250);
  });
});
