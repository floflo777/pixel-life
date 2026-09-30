import { describe, expect, it } from "vitest";
import { fitIsland } from "./island-fit";

describe("fitIsland", () => {
  it("is deterministic and matches the sim ellipse closely", () => {
    const f = fitIsland(36, 24, 0.15, 0.24, 21);
    expect(fitIsland(36, 24, 0.15, 0.24, 21)).toEqual(f);
    expect(f.squash).toBeCloseTo(1.5);
    expect(f.iou).toBeGreaterThan(0.85);
  });

  it("never does worse than the first seed alone", () => {
    const one = fitIsland(36, 24, 0.15, 0.24, 5, 1);
    const many = fitIsland(36, 24, 0.15, 0.24, 5, 12);
    expect(many.iou).toBeGreaterThanOrEqual(one.iou);
  });
});
