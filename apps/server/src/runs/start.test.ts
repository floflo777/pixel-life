import { EMPTY_MASK, fromIndices, regrowthMsPerPx } from "@pl/shared";
import { describe, expect, it } from "vitest";
import { START_MAX_AGE_MS, plausibleStartLost, type StartCheck } from "./start.js";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const front = fromIndices([0, 1, 2, 3, 4, 5, 6, 7]);

const check = (over: Partial<StartCheck> = {}): StartCheck => ({
  startLost: fromIndices([1, 2, 3]),
  startedAt: NOW - 60_000,
  now: NOW,
  front,
  lostNow: fromIndices([1, 2]),
  locked: EMPTY_MASK,
  goldHeld: 0,
  paidRestoredPx: 0,
  ...over,
});

describe("plausibleStartLost", () => {
  it("accepts the scars the client started with when one pixel regrew mid-run", () => {
    expect(plausibleStartLost(check())).toBe(true);
    expect(plausibleStartLost(check({ startLost: fromIndices([1, 2]) }))).toBe(true);
  });

  it("refuses stale, future or out-of-front starts", () => {
    expect(plausibleStartLost(check({ startedAt: NOW - START_MAX_AGE_MS - 1 }))).toBe(false);
    expect(plausibleStartLost(check({ startedAt: NOW + 60_000 }))).toBe(false);
    expect(plausibleStartLost(check({ startedAt: 0.5 }))).toBe(false);
    expect(plausibleStartLost(check({ startLost: fromIndices([1, 2, 200]) }))).toBe(false);
  });

  it("refuses a start that hides scars the Friend has now, unless a lock hides them from the client", () => {
    expect(plausibleStartLost(check({ startLost: fromIndices([1]) }))).toBe(false);
    expect(plausibleStartLost(check({ startLost: fromIndices([1]), locked: fromIndices([2]) }))).toBe(true);
  });

  it("bounds the pixels healed since start by free regrowth plus paid restores", () => {
    const many = fromIndices([1, 2, 3, 4, 5, 6]);
    expect(plausibleStartLost(check({ startLost: many }))).toBe(false);
    expect(plausibleStartLost(check({ startLost: many, paidRestoredPx: 3 }))).toBe(true);
    // A run lasts minutes and a pixel regrows in hours: free regrowth explains at most one healed pixel.
    expect(regrowthMsPerPx(0)).toBeGreaterThan(START_MAX_AGE_MS);
    expect(plausibleStartLost(check({ startLost: fromIndices([1, 2, 3, 4]) }))).toBe(false);
  });
});
