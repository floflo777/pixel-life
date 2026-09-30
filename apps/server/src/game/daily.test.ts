import { describe, expect, it } from "vitest";
import { addDays, currentStreak, dailySeed, nextMidnightUtc, nextStreak, streakAfterMiss, utcDay } from "./daily.js";

describe("daily helpers", () => {
  it("computes UTC days and the next midnight", () => {
    const at = new Date("2026-10-01T23:59:59.999Z");
    expect(utcDay(at)).toBe("2026-10-01");
    expect(nextMidnightUtc(at)).toBe(Date.parse("2026-10-02T00:00:00Z"));
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("derives a stable uint32 seed per day and secret", () => {
    const s = dailySeed("2026-10-01", "k".repeat(32));
    expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
    expect(dailySeed("2026-10-01", "k".repeat(32))).toBe(s);
  });

  it("drops one halo tier per missed day instead of resetting (GDD §5.6)", () => {
    expect(streakAfterMiss(35)).toBe(14);
    expect(streakAfterMiss(14)).toBe(7);
    expect(streakAfterMiss(10)).toBe(3);
    expect(streakAfterMiss(4)).toBe(0);
    expect(nextStreak(0, null, "2026-10-01")).toBe(1);
    expect(nextStreak(5, "2026-10-01", "2026-10-01")).toBe(5);
    expect(nextStreak(5, "2026-10-01", "2026-10-02")).toBe(6);
    expect(nextStreak(10, "2026-10-01", "2026-10-03")).toBe(4); // one missed day: 7–13 → 3, then +1
    expect(nextStreak(35, "2026-10-01", "2026-10-04")).toBe(8); // two missed: 30+ → 14 → 7, then +1
    expect(currentStreak(10, "2026-10-01", "2026-10-02")).toBe(10);
    expect(currentStreak(10, "2026-10-01", "2026-10-03")).toBe(3);
    expect(currentStreak(0, null, "2026-10-03")).toBe(0);
  });
});
