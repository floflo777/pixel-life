import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BPS, MICRO_PER_RF, microToWei, WEI_PER_MICRO } from "./economy.js";
import { MARKET, marketPriceProblem, marketPriceWei, marketSchemas, marketSplit, marketSplitWei } from "./market.js";

const anyPrice = fc.integer({ min: 0, max: Math.floor(Number.MAX_SAFE_INTEGER / BPS) });
const tickPrice = fc
  .integer({ min: MARKET.minPriceMicro / MARKET.tickMicro, max: MARKET.maxPriceMicro / MARKET.tickMicro })
  .map((ticks) => ticks * MARKET.tickMicro);

describe("MARKET constants", () => {
  it("mirror GoldPixelMarket.sol (2 % burn, 2 % origin, 1 % creator) and the 45 RF backing", () => {
    expect([MARKET.burnBps, MARKET.originBps, MARKET.creatorBps, MARKET.feeBps]).toEqual([200, 200, 100, 500]);
    expect(MARKET.backingMicro).toBe(45 * MICRO_PER_RF);
    expect(MARKET.minPriceMicro).toBe(MARKET.backingMicro);
  });
});

describe("marketSplit", () => {
  it("splits 55 RF like the tokenomics example", () => {
    expect(marketSplit(55 * MICRO_PER_RF)).toEqual({
      priceMicro: 55_000_000,
      burnedMicro: 1_100_000,
      toOriginMicro: 1_100_000,
      toCreatorMicro: 550_000,
      toSellerMicro: 52_250_000,
    });
  });

  it("parts always sum to the price, each fee is exactly floor(price·bps/10 000), the seller keeps the dust", () => {
    fc.assert(
      fc.property(anyPrice, (p) => {
        const s = marketSplit(p);
        expect(s.burnedMicro + s.toOriginMicro + s.toCreatorMicro + s.toSellerMicro).toBe(p);
        expect(s.burnedMicro).toBe(Number((BigInt(p) * 200n) / 10_000n));
        expect(s.toOriginMicro).toBe(Number((BigInt(p) * 200n) / 10_000n));
        expect(s.toCreatorMicro).toBe(Number((BigInt(p) * 100n) / 10_000n));
        expect(s.toSellerMicro).toBeGreaterThanOrEqual(p - Math.floor((p * MARKET.feeBps) / BPS));
        expect(Math.min(s.burnedMicro, s.toOriginMicro, s.toCreatorMicro, s.toSellerMicro)).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("on the price tick every share is exact (no dust) and equals the contract's wei split", () => {
    fc.assert(
      fc.property(tickPrice, (p) => {
        const s = marketSplit(p);
        expect(s.burnedMicro * BPS).toBe(p * MARKET.burnBps);
        expect(s.toOriginMicro * BPS).toBe(p * MARKET.originBps);
        expect(s.toCreatorMicro * BPS).toBe(p * MARKET.creatorBps);
        expect(s.toSellerMicro * BPS).toBe(p * (BPS - MARKET.feeBps));
        const wei = marketSplitWei(marketPriceWei(p));
        expect(wei.burned.toString()).toBe(microToWei(s.burnedMicro));
        expect(wei.toOrigin.toString()).toBe(microToWei(s.toOriginMicro));
        expect(wei.toCreator.toString()).toBe(microToWei(s.toCreatorMicro));
        expect(wei.toSeller.toString()).toBe(microToWei(s.toSellerMicro));
      }),
    );
  });

  it("marketSplitWei sums to the price for any uint", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: (1n << 200n) - 1n }), (p) => {
        const w = marketSplitWei(p);
        expect(w.burned + w.toOrigin + w.toCreator + w.toSeller).toBe(p);
        expect(w.burned).toBe((p * 200n) / 10_000n);
      }),
    );
  });

  it("refuses non-integers, negatives and amounts whose bps product would be inexact", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER])
      expect(() => marketSplit(bad)).toThrow(RangeError);
    expect(() => marketSplitWei(-1n)).toThrow(RangeError);
  });
});

describe("marketPriceProblem", () => {
  it("accepts whole ticks in [45 RF, 10 000 RF]", () => {
    fc.assert(fc.property(tickPrice, (p) => marketPriceProblem(p) === null));
  });

  it("names the problem otherwise", () => {
    expect(marketPriceProblem(MARKET.minPriceMicro - MARKET.tickMicro)).toBe("below_min");
    expect(marketPriceProblem(MARKET.maxPriceMicro + MARKET.tickMicro)).toBe("above_max");
    expect(marketPriceProblem(MARKET.minPriceMicro + 1)).toBe("off_tick");
    expect(marketPriceProblem(50.5 * MICRO_PER_RF + 0.5)).toBe("not_integer");
  });

  it("converts a price to wei exactly", () => {
    expect(marketPriceWei(MARKET.minPriceMicro)).toBe(45n * 10n ** 18n);
    expect(marketPriceWei(1)).toBe(WEI_PER_MICRO);
  });
});

describe("marketSchemas", () => {
  it("accept well-formed bodies and reject extra or malformed fields", () => {
    expect(marketSchemas.list.safeParse({ priceMicro: 50_000_000 }).success).toBe(true);
    expect(marketSchemas.list.safeParse({ priceMicro: 50_000_000, leafId: 3 }).success).toBe(true);
    expect(marketSchemas.list.safeParse({ priceMicro: "50" }).success).toBe(false);
    expect(marketSchemas.buy.safeParse({ leafId: 1, expectedPriceMicro: 1 }).success).toBe(true);
    expect(marketSchemas.buy.safeParse({ leafId: 1 }).success).toBe(false);
    expect(marketSchemas.cancel.safeParse({ leafId: 0 }).success).toBe(false);
    expect(marketSchemas.cancel.safeParse({ leafId: 1, extra: true }).success).toBe(false);
    expect(marketSchemas.book.safeParse({ limit: "10" }).success).toBe(true);
  });
});
