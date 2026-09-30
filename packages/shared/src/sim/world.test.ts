import { describe, expect, it } from "vitest";
import { popcount } from "../bitmap.js";
import { EDGE_FALL, EDGE_PIXELS, EDGE_RESPAWN, END_CRUMBLE, END_TIME, LOST_TIMEOUT } from "./events.js";
import { SLOT_BODY, SLOT_LOOSE, SLOT_LOST, SLOT_SAFE } from "./pixels.js";
import { blockConfig, eventsOf, fling, readyWorld, run } from "./testkit.js";
import * as T from "./tuning.js";
import { launchSpeed, slideDistance, stopTicks, World } from "./world.js";

describe("fling physics (GDD §2.3)", () => {
  it("a full fling at m = 70 launches at V_MAX and slides ≈ 30 u in ≈ 1.45 s (the GDD damping law)", () => {
    expect(launchSpeed(1023, 70)).toBe(70);
    expect(launchSpeed(1023, 96)).toBeCloseTo(70 * Math.sqrt(70 / 96), 10);
    expect(launchSpeed(1023, 20)).toBeCloseTo(70 * 1.35, 10);
    // dv/dt = −(10 + 1.8 v) integrates to ≈ 30.8 u / 1.45 s analytically (the GDD prose says ≈ 34 u / 1.6 s).
    expect(slideDistance(70, 1)).toBeGreaterThan(29);
    expect(slideDistance(70, 1)).toBeLessThan(31.5);
    expect(stopTicks(70, 1)).toBeGreaterThan(84);
    expect(stopTicks(70, 1)).toBeLessThan(90);
  });

  it("accepts a fling only when READY, past the drop-in and cooldown, and above the dead zone", () => {
    const w = new World(blockConfig());
    w.step([{ t: 0, k: 0, ang: 0, pow: 1023 }]);
    expect(w.speed(w.body(0))).toBe(0);
    run(w, 100);
    w.step([fling(w, 0, T.MIN_POW - 1)]);
    expect(w.speed(w.body(0))).toBe(0);
    w.step([fling(w, 0, 1023)]);
    const v = w.speed(w.body(0));
    expect(v).toBeGreaterThan(60);
    expect(eventsOf(w, "launch")).toHaveLength(1);
    w.step([fling(w, 2048, 1023)]);
    expect(w.body(0).vx).toBeGreaterThan(0);
  });

  it("slows under damping to a stop and becomes PREY again", () => {
    const w = readyWorld();
    run(w, 200, [fling(w, 1024, 600)]);
    expect(w.speed(w.body(0))).toBe(0);
    expect(w.isPrey(w.body(0))).toBe(true);
    expect(w.body(0).z).toBeGreaterThan(5);
  });

  it("steering creeps without ever becoming a weapon", () => {
    const w = readyWorld();
    w.step([{ t: w.tick, k: 1, dir: 0, on: 1 }]);
    let max = 0;
    for (let i = 0; i < 120; i++) {
      w.step([]);
      max = Math.max(max, w.speed(w.body(0)));
    }
    expect(w.body(0).x).toBeGreaterThan(3);
    expect(max).toBeLessThan(T.FLY_THRESHOLD);
    w.step([{ t: w.tick, k: 1, dir: 0, on: 0 }]);
    run(w, 60);
    expect(w.speed(w.body(0))).toBe(0);
  });
});

describe("ring-out (GDD §2.6)", () => {
  it("falls, loses 3 edge pixels, costs 50, respawns at the centre invulnerable", () => {
    const w = readyWorld();
    w.score = 100;
    w.body(0).x = 20;
    run(w, 100, [fling(w, 0, 1023)]);
    expect(eventsOf(w, "edge").map((e) => e.a)).toEqual([EDGE_FALL, EDGE_PIXELS, EDGE_RESPAWN]);
    expect(w.pixels.count(SLOT_LOST)).toBe(T.RINGOUT_PX);
    expect(w.ringouts).toBe(1);
    expect(w.score).toBe(100 + T.PTS_RINGOUT + 0);
    expect(w.body(0).x).toBe(0);
    expect(w.vulnerable()).toBe(w.tick >= w.invulnUntil);
  });
});

describe("loose pixels (GDD §2.5)", () => {
  it("are lost when the grab window runs out, and persist as scars", () => {
    const w = readyWorld();
    w.biteFriend(0, 2, 1, 0, 99, 0);
    expect(w.pixels.count(SLOT_LOOSE)).toBe(2);
    expect(eventsOf(w, "pixelOff")).toHaveLength(2);
    w.body(0).x = -25;
    run(w, T.GRAB_WINDOW + 2);
    expect(eventsOf(w, "pixelLost").map((e) => e.b)).toEqual([LOST_TIMEOUT, LOST_TIMEOUT]);
    expect(w.persisted).toBe(2);
    expect(popcount(w.lostDelta())).toBe(2);
  });

  it("are grabbed back by sweeping over them (+5, clutch +25)", () => {
    const w = readyWorld();
    w.biteFriend(0, 1, 1, 0, 99, 0);
    const d = w.debris[0];
    if (!d) throw new Error("no debris");
    d.x = 0;
    d.z = 0;
    d.vx = d.vz = 0;
    run(w, T.PICKUP_DELAY + 1);
    expect(eventsOf(w, "pixelBack")).toHaveLength(1);
    expect(w.pixels.count(SLOT_BODY)).toBe(80);
    expect(w.score).toBe(T.PTS_GRAB);
    w.biteFriend(0, 1, 1, 0, 99, 0);
    const c = w.debris[0];
    if (!c) throw new Error("no debris");
    c.x = 40;
    c.y = 0;
    run(w, 3);
    c.x = w.body(0).x;
    c.z = w.body(0).z;
    c.vx = c.vz = c.vy = 0;
    c.left = T.CLUTCH_LEFT;
    c.age = T.PICKUP_DELAY;
    w.step([]);
    expect(eventsOf(w, "pixelBack").at(-1)?.b).toBe(1);
    expect(w.score).toBe(T.PTS_GRAB + T.PTS_CLUTCH);
  });

  it("respect the per-run scar cap (safety stitches) and the persisted floor", () => {
    const small = blockConfig({ w: 5, h: 6 }); // N0 = 30 → cap 6, floor 15
    const w = readyWorld(small);
    expect(w.scarAllowance).toBe(6);
    const present = [...Array(256).keys()].filter((i) => w.pixels.slot[i] === SLOT_BODY);
    for (const pid of present.slice(0, 8)) w.losePixel(pid, 0, 0, 0);
    expect(w.pixels.count(SLOT_LOST)).toBe(6);
    expect(w.pixels.count(SLOT_SAFE)).toBe(2);
    expect(popcount(w.lostDelta())).toBe(6);
    w.step([]);
    expect(w.done).toBe(false);
    for (const pid of present.slice(8, 15)) w.losePixel(pid, 0, 0, 0);
    w.step([]);
    expect(w.done).toBe(true);
    expect(w.endReason).toBe(END_CRUMBLE);
    const atFloor = new World({
      ...small,
      friend: { ...small.friend, lost: blockConfig({ w: 5, h: 3 }).friend.front },
    });
    expect(atFloor.scarAllowance).toBe(0);
  });
});

describe("scoring (GDD §2.9)", () => {
  it("combo = kills in one fling, chain +0.1 per killing fling, whiff resets", () => {
    const w = readyWorld();
    for (const x of [8, 13, 18]) w.addCreature(T.NIB, x, 0, 0);
    run(w, 25, [fling(w, 0, 1023)]);
    expect(eventsOf(w, "smash").map((e) => e.b)).toEqual([10, 20, 30]);
    expect(eventsOf(w, "combo").map((e) => e.a)).toEqual([2, 3]);
    run(w, 120);
    expect(w.chain).toBe(11);
    run(w, 30, [fling(w, 2048, 600)]);
    run(w, 120);
    expect(w.chain).toBe(10);
  });

  it("the run ends at 60 s with the survival and flawless bonuses", () => {
    const w = new World(blockConfig({ seed: 3 }));
    w.invulnUntil = 1e9;
    while (!w.done) w.step([]);
    expect(w.tick).toBe(3600);
    expect(w.endReason).toBe(END_TIME);
    expect(eventsOf(w, "end")).toHaveLength(1);
    expect(w.lostRun).toBe(0);
    expect(w.score).toBe(T.PTS_SURVIVAL + T.PTS_FLAWLESS);
    const hash = w.tick;
    w.step([]);
    expect(w.tick).toBe(hash);
  });
});

describe("spawning (GDD §3.9)", () => {
  it("follows the wave windows, caps and Last Light", () => {
    const w = new World(blockConfig({ seed: 11 }));
    w.invulnUntil = 1e9;
    const kindsBefore20 = new Set<number>();
    let maxAlive = 0;
    while (!w.done) {
      w.step([]);
      if (w.tick < T.WAVE1_START) expect(w.creatures).toHaveLength(0);
      if (w.tick < T.WAVE2_START) for (const c of w.creatures) kindsBefore20.add(c.kind);
      maxAlive = Math.max(maxAlive, w.creatures.length);
      if (w.tick === T.LAST_LIGHT_START + 1) {
        const n = eventsOf(w, "spawn").length;
        run(w, 60);
        expect(eventsOf(w, "spawn").length).toBe(n);
      }
    }
    expect([...kindsBefore20].every((k) => k === T.NIB || k === T.POGO)).toBe(true);
    expect(maxAlive).toBeLessThanOrEqual(14);
    expect(eventsOf(w, "spawn").length).toBeGreaterThan(20);
  });
});
