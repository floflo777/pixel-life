import { EMPTY_MASK, fromIndices, regrowthMsPerPx, type ScarState } from "@pl/shared";
import { describe, expect, it } from "vitest";
import { nextWholeSince, wholeDays } from "./whole.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-09-01T00:00:00Z");
const token = "344030";

const state = (lost: string, updatedAt: number): ScarState => ({ lost, updatedAt, version: 3 });

describe("nextWholeSince", () => {
  it("is null while the Friend still has effective scars", () => {
    const lost = fromIndices([1]);
    expect(
      nextWholeSince({ stored: state(lost, T0), lostNow: lost, wholeSince: T0, now: T0 + DAY, tokenId: token, goldHeld: 0 }),
    ).toBeNull();
  });

  it("keeps a recorded start", () => {
    expect(
      nextWholeSince({
        stored: state(EMPTY_MASK, T0 + 5 * DAY),
        lostNow: EMPTY_MASK,
        wholeSince: T0,
        now: T0 + 9 * DAY,
        tokenId: token,
        goldHeld: 0,
      }),
    ).toBe(T0);
  });

  it("back-dates to the restoring write when the stored state is already whole", () => {
    expect(
      nextWholeSince({
        stored: state(EMPTY_MASK, T0),
        lostNow: EMPTY_MASK,
        wholeSince: null,
        now: T0 + 3 * DAY,
        tokenId: token,
        goldHeld: 0,
      }),
    ).toBe(T0);
  });

  it("back-dates to the moment the last stored scar regrew for free", () => {
    const lost = fromIndices([1, 2, 3]);
    const got = nextWholeSince({
      stored: state(lost, T0),
      lostNow: EMPTY_MASK,
      wholeSince: null,
      now: T0 + 30 * DAY,
      tokenId: token,
      goldHeld: 0,
    });
    expect(got).toBe(T0 + 3 * regrowthMsPerPx(0));
  });

  it("never returns a time after now", () => {
    expect(
      nextWholeSince({
        stored: state(EMPTY_MASK, T0 + DAY),
        lostNow: EMPTY_MASK,
        wholeSince: null,
        now: T0,
        tokenId: token,
        goldHeld: 0,
      }),
    ).toBe(T0);
  });
});

describe("wholeDays", () => {
  it("counts whole elapsed days", () => {
    expect(wholeDays(null, T0)).toBe(0);
    expect(wholeDays(T0, T0 + DAY - 1)).toBe(0);
    expect(wholeDays(T0, T0 + 7 * DAY)).toBe(7);
    expect(wholeDays(T0 + DAY, T0)).toBe(0);
  });
});
