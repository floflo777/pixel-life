import {
  BPS,
  boundary,
  ECON,
  frontMask,
  fromIndices,
  getBit,
  isSubset,
  MARKET,
  marketSplit,
  quote,
  rtpBps,
  SEED_PACK,
} from "@pl/shared";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOANERS, loaner } from "../test/fixtures.js";
import { bindCoachToWindow, COACH_EVENTS, coachReduce, createCoach, emitCoachEvent } from "./coach.js";
import { healFrames, healOrder, hitFrames, knockPixels, mendFrames } from "./demo.js";
import { bands, diagramHeight, packetsFor } from "./diagram.js";
import { FLOW_KINDS, rfFlow, seedOdds, seedPackBps } from "./flows.js";
import { markIntroSeen, ONBOARDING_KEY, readProgress, resetOnboarding, shouldShowIntro } from "./progress.js";

describe("rfFlow", () => {
  it("legs are non-negative integers that sum to the total, for any amount", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FLOW_KINDS),
        fc.integer({ min: -5, max: 400 }),
        fc.integer({ min: 0, max: 20_000_000_000 }),
        fc.integer({ min: -3, max: 200 }),
        (kind, pixels, priceMicro, packs) => {
          const f = rfFlow(kind, { pixels, priceMicro, packs });
          const sum = f.legs.reduce((s, l) => s + l.micro, 0);
          expect(sum).toBe(f.totalMicro);
          for (const l of f.legs) expect(Number.isInteger(l.micro) && l.micro >= 0).toBe(true);
          expect(f.legs.reduce((s, l) => s + l.bps, 0)).toBe(BPS);
        },
      ),
    );
  });

  it("Regrow and Mend match the server's quote() to the micro-RF", () => {
    for (const px of [1, 3, 10, 24, 256]) {
      const mask = fromIndices(Array.from({ length: px }, (_, i) => i));
      const r = quote({ kind: "regrow", tokenId: "9", pixels: mask });
      const rf = rfFlow("regrow", { pixels: px });
      expect(rf.totalMicro).toBe(r.totalMicro);
      expect(rf.legs.find((l) => l.key === "burn")?.micro).toBe(r.burnMicro);
      expect(rf.legs.find((l) => l.key === "stream")?.micro).toBe(r.streamMicro);
      const m = quote({ kind: "mend", payer: "9", target: "8", pixels: mask });
      const mf = rfFlow("mend", { pixels: px, targetName: "#8" });
      expect(mf.totalMicro).toBe(m.totalMicro);
      expect(mf.legs.find((l) => l.key === "target")?.micro).toBe(m.toTargetMicro);
      expect(mf.legs.find((l) => l.key === "target")?.label).toBe("#8's wallet");
    }
    expect(rfFlow("regrow").totalMicro).toBe(10 * ECON.regrowMicroPerPx);
  });

  it("market sales follow marketSplit and snap to a whole tick within the price bounds", () => {
    const f = rfFlow("market", { priceMicro: 60_123_456 });
    expect(f.totalMicro).toBe(60_120_000);
    const s = marketSplit(60_120_000);
    expect(f.legs.map((l) => l.micro)).toEqual([s.toSellerMicro, s.burnedMicro, s.toOriginMicro, s.toCreatorMicro]);
    expect(f.legs.map((l) => l.bps)).toEqual([9500, 200, 200, 100]);
    expect(rfFlow("market", { priceMicro: 1 }).totalMicro).toBe(MARKET.minPriceMicro);
    expect(rfFlow("market").totalMicro).toBe(MARKET.backingMicro);
  });

  it("Seed Pack: RTP back as rewards, the edge split 50/50 burn/stream", () => {
    const b = seedPackBps();
    expect(b.reward).toBe(rtpBps(SEED_PACK));
    expect(b.reward).toBe(8960);
    expect(b.burn).toBe(520);
    expect(b.stream).toBe(520);
    const f = rfFlow("seed", { packs: 3 });
    expect(f.totalMicro).toBe(15_000_000);
    expect(f.expected).toBe(true);
    expect(f.what).toBe("3 Seed Packs");
  });

  it("seedOdds is the published table with plant values", () => {
    const o = seedOdds();
    expect(o.map((x) => x.name)).toEqual(["Sprout", "Bloom", "Full Bloom", "Gold Pixel"]);
    expect(o.reduce((s, x) => s + x.chanceBps, 0)).toBe(BPS);
    expect(o.map((x) => x.plantPx)).toEqual([4, 12, 19, 0]);
  });
});

describe("diagram bands", () => {
  const layout = { rowH: 76, gap: 8, width: 52, minSlice: 4 };
  it("slices tile the source column in order and land centred on their rows", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: BPS }), { minLength: 1, maxLength: 5 }), (bps) => {
        const bs = bands(bps, layout);
        const h = diagramHeight(bps.length, layout);
        expect(bs[0]?.y0).toBe(0);
        expect(bs.at(-1)?.y1).toBeCloseTo(h, 1);
        bs.forEach((b, i) => {
          if (i > 0) expect(b.y0).toBeCloseTo(bs[i - 1]?.y1 ?? 0, 1);
          expect(b.y1 - b.y0).toBeGreaterThanOrEqual(layout.minSlice - 0.02);
          const mid = i * (layout.rowH + layout.gap) + layout.rowH / 2;
          expect((b.t0 + b.t1) / 2).toBeCloseTo(mid, 1);
          expect(b.t1 - b.t0).toBeLessThanOrEqual(layout.rowH - 8 + 0.02);
        });
      }),
    );
  });
  it("a 1 % share is still drawn and gets one packet", () => {
    const bs = bands([9500, 200, 200, 100], layout);
    expect((bs[3]?.y1 ?? 0) - (bs[3]?.y0 ?? 0)).toBeGreaterThanOrEqual(4);
    expect(packetsFor(100)).toBe(1);
    expect(packetsFor(5000)).toBe(3);
    expect(packetsFor(9500)).toBe(4);
    expect(packetsFor(0)).toBe(0);
    expect(bands([], layout)).toEqual([]);
  });
});

describe("demo frames", () => {
  it("knocks only boundary pixels of the real sprite, deterministically", () => {
    for (const l of LOANERS) {
      const edge = boundary(frontMask(l.appearance));
      const k = knockPixels(l.appearance, 5);
      expect(k.length).toBe(5);
      expect(new Set(k).size).toBe(5);
      for (const i of k) expect(getBit(edge, i)).toBe(true);
      expect(knockPixels(l.appearance, 5)).toEqual(k);
    }
  });
  it("every frame's scars sit inside the Friend and heal in regrowth order", () => {
    const a = loaner(0).appearance;
    const front = frontMask(a);
    for (const f of [...hitFrames(a), ...healFrames(a), ...mendFrames(a)]) {
      expect(isSubset(f.lost, front)).toBe(true);
      expect(isSubset(f.stitched, front)).toBe(true);
      expect(f.ms).toBeGreaterThan(0);
    }
    const lost = knockPixels(a, 7, 3);
    expect(healOrder(a.tokenId, lost).sort((x, y) => x - y)).toEqual([...lost].sort((x, y) => x - y));
    const hit = hitFrames(a);
    expect(hit[1]?.loose.length).toBe(5);
    expect(hit.at(-1)?.loose.length).toBe(0);
  });
});

describe("onboarding progress", () => {
  beforeEach(() => localStorage.clear());
  it("shows the intro once, then remembers", () => {
    expect(shouldShowIntro()).toBe(true);
    markIntroSeen();
    expect(shouldShowIntro()).toBe(false);
    resetOnboarding();
    expect(shouldShowIntro()).toBe(true);
  });
  it("treats malformed storage as nothing seen", () => {
    localStorage.setItem(ONBOARDING_KEY, "{bad json");
    expect(readProgress()).toEqual({ introSeen: false, coachDone: [] });
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ introSeen: "yes", coachDone: [1] }));
    expect(readProgress()).toEqual({ introSeen: false, coachDone: [] });
  });
});

describe("coach", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("shows fling on run start, completes it on a fling, then shows sweep on loose pixels", () => {
    let s = { active: null, done: [] } as { active: string | null; done: readonly string[] };
    s = coachReduce(s, COACH_EVENTS.runStart);
    expect(s.active).toBe("fling");
    s = coachReduce(s, COACH_EVENTS.fling);
    expect(s).toEqual({ active: null, done: ["fling"] });
    s = coachReduce(s, COACH_EVENTS.runStart);
    expect(s.active).toBeNull();
    s = coachReduce(s, COACH_EVENTS.pixelsLoose);
    expect(s.active).toBe("sweep");
    // Pixels scarred: hide, not done, so the hint comes back next time.
    s = coachReduce(s, COACH_EVENTS.pixelsScarred);
    expect(s).toEqual({ active: null, done: ["fling"] });
    s = coachReduce(s, COACH_EVENTS.pixelsLoose);
    expect(s.active).toBe("sweep");
    s = coachReduce(s, COACH_EVENTS.pixelsGrabbed);
    expect(s).toEqual({ active: null, done: ["fling", "sweep"] });
  });

  it("ignores unknown events without allocating a new state", () => {
    const s = { active: "fling", done: [] };
    expect(coachReduce(s, "combo:x3")).toBe(s);
  });

  it("pause and run end hide the hint without completing it", () => {
    let s = coachReduce({ active: null, done: [] }, COACH_EVENTS.runStart);
    s = coachReduce(s, COACH_EVENTS.pause);
    expect(s).toEqual({ active: null, done: [] });
    s = coachReduce(coachReduce(s, COACH_EVENTS.runStart), COACH_EVENTS.runEnd);
    expect(s).toEqual({ active: null, done: [] });
  });

  it("persists completed hints and is fed by window events", () => {
    const c = createCoach();
    const unbind = bindCoachToWindow(c);
    let calls = 0;
    const unsub = c.subscribe(() => calls++);
    emitCoachEvent("run:start");
    expect(c.current()?.id).toBe("fling");
    c.dismiss();
    expect(c.getSnapshot()).toEqual({ active: null, done: ["fling"] });
    expect(readProgress().coachDone).toEqual(["fling"]);
    expect(calls).toBe(2);
    unsub();
    unbind();
    emitCoachEvent("pixels:loose");
    expect(c.getSnapshot().active).toBeNull();
    // A fresh coach loads the stored progress: the fling hint does not come back.
    const again = createCoach();
    again.emit("run:start");
    expect(again.getSnapshot().active).toBeNull();
    const temp = createCoach({ persist: false });
    temp.emit("run:start");
    expect(temp.getSnapshot().active).toBe("fling");
  });
});
