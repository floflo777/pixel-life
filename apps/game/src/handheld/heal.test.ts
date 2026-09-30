import { ECON, getBit, popcount, regrowthOrder } from "@pl/shared";
import { describe, expect, it } from "vitest";
import { devFriend } from "./dev/fixture.js";
import { clockDuration, homeScars, shortDuration } from "./heal.js";

const T0 = 1_800_000_000_000;
const PER_PX = ECON.regrowthMsPerPx;

describe("homeScars", () => {
  it("heals scars over time at the free-regrowth rate, in the token's regrowth order", () => {
    const f = devFriend(T0);
    const start = homeScars(f, T0);
    expect(start.lostCount).toBe(5);
    expect(start.growth).toBe(0);
    const first = regrowthOrder("344030").find((id) => getBit(start.lost, id));
    expect(start.sprout).toBe(first);
    expect(start.nextInMs).toBe(PER_PX);
    expect(start.wholeInMs).toBe(5 * PER_PX);

    const half = homeScars(f, T0 + PER_PX / 2);
    expect(half.lostCount).toBe(5);
    expect(half.growth).toBeCloseTo(0.5, 5);

    const later = homeScars(f, T0 + PER_PX + 1);
    expect(later.lostCount).toBe(4);
    expect(getBit(later.lost, start.sprout)).toBe(false);
    expect(later.sprout).not.toBe(start.sprout);

    const whole = homeScars(f, T0 + 5 * PER_PX);
    expect(whole.lostCount).toBe(0);
    expect(whole.sprout).toBe(-1);
    expect(whole.nextInMs).toBeNull();
    expect(whole.wholeInMs).toBeNull();
  });

  it("never reports a scar outside the front mask", () => {
    const f = devFriend(T0);
    const h = homeScars(f, T0);
    for (let i = 0; i < 256; i++) if (getBit(h.lost, i)) expect(getBit(h.front, i)).toBe(true);
    expect(popcount(h.lost)).toBe(h.lostCount);
  });

  it("heals faster with Gold Pixels held", () => {
    const f = devFriend(T0);
    const gold = { ...f, pub: { ...f.pub, goldHeld: 2 } };
    expect(homeScars(gold, T0).wholeInMs).toBeLessThan(homeScars(f, T0).wholeInMs ?? 0);
  });
});

describe("durations", () => {
  it("formats short LCD durations, rounding up", () => {
    expect(shortDuration(0)).toBe("<1M");
    expect(shortDuration(1)).toBe("1M");
    expect(shortDuration(59 * 60_000)).toBe("59M");
    expect(shortDuration(61 * 60_000)).toBe("2H");
    expect(shortDuration(8 * 3_600_000)).toBe("8H");
  });

  it("formats H:MM countdowns", () => {
    expect(clockDuration(0)).toBe("0:00");
    expect(clockDuration(724 * 60_000)).toBe("12:04");
    expect(clockDuration(30_000)).toBe("0:01");
  });
});
