import { describe, expect, it } from "vitest";
import { EMPTY_MASK, fromIndices, popcount, toIndices } from "../../bitmap.js";
import { FRIEND_FIXTURES, fixtureAppearance } from "../../__fixtures__/friends.js";
import { frontMask } from "../../friend.js";
import type { FamilyId } from "../../ids.js";
import { Rng } from "../../sim/rng.js";
import { blockMask } from "../../sim/testkit.js";
import { decodeSumoInputs, encodeSumoInputs, validateSumoInputs } from "./codec.js";
import { heavySideOf, Match, type Fighter, type Intent } from "./match.js";
import { createSumo, replaySumo } from "./sim.js";
import { SUMO_TRAITS, sumoTrait } from "./traits.js";
import * as T from "./tuning.js";
import { SumoFighterState, SumoPhase, SumoPx, type SumoConfig, type SumoInput } from "./types.js";

const IDLE: Intent = { move: false, dir: 0, charge: false };

function block(familyId: FamilyId = 2, w = 8, h = 10, lost = EMPTY_MASK) {
  return { front: blockMask(w, h), lost, familyId };
}

function cfgOf(seed = 1, fams: readonly FamilyId[] = [2, 2, 2, 2]): SumoConfig {
  return { seed, fighters: fams.map((f) => block(f)) };
}

function realCfg(seed: number): SumoConfig {
  const fighters = [0, 1, 2, 3].map((k) => {
    const fx = FRIEND_FIXTURES[(seed * 3 + k * 4) % FRIEND_FIXTURES.length];
    if (!fx) throw new Error("fixture");
    const a = fixtureAppearance(fx);
    return { front: frontMask(a), lost: EMPTY_MASK, familyId: a.familyId };
  });
  return { seed, fighters };
}

/** Steps a match until the fight starts (bots frozen unless `bots`). */
function fighting(cfg: SumoConfig, bots = false): Match {
  const m = new Match(cfg);
  m.botsActive = bots;
  while (m.phase !== SumoPhase.Fight) m.step(IDLE);
  return m;
}

function fighter(m: Match, i: number): Fighter {
  const f = m.fighters[i];
  if (!f) throw new Error(`no fighter ${i}`);
  return f;
}

/** Parks fighters (other than `keep`) out of the round so a test sees only its duel. */
function isolate(m: Match, keep: readonly number[]): void {
  for (const f of m.fighters) {
    if (keep.includes(f.idx)) continue;
    // One idle bystander stays in play at the back of the ring so a solo test does not end the round.
    if (keep.length === 1 && f.idx === 2) {
      f.x = 0;
      f.z = -T.RING_R0 + 8;
      continue;
    }
    f.state = SumoFighterState.Out;
    f.x = 500;
    f.z = 500;
  }
}

/** Holds a charge for `ticks` then releases it along `dir`, with fighter 0 as the player. */
function shoveTicks(m: Match, dir: number, ticks: number): void {
  for (let k = 0; k < ticks; k++) m.step({ move: false, dir, charge: true });
  m.step({ move: false, dir, charge: false });
}

/** Random-but-valid player log (charges and walks) for fuzzing. */
function randomLog(seed: number, until = T.MATCH_MAX_TICKS): SumoInput[] {
  const r = new Rng(seed, 9);
  const out: SumoInput[] = [];
  let t = 0;
  while (true) {
    t += 1 + r.int(40);
    if (t >= until) break;
    out.push({ t, move: r.int(2) as 0 | 1, dir: r.int(4096), charge: r.int(3) === 0 ? 1 : 0 });
  }
  return out;
}

describe("Bump Sumo traits", () => {
  it("has one trait per family, data-only", () => {
    expect(SUMO_TRAITS).toHaveLength(9);
    expect(sumoTrait(6).massMult).toBeGreaterThan(1);
    expect(sumoTrait(5).hover).toBe(true);
    expect(sumoTrait(8).lossMult).toBeLessThan(1);
    expect(() => sumoTrait(9)).toThrow(RangeError);
    expect(() => sumoTrait(-1)).toThrow(RangeError);
  });

  it("finds the Asymmetry heavy side from unmirrored pixels (ties go right)", () => {
    const px = new Uint8Array(256);
    px[3 * 16 + 2] = SumoPx.Body;
    expect(heavySideOf(px)).toBe(-1);
    px[3 * 16 + 13] = SumoPx.Body;
    expect(heavySideOf(px)).toBe(1);
  });
});

describe("Bump Sumo config", () => {
  it("rejects a wrong fighter count, level or an empty Friend", () => {
    expect(() => new Match({ seed: 1, fighters: [block(), block()] })).toThrow(RangeError);
    expect(() => new Match({ ...cfgOf(), botLevel: 3 })).toThrow(RangeError);
    const empty = { front: blockMask(2, 2), lost: blockMask(2, 2), familyId: 2 as FamilyId };
    expect(() => new Match({ seed: 1, fighters: [empty, block(), block(), block()] })).toThrow(RangeError);
  });

  it("starts from the scars a Friend walks in with (lighter, never re-scarred)", () => {
    const lost = fromIndices(toIndices(blockMask(8, 10)).slice(0, 20));
    const m = new Match({ seed: 1, fighters: [block(2, 8, 10, lost), block(), block(), block()] });
    expect(fighter(m, 0).present).toBe(60);
    expect(m.mass(fighter(m, 0))).toBeLessThan(m.mass(fighter(m, 1)));
    expect(fighter(m, 0).pixels.filter((p) => p === SumoPx.Scar)).toHaveLength(20);
  });
});

describe("Bump Sumo physics", () => {
  it("holds everyone on their pads during the ready beat", () => {
    const m = new Match(cfgOf());
    const x0 = fighter(m, 0).x;
    for (let i = 0; i < T.READY_TICKS - 1; i++) m.step({ move: true, dir: 0, charge: false });
    expect(m.phase).toBe(SumoPhase.Ready);
    expect(fighter(m, 0).x).toBe(x0);
    m.step(IDLE);
    expect(m.phase).toBe(SumoPhase.Fight);
  });

  it("walks up to the walking cap and no further", () => {
    const m = fighting(cfgOf());
    isolate(m, [0]);
    const f = fighter(m, 0);
    f.x = -20;
    f.z = 0;
    for (let i = 0; i < 60; i++) m.step({ move: true, dir: 0, charge: false });
    expect(f.vx).toBeGreaterThan(T.WALK_MAX * 0.8);
    expect(f.vx).toBeLessThanOrEqual(T.WALK_MAX + (T.MOVE_ACCEL * T.DT) / 1);
  });

  it("a shove knocks pixels off the contact side, and a lighter victim flies farther", () => {
    const run = (victimW: number) => {
      const m = fighting({ seed: 3, fighters: [block(), block(2, victimW, 10), block(), block()] });
      isolate(m, [0, 1]);
      const a = fighter(m, 0);
      const v = fighter(m, 1);
      a.x = -10;
      a.z = 0;
      v.x = 6;
      v.z = 0;
      shoveTicks(m, 0, T.CHARGE_TICKS);
      let peak = 0;
      const n0 = v.present;
      for (let i = 0; i < 20; i++) {
        m.step(IDLE);
        peak = Math.max(peak, v.vx);
      }
      return { peak, lost: n0 - v.present, v, m };
    };
    const heavy = run(10);
    const light = run(6);
    expect(heavy.lost).toBe(1 + T.HIT_PIXELS_P);
    expect(light.peak).toBeGreaterThan(heavy.peak * 1.15);
    // Hit from the left (attacker at −x): the knocked pixels are the victim's left-most columns.
    const loose = heavy.m.debris.filter((d) => d.owner === 1).map((d) => d.pid & 15);
    const cols = toIndices(blockMask(10, 10)).map((p) => p & 15);
    expect(Math.max(...loose)).toBeLessThanOrEqual(Math.min(...cols) + 2);
  });

  it("never knocks a Friend below its pixel floor", () => {
    const m = fighting(cfgOf(5));
    isolate(m, [0, 1]);
    const v = fighter(m, 1);
    for (let k = 0; k < 40; k++) {
      const a = fighter(m, 0);
      a.x = -10;
      a.z = 0;
      a.vx = 0;
      a.vz = 0;
      a.cooldownUntil = 0;
      v.x = 0;
      v.z = 0;
      v.vx = 0;
      v.vz = 0;
      v.stun = 0;
      m.debris = [];
      shoveTicks(m, 0, T.CHARGE_TICKS);
      for (let i = 0; i < 6; i++) m.step(IDLE);
    }
    expect(v.present).toBe(v.floor);
    expect(v.floor).toBe(Math.floor(v.total * T.PIXEL_FLOOR + 0.5));
  });

  it("a tap is a dodge that ignores shoves for a moment", () => {
    const m = fighting(cfgOf());
    isolate(m, [0]);
    const f = fighter(m, 0);
    m.step({ move: true, dir: 1024, charge: true });
    m.step({ move: true, dir: 1024, charge: false });
    expect(m.tick < f.dodgeUntil).toBe(true);
    expect(f.vz).toBeGreaterThan(T.DODGE_SPEED * 0.8);
  });

  it("picks up its own loose pixels and scores them for the player", () => {
    const m = fighting(cfgOf());
    isolate(m, [0]);
    const f = fighter(m, 0);
    f.x = 0;
    f.z = 0;
    const pid = toIndices(blockMask(8, 10))[0] ?? 0;
    f.pixels[pid] = SumoPx.Loose;
    f.present--;
    m.debris.push({
      owner: 0,
      pid,
      x: 1,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 0,
      left: T.LOOSE_TICKS,
      falling: false,
      kickCd: 0,
    });
    for (let i = 0; i < T.PICK_DELAY + 2; i++) m.step(IDLE);
    expect(f.pixels[pid]).toBe(SumoPx.Body);
    expect(f.grabbed).toBe(1);
    expect(m.score).toBe(T.SCORE_GRAB);
  });
});

describe("Bump Sumo ring-outs and traits", () => {
  it("rings out past the edge, credits the shover and ends the round", () => {
    const m = fighting(cfgOf());
    isolate(m, [0, 1]);
    const a = fighter(m, 0);
    const v = fighter(m, 1);
    a.x = T.RING_R0 - 22;
    a.z = 0;
    v.x = T.RING_R0 - 8;
    v.z = 0;
    shoveTicks(m, 0, T.CHARGE_TICKS);
    for (let i = 0; i < T.FALL_TICKS + 60 && m.phase === SumoPhase.Fight; i++) m.step(IDLE);
    expect(v.state).toBe(SumoFighterState.Out);
    expect(a.kos).toBe(1);
    expect(a.wins).toBe(1);
    expect(m.roundWinners).toEqual([0]);
    expect(m.score).toBe(T.SCORE_KO + T.SCORE_ROUND);
    expect(m.phase).toBe(SumoPhase.RoundEnd);
  });

  it("Hoverer hovers past the edge and can glide back in", () => {
    const m = fighting(cfgOf(1, [5, 2, 2, 2]));
    isolate(m, [0, 1]);
    const f = fighter(m, 0);
    f.x = T.RING_R0 + 0.5;
    f.z = 0;
    f.vx = 5;
    m.step({ move: true, dir: 2048, charge: false });
    expect(f.state).toBe(SumoFighterState.Hover);
    for (let i = 0; i < 40 && f.state === SumoFighterState.Hover; i++) m.step({ move: true, dir: 2048, charge: false });
    expect(f.state).toBe(SumoFighterState.Ring);
  });

  it("a plain Friend past the edge falls", () => {
    const m = fighting(cfgOf());
    isolate(m, [0, 1]);
    const f = fighter(m, 0);
    f.x = T.RING_R0 + 0.5;
    f.z = 0;
    m.step(IDLE);
    expect(f.state).toBe(SumoFighterState.Falling);
  });

  it("Mask parries a shove released just before the hit", () => {
    const m = fighting(cfgOf(1, [2, 1, 2, 2]));
    isolate(m, [0, 1]);
    const a = fighter(m, 0);
    const v = fighter(m, 1);
    a.x = -12;
    a.z = 0;
    v.x = 0;
    v.z = 0;
    for (let k = 0; k < T.CHARGE_TICKS; k++) m.step({ move: false, dir: 0, charge: true });
    v.lastReleaseTick = m.tick;
    m.step({ move: false, dir: 0, charge: false });
    for (let i = 0; i < 10; i++) m.step(IDLE);
    expect(v.present).toBe(v.total);
    expect(a.vx).toBeLessThan(0);
  });

  it("Colossus stomps at the end of a strong dash", () => {
    const m = fighting({ ...cfgOf(1, [6, 2, 2, 2]), seed: 2 });
    isolate(m, [0, 1]);
    const f = fighter(m, 0);
    const o = fighter(m, 1);
    f.x = -20;
    f.z = 0;
    o.x = 0;
    o.z = 12;
    m.recordEvents = true;
    shoveTicks(m, 0, T.CHARGE_TICKS * 2);
    for (let i = 0; i < 40; i++) m.step(IDLE);
    expect(m.events.some((e) => e.type === "quake" && e.a === 0)).toBe(true);
  });

  it("Hollow loses fewer pixels per hit", () => {
    const lostBy = (fam: FamilyId) => {
      const m = fighting({ seed: 4, fighters: [block(), block(fam), block(), block()] });
      isolate(m, [0, 1]);
      fighter(m, 0).x = -10;
      fighter(m, 0).z = 0;
      fighter(m, 1).x = 6;
      fighter(m, 1).z = 0;
      shoveTicks(m, 0, T.CHARGE_TICKS);
      for (let i = 0; i < 15; i++) m.step(IDLE);
      return fighter(m, 1).total - fighter(m, 1).present;
    };
    expect(lostBy(8)).toBeLessThan(lostBy(2));
  });
});

describe("Bump Sumo match", () => {
  it("plays three rounds, ranks the Friends and brings every pixel home (scarless)", () => {
    const sim = createSumo(realCfg(3));
    const types = new Set<string>();
    while (!sim.done) {
      sim.step([]);
      for (const e of sim.drainEvents()) types.add(e.type);
    }
    const v = sim.view();
    expect(v.roundWinners).toHaveLength(T.ROUNDS);
    expect(v.winner).toBeGreaterThanOrEqual(0);
    expect(v.phase).toBe(SumoPhase.Done);
    for (const f of v.fighters) {
      expect(f.present).toBe(f.total);
      expect([...f.pixels].some((p) => p === SumoPx.Loose || p === SumoPx.Gone)).toBe(false);
    }
    const s = sim.summary();
    expect(s.lostDelta).toBe(EMPTY_MASK);
    expect(popcount(s.lostDelta)).toBe(0);
    expect(s.ticks).toBeLessThanOrEqual(T.MATCH_MAX_TICKS);
    for (const t of ["ready", "fight", "shove", "hit", "pixelOff", "ringout", "roundEnd", "matchEnd"])
      expect(types.has(t)).toBe(true);
    expect(sim.stats().place).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic: live play and headless replay agree, seeds diverge", () => {
    for (const seed of [1, 2, 7]) {
      const cfg = realCfg(seed);
      const log = randomLog(seed);
      const sim = createSumo(cfg);
      let k = 0;
      while (!sim.done) {
        const batch: SumoInput[] = [];
        while (log[k] && (log[k]?.t ?? Infinity) <= sim.tick) {
          const i = log[k++];
          if (i && i.t === sim.tick) batch.push(i);
        }
        sim.step(batch);
      }
      const played = log.filter((i) => i.t < sim.tick);
      const replayed = replaySumo(cfg, played);
      expect(replayed).toEqual(sim.summary());
      expect(replaySumo(cfg, played).finalHash).toBe(replayed.finalHash);
      expect(replaySumo({ ...cfg, seed: seed + 100 }, played).finalHash).not.toBe(replayed.finalHash);
    }
  });

  it("always finishes within the match cap, whatever the player does", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = replaySumo(realCfg(seed), randomLog(seed * 31));
      expect(s.ticks).toBeLessThanOrEqual(T.MATCH_MAX_TICKS);
      expect(s.ticks).toBeGreaterThan(T.ROUNDS * (T.READY_TICKS + T.END_TICKS));
    }
  });

  it("round-trips the input log and refuses malformed ones", () => {
    const log = randomLog(5, 3000);
    const bytes = encodeSumoInputs(log);
    expect(bytes.length).toBe(1 + 4 * log.length);
    expect(decodeSumoInputs(bytes)).toEqual(log);
    expect(() => decodeSumoInputs(new Uint8Array([9]))).toThrow(RangeError);
    expect(() => decodeSumoInputs(bytes.slice(0, bytes.length - 1))).toThrow(RangeError);
    expect(() =>
      validateSumoInputs([
        { t: 3, move: 0, dir: 0, charge: 0 },
        { t: 3, move: 1, dir: 0, charge: 0 },
      ]),
    ).toThrow(RangeError);
    expect(() => validateSumoInputs([{ t: 0, move: 0, dir: 4096, charge: 0 }])).toThrow(RangeError);
    expect(() => validateSumoInputs([{ t: T.MATCH_MAX_TICKS, move: 0, dir: 0, charge: 0 }])).toThrow(RangeError);
  });
});
