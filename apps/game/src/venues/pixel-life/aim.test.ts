import { describe, expect, it } from "vitest";
import { launchSpeed, previewDistances, previewPoints } from "./aim";

describe("aim preview", () => {
  it("matches the GDD launch speeds", () => {
    expect(launchSpeed(1, 70)).toBeCloseTo(70);
    expect(launchSpeed(1, 96)).toBeCloseTo(70 * Math.sqrt(70 / 96));
    expect(launchSpeed(1, 42)).toBeCloseTo(70 * Math.sqrt(70 / 42));
    expect(launchSpeed(1, 10)).toBeCloseTo(70 * 1.35);
    expect(launchSpeed(0, 70)).toBe(0);
  });
  it("samples 8 increasing distances over 0.5 s", () => {
    const d = previewDistances(1, 70);
    expect(d).toHaveLength(8);
    for (let i = 1; i < d.length; i++) expect(d[i] ?? 0).toBeGreaterThan(d[i - 1] ?? 0);
    // A full fling travels ≈ 34 u in total; most of it in the first half second.
    expect(d[7] ?? 0).toBeGreaterThan(15);
    expect(d[7] ?? 0).toBeLessThan(34);
  });
  it("bounces the dots off the rim once", () => {
    const pts = previewPoints(30, 0, 1, 0, [2, 4, 6, 8, 10, 12, 14, 16], 36, 24);
    expect(Math.max(...pts.map((p) => p.x))).toBeLessThan(40);
    expect(pts.at(-1)?.x ?? 99).toBeLessThan(36);
  });
});
