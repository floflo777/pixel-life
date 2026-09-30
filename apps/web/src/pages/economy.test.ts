import { BPS, fromIndices, marketSplit, quote } from "@pl/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GOLD_FLOOR_MICRO, marketParts, MARKET_SELLER_BPS, quoteParts, seedPackFacts } from "./economy.js";
import { inboxCopy } from "./inbox-copy.js";

describe("quoteParts", () => {
  it("mirrors the quote's exact split for Regrow and Mend", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 255 }), { minLength: 1, maxLength: 256 }),
        fc.boolean(),
        (px, mend) => {
          const pixels = fromIndices(px);
          const q = quote(
            mend ? { kind: "mend", payer: "1", target: "2", pixels } : { kind: "regrow", tokenId: "1", pixels },
          );
          const parts = quoteParts(q);
          expect(parts.reduce((s, p) => s + p.bps, 0)).toBe(BPS);
          expect(parts.reduce((s, p) => s + (p.micro ?? 0), 0)).toBe(q.totalMicro);
          expect(parts.map((p) => p.kind)).toEqual(mend ? ["burn", "friend"] : ["burn", "stream"]);
        },
      ),
    );
  });
});

describe("market parts", () => {
  it("mirror the shared market split exactly and sum to the price (property)", () => {
    fc.assert(
      // Up to 100 000 RF: ten times the highest ask the market accepts.
      fc.property(fc.integer({ min: 0, max: 1e11 }), (price) => {
        const parts = marketParts(price, "7");
        const s = marketSplit(price);
        expect(parts.reduce((t, p) => t + (p.micro ?? 0), 0)).toBe(price);
        expect(parts[0]?.micro).toBe(s.toSellerMicro);
        expect(parts.reduce((t, p) => t + p.bps, 0)).toBe(BPS);
      }),
    );
  });
  it("uses the tokenomics fee: 95 / 2 / 2 / 1 and the 45 RF floor", () => {
    expect(marketParts(100_000_000).map((p) => p.micro)).toEqual([95_000_000, 2_000_000, 2_000_000, 1_000_000]);
    expect(marketParts().map((p) => p.bps)).toEqual([9500, 200, 200, 100]);
    expect(MARKET_SELLER_BPS).toBe(9500);
    expect(GOLD_FLOOR_MICRO).toBe(45_000_000);
  });
});

describe("seedPackFacts", () => {
  it("matches the published tokenomics §3 numbers", () => {
    const f = seedPackFacts();
    expect(f.price).toBe(5_000_000);
    expect(f.ev).toBe(4_480_000);
    expect(f.rtpBps).toBe(8960);
    expect(f.edgeMicro).toBe(520_000);
    expect(f.max).toBe(45_000_000);
    expect(f.reservePerPackMicro).toBe(40_000_000);
    expect(f.moneyBackBps).toBe(4400);
    expect(f.rows.map((r) => r.chanceBps)).toEqual([5600, 3000, 1200, 200]);
  });
});

describe("inboxCopy", () => {
  it("writes the GDD §5.9 sentences", () => {
    const base = { id: "a", tokenId: "344030", createdAt: 0, readAt: null };
    expect(
      inboxCopy({
        ...base,
        kind: "mended",
        by: "1969",
        px: 1,
        toTargetMicro: 500_000,
        mode: "sim",
        region: "left ear",
        batched: 0,
      }),
    ).toBe("#1969 mended #344030's left ear and paid it 0.50 RF simulated.");
    expect(inboxCopy({ ...base, kind: "whole" })).toBe("#344030 is whole again.");
    expect(inboxCopy({ ...base, kind: "streak_risk", streak: 9 })).toBe("your 9-day halo fades tomorrow.");
    expect(
      inboxCopy({
        ...base,
        kind: "market_sold",
        mode: "sim",
        leafId: 3,
        buyer: "7",
        priceMicro: 50_000_000,
        toSellerMicro: 47_500_000,
        toOriginMicro: 1_000_000,
      }),
    ).toBe("#7 bought your Gold Pixel (leaf 3) for 50.00 RF simulated: #344030 got 47.50 RF.");
    expect(
      inboxCopy({
        ...base,
        kind: "market_royalty",
        mode: "sim",
        leafId: 3,
        buyer: "7",
        seller: "8",
        priceMicro: 50_000_000,
        toOriginMicro: 1_000_000,
      }),
    ).toMatch(/royalty/);
    // A kind from a newer server still renders.
    expect(inboxCopy({ ...base, kind: "stamp_earned" } as unknown as Parameters<typeof inboxCopy>[0])).toMatch(/new/);
  });
});
