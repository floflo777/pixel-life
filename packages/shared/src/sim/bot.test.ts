import { describe, expect, it } from "vitest";
import { BOT_PROFILES, createBot } from "./bot.js";
import { angleDelta } from "./fixed-math.js";
import { viewWorld } from "./sim.js";
import { readyWorld } from "./testkit.js";
import * as T from "./tuning.js";

describe("bot shot planner (balance bots, GDD §9.7)", () => {
  it("the expert lines up a combo through three creatures rather than the nearest lone one", () => {
    const w = readyWorld();
    w.creatures = [];
    for (const x of [9, 14, 19]) w.addCreature(T.NIB, x, 0, 0);
    w.addCreature(T.NIB, 0, -8, 0);
    const out = createBot(BOT_PROFILES.expert, 1).decide(viewWorld(w));
    const f = out.find((i) => i.k === 0);
    expect(f?.k).toBe(0);
    if (f?.k !== 0) return;
    expect(Math.abs(angleDelta(0, f.ang))).toBeLessThanOrEqual(BOT_PROFILES.expert.aimNoise + 16);
    expect(f.t).toBe(w.tick + BOT_PROFILES.expert.reaction);
  });

  it("never plans a fling whose slide ends off the island", () => {
    const w = readyWorld();
    w.creatures = [];
    // A lone creature just inside the rim: reaching it at FLYING speed would carry the Friend over the edge.
    w.body(0).x = 20;
    w.addCreature(T.NIB, 33, 0, 0);
    const out = createBot(BOT_PROFILES.expert, 2).decide(viewWorld(w));
    for (const i of out) if (i.k === 0) expect(Math.abs(angleDelta(0, i.ang))).toBeGreaterThan(400);
  });
});
