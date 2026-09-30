import { describe, expect, it } from "vitest";
import { cross, dist, dist2, dot, len, normalizeInto } from "./vec.js";

describe("vec", () => {
  it("computes lengths, dots and crosses", () => {
    expect(len(3, 4)).toBe(5);
    expect(dist(1, 1, 4, 5)).toBe(5);
    expect(dist2(0, 0, 2, 2)).toBe(8);
    expect(dot(1, 2, 3, 4)).toBe(11);
    expect(cross(1, 0, 0, 1)).toBe(1);
  });

  it("normalizes in place and keeps zero vectors at zero", () => {
    const v = { x: 9, z: 9 };
    expect(normalizeInto(v, 0, -2)).toBe(2);
    expect(v).toEqual({ x: 0, z: -1 });
    expect(normalizeInto(v, 0, 0)).toBe(0);
    expect(v).toEqual({ x: 0, z: 0 });
  });
});
