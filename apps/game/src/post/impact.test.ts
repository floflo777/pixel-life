import { describe, expect, it } from "vitest";
import { BURST_FRAMES, IMPACT_MIN_GAP_MS, ImpactScheduler } from "./impact";

describe("ImpactScheduler", () => {
  it("plays 1-bit then inverted frames, then nothing", () => {
    const s = new ImpactScheduler();
    expect(s.requestFrame(0, 2)).toBe("frame");
    expect([s.next().fullFrame, s.next().fullFrame, s.next().fullFrame]).toEqual([1, 2, 0]);
  });

  it("caps sequences at one per 600 ms (< 3 flashes/s)", () => {
    const s = new ImpactScheduler();
    expect(s.requestFrame(0)).toBe("frame");
    expect(s.requestFrame(IMPACT_MIN_GAP_MS - 1)).toBe("none");
    expect(s.requestFrame(IMPACT_MIN_GAP_MS)).toBe("frame");
    let starts = 0;
    for (let t = 0; t < 10_000; t += 16) if (s.requestFrame(2_000 + t) === "frame") starts++;
    expect(starts / 10).toBeLessThan(3);
  });

  it("clamps the frame count to 1..3", () => {
    const s = new ImpactScheduler();
    s.requestFrame(0, 9);
    const seq = [s.next(), s.next(), s.next(), s.next()].map((f) => f.fullFrame);
    expect(seq).toEqual([1, 2, 1, 0]);
  });

  it("replaces impact frames with a one-frame border under reduced motion", () => {
    const s = new ImpactScheduler({ reducedMotion: true, noFlashes: false });
    expect(s.requestFrame(0)).toBe("border");
    expect(s.next()).toEqual({ fullFrame: 0, border: true, burst: null });
    expect(s.next().border).toBe(false);
  });

  it("disables every inversion with no-flashes", () => {
    const s = new ImpactScheduler({ reducedMotion: false, noFlashes: true });
    expect(s.requestFrame(0)).toBe("none");
    expect(s.requestBurst(10, 10)).toBe(false);
    expect(s.next()).toEqual({ fullFrame: 0, border: false, burst: null });
  });

  it("grows a local burst over its frames then clears it", () => {
    const s = new ImpactScheduler();
    s.requestBurst(100, 50, 30, 12);
    const outers: number[] = [];
    for (let i = 0; i < BURST_FRAMES; i++) outers.push(s.next().burst?.outer ?? 0);
    expect(outers[outers.length - 1]).toBe(30);
    expect([...outers].sort((a, b) => a - b)).toEqual(outers);
    expect(s.next().burst).toBeNull();
  });
});
