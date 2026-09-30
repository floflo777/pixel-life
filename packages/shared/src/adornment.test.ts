import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { goldSlots, isValidGoldLayout, MAX_VISIBLE_GOLD, STITCH_VISIBLE_MS, visibleStitches } from "./adornment.js";
import { EMPTY_MASK, fromIndices, popcount } from "./bitmap.js";

const front = fromIndices([17, 18, 33, 34, 49, 50, 65, 66]);

describe("goldSlots", () => {
  it("is empty without gold", () => {
    expect(goldSlots(front, EMPTY_MASK, "1", 0)).toBe(EMPTY_MASK);
  });
  it("caps at MAX_VISIBLE_GOLD and is deterministic", () => {
    const a = goldSlots(front, EMPTY_MASK, "344030", 5);
    expect(popcount(a)).toBe(MAX_VISIBLE_GOLD);
    expect(goldSlots(front, EMPTY_MASK, "344030", 5)).toBe(a);
  });
  it("never sits on a scar or outside the front mask", () => {
    fc.assert(
      fc.property(
        fc.subarray([17, 18, 33, 34, 49, 50, 65, 66]),
        fc.integer({ min: 0, max: 5 }),
        fc.nat(),
        (lostIdx, gold, id) => {
          const lost = fromIndices(lostIdx);
          const slots = goldSlots(front, lost, String(id), gold);
          expect(isValidGoldLayout(slots, front, lost)).toBe(true);
        },
      ),
    );
  });
});

describe("visibleStitches", () => {
  const now = 10 * STITCH_VISIBLE_MS;
  it("keeps recent stitches on present pixels only", () => {
    const records = [
      { pixels: fromIndices([17, 18]), at: now - 1000 },
      { pixels: fromIndices([33]), at: now - STITCH_VISIBLE_MS },
      { pixels: fromIndices([49]), at: now + 1 },
    ];
    expect(visibleStitches(records, front, fromIndices([18]), now)).toBe(fromIndices([17]));
  });
});
