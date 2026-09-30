import { describe, expect, it } from "vitest";
import { QUALITY, cappedDpr, initialTier, internalSize, percentile, selectTier } from "./quality";

const frames = (ms: number, n = 120): number[] => Array.from({ length: n }, () => ms);

describe("percentile", () => {
  it("uses nearest rank", () => {
    const s = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(s, 0.95)).toBe(95);
    expect(percentile(s, 0.5)).toBe(50);
    expect(percentile([7], 0.95)).toBe(7);
  });
  it("is NaN when empty", () => {
    expect(percentile([], 0.95)).toBeNaN();
  });
  it("does not mutate its input", () => {
    const s = [3, 1, 2];
    percentile(s, 0.5);
    expect(s).toEqual([3, 1, 2]);
  });
});

describe("selectTier", () => {
  it("keeps the tier at a steady 60 fps", () => {
    expect(selectTier(frames(16.7), "high")).toEqual({ tier: "high", p95: 16.7, fallback: false });
  });
  it("ignores a few spikes below the 95th percentile", () => {
    const s = frames(16.7);
    for (let i = 0; i < 5; i++) s[i] = 60;
    expect(selectTier(s, "high").tier).toBe("high");
  });
  it("steps down one tier when p95 misses the window", () => {
    expect(selectTier(frames(22), "high").tier).toBe("medium");
    expect(selectTier(frames(22), "medium").tier).toBe("low");
    expect(selectTier(frames(22), "low").tier).toBe("low");
  });
  it("jumps to low when far off", () => {
    expect(selectTier(frames(30), "high").tier).toBe("low");
  });
  it("never upgrades beyond the current tier", () => {
    expect(selectTier(frames(8), "low").tier).toBe("low");
  });
  it("flags the 1-bit fallback below 30 fps", () => {
    expect(selectTier(frames(40), "high")).toMatchObject({ tier: "low", fallback: true });
    expect(selectTier(frames(30), "high").fallback).toBe(false);
  });
  it("keeps the tier with no samples", () => {
    expect(selectTier([], "medium").tier).toBe("medium");
  });
});

describe("initialTier", () => {
  it("starts desktops high, phones medium, weak devices low", () => {
    expect(initialTier({ cores: 8, deviceMemoryGb: 8 })).toBe("high");
    expect(initialTier({ cores: 8, coarsePointer: true })).toBe("medium");
    expect(initialTier({ cores: 2 })).toBe("low");
    expect(initialTier({ deviceMemoryGb: 2 })).toBe("low");
    expect(initialTier({ maxTextureSize: 2048 })).toBe("low");
    expect(initialTier({})).toBe("high");
  });
});

describe("internalSize", () => {
  it("halves 1280x720 at pixel-scale 2 (art bible §3)", () => {
    expect(internalSize(1280, 720, QUALITY.high)).toEqual({ width: 640, height: 360, scale: 2 });
  });
  it("uses pixel-scale 3 on the low tier", () => {
    expect(internalSize(1440, 810, QUALITY.low)).toEqual({ width: 480, height: 270, scale: 3 });
  });
  it("caps the internal height on big screens", () => {
    const r = internalSize(3840, 2160, QUALITY.medium);
    expect(r.height).toBe(360);
    expect(r.width).toBe(640);
  });
  it("never returns a zero size", () => {
    expect(internalSize(0, 0, QUALITY.high)).toMatchObject({ width: 1, height: 1 });
  });
});

describe("cappedDpr", () => {
  it("caps per tier and floors at 1", () => {
    expect(cappedDpr(3, QUALITY.high)).toBe(2);
    expect(cappedDpr(3, QUALITY.low)).toBe(1.25);
    expect(cappedDpr(0.5, QUALITY.high)).toBe(1);
    expect(cappedDpr(0, QUALITY.high)).toBe(1);
  });
});
