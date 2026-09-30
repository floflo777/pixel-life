import { BPS, fromIndices, quote } from "@pl/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GOLD_FLOOR_MICRO, marketParts, marketSplit, MARKET_SELLER_BPS, quoteParts, seedPackFacts } from "./economy.js";
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

describe("market split", () => {
  it("always sums to the price with fees rounded down (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), (price) => {
        const s = marketSplit(price);
        expect(s.burn + s.origin + s.creator + s.seller).toBe(price);
        expect(s.burn).toBe(Math.floor(price * 0.02));
        expect(s.seller).toBeGreaterThanOrEqual(Math.floor((price * MARKET_SELLER_BPS) / BPS));
      }),
    );
  });
  it("uses the tokenomics fee: 95 / 2 / 2 / 1", () => {
    expect(marketSplit(100_000_000)).toEqual({
      burn: 2_000_000,
      origin: 2_000_000,
      creator: 1_000_000,
      seller: 95_000_000,
    });
    expect(marketParts().map((p) => p.bps)).toEqual([9500, 200, 200, 100]);
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
  });
});
