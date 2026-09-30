import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EMPTY_MASK, fromIndices, fromSdkBitmap, FULL_MASK, popcount } from "./bitmap.js";
import * as generated from "./economy.generated.js";
import {
  actionPixelCount,
  BITS,
  BPS,
  capBits,
  ECON,
  type EconomyAction,
  EconomyError,
  formatMicroRf,
  microToWei,
  payerOf,
  plantPixels,
  quote,
  regrowthMsPerPx,
  RF_DECOR_TIERS_MICRO,
  runBits,
  subjectOf,
  weiToMicro,
  WEI_PER_MICRO,
} from "./economy.js";
import { UINT256_MAX } from "./ids.js";

const nonEmptyMask = fc.bigInt({ min: 1n, max: UINT256_MAX }).map(fromSdkBitmap);
const tokenId = fc.bigInt({ min: 1n, max: 10n ** 20n }).map(String);
const action: fc.Arbitrary<EconomyAction> = fc.oneof(
  fc.record({ kind: fc.constant("regrow" as const), tokenId, pixels: nonEmptyMask }),
  fc
    .record({ kind: fc.constant("mend" as const), payer: tokenId, target: tokenId, pixels: nonEmptyMask })
    .filter((a) => a.payer !== a.target),
);

function expectCode(fn: () => unknown, code: EconomyError["code"]): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EconomyError);
    expect((e as EconomyError).code).toBe(code);
    return;
  }
  throw new Error(`expected EconomyError(${code})`);
}

describe("ECON", () => {
  it("matches the final prices in tokenomics.md", () => {
    expect(ECON.regrowMicroPerPx).toBe(500_000);
    expect(ECON.mendMicroPerPx).toBe(1_000_000);
    expect(ECON.burnBps).toBe(5000);
    expect(ECON.streamBps).toBe(5000);
    expect(ECON.targetBps).toBe(5000);
    expect(ECON.regrowthMsPerPx).toBe(2 * 3_600_000);
    expect(ECON.maxPxPerAction).toBe(256);
    expect(ECON.seedPackPriceMicro).toBe(5_000_000);
    expect(ECON.mendMicroPerPx).toBeGreaterThanOrEqual(2 * ECON.regrowMicroPerPx);
    expect(ECON.simStartMicro).toBe(generated.SIM_START_MICRO);
    expect(Object.isFrozen(ECON)).toBe(true);
  });
});

describe("quote", () => {
  it("prices the documented examples", () => {
    const three = fromIndices([1, 2, 3]);
    const r = quote({ kind: "regrow", tokenId: "344030", pixels: three });
    expect(r).toMatchObject({
      totalMicro: 1_500_000,
      burnMicro: 750_000,
      streamMicro: 750_000,
      toTargetMicro: 0,
      mode: "sim",
    });
    // GDD §5.9 copy: mending 1 px pays the Friend 0.5 RF.
    const m = quote({ kind: "mend", payer: "1234", target: "344030", pixels: fromIndices([7]) }, "live");
    expect(m).toMatchObject({
      totalMicro: 1_000_000,
      burnMicro: 500_000,
      streamMicro: 0,
      toTargetMicro: 500_000,
      mode: "live",
    });
    expect(quote({ kind: "regrow", tokenId: "1", pixels: FULL_MASK }).totalMicro).toBe(128_000_000);
  });

  it("rejects unquotable actions with stable codes", () => {
    expectCode(() => quote({ kind: "regrow", tokenId: "1", pixels: EMPTY_MASK }), "no_pixels");
    expectCode(() => quote({ kind: "regrow", tokenId: "1", pixels: "zz" }), "bad_mask");
    expectCode(() => quote({ kind: "regrow", tokenId: "01", pixels: FULL_MASK }), "bad_token");
    expectCode(() => quote({ kind: "mend", payer: "x", target: "2", pixels: FULL_MASK }), "bad_token");
    expectCode(() => quote({ kind: "mend", payer: "2", target: "2", pixels: FULL_MASK }), "self_mend");
  });

  it("property: splits are exact, non-negative integers, <= 256 px", () => {
    fc.assert(
      fc.property(action, fc.constantFrom("sim" as const, "live" as const), (a, mode) => {
        const q = quote(a, mode);
        const px = popcount(a.pixels);
        expect(actionPixelCount(a)).toBe(px);
        expect(px).toBeGreaterThanOrEqual(1);
        expect(px).toBeLessThanOrEqual(ECON.maxPxPerAction);
        expect(q.burnMicro + q.streamMicro + q.toTargetMicro).toBe(q.totalMicro);
        for (const v of [q.totalMicro, q.burnMicro, q.streamMicro, q.toTargetMicro]) {
          expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
        }
        expect(q.mode).toBe(mode);
        expect(q.action).toBe(a);
        if (a.kind === "regrow") {
          expect(q.totalMicro).toBe(px * ECON.regrowMicroPerPx);
          expect(q.toTargetMicro).toBe(0);
          expect(q.burnMicro).toBeGreaterThanOrEqual(q.streamMicro);
        } else {
          expect(q.totalMicro).toBe(px * ECON.mendMicroPerPx);
          expect(q.streamMicro).toBe(0);
          expect(q.toTargetMicro).toBeGreaterThanOrEqual(q.burnMicro);
        }
        // Self-mend via an alt is never cheaper than Regrow (tokenomics change 1).
        expect(px * ECON.mendMicroPerPx - Math.floor((px * ECON.mendMicroPerPx) / 2)).toBeGreaterThanOrEqual(
          px * ECON.regrowMicroPerPx - Math.floor((px * ECON.regrowMicroPerPx) / 2),
        );
      }),
    );
  });

  it("payerOf / subjectOf name the right Friends", () => {
    const r: EconomyAction = { kind: "regrow", tokenId: "5", pixels: FULL_MASK };
    const m: EconomyAction = { kind: "mend", payer: "6", target: "7", pixels: FULL_MASK };
    expect([payerOf(r), subjectOf(r), payerOf(m), subjectOf(m)]).toEqual(["5", "5", "6", "7"]);
  });
});

describe("helpers", () => {
  it("regrowthMsPerPx sanitises gold counts", () => {
    expect(regrowthMsPerPx(-3)).toBe(regrowthMsPerPx(0));
    expect(regrowthMsPerPx(1.9)).toBe(regrowthMsPerPx(1));
    expect(regrowthMsPerPx(Number.NaN)).toBe(regrowthMsPerPx(0));
    expect(regrowthMsPerPx(Number.POSITIVE_INFINITY)).toBe(regrowthMsPerPx(0));
  });

  it("plantPixels matches the Seed Pack table (Sprout 4, Bloom 12, Full Bloom 19)", () => {
    expect(plantPixels(2_000_000)).toBe(4);
    expect(plantPixels(5_000_000)).toBe(12);
    expect(plantPixels(8_000_000)).toBe(19);
    expect(plantPixels(0)).toBe(0);
    expect(plantPixels(10_000_000_000)).toBe(256);
    expect(() => plantPixels(-1)).toThrow(RangeError);
  });

  it("wei <-> micro conversions are exact", () => {
    expect(microToWei(500_000)).toBe("500000000000000000");
    expect(weiToMicro("5000000000000000000")).toBe(5_000_000);
    expect(weiToMicro(WEI_PER_MICRO)).toBe(1);
    expect(() => weiToMicro("1")).toThrow(RangeError);
    expect(() => weiToMicro("1.0")).toThrow(RangeError);
    expect(() => weiToMicro(-WEI_PER_MICRO)).toThrow(RangeError);
    expect(() => weiToMicro((BigInt(Number.MAX_SAFE_INTEGER) + 1n) * WEI_PER_MICRO)).toThrow(RangeError);
    expect(() => microToWei(1.5)).toThrow(RangeError);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (m) => {
        expect(weiToMicro(microToWei(m))).toBe(m);
      }),
    );
  });

  it("formatMicroRf rounds down to the requested decimals", () => {
    expect(formatMicroRf(1_500_000)).toBe("1.50");
    expect(formatMicroRf(750_000)).toBe("0.75");
    expect(formatMicroRf(1_999_999, 2)).toBe("1.99");
    expect(formatMicroRf(45_000_000, 0)).toBe("45");
    expect(formatMicroRf(-250_000, 3)).toBe("-0.250");
    expect(() => formatMicroRf(1, 7)).toThrow(RangeError);
    expect(() => formatMicroRf(0.5)).toThrow(RangeError);
  });
});

describe("Bits", () => {
  it("encodes tokenomics §7 as data", () => {
    expect(BITS.islandPlots).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(RF_DECOR_TIERS_MICRO).toEqual([2_000_000, 5_000_000, 10_000_000, 25_000_000]);
    expect(runBits(20, true)).toBe(80);
    expect(runBits(99, false)).toBe(30);
    expect(runBits(-5, false)).toBe(10);
    expect(runBits(Number.NaN, false)).toBe(10);
  });

  it("caps daily Bits: full rate to 250, 25 % to 500, 0 after", () => {
    expect(capBits(0, 80)).toBe(80);
    expect(capBits(240, 30)).toBe(10 + 5);
    expect(capBits(250, 40)).toBe(10);
    expect(capBits(498, 80)).toBe(2);
    expect(capBits(500, 80)).toBe(0);
    expect(capBits(0, 10_000)).toBe(500);
  });

  it("property: never negative, never above raw, never past the hard cap, monotone in raw", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 600 }), fc.integer({ min: 0, max: 500 }), (today, raw) => {
        const c = capBits(today, raw);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(raw);
        expect(Math.max(today, BITS.dailyHardCap) >= today + c || today >= BITS.dailyHardCap).toBe(true);
        if (today < BITS.dailyHardCap) expect(today + c).toBeLessThanOrEqual(BITS.dailyHardCap);
        else expect(c).toBe(0);
        expect(capBits(today, raw + 1)).toBeGreaterThanOrEqual(c);
      }),
    );
    expect(BPS).toBe(10_000);
  });
});
