import { BITS, EMPTY_MASK, frontMask, setBit, toIndices } from "@pl/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownedView } from "../test/fixtures.js";
import { createProgressBook } from "./progress.js";
import { streakLabel, streakTier } from "./streak.js";
import { quoteLines } from "./economy.js";
import { drawShareCard, SHARE_H, SHARE_W } from "../share/share-card.js";
import { quote } from "@pl/shared";

const DAY = Date.parse("2026-10-01T10:00:00Z");
beforeEach(() => localStorage.clear());

describe("bits (local)", () => {
  it("pays the first-run bonus once a day and never exceeds the daily hard cap", () => {
    const book = createProgressBook();
    const first = book.recordRun("guest", { score: 100, lost: 0 }, DAY);
    expect(first.firstRunOfDay).toBe(true);
    expect(first.bits).toBe(BITS.runBase + BITS.runSkillMax + BITS.firstRunOfDay);
    expect(first.newStamps).toEqual(["first-run", "flawless"]);
    let total = first.bits;
    for (let i = 0; i < 100; i++) total += book.recordRun("guest", { score: 1200, lost: 3 }, DAY + i).bits;
    expect(total).toBe(BITS.dailyHardCap);
    expect(book.get("guest").best).toBe(1200);
    expect(book.get("guest").stamps).toContain("score-1000");
    expect(book.get("guest").stamps).toContain("ten-runs");
    // A new UTC day resets the daily cap, not the total.
    const next = book.recordRun("guest", { score: 1, lost: 20 }, DAY + 86_400_000);
    expect(next.firstRunOfDay).toBe(true);
    expect(next.bits).toBe(BITS.runBase + BITS.firstRunOfDay);
    expect(createProgressBook().get("guest").bits).toBe(BITS.dailyHardCap + next.bits);
  });

  it("keeps players apart", () => {
    const book = createProgressBook();
    book.recordRun("guest", { score: 1, lost: 1 }, DAY);
    expect(book.get("344030").bits).toBe(0);
    expect(book.stamp("344030", "mender")).toBe(true);
    expect(book.stamp("344030", "mender")).toBe(false);
  });
});

describe("streak halo", () => {
  it("follows the GDD tiers", () => {
    expect([0, 2, 3, 6, 7, 13, 14, 29, 30].map(streakTier)).toEqual([
      "halo",
      "halo",
      "sun",
      "sun",
      "coral",
      "coral",
      "lilac",
      "lilac",
      "goldWhite",
    ]);
    expect(streakLabel(9)).toBe("coral halo");
  });
});

describe("economy copy", () => {
  it("states price, split and SIMULATED for Regrow and Mend", () => {
    const px = setBit(setBit(EMPTY_MASK, 3, true), 4, true);
    const r = quoteLines(quote({ kind: "regrow", tokenId: "7", pixels: px }));
    expect(r[0]).toBe("Regrow 2 px of #7: 1.00 RF (SIMULATED).");
    expect(r[1]).toMatch(/0\.50 RF burned · 0\.50 RF to the active-Friends stream/);
    const m = quoteLines(quote({ kind: "mend", payer: "7", target: "8", pixels: px }));
    expect(m[1]).toBe("1.00 RF burned · 1.00 RF to #8's wallet.");
  });
});

describe("share card", () => {
  it("draws the silhouette with scars, the id, the score and the link", () => {
    const calls: string[] = [];
    const ctx = new Proxy(
      { measureText: () => ({ width: 100 }) },
      {
        get(t, k) {
          if (k in t) return (t as Record<string | symbol, unknown>)[k];
          return typeof k === "string" &&
            /^[a-z]/.test(k) &&
            !["fillStyle", "font", "lineWidth", "strokeStyle", "textBaseline"].includes(k)
            ? (...args: unknown[]) => calls.push(`${k}(${args.join(",")})`)
            : undefined;
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    const base = ownedView("344030");
    const first = toIndices(frontMask(base.appearance))[0] ?? 0;
    const view = ownedView("344030", setBit(EMPTY_MASK, first, true));
    drawShareCard(ctx, {
      appearance: view.appearance,
      lost: view.pub.scars.lost,
      score: 3410,
      kept: 75,
      total: 76,
      loaned: false,
      link: "https://pixel-life.test/f/344030",
    });
    expect(calls[0]).toBe(`fillRect(0,0,${SHARE_W},${SHARE_H})`);
    expect(calls.some((c) => c.startsWith("fillText(#344030,"))).toBe(true);
    expect(calls.some((c) => c.startsWith("fillText(3410,"))).toBe(true);
    // One coral-dotted scar slot: 4 dots per side, 3 steps → 12 dot rects around the lost pixel.
    expect(calls.filter((c) => /^fillRect\(\d+,\d+,4,4\)$/.test(c))).toHaveLength(12);
    expect(calls.some((c) => c.startsWith("fillText(https://pixel-life.test/f/344030"))).toBe(true);
  });
});

vi.restoreAllMocks();
