import { describe, expect, it } from "vitest";
import { isSubset, popcount } from "../bitmap.js";
import { runScarCap } from "../friend.js";
import type { SimEventType, SimInput } from "../sim-types.js";
import { BOT_PROFILES, playBot } from "./bot.js";
import { createSim, replay } from "./sim.js";
import { blockConfig } from "./testkit.js";

const EVENT_TYPES: readonly SimEventType[] = [
  "hit",
  "bite",
  "pixelOff",
  "pixelBack",
  "pixelLost",
  "smash",
  "edge",
  "end",
  "spawn",
  "despawn",
  "telegraph",
  "launch",
  "combo",
  "chain",
  "gulp",
  "parry",
  "glance",
  "trait",
  "steal",
  "yank",
  "explode",
  "crumb",
  "phase",
];

function scripted(): SimInput[] {
  const out: SimInput[] = [];
  for (let t = 80; t < 3600; t += 47) out.push({ t, k: 0, ang: (t * 97) % 4096, pow: 300 + ((t * 13) % 700) });
  return out;
}

describe("createSim / replay", () => {
  it("rejects invalid configs", () => {
    const cfg = blockConfig();
    expect(() => createSim({ ...cfg, arena: "nowhere" })).toThrow(RangeError);
    expect(() => createSim({ ...cfg, seed: 1.5 })).toThrow(RangeError);
    expect(() => createSim({ ...cfg, friend: { ...cfg.friend, front: "xyz" } })).toThrow(RangeError);
    expect(() => createSim({ ...cfg, friend: { ...cfg.friend, familyId: 9 as 0 } })).toThrow(RangeError);
  });

  it("is deterministic: equal configs and inputs give equal hashes every tick; seeds differ", () => {
    const a = createSim(blockConfig({ seed: 9 }));
    const b = createSim(blockConfig({ seed: 9 }));
    const c = createSim(blockConfig({ seed: 10 }));
    const log = scripted();
    let i = 0;
    let diverged = false;
    while (!a.done) {
      const now: SimInput[] = [];
      while (i < log.length && log[i]?.t === a.tick) now.push(log[i++] as SimInput);
      a.step(now);
      b.step(now.map((x) => ({ ...x })));
      c.step(now.map((x) => ({ ...x, t: c.tick })));
      expect(a.hash()).toBe(b.hash());
      if (a.hash() !== c.hash()) diverged = true;
    }
    expect(diverged).toBe(true);
    expect(replay(blockConfig({ seed: 9 }), log)).toEqual(a.summary());
  });

  it("applies only inputs stamped for the current tick (exactly what replay applies)", () => {
    const a = createSim(blockConfig());
    for (let i = 0; i < 100; i++) a.step([]);
    const h = a.hash();
    const b = createSim(blockConfig());
    for (let i = 0; i < 100; i++) b.step([]);
    b.step([{ t: 5, k: 0, ang: 0, pow: 1023 }]);
    a.step([]);
    expect(b.hash()).toBe(a.hash());
    expect(h).not.toBe(a.hash());
  });

  it("replays a live bot run exactly, ignores inputs after the end, and rejects unsorted logs", () => {
    const cfg = blockConfig({ seed: 21, familyId: 3 });
    const live = playBot(cfg, BOT_PROFILES.average, 4);
    expect(replay(cfg, live.inputs)).toEqual(live.summary);
    expect(replay(cfg, [...live.inputs, { t: 9999, k: 0, ang: 0, pow: 1023 }])).toEqual(live.summary);
    expect(() =>
      replay(cfg, [
        { t: 5, k: 0, ang: 0, pow: 900 },
        { t: 1, k: 0, ang: 0, pow: 900 },
      ]),
    ).toThrow(RangeError);
  });

  it("summaries stay within the per-run cap and the front mask", () => {
    for (let s = 0; s < 12; s++) {
      const cfg = blockConfig({ seed: s, familyId: (s % 9) as 0 });
      const sum = replay(cfg, scripted());
      expect(isSubset(sum.lostDelta, cfg.friend.front)).toBe(true);
      expect(popcount(sum.lostDelta)).toBeLessThanOrEqual(runScarCap(popcount(cfg.friend.front)));
      expect(sum.finalHash).toMatch(/^[0-9a-f]{16}$/);
      expect(sum.ticks).toBeLessThanOrEqual(3600);
    }
  });

  it("views are immutable snapshots and events drain", () => {
    const sim = createSim(blockConfig({ seed: 4 }));
    for (let i = 0; i < 400; i++) sim.step(i === 100 ? [{ t: 100, k: 0, ang: 512, pow: 900 }] : []);
    const v = sim.view();
    const h = sim.hash();
    v.friend.pixels.fill(0);
    (v.friend.bodies[0] as { x: number }).x = 99;
    expect(sim.hash()).toBe(h);
    expect(sim.view().friend.pixels.some((p) => p === 1)).toBe(true);
    const ev = sim.drainEvents();
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) expect(EVENT_TYPES).toContain(e.type);
    expect(sim.drainEvents()).toEqual([]);
    expect(v.arena.a).toBe(36);
    expect(v.creatures.length).toBeGreaterThan(0);
  });
});
