import { describe, expect, it } from "vitest";
import { runSummarySchema } from "../../protocol.js";
import type { SimInput } from "../../sim-types.js";
import { decodeInputs, encodeInputs } from "../../sim/codec.js";
import { fullTests, HEAVY_TIMEOUT_MS } from "../../sim/testkit.js";
import { chooseShot } from "./bot.js";
import { cellIndex, cellKey, generateCourse, TEMPLATE_COUNT, templateSpec, buildHole } from "./course.js";
import { createPuttSim, puttScore, replayPutt, type PuttEvent, type PuttSim } from "./sim.js";
import { PUTT, PUTT_SCORE_BASE } from "./tuning.js";
import botSrc from "./bot.ts?raw";
import courseSrc from "./course.ts?raw";
import indexSrc from "./index.ts?raw";
import simSrc from "./sim.ts?raw";
import tuningSrc from "./tuning.ts?raw";

/** Plays a whole round with the search bot; returns the input log and every event. */
function botRound(seed: number): { sim: PuttSim; inputs: SimInput[]; events: PuttEvent[] } {
  const sim = createPuttSim({ seed, kind: "daily" });
  const inputs: SimInput[] = [];
  const events: PuttEvent[] = [];
  let guard = 0;
  while (!sim.done && guard++ < PUTT.maxTicks) {
    const v = sim.view();
    let batch: SimInput[] = [];
    if (v.ready) {
      const shot = chooseShot(sim);
      if (!shot) throw new Error("bot found no shot while ready");
      for (let i = 0; i < shot.wait; i++) {
        sim.step();
        events.push(...sim.drainEvents());
      }
      batch = [{ t: sim.tick, k: 0, ang: shot.ang, pow: shot.pow }];
      inputs.push(...batch);
    }
    sim.step(batch);
    events.push(...sim.drainEvents());
  }
  return { sim, inputs, events };
}

const onSurface = (cells: readonly number[], x: number, z: number): boolean =>
  cells.includes(cellKey(cellIndex(x), cellIndex(z)));

describe("pixel putt course", () => {
  it("is a pure function of the seed: 9 holes, easy to hard, pars 2–4", () => {
    for (const seed of [0, 1, 7, 42, -5, 2 ** 31 - 1]) {
      const a = generateCourse(seed);
      expect(generateCourse(seed)).toEqual(a);
      expect(a.holes).toHaveLength(PUTT.holes);
      const tiers = a.holes.map((h) => h.tier);
      expect([...tiers].sort()).toEqual(tiers);
      expect(new Set(a.holes.map((h) => h.name)).size).toBe(PUTT.holes);
      for (const h of a.holes) {
        expect(h.par).toBeGreaterThanOrEqual(2);
        expect(h.par).toBeLessThanOrEqual(4);
      }
      expect(a.par).toBe(a.holes.reduce((s, h) => s + h.par, 0));
    }
  });

  it("differs between seeds", () => {
    const names = (s: number): string =>
      generateCourse(s)
        .holes.map((h) => `${h.name}:${h.cup.z}`)
        .join("|");
    expect(names(1)).not.toBe(names(2));
  });

  it("puts every tee and cup on solid ground, clear of bumpers, in both mirror images", () => {
    for (let i = 0; i < TEMPLATE_COUNT; i++)
      for (const knobs of [
        [0, 0, 0, 0],
        [0.5, 0.5, 0.5, 0.5],
        [0.99, 0.99, 0.99, 0.99],
      ])
        for (const mirror of [false, true]) {
          const h = buildHole(templateSpec(i, knobs, mirror), 1);
          expect(onSurface(h.cells, h.tee.x, h.tee.z), `${h.name} tee`).toBe(true);
          expect(onSurface(h.cells, h.cup.x, h.cup.z), `${h.name} cup`).toBe(true);
          expect(h.rails.length).toBeGreaterThan(3);
          for (const b of h.bumpers ?? []) {
            expect(Math.hypot(b.x - h.cup.x, b.z - h.cup.z), `${h.name} cup vs bumper`).toBeGreaterThan(b.r + 1);
            expect(Math.hypot(b.x - h.tee.x, b.z - h.tee.z), `${h.name} tee vs bumper`).toBeGreaterThan(b.r + 1);
          }
        }
  });

  it("rails are axis-aligned runs on the lattice", () => {
    const h = generateCourse(3).holes[0];
    if (!h) throw new Error("no hole");
    for (const r of h.rails) {
      expect(r.ax === r.bx || r.az === r.bz).toBe(true);
      for (const v of [r.ax, r.az, r.bx, r.bz]) expect(Number.isInteger(v / PUTT.cell)).toBe(true);
    }
  });
});

/**
 * Daily seeds the search bot plays to the end. Locally all eight; on CI (without PL_FULL_TESTS=1) two seeds whose
 * courses between them use every template (the test checks that coverage, so a tuning change that breaks it fails
 * loudly: pick new seeds then).
 */
const ROUND_SEEDS = fullTests() ? [1, 2, 3, 4, 5, 6, 7, 8] : [2, 7];

// Bot rounds are CPU-heavy (a search per shot): give the whole block an explicit timeout for slow CI runners.
describe("pixel putt sim", { timeout: HEAVY_TIMEOUT_MS }, () => {
  it("replays a bot round bit-identically (live, replayPutt and through the binary codec)", () => {
    const { sim, inputs } = botRound(11);
    expect(sim.done).toBe(true);
    const live = sim.summary();
    const replayed = replayPutt({ seed: 11, kind: "daily" }, inputs);
    expect(replayed).toEqual(live);
    const decoded = decodeInputs(encodeInputs(inputs));
    expect(replayPutt({ seed: 11, kind: "daily" }, decoded).run.finalHash).toBe(live.run.finalHash);
    // A different seed with the same inputs is a different round.
    expect(replayPutt({ seed: 12, kind: "daily" }, inputs).run.finalHash).not.toBe(live.run.finalHash);
  });

  it("matches the golden hash for a fixed scripted round (update deliberately when tuning changes)", () => {
    const inputs: SimInput[] = [];
    for (let i = 0; i < 40; i++)
      inputs.push({ t: 30 + i * 200, k: 0, ang: (i * 331) & 4095, pow: 300 + ((i * 97) % 700) });
    const s = replayPutt({ seed: 20261001, kind: "daily" }, inputs);
    expect(s.run.finalHash).toMatchInlineSnapshot(`"8be9dd33680cf67a"`);
    expect(s.card).toMatchInlineSnapshot(`
      [
        8,
        8,
        8,
        8,
        8,
        8,
        8,
        8,
        8,
      ]
    `);
  });

  it("finishes every hole under the cap for a range of daily seeds (all templates are playable)", () => {
    const seen = new Set<string>();
    for (const seed of ROUND_SEEDS) {
      const { sim, events } = botRound(seed);
      for (const h of sim.course.holes) seen.add(h.name);
      const s = sim.summary();
      expect(s.card).toHaveLength(PUTT.holes);
      expect(events.filter((e) => e.type === "pickup")).toEqual([]);
      expect(events.filter((e) => e.type === "sink")).toHaveLength(PUTT.holes);
      expect(events.at(-1)?.type).toBe("end");
      expect(s.total).toBeLessThanOrEqual(s.par + 9);
    }
    expect(seen.size).toBe(TEMPLATE_COUNT);
  });

  it("reports a RunSummary the server accepts: no scars, strokes-ranked score", () => {
    const { sim } = botRound(5);
    const s = sim.summary();
    expect(runSummarySchema.safeParse(s.run).success).toBe(true);
    expect(s.run.lostDelta).toBe("0".repeat(64));
    expect(s.run.score).toBe(PUTT_SCORE_BASE - s.total);
    expect(s.holeInOnes).toBe(s.card.filter((c) => c === 1).length);
  });

  it("ignores flings while the ball is moving and counts one stroke per accepted fling", () => {
    const sim = createPuttSim({ seed: 9, kind: "free" });
    sim.step([{ t: 0, k: 0, ang: 0, pow: 400 }]);
    sim.step([{ t: 1, k: 0, ang: 2048, pow: 1000 }]);
    sim.step([{ t: 2, k: 1, dir: 0, on: 1 }]);
    const launches = sim.drainEvents().filter((e) => e.type === "launch");
    expect(launches).toHaveLength(1);
    expect(sim.view().strokes).toBe(1);
    expect(sim.view().ready).toBe(false);
  });

  it("picks the hole up at the stroke cap", () => {
    const sim = createPuttSim({ seed: 4, kind: "free" });
    const events: PuttEvent[] = [];
    // Minimum-power taps: each is a stroke that barely moves the ball.
    for (let i = 0; i < 2000 && sim.view().hole === 0; i++) {
      sim.step(sim.view().ready ? [{ t: sim.tick, k: 0, ang: 0, pow: 1 }] : []);
      events.push(...sim.drainEvents());
    }
    const pick = events.find((e) => e.type === "pickup");
    expect(pick).toMatchObject({ type: "pickup", hole: 0, strokes: PUTT.maxStrokes });
    expect(sim.view().card).toEqual([PUTT.maxStrokes]);
  });

  it("drops a too-soft shot into the gap: +1 stroke, back to where it was hit from", () => {
    // Find a seed whose course has "the gap"; tap straight at it softly from the tee after skipping to that hole.
    let seed = 1;
    while (!generateCourse(seed).holes.some((h) => h.name === "the gap")) seed++;
    const course = generateCourse(seed);
    const idx = course.holes.findIndex((h) => h.name === "the gap");
    const sim = createPuttSim({ seed, kind: "free" });
    // Burn the earlier holes with the bot.
    while (sim.view().hole < idx) {
      const shot = sim.view().ready ? chooseShot(sim) : null;
      if (shot) for (let i = 0; i < shot.wait; i++) sim.step();
      sim.step(shot ? [{ t: sim.tick, k: 0, ang: shot.ang, pow: shot.pow }] : []);
    }
    while (!sim.view().ready) sim.step();
    sim.drainEvents();
    const before = sim.view();
    const hole = course.holes[idx];
    if (!hole) throw new Error("no gap hole");
    // Aim straight at the far island (toward +x, the gap) with a soft putt that rolls into the void.
    const ang = 0;
    const o = sim.simulateShot(ang, 420);
    expect(o).toMatchObject({ fell: true, penalties: 1 });
    sim.step([{ t: sim.tick, k: 0, ang, pow: 420 }]);
    const events: PuttEvent[] = [];
    for (let i = 0; i < 900 && !sim.view().ready; i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["fall", "penalty", "reset"]));
    const after = sim.view();
    expect([after.ball.x, after.ball.z]).toEqual([before.ball.x, before.ball.z]);
    expect(after.strokes).toBe(before.strokes + 2);
  });

  it("charges one stroke for touching a Nib during a shot", () => {
    let seed = 1;
    while (!generateCourse(seed).holes.some((h) => h.name === "nib patrol")) seed++;
    const idx = generateCourse(seed).holes.findIndex((h) => h.name === "nib patrol");
    const sim = createPuttSim({ seed, kind: "free" });
    while (sim.view().hole < idx) {
      const shot = sim.view().ready ? chooseShot(sim) : null;
      if (shot) for (let i = 0; i < shot.wait; i++) sim.step();
      sim.step(shot ? [{ t: sim.tick, k: 0, ang: shot.ang, pow: shot.pow }] : []);
    }
    while (!sim.view().ready) sim.step();
    let hitNib = false;
    for (let wait = 0; wait < 200 && !hitNib; wait += 10) {
      const o = sim.simulateShot(0, 700, wait);
      if (o.penalties >= 1 && !o.fell) hitNib = true;
    }
    expect(hitNib).toBe(true);
  });

  it("previews and ghost shots have no side effects", () => {
    const sim = createPuttSim({ seed: 3, kind: "free" });
    sim.step();
    const h = sim.hash();
    const pts = sim.preview(0, 700, 45);
    expect(pts.length).toBeGreaterThan(5);
    sim.simulateShot(1024, 900, 30);
    expect(sim.hash()).toBe(h);
    expect(sim.drainEvents().filter((e) => e.type === "launch")).toEqual([]);
  });

  it("a scarred Friend flies farther (mass factor)", () => {
    const whole = createPuttSim({ seed: 3, kind: "free", friend: { total: 80, present: 80 } });
    const scarred = createPuttSim({ seed: 3, kind: "free", friend: { total: 80, present: 40 } });
    const reach = (s: PuttSim): number => {
      const pts = s.preview(0, 500, 12, 12);
      const p = pts.at(-1);
      return p ? p.x - s.view().ball.x : 0;
    };
    expect(reach(scarred)).toBeGreaterThan(reach(whole));
  });

  it("ends an idle round at the hard stop with every hole at the cap", () => {
    const sim = createPuttSim({ seed: 1, kind: "free" });
    for (let i = 0; i < PUTT.maxTicks + 5 && !sim.done; i++) sim.step();
    expect(sim.done).toBe(true);
    expect(sim.summary().card).toEqual(Array.from({ length: PUTT.holes }, () => PUTT.maxStrokes));
    expect(sim.summary().run.score).toBe(0);
  });

  it("score is strictly decreasing in strokes and never negative", () => {
    expect(puttScore(9)).toBeGreaterThan(puttScore(10));
    expect(puttScore(10_000)).toBe(0);
  });
});

describe("pixel putt determinism rules", () => {
  it("uses no engine-dependent maths or wall clock in its sources (same rules as packages/shared/src/sim)", () => {
    const banned =
      /Math\.(random|sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|sinh|cosh|tanh|expm1|log1p)\b|\bDate\b|\bperformance\b|\*\*/;
    const files: Record<string, string> = {
      "bot.ts": botSrc,
      "course.ts": courseSrc,
      "index.ts": indexSrc,
      "sim.ts": simSrc,
      "tuning.ts": tuningSrc,
    };
    for (const [f, text] of Object.entries(files)) {
      expect(text.length, f).toBeGreaterThan(100);
      const src = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(banned.exec(src)?.[0], f).toBeUndefined();
    }
  });
});
