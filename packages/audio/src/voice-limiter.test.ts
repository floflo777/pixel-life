import { describe, expect, it } from "vitest";
import { VoiceLimiter } from "./voice-limiter";

describe("VoiceLimiter", () => {
  it("uses free slots, then reclaims ended voices", () => {
    const v = new VoiceLimiter(2, 4);
    expect(v.acquire(0, 5, 0, 1, 4, 0)).toBe(0);
    expect(v.acquire(1, 5, 0, 1, 4, 0)).toBe(1);
    expect(v.activeCount(0.5)).toBe(2);
    expect(v.acquire(2, 5, 1.5, 2, 4, 0)).toBe(0);
    expect(v.stolen).toBe(false);
  });

  it("rejects restarts inside minInterval", () => {
    const v = new VoiceLimiter(4, 2);
    expect(v.acquire(0, 5, 0, 1, 4, 0.05)).toBeGreaterThanOrEqual(0);
    expect(v.acquire(0, 5, 0.02, 1, 4, 0.05)).toBe(-1);
    expect(v.acquire(0, 5, 0.06, 1, 4, 0.05)).toBeGreaterThanOrEqual(0);
  });

  it("steals its own oldest voice at maxPerCue", () => {
    const v = new VoiceLimiter(8, 2);
    const a = v.acquire(0, 5, 0, 10, 2, 0);
    v.acquire(0, 5, 1, 10, 2, 0);
    const c = v.acquire(0, 5, 2, 10, 2, 0);
    expect(c).toBe(a);
    expect(v.stolen).toBe(true);
    expect(v.activeCount(3)).toBe(2);
  });

  it("steals the lowest-priority oldest voice when full, never a higher priority", () => {
    const v = new VoiceLimiter(3, 4);
    v.acquire(0, 9, 0, 10, 4, 0); // slot 0, high
    v.acquire(1, 2, 1, 10, 4, 0); // slot 1, low, older
    v.acquire(2, 2, 2, 10, 4, 0); // slot 2, low, newer
    expect(v.acquire(3, 5, 3, 10, 4, 0)).toBe(1);
    expect(v.stolen).toBe(true);
    // A low-priority cue cannot evict the high-priority voice or the priority-5 one.
    expect(v.acquire(1, 1, 4, 10, 4, 0)).toBe(-1);
  });

  it("honours a reduced limit without reallocating", () => {
    const v = new VoiceLimiter(4, 4);
    v.setLimit(1);
    expect(v.acquire(0, 5, 0, 10, 4, 0)).toBe(0);
    expect(v.acquire(1, 1, 0, 10, 4, 0)).toBe(-1);
    v.setLimit(99);
    expect(v.limit).toBe(4);
    expect(v.acquire(1, 1, 0, 10, 4, 0)).toBe(1);
  });

  it("reset frees everything", () => {
    const v = new VoiceLimiter(2, 1);
    v.acquire(0, 5, 0, 10, 2, 1);
    v.reset();
    expect(v.activeCount(0)).toBe(0);
    expect(v.acquire(0, 5, 0, 10, 2, 1)).toBe(0);
  });
});
