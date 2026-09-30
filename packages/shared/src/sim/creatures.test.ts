import { describe, expect, it } from "vitest";
import { FIZZ_PROJECTILE, NIB_BOWING } from "./creatures.js";
import { HIT_PLATE, LOST_SLURP, LOST_SNATCH } from "./events.js";
import { SLOT_LOOSE } from "./pixels.js";
import { eventsOf, fling, readyWorld, run } from "./testkit.js";
import * as T from "./tuning.js";

describe("Nib", () => {
  it("bows (telegraph) then bites 1 px when the Friend is PREY in range", () => {
    const w = readyWorld();
    const c = w.addCreature(T.NIB, 7, 0, 0);
    w.step([]);
    expect(c.state).toBe(NIB_BOWING);
    expect(eventsOf(w, "telegraph")).toHaveLength(1);
    run(w, T.NIB_BOW);
    expect(eventsOf(w, "bite")).toHaveLength(1);
    expect(w.pixels.count(SLOT_LOOSE) + w.recovered).toBe(1);
  });

  it("cannot bite an invulnerable Friend and dies to any FLYING contact", () => {
    const w = readyWorld();
    w.invulnUntil = w.tick + 1000;
    w.addCreature(T.NIB, 7, 0, 0);
    run(w, 60);
    expect(eventsOf(w, "bite")).toHaveLength(0);
    run(w, 20, [fling(w, 0, 900)]);
    expect(eventsOf(w, "smash").map((e) => e.b)).toEqual([10]);
  });
});

describe("Pogo", () => {
  it("crouches, hops and pounces for 1 px; an air pop scores ×2", () => {
    const w = readyWorld();
    w.addCreature(T.POGO, 15, 0, 0);
    run(w, T.POGO_CROUCH + T.POGO_HOP + 2);
    expect(eventsOf(w, "bite")).toHaveLength(1);
    const v = readyWorld();
    const p = v.addCreature(T.POGO, 20, 0, 0);
    run(v, T.POGO_CROUCH + 10);
    expect(p.y).toBeGreaterThan(0);
    run(v, 20, [fling(v, 0, 1023)]);
    expect(eventsOf(v, "smash").map((e) => e.b)).toEqual([30]);
  });
});

describe("Clank", () => {
  it("front plate: bounces a weak hit and costs 1 px; rear hits pop it", () => {
    const w = readyWorld();
    const c = w.addCreature(T.CLANK, 10, 0, 0);
    c.facing = 2048;
    run(w, 12, [fling(w, 0, 480)]);
    expect(eventsOf(w, "hit").some((e) => e.b === HIT_PLATE)).toBe(true);
    expect(eventsOf(w, "bite")).toHaveLength(1);
    expect(w.body(0).vx).toBeLessThan(0);
    const r = readyWorld();
    const d = r.addCreature(T.CLANK, 10, 0, 0);
    d.facing = 0;
    run(r, 12, [fling(r, 0, 700)]);
    expect(eventsOf(r, "smash").map((e) => e.b)).toEqual([40]);
  });

  it("a heavy fast hit cracks the shell head-on (+40)", () => {
    const w = readyWorld();
    const c = w.addCreature(T.CLANK, 12, 0, 0);
    c.facing = 2048;
    run(w, 12, [fling(w, 0, 1023)]);
    expect(eventsOf(w, "smash")).toHaveLength(1);
    expect(w.score).toBe(40 + T.PTS_SHELL_CRACK);
  });
});

describe("Fizz", () => {
  it("left alone it fuses and explodes: three 1-px bites", () => {
    const w = readyWorld();
    w.addCreature(T.FIZZ, 8, 0, 0);
    run(w, T.FIZZ_FUSE + 5);
    expect(eventsOf(w, "explode").map((e) => e.b)).toEqual([0]);
    expect(eventsOf(w, "bite")).toHaveLength(3);
  });

  it("hit while FLYING it is launched and explodes on a creature (FIZZ BANK), never hurting the Friend", () => {
    const w = readyWorld();
    const f = w.addCreature(T.FIZZ, 7, 0, 0);
    w.addCreature(T.NIB, 26, 3, 0);
    w.step([fling(w, 0, 1023)]);
    run(w, 4);
    expect(f.state === FIZZ_PROJECTILE || f.dead).toBe(true);
    run(w, 30);
    expect(eventsOf(w, "explode").map((e) => e.b)).toEqual([1]);
    expect(eventsOf(w, "smash").length).toBeGreaterThanOrEqual(2);
    expect(eventsOf(w, "bite")).toHaveLength(0);
  });
});

describe("Snatch and Slurp", () => {
  it("Snatch steals a loose pixel and carries it off the rim", () => {
    const w = readyWorld();
    w.biteFriend(0, 1, 1, 0, 99, 0);
    w.body(0).x = -25;
    w.addCreature(T.SNATCH, 0, 8, 0);
    run(w, 400);
    expect(eventsOf(w, "steal")).toHaveLength(1);
    expect(eventsOf(w, "pixelLost").map((e) => e.b)).toEqual([LOST_SNATCH]);
  });

  it("hitting a carrying Snatch drops the pixel with a fresh window", () => {
    const w = readyWorld();
    w.biteFriend(0, 1, 1, 0, 99, 0);
    w.body(0).x = -25;
    const s = w.addCreature(T.SNATCH, 0, 8, 0);
    for (let i = 0; i < 200 && eventsOf(w, "steal").length === 0; i++) w.step([]);
    w.body(0).x = s.x - 4;
    w.body(0).z = s.z;
    w.body(0).vx = 60;
    w.step([]);
    expect(s.dead).toBe(true);
    expect(eventsOf(w, "pixelLost")).toHaveLength(0);
    // Dropped right onto the Friend: either still loose with a fresh window, or already swept back.
    const d = w.debris[0];
    if (d) expect([d.carriedBy, d.left > T.SNATCH_DROP_WINDOW - 3]).toEqual([-1, true]);
    else expect(eventsOf(w, "pixelBack")).toHaveLength(1);
  });

  it("Slurp wakes, eats a loose pixel in reach, and takes two hits", () => {
    const w = readyWorld();
    w.addCreature(T.SLURP, -12, 0, 0);
    w.biteFriend(0, 1, -1, 0, 99, 0);
    w.body(0).x = 25;
    run(w, 90);
    expect(eventsOf(w, "pixelLost").map((e) => e.b)).toEqual([LOST_SLURP]);
    const v = readyWorld();
    const s = v.addCreature(T.SLURP, 12, 0, 0);
    run(v, 30, [fling(v, 0, 800)]);
    expect(s.hp).toBe(1);
    expect(s.dead).toBe(false);
    run(v, 120);
    v.body(0).x = s.x - 12;
    v.body(0).z = s.z;
    run(v, 30, [fling(v, 0, 900)]);
    expect(s.dead).toBe(true);
  });
});
