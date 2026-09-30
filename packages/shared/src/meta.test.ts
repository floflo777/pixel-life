import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BITS, RF_DECOR_TIERS_MICRO } from "./economy.js";
import {
  applyMetaEvent,
  baseTerraces,
  beltEarnedBy,
  BELTS,
  beltRank,
  CATALOG,
  catalogItem,
  currentBelt,
  decorItem,
  DISTINCT_CAP,
  EMPTY_LAYOUT,
  EMPTY_STATS,
  FRIEND_SPOT,
  footprint,
  HOME_GRID,
  homeLayoutSchema,
  homeTerraces,
  itemCost,
  itemOwner,
  MAX_PLOTS,
  type MetaEvent,
  type MetaStats,
  moveItem,
  newStamps,
  nextBelt,
  nextPlotPrice,
  parseMetaStats,
  type Placement,
  placeItem,
  placementAt,
  placementCap,
  placementCells,
  removeItem,
  rotateItem,
  type Rotation,
  runMeets,
  STAMPS,
  stampsXp,
  validateLayout,
} from "./meta.js";

const at = (item: string, t: number, x: number, z: number, r: Rotation = 0): Placement => ({ item, t, x, z, r });

describe("catalog", () => {
  it("has 20-30 cosmetic items with unique ids and prices in the tokenomics bands", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(20);
    expect(CATALOG.length).toBeLessThanOrEqual(30);
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
    for (const item of CATALOG) {
      if ("bits" in item.price) {
        expect(item.price.bits).toBeGreaterThanOrEqual(BITS.catalogMin);
        expect(item.price.bits).toBeLessThanOrEqual(BITS.catalogMax);
      }
    }
    expect(CATALOG.filter((i) => i.kind === "hat").length).toBeGreaterThanOrEqual(4);
    // One RF decor piece per tier.
    const tiers = CATALOG.flatMap((i) => ("rfTier" in i.price ? [i.price.rfTier] : [])).sort();
    expect(tiers).toEqual([0, 1, 2, 3]);
  });

  it("prices RF decor with a 50/50 burn/stream split and blueprints on the crafted tiers", () => {
    for (const item of CATALOG) {
      const c = itemCost(item);
      expect(c.burnMicro + c.streamMicro).toBe(c.rfMicro);
      if (!("rfTier" in item.price)) {
        expect(c.rfMicro).toBe(0);
        expect(itemOwner(item)).toBe("account");
        continue;
      }
      expect(itemOwner(item)).toBe("friend");
      expect(c.rfMicro).toBe(RF_DECOR_TIERS_MICRO[item.price.rfTier]);
      expect(c.burnMicro).toBe(c.rfMicro / 2);
      const blueprint = [0, 0, BITS.craftedBlueprints.rf10, BITS.craftedBlueprints.rf25][item.price.rfTier];
      expect(c.bits).toBe(blueprint);
    }
  });

  it("gates flex items on stamps or belts that exist", () => {
    const flex = CATALOG.filter((i) => i.unlock);
    expect(flex.length).toBeGreaterThan(0);
    for (const i of flex) {
      if (i.unlock && "stamp" in i.unlock)
        expect(STAMPS.some((s) => s.id === (i.unlock as { stamp: string }).stamp)).toBe(true);
      if (i.unlock && "belt" in i.unlock) expect(beltRank(i.unlock.belt)).toBeGreaterThan(0);
    }
  });

  it("looks items up by id", () => {
    expect(catalogItem("bench")?.name).toBe("Bench");
    expect(decorItem("hat_cap")).toBeNull();
    expect(catalogItem("nope")).toBeNull();
  });
});

describe("terraces and plots", () => {
  it("maps generation to terraces (Gen-6 → 1 … Gen-1 → 6) and adds plots", () => {
    expect([1, 2, 3, 4, 5, 6].map(baseTerraces)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(baseTerraces(0)).toBe(1);
    expect(baseTerraces(Number.NaN)).toBe(1);
    expect(homeTerraces(6, 2)).toBe(3);
    expect(homeTerraces(1, 99)).toBe(6 + MAX_PLOTS);
    expect(placementCap(1)).toBe(12);
    expect(placementCap(6)).toBe(32);
  });

  it("escalates plot prices and stops after the last one", () => {
    expect(nextPlotPrice(0)).toBe(1000);
    expect(nextPlotPrice(4)).toBe(16000);
    expect(nextPlotPrice(5)).toBeNull();
    expect(nextPlotPrice(-1)).toBeNull();
  });
});

describe("home layout", () => {
  const rules = { terraces: 2 };

  it("accepts an empty layout and a sensible one", () => {
    expect(validateLayout(EMPTY_LAYOUT, rules).ok).toBe(true);
    const layout = {
      v: 1 as const,
      items: [at("tree_paper", 0, 0, 0), at("bench", 0, 8, 2, 1), at("rock", 1, 11, 11)],
    };
    expect(validateLayout(layout, rules)).toEqual({ ok: true });
  });

  it("rejects each rule violation with the failing index", () => {
    const check = (items: Placement[], r: Parameters<typeof validateLayout>[1] = rules) =>
      validateLayout({ v: 1, items }, r);
    expect(check([at("nope", 0, 0, 0)])).toEqual({ ok: false, error: "unknown_item", index: 0 });
    expect(check([at("hat_cap", 0, 0, 0)])).toEqual({ ok: false, error: "not_decor", index: 0 });
    expect(check([at("rock", 2, 0, 0)])).toEqual({ ok: false, error: "bad_terrace", index: 0 });
    expect(check([at("rock", 0, 0, 0), at("tree_paper", 0, 11, 0)])).toEqual({
      ok: false,
      error: "out_of_bounds",
      index: 1,
    });
    expect(check([at("tree_paper", 0, 0, 0), at("rock", 0, 1, 1)])).toEqual({ ok: false, error: "overlap", index: 1 });
    expect(check([at("rock", FRIEND_SPOT.t, FRIEND_SPOT.x, FRIEND_SPOT.z)])).toEqual({
      ok: false,
      error: "friend_spot",
      index: 0,
    });
    // The Friend spot only exists on terrace 0.
    expect(check([at("rock", 1, FRIEND_SPOT.x, FRIEND_SPOT.z)]).ok).toBe(true);
    const many = Array.from({ length: placementCap(1) + 1 }, (_, i) => at("rock", 0, i % HOME_GRID, i < 12 ? 0 : 1));
    expect(check(many, { terraces: 1 })).toEqual({ ok: false, error: "too_many", index: placementCap(1) });
    expect(check([at("rock", 0, 0, 0), at("rock", 0, 1, 0)], { terraces: 1, owned: { rock: 1 } })).toEqual({
      ok: false,
      error: "not_owned",
      index: 1,
    });
  });

  it("swaps the footprint on odd rotations", () => {
    const bench = decorItem("bench");
    expect(bench).not.toBeNull();
    if (!bench) return;
    expect(footprint(bench, 0)).toEqual({ w: 2, d: 1 });
    expect(footprint(bench, 1)).toEqual({ w: 1, d: 2 });
    expect(placementCells(at("bench", 0, 3, 3, 3))).toEqual([
      [3, 3],
      [3, 4],
    ]);
  });

  it("edits: place, find, move, rotate, remove", () => {
    let layout = EMPTY_LAYOUT;
    const placed = placeItem(layout, at("bench", 0, 10, 0), rules);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    layout = placed.layout;
    expect(placementAt(layout, 0, 11, 0)).toBe(0);
    expect(placementAt(layout, 0, 9, 0)).toBe(-1);
    // Rotating at the right edge still fits (2×1 → 1×2).
    const rotated = rotateItem(layout, 0, rules);
    expect(rotated.ok && rotated.layout.items[0]?.r).toBe(1);
    // A second rotate back to 2 wide still fits at x = 10.
    const blocked = placeItem(layout, at("rock", 0, 11, 0), rules);
    expect(blocked).toEqual({ ok: false, error: "overlap" });
    const moved = moveItem(layout, 0, { t: 1, x: 0, z: 0 }, rules);
    expect(moved.ok && moved.layout.items[0]).toEqual(at("bench", 1, 0, 0));
    expect(moveItem(layout, 0, { t: 0, x: 11, z: 0 }, rules)).toEqual({ ok: false, error: "out_of_bounds" });
    expect(removeItem(layout, 0).items).toEqual([]);
    expect(rotateItem(layout, 5, rules)).toEqual({ ok: false, error: "unknown_item" });
  });

  it("never accepts overlapping or out-of-grid layouts (property)", () => {
    const decorIds = CATALOG.filter((i) => i.kind === "decor").map((i) => i.id);
    const placement = fc.record({
      item: fc.constantFrom(...decorIds),
      t: fc.integer({ min: 0, max: 2 }),
      x: fc.integer({ min: 0, max: HOME_GRID - 1 }),
      z: fc.integer({ min: 0, max: HOME_GRID - 1 }),
      r: fc.constantFrom<Rotation>(0, 1, 2, 3),
    });
    fc.assert(
      fc.property(fc.array(placement, { maxLength: 20 }), (items) => {
        const layout = { v: 1 as const, items };
        if (!validateLayout(layout, { terraces: 3 }).ok) return;
        const seen = new Set<string>();
        for (const p of items)
          for (const [x, z] of placementCells(p) ?? []) {
            expect(x).toBeLessThan(HOME_GRID);
            expect(z).toBeLessThan(HOME_GRID);
            const key = `${p.t}:${x}:${z}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
          }
        expect(homeLayoutSchema.safeParse(layout).success).toBe(true);
      }),
    );
  });
});

describe("stamps", () => {
  it("defines 24 stamps with unique ids across the 4 colours", () => {
    expect(STAMPS.length).toBe(24);
    expect(new Set(STAMPS.map((s) => s.id)).size).toBe(24);
    expect(new Set(STAMPS.map((s) => s.color))).toEqual(new Set(["easy", "medium", "hard", "extreme"]));
  });

  const run = (extra: object = {}): MetaEvent => ({
    kind: "run_finished",
    run: { venueId: "pixel-life", score: 500, ...extra },
  });

  it("awards run stamps from a single run and stat stamps from counters", () => {
    let stats: MetaStats = EMPTY_STATS;
    const held = new Set<string>();
    const earn = (e: MetaEvent): string[] => {
      stats = applyMetaEvent(stats, e);
      const got = newStamps(stats, e, held);
      for (const id of got) held.add(id);
      return got;
    };
    expect(earn(run())).toEqual(["first_flight"]);
    expect(earn(run())).toEqual([]);
    expect(earn(run({ score: 4200, maxCombo: 8, grabbedBack: 2 }))).toEqual([
      "first_grab",
      "warm_up",
      "triple",
      "combo_8",
      "high_four",
    ]);
    // Other venues never earn Pixel Life run stamps.
    expect(earn({ kind: "run_finished", run: { venueId: "pixel-putt", score: 99999, flawless: true } })).toEqual([]);
    expect(earn(run({ island: "ink", flawless: true }))).toEqual(["flawless", "untouchable"]);
    expect(earn({ kind: "mend_given", target: "7", px: 3 })).toEqual(["first_stitch"]);
    expect(earn({ kind: "gold_kept" })).toEqual(["gold_keeper"]);
    for (let i = 1; i <= 4; i++) expect(earn({ kind: "mend_received", from: String(i), px: 1 })).toEqual([]);
    expect(earn({ kind: "mend_received", from: "4", px: 1 })).toEqual([]); // duplicate mender
    expect(earn({ kind: "mend_received", from: "5", px: 1 })).toEqual(["well_loved"]);
    expect(earn({ kind: "whole", days: 30 })).toEqual(["whole_week", "whole_moon"]);
    expect(earn({ kind: "home_saved", items: 5 })).toEqual(["decorator"]);
    expect(earn({ kind: "belt_earned", belt: "gulp_master" })).toEqual(["gulp_master"]);
    expect(stampsXp(["first_flight", "gulp_master", "nope"])).toBe(325);
  });

  it("counts Gulp burps and pops across runs", () => {
    let stats: MetaStats = EMPTY_STATS;
    for (let i = 0; i < 50; i++) stats = applyMetaEvent(stats, run({ gulpBurped: true, pops: 3 }));
    expect(stats.gulpBurps).toBe(50);
    expect(stats.pops).toBe(150);
    expect(newStamps(stats, run(), new Set())).toContain("gulp_gourmet");
  });

  it("keeps counters monotone and distinct lists bounded (property)", () => {
    const token = fc.integer({ min: 1, max: 60 }).map(String);
    const event: fc.Arbitrary<MetaEvent> = fc.oneof(
      fc.record({ kind: fc.constant("mend_given" as const), target: token, px: fc.integer({ min: -5, max: 30 }) }),
      fc.record({ kind: fc.constant("mend_received" as const), from: token, px: fc.integer({ min: 0, max: 30 }) }),
      fc.record({ kind: fc.constant("isle_visited" as const), owner: token }),
      fc.record({ kind: fc.constant("whole" as const), days: fc.integer({ min: -3, max: 40 }) }),
      fc.record({
        kind: fc.constant("run_finished" as const),
        run: fc.record({ venueId: fc.constant("pixel-life"), score: fc.integer({ min: 0, max: 9000 }) }),
      }),
    );
    fc.assert(
      fc.property(fc.array(event, { maxLength: 120 }), (events) => {
        let s: MetaStats = EMPTY_STATS;
        for (const e of events) {
          const n = applyMetaEvent(s, e);
          for (const k of ["runs", "mendsGiven", "mendPxGiven", "wholeDays", "bestScore"] as const)
            expect(n[k]).toBeGreaterThanOrEqual(s[k]);
          for (const k of ["mendTargets", "menders", "islesVisited"] as const) {
            expect(n[k].length).toBeLessThanOrEqual(DISTINCT_CAP);
            expect(new Set(n[k]).size).toBe(n[k].length);
          }
          s = n;
        }
        expect(parseMetaStats(JSON.parse(JSON.stringify(s)))).toEqual(s);
      }),
    );
  });

  it("parses junk stats into zeros", () => {
    expect(parseMetaStats(null)).toEqual(EMPTY_STATS);
    expect(parseMetaStats({ runs: -4, menders: ["x", "5", "5"], beltRank: 99 })).toEqual({
      ...EMPTY_STATS,
      menders: ["5"],
      beltRank: BELTS.length,
    });
  });
});

describe("fling belts", () => {
  const pl = { venueId: "pixel-life" };

  it("wears the highest belt reached without a gap", () => {
    expect(currentBelt([])).toBeNull();
    expect(currentBelt(["white", "yellow", "green"])).toBe("yellow");
    expect(nextBelt(null)).toBe("white");
    expect(nextBelt("black")).toBe("gulp_master");
    expect(nextBelt("gulp_master")).toBeNull();
  });

  it("earns white from any Pixel Life run, later belts only from their own trial", () => {
    expect(beltEarnedBy([], { ...pl, score: 0 })).toBe("white");
    expect(beltEarnedBy([], { venueId: "pixel-putt", score: 0 })).toBeNull();
    // Yellow: score 2,000 on the yellow trial seed (Meadow).
    expect(beltEarnedBy(["white"], { ...pl, score: 2500, island: "meadow" })).toBeNull();
    expect(beltEarnedBy(["white"], { ...pl, score: 2500, island: "meadow", beltTrial: "yellow" })).toBe("yellow");
    expect(beltEarnedBy(["white"], { ...pl, score: 1999, island: "meadow", beltTrial: "yellow" })).toBeNull();
    // Cannot skip: an orange trial run does nothing for a white belt.
    expect(beltEarnedBy(["white"], { ...pl, score: 0, island: "meadow", maxCombo: 9, beltTrial: "orange" })).toBeNull();
    const upToPurple = BELTS.slice(0, 8).map((b) => b.id);
    expect(beltEarnedBy(upToPurple, { ...pl, score: 6100, island: "ink", gulpBurped: true, beltTrial: "black" })).toBe(
      "black",
    );
    expect(beltEarnedBy(upToPurple, { ...pl, score: 6100, island: "ink", beltTrial: "black" })).toBeNull();
    expect(
      beltEarnedBy(
        BELTS.map((b) => b.id),
        { ...pl, score: 1 },
      ),
    ).toBeNull();
  });

  it("checks run requirements metric by metric", () => {
    expect(runMeets({ ...pl, score: 10, keptBps: 9000 }, { min: { keptBps: 9000 } })).toBe(true);
    expect(runMeets({ ...pl, score: 10 }, { min: { keptBps: 1 } })).toBe(false);
    expect(runMeets({ ...pl, score: 10 }, { island: "snow" })).toBe(false);
  });
});
