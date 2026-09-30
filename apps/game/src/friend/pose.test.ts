import { describe, expect, it } from "vitest";
import { COLOSSUS_FAMILY_ID, EMPTY_MASK, FACINGS, frameIndex, type FriendAppearance } from "@pl/shared";
import { FIXTURE_FRIENDS } from "./dev/fixtures.js";
import { facingFromDelta, PoseClock, resolvePose } from "./pose.js";

const mask = FIXTURE_FRIENDS.find((f) => f.tokenId === "344030") as FriendAppearance;
const colossus = FIXTURE_FRIENDS.find((f) => f.familyId === COLOSSUS_FAMILY_ID) as FriendAppearance;

describe("resolvePose", () => {
  it("maps every pose to the SDK frame index (idle[d,u,l,r]×8 then walk)", () => {
    for (const walking of [false, true])
      for (const facing of FACINGS)
        for (let f = 0; f < 8; f++) {
          const p = resolvePose(mask, facing, walking, f);
          expect(p.index).toBe(frameIndex(walking, facing, f));
          expect(p.index).toBe((walking ? 32 : 0) + FACINGS.indexOf(facing) * 8 + f);
          expect(p.usedFallback).toBe(false);
        }
  });

  it("wraps frame numbers into 0..7", () => {
    expect(resolvePose(mask, "left", true, 9).index).toBe(frameIndex(true, "left", 1));
    expect(resolvePose(mask, "left", true, -1).index).toBe(frameIndex(true, "left", 7));
  });

  it("sends Colossus up/down to the last side facing, like SDK spriteFrame", () => {
    expect(colossus).toBeDefined();
    expect(resolvePose(colossus, "down", false, 2)).toEqual({
      index: frameIndex(false, "right", 2),
      resolvedFacing: "right",
      usedFallback: true,
    });
    expect(resolvePose(colossus, "up", true, 5, "left").index).toBe(frameIndex(true, "left", 5));
    expect(resolvePose(colossus, "left", true, 5).usedFallback).toBe(false);
  });

  it("never picks a blank frame when a fallback exists", () => {
    const frames = [...mask.frames];
    frames[frameIndex(true, "up", 4)] = EMPTY_MASK;
    frames[frameIndex(true, "up", 0)] = EMPTY_MASK;
    const a = { ...mask, frames };
    expect(resolvePose(a, "up", true, 4).index).toBe(frameIndex(false, "up", 0));
  });
});

describe("PoseClock", () => {
  it("steps at 12 fps without easing and restarts clips on idle/walk switches", () => {
    const c = new PoseClock(12);
    expect(c.update(0, false)).toBe(0);
    expect(c.update(80, false)).toBe(0);
    expect(c.update(10, false)).toBe(1); // 90 ms ≥ 83.3 ms
    expect(c.update(1000, false)).toBe((1 + 12) % 8);
    expect(c.update(16, true)).toBe(0);
    expect(c.update(-5, true)).toBe(0);
    expect(c.update(Number.NaN, true)).toBe(0);
    expect(() => new PoseClock(0)).toThrow(RangeError);
  });
});

describe("facingFromDelta", () => {
  it("picks the dominant axis, ties horizontal, keeps facing when still", () => {
    expect(facingFromDelta(1, 0)).toBe("right");
    expect(facingFromDelta(-1, 0.5)).toBe("left");
    expect(facingFromDelta(0.2, 1)).toBe("down");
    expect(facingFromDelta(0.2, -1)).toBe("up");
    expect(facingFromDelta(1, 1)).toBe("right");
    expect(facingFromDelta(0, 0, "up")).toBe("up");
  });
});
