import { describe, expect, it } from "vitest";
import { FIXED_DT, FrameClock, FrameSampler, MAX_STEPS_PER_FRAME } from "./frame-loop";

describe("FrameClock", () => {
  it("does nothing on the first frame", () => {
    const c = new FrameClock();
    expect(c.advance(1000)).toEqual({ dt: 0, scaledDt: 0, steps: 0, alpha: 0 });
  });

  it("runs one step per 60 Hz frame", () => {
    const c = new FrameClock();
    c.advance(0);
    let total = 0;
    for (let i = 1; i <= 60; i++) total += c.advance((i * 1000) / 60).steps;
    expect(total).toBe(60);
  });

  it("runs two steps per frame at 30 fps and half a step of alpha at 120 fps", () => {
    const c = new FrameClock();
    c.advance(0);
    expect(c.advance(1000 / 30).steps).toBe(2);
    const d = new FrameClock();
    d.advance(0);
    const f = d.advance(1000 / 120);
    expect(f.steps).toBe(0);
    expect(f.alpha).toBeCloseTo(0.5, 5);
    expect(d.advance(2000 / 120).steps).toBe(1);
  });

  it("clamps long stalls instead of spiralling", () => {
    const c = new FrameClock();
    c.advance(0);
    const f = c.advance(5000);
    expect(f.dt).toBeCloseTo(0.1, 9);
    expect(f.steps).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
  });

  it("freezes sim steps during hit-stop but keeps real dt", () => {
    const c = new FrameClock();
    c.advance(0);
    c.timeScale = 0;
    const f = c.advance(50);
    expect(f.steps).toBe(0);
    expect(f.dt).toBeCloseTo(0.05, 9);
  });

  it("slows the sim in slow-mo", () => {
    const c = new FrameClock();
    c.timeScale = 0.3;
    c.advance(0);
    let steps = 0;
    for (let i = 1; i <= 100; i++) steps += c.advance(i * 10).steps;
    expect(steps).toBe(Math.floor((1 * 0.3) / FIXED_DT + 1e-9));
  });

  it("sanitises the time scale", () => {
    const c = new FrameClock();
    c.timeScale = -2;
    expect(c.timeScale).toBe(0);
    c.timeScale = Number.NaN;
    expect(c.timeScale).toBe(1);
  });

  it("ignores the gap across a reset (visibility pause)", () => {
    const c = new FrameClock();
    c.advance(0);
    c.reset();
    expect(c.advance(60_000).steps).toBe(0);
  });

  it("never reports alpha outside 0..1", () => {
    const c = new FrameClock();
    c.advance(0);
    for (let t = 1; t < 2000; t += 7.3) {
      const { alpha } = c.advance(t);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
  });
});

describe("FrameSampler", () => {
  it("signals exactly once when full", () => {
    const s = new FrameSampler(3);
    expect([s.push(1), s.push(2), s.push(3), s.push(4)]).toEqual([false, false, true, false]);
    expect(s.values()).toEqual([1, 2, 3]);
    s.clear();
    expect(s.values()).toEqual([]);
  });
});
