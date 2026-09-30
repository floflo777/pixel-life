import { describe, expect, it } from "vitest";
import { comboScale, impactSquash, MAX_HIT_STOP_MS, planFor, stretchFor, TimeWarp } from "./juice";

describe("planFor (GDD §2.7)", () => {
  it("scales pops by combo and armour", () => {
    expect(planFor({ kind: "pop", combo: 1, armoured: false })).toEqual({ hitStopMs: 50, trauma: 0.15 });
    expect(planFor({ kind: "pop", combo: 3, armoured: false }).hitStopMs).toBe(80);
    expect(planFor({ kind: "pop", combo: 5, armoured: false }).punch).toBe(true);
    expect(planFor({ kind: "pop", combo: 1, armoured: true })).toMatchObject({ hitStopMs: 120, impactFrames: 2 });
  });
  it("gives bites a hit-stop, a 0.3× slow-mo stepping back in 2 steps, and trauma per pixel", () => {
    const one = planFor({ kind: "bite", px: 1 });
    expect(one.hitStopMs).toBe(90);
    expect(one.slow?.map((s) => s.scale)).toEqual([0.3, 0.6, 1]);
    expect(one.trauma).toBeCloseTo(0.3);
    expect(one.impactFrames).toBeUndefined();
    const three = planFor({ kind: "bite", px: 3 });
    expect(three.trauma).toBeCloseTo(0.6);
    expect(three.impactFrames).toBe(2);
  });
  it("makes Old Gulp's bite the biggest beat", () => {
    expect(planFor({ kind: "gulpBite" })).toMatchObject({ hitStopMs: 200, trauma: 1, impactFrames: 3 });
  });
});

describe("TimeWarp", () => {
  it("holds 0 during hit-stop, then plays the slow-mo program, then returns to 1", () => {
    const w = new TimeWarp();
    w.apply(1000, planFor({ kind: "bite", px: 1 }));
    expect(w.scale(1000)).toBe(0);
    expect(w.scale(1089)).toBe(0);
    expect(w.scale(1090)).toBe(0.3);
    expect(w.scale(1489)).toBe(0.3);
    expect(w.scale(1491)).toBe(0.6);
    expect(w.scale(1571)).toBe(1);
    expect(w.scale(1700)).toBe(1);
  });
  it("caps slow-mo at 0.6× under reduced motion but keeps hit-stop", () => {
    const w = new TimeWarp(true);
    w.apply(0, planFor({ kind: "bite", px: 2 }));
    expect(w.scale(10)).toBe(0);
    expect(w.scale(200)).toBe(0.6);
  });
  it("never holds longer than the hit-stop cap", () => {
    const w = new TimeWarp();
    w.hitStop(0, 1000);
    expect(w.stopped(MAX_HIT_STOP_MS - 1)).toBe(true);
    expect(w.stopped(MAX_HIT_STOP_MS)).toBe(false);
  });
  it("keeps the deeper slow-mo when a shallower one arrives", () => {
    const w = new TimeWarp();
    w.slowmo(0, [{ scale: 0.3, ms: 400 }]);
    w.slowmo(100, [{ scale: 0.5, ms: 300 }]);
    expect(w.scale(150)).toBe(0.3);
    w.reset();
    expect(w.scale(150)).toBe(1);
  });
});

describe("shape helpers", () => {
  it("stretches with speed, volume-preserving, capped at 1.35", () => {
    expect(stretchFor(0).along).toBe(1);
    const s = stretchFor(1000);
    expect(s.along).toBeCloseTo(1.35);
    expect(s.along * s.across * s.across).toBeCloseTo(1);
  });
  it("steps the impact squash 0.75 → 1.10 → 1", () => {
    expect(impactSquash(0)).toBe(0.75);
    expect(impactSquash(100)).toBe(1.1);
    expect(impactSquash(200)).toBe(1);
  });
  it("grows combo text ×1.2 per step up to ×2", () => {
    expect(comboScale(2)).toBe(1);
    expect(comboScale(3)).toBeCloseTo(1.2);
    expect(comboScale(20)).toBe(2);
  });
});
