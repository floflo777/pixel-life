import fc from "fast-check";
import { decodeGenerationSprites, spriteFrame } from "@rarefriends/friendsdk/sprites";
import { describe, expect, it } from "vitest";
import { FRIEND_FIXTURES, fixtureAppearance } from "./__fixtures__/friends.js";
import { and, andNot, EMPTY_MASK, fromIndices, fromSdkBitmap, isSubset, or, popcount, toSdkBitmap } from "./bitmap.js";
import { ECON, regrowthMsPerPx } from "./economy.js";
import {
  applyLoss,
  applyRestore,
  effectiveLost,
  frameIndex,
  frontMask,
  maxPersistedLost,
  nextRegrowthAt,
  pixelCount,
  presentMask,
  regrowthOrder,
  runScarCap,
  type ScarState,
  scarsHash,
  scarsWithinFront,
  settleScars,
  wholeAt,
  wholeScars,
} from "./friend.js";
import { UINT256_MAX } from "./ids.js";

const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;
const MS = ECON.regrowthMsPerPx;
const mask = fc.bigInt({ min: 0n, max: UINT256_MAX }).map(fromSdkBitmap);
const tokenId = fc.bigInt({ min: 1n, max: 10n ** 12n }).map(String);
const mask344030 = FRIEND_FIXTURES[0] ? frontMask(fixtureAppearance(FRIEND_FIXTURES[0])) : EMPTY_MASK;

describe("front mask", () => {
  it("equals the frame SDK spriteFrame(idle, down, 0) shows, for every fixture (incl. the Colossus fallback)", () => {
    for (const f of FRIEND_FIXTURES) {
      const a = fixtureAppearance(f);
      const sprites = decodeGenerationSprites(BigInt(a.tokenId), a.familyId, 0, a.frames.map(toSdkBitmap));
      const { frame } = spriteFrame(sprites, "down", false, 0);
      expect(frontMask(a)).toBe(fromSdkBitmap(frame?.bitmap ?? -1n));
      expect(pixelCount(a)).toBeGreaterThanOrEqual(42);
      expect(pixelCount(a)).toBeLessThanOrEqual(96);
    }
  });

  it("uses idle-right for Colossus because its down frames are blank on-chain", () => {
    const colossus = FRIEND_FIXTURES.find((f) => f.family === "Colossus");
    expect(colossus).toBeDefined();
    if (!colossus) return;
    const a = fixtureAppearance(colossus);
    expect(a.frames[0]).toBe(EMPTY_MASK);
    expect(frontMask(a)).toBe(a.frames[24]);
    expect(pixelCount(a)).toBe(96);
  });

  it("rejects a wrong frame count and indexes frames in SDK order", () => {
    const a = fixtureAppearance(FRIEND_FIXTURES[0] ?? { tokenId: "1", family: "Mask", frames: [] });
    expect(() => frontMask({ ...a, frames: a.frames.slice(1) })).toThrow(RangeError);
    expect(() => frontMask({ ...a, frames: ["bad", ...a.frames.slice(1)] })).toThrow(RangeError);
    expect(frameIndex(false, "down", 0)).toBe(0);
    expect(frameIndex(false, "up", 7)).toBe(15);
    expect(frameIndex(false, "right", 0)).toBe(24);
    expect(frameIndex(true, "left", 1)).toBe(49);
    expect(() => frameIndex(true, "left", 8)).toThrow(RangeError);
  });

  it("presentMask removes lost pixels", () => {
    const lost = fromIndices([0, 1, 2]);
    expect(presentMask(mask344030, lost)).toBe(andNot(mask344030, lost));
  });
});

describe("caps", () => {
  it("floor keeps at least half of the sprite", () => {
    expect(maxPersistedLost(82)).toBe(41);
    expect(maxPersistedLost(43)).toBe(21);
    expect(maxPersistedLost(0)).toBe(0);
    expect(() => maxPersistedLost(257)).toThrow(RangeError);
  });

  it("run scar cap is max(6, round(15%)) clamped to 12", () => {
    expect(runScarCap(82)).toBe(12);
    expect(runScarCap(42)).toBe(6);
    expect(runScarCap(56)).toBe(8);
    expect(runScarCap(70)).toBe(11);
    expect(runScarCap(92)).toBe(12);
    expect(() => runScarCap(-1)).toThrow(RangeError);
  });
});

describe("regrowth order", () => {
  it("is a fixed permutation of 0..255 per token (golden values pin persisted semantics)", () => {
    const o = regrowthOrder("344030");
    expect([...o].sort((x, y) => x - y)).toEqual(Array.from({ length: 256 }, (_, i) => i));
    expect(o.slice(0, 8)).toEqual([155, 100, 78, 203, 231, 233, 19, 111]);
    expect(regrowthOrder("1").slice(0, 8)).toEqual([10, 141, 80, 37, 47, 85, 213, 167]);
    expect(regrowthOrder("344030")).toBe(o);
  });

  it("stays correct when the cache evicts", () => {
    const first = [...regrowthOrder("7")];
    for (let i = 0; i < 600; i++) regrowthOrder(String(1000 + i));
    expect(regrowthOrder("7")).toEqual(first);
  });
});

describe("effectiveLost", () => {
  const lost = and(mask344030, fromIndices(regrowthOrder("344030").slice(0, 120)));
  const s: ScarState = { lost, updatedAt: T0, version: 3 };

  it("heals one pixel per 2 h, first in regrowth order", () => {
    expect(effectiveLost(s, T0, "344030")).toBe(lost);
    expect(effectiveLost(s, T0 + MS - 1, "344030")).toBe(lost);
    const one = effectiveLost(s, T0 + MS, "344030");
    expect(popcount(one)).toBe(popcount(lost) - 1);
    const firstLost = regrowthOrder("344030").find((i) => isSubset(fromIndices([i]), lost));
    expect(andNot(lost, one)).toBe(fromIndices([firstLost ?? -1]));
    expect(effectiveLost(s, T0 - HOUR, "344030")).toBe(lost);
    expect(effectiveLost(s, T0 + 10_000 * HOUR, "344030")).toBe(EMPTY_MASK);
  });

  it("applies the Gold perk: x1.25 per Gold, at most 2", () => {
    expect(regrowthMsPerPx(0)).toBe(7_200_000);
    expect(regrowthMsPerPx(1)).toBe(5_760_000);
    expect(regrowthMsPerPx(2)).toBe(4_800_000);
    expect(regrowthMsPerPx(9)).toBe(4_800_000);
    const n = popcount(lost);
    expect(popcount(effectiveLost(s, T0 + 12 * HOUR, "344030", { goldHeld: 0 }))).toBe(n - 6);
    expect(popcount(effectiveLost(s, T0 + 12 * HOUR, "344030", { goldHeld: 1 }))).toBe(n - 7);
    expect(popcount(effectiveLost(s, T0 + 12 * HOUR, "344030", { goldHeld: 2 }))).toBe(n - 9);
  });

  it("skips locked pixels", () => {
    const small: ScarState = { lost: fromIndices([1, 2]), updatedAt: T0, version: 0 };
    expect(effectiveLost(small, T0 + 100 * HOUR, "9", { locked: fromIndices([2]) })).toBe(fromIndices([2]));
  });

  it("validates timestamps", () => {
    expect(() => effectiveLost(s, Number.NaN, "1")).toThrow(RangeError);
    expect(() => effectiveLost({ ...s, updatedAt: -1 }, T0, "1")).toThrow(RangeError);
  });

  it("properties: subset, monotone, exact count, composable with settleScars", () => {
    fc.assert(
      fc.property(
        mask,
        tokenId,
        fc.integer({ min: 0, max: 600 * HOUR }),
        fc.integer({ min: 0, max: 600 * HOUR }),
        fc.integer({ min: 0, max: 3 }),
        (m, id, d1, d2, gold) => {
          const st: ScarState = { lost: m, updatedAt: T0, version: 0 };
          const opts = { goldHeld: gold };
          const e1 = effectiveLost(st, T0 + d1, id, opts);
          const e2 = effectiveLost(st, T0 + d1 + d2, id, opts);
          expect(isSubset(e1, m)).toBe(true);
          expect(isSubset(e2, e1)).toBe(true);
          const due = Math.floor(d1 / regrowthMsPerPx(gold));
          expect(popcount(e1)).toBe(Math.max(0, popcount(m) - due));
          const mid = settleScars(st, T0 + d1, id, opts);
          expect(mid.lost).toBe(e1);
          expect(mid.version).toBe(0);
          expect(effectiveLost(mid, T0 + d1 + d2, id, opts)).toBe(e2);
        },
      ),
    );
  });
});

describe("applyLoss / applyRestore", () => {
  it("keeps partial regrowth progress across writes", () => {
    const s: ScarState = { lost: fromIndices([10, 11]), updatedAt: T0, version: 0 };
    const after = applyLoss(s, fromIndices([12]), T0 + 1.5 * HOUR, "5");
    expect(after.version).toBe(1);
    expect(after.updatedAt).toBe(T0);
    expect(popcount(effectiveLost(after, T0 + 2 * HOUR, "5"))).toBe(2);
  });

  it("never banks regrowth while whole", () => {
    const s = wholeScars(T0);
    expect(s).toEqual({ lost: EMPTY_MASK, updatedAt: T0, version: 0 });
    const hit = applyLoss(s, fromIndices([40]), T0 + 10 * HOUR, "5");
    expect(hit.updatedAt).toBe(T0 + 10 * HOUR);
    expect(effectiveLost(hit, T0 + 11 * HOUR, "5")).toBe(fromIndices([40]));
    expect(effectiveLost(hit, T0 + 12 * HOUR, "5")).toBe(EMPTY_MASK);
  });

  it("clips to the front mask and to the 50 % floor, dropping extra pixels in regrowth order", () => {
    const front = mask344030;
    const n0 = popcount(front);
    const everything = applyLoss(wholeScars(T0), fromIndices(Array.from({ length: 256 }, (_, i) => i)), T0, "344030", {
      front,
    });
    expect(isSubset(everything.lost, front)).toBe(true);
    expect(popcount(everything.lost)).toBe(maxPersistedLost(n0));
    expect(scarsWithinFront(everything, front)).toBe(true);
    const again = applyLoss(everything, front, T0, "344030", { front });
    expect(again.lost).toBe(everything.lost);
  });

  it("restores only lost pixels and restarts the clock once whole", () => {
    const s: ScarState = { lost: fromIndices([1, 2, 3]), updatedAt: T0, version: 4 };
    const r = applyRestore(s, fromIndices([2, 200]), T0 + HOUR, "5");
    expect(r).toEqual({ lost: fromIndices([1, 3]), updatedAt: T0, version: 5 });
    const whole = applyRestore(r, fromIndices([1, 3]), T0 + HOUR, "5");
    expect(whole).toEqual({ lost: EMPTY_MASK, updatedAt: T0 + HOUR, version: 6 });
  });

  it("properties: invariants hold for any sequence of writes", () => {
    const front = mask344030;
    const op = fc.record({ loss: fc.boolean(), m: mask, dt: fc.integer({ min: 0, max: 10 * HOUR }) });
    fc.assert(
      fc.property(fc.array(op, { maxLength: 12 }), (ops) => {
        let s = wholeScars(T0);
        let now = T0;
        for (const o of ops) {
          now += o.dt;
          const before = effectiveLost(s, now, "344030");
          const next = o.loss ? applyLoss(s, o.m, now, "344030", { front }) : applyRestore(s, o.m, now, "344030");
          expect(next.version).toBe(s.version + 1);
          expect(next.updatedAt).toBeLessThanOrEqual(now);
          expect(next.updatedAt).toBeGreaterThanOrEqual(s.updatedAt);
          expect(isSubset(next.lost, front)).toBe(true);
          expect(popcount(next.lost)).toBeLessThanOrEqual(maxPersistedLost(popcount(front)));
          if (o.loss) expect(isSubset(before, next.lost)).toBe(true);
          else expect(next.lost).toBe(andNot(before, o.m));
          expect(isSubset(next.lost, or(before, o.loss ? o.m : EMPTY_MASK))).toBe(true);
          s = next;
        }
      }),
    );
  });
});

describe("timers and hash", () => {
  it("reports the next pixel and the whole time", () => {
    const s: ScarState = { lost: fromIndices([1, 2, 3]), updatedAt: T0, version: 0 };
    expect(nextRegrowthAt(s, T0 + HOUR, "5")).toBe(T0 + MS);
    expect(wholeAt(s, T0 + HOUR, "5")).toBe(T0 + 3 * MS);
    expect(nextRegrowthAt(s, T0 + MS, "5")).toBe(T0 + 2 * MS);
    expect(wholeAt(s, T0 + HOUR, "5", { goldHeld: 2 })).toBe(T0 + 3 * regrowthMsPerPx(2));
    expect(nextRegrowthAt(wholeScars(T0), T0, "5")).toBeNull();
    expect(wholeAt(s, T0 + 10 * MS, "5")).toBeNull();
    expect(nextRegrowthAt(s, T0, "5", { locked: s.lost })).toBeNull();
  });

  it("scarsHash is 8 hex chars and changes with the mask or version", () => {
    const s: ScarState = { lost: fromIndices([1]), updatedAt: T0, version: 0 };
    expect(scarsHash(s)).toMatch(/^[0-9a-f]{8}$/);
    expect(scarsHash(s)).toBe(scarsHash({ ...s, updatedAt: T0 + 1 }));
    expect(scarsHash(s)).not.toBe(scarsHash({ ...s, version: 1 }));
    expect(scarsHash(s)).not.toBe(scarsHash({ ...s, lost: fromIndices([2]) }));
  });
});
