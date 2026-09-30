import { describe, expect, it } from "vitest";
import { TRAIT_MERGE, TRAIT_QUAKE, TRAIT_SPLIT, EDGE_HOVER } from "./events.js";
import { NIB_BOWING } from "./creatures.js";
import { SLOT_BODY } from "./pixels.js";
import { blockConfig, eventsOf, fling, readyWorld, run } from "./testkit.js";
import { trait, TRAITS } from "./traits.js";
import * as T from "./tuning.js";
import { angleOf } from "./fixed-math.js";

const fam = (familyId: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) => readyWorld(blockConfig({ familyId }));

describe("family traits (GDD §4)", () => {
  it("has one parameter set per family", () => {
    expect(TRAITS).toHaveLength(9);
    expect(() => trait(9)).toThrow(RangeError);
  });

  it("Skeleton: 3 s window and loose pixels crawl home", () => {
    const w = fam(0);
    w.biteFriend(0, 1, 1, 0, 99, 0);
    expect(w.debris[0]?.window).toBe(T.GRAB_WINDOW_SKELETON);
    const d = w.debris[0];
    if (!d) throw new Error();
    w.body(0).x = -20;
    run(w, 80);
    const before = Math.abs(d.x - w.body(0).x);
    run(w, 40);
    expect(Math.abs(d.x - w.body(0).x)).toBeLessThan(before);
  });

  it("Mask: a fling released just before a bite lands parries it (+50, stun)", () => {
    const w = fam(1);
    const c = w.addCreature(T.NIB, 7, 0, 0);
    w.step([]);
    expect(c.state).toBe(NIB_BOWING);
    while (c.t > 3) w.step([]);
    run(w, 5, [fling(w, 2048, 500)]);
    expect(eventsOf(w, "parry")).toHaveLength(1);
    expect(eventsOf(w, "bite")).toHaveLength(0);
    expect(c.stun).toBeGreaterThan(0);
    expect(w.score).toBe(T.PTS_PARRY);
  });

  it("Family: double magnet reach", () => {
    expect(trait(2).magnetMult).toBe(2);
    expect(trait(1).magnetMult).toBe(1);
  });

  it("Cellular: a p ≥ 0.9 fling splits into two halves that re-merge", () => {
    const w = fam(3);
    run(w, 2, [fling(w, 0, 1023)]);
    expect(w.bodies).toHaveLength(2);
    expect(eventsOf(w, "trait").some((e) => e.b === TRAIT_SPLIT)).toBe(true);
    run(w, 300);
    expect(w.bodies).toHaveLength(1);
    expect(eventsOf(w, "trait").some((e) => e.b === TRAIT_MERGE)).toBe(true);
    expect(w.body(0).shape.count).toBe(80);
    const v = fam(3);
    run(v, 2, [fling(v, 0, 800)]);
    expect(v.bodies).toHaveLength(1);
  });

  it("Asymmetry: the fling curves toward the heavy side", () => {
    const w = fam(4);
    run(w, 30, [fling(w, 0, 900)]);
    const heading = angleOf(w.body(0).vx, w.body(0).vz);
    expect(w.heavySide).toBe(1);
    expect(heading).toBeGreaterThan(100);
    expect(heading).toBeLessThan(400);
  });

  it("Hoverer: hovers instead of falling and can push back", () => {
    const w = fam(5);
    w.body(0).x = 30;
    run(w, 1, [fling(w, 0, 350)]);
    for (let i = 0; i < 60 && eventsOf(w, "edge").length === 0; i++) w.step([]);
    expect(eventsOf(w, "edge")[0]?.a).toBe(EDGE_HOVER);
    w.step([{ t: w.tick, k: 1, dir: 2048, on: 1 }]);
    run(w, 80);
    expect(w.ringouts).toBe(0);
  });

  it("Colossus: a strong fling ends in a stomp that pops small creatures", () => {
    const w = fam(6);
    const nib = w.addCreature(T.NIB, 5, 0, 0);
    w.fling.active = true;
    w.fling.quake = true;
    w.endFling();
    expect(eventsOf(w, "trait").some((e) => e.b === TRAIT_QUAKE)).toBe(true);
    expect(nib.dead).toBe(true);
  });

  it("Sparkling: the trail pops creatures that cross it", () => {
    const w = fam(7);
    run(w, 12, [fling(w, 0, 1023)]);
    expect(w.trail.length).toBeGreaterThan(0);
    const p = w.trail[0];
    if (!p) throw new Error();
    w.addCreature(T.NIB, p.x, p.z + 1, 0);
    w.step([]);
    expect(eventsOf(w, "smash")).toHaveLength(1);
  });

  it("Hollow: pops cost no speed", () => {
    const speedAfterPop = (familyId: 2 | 8): number => {
      const w = fam(familyId);
      w.addCreature(T.NIB, 9, 0, 0);
      w.step([fling(w, 0, 1023)]);
      let before = 0;
      while (eventsOf(w, "smash").length === 0) {
        before = w.speed(w.body(0));
        w.step([]);
      }
      return w.speed(w.body(0)) / before;
    };
    expect(speedAfterPop(8)).toBeGreaterThan(0.95);
    expect(speedAfterPop(2)).toBeLessThan(0.92);
  });

  it("trait effects never touch pixels they do not own", () => {
    for (let f = 0; f < 9; f++) {
      const w = readyWorld(blockConfig({ familyId: f as 0 }));
      run(w, 200, [fling(w, 1024, 1023)]);
      expect(w.pixels.count(SLOT_BODY) + w.lostRun + w.debris.length).toBe(80);
    }
  });
});
