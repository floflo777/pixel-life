/**
 * Public face of the Bump Sumo sim: `createSumo` (live, with events and views), `replaySumo` (headless, for a server
 * check), the state hash and the run summary in the shared `RunSummary` shape (always scarless: empty `lostDelta`).
 */
import { EMPTY_MASK } from "../../bitmap.js";
import type { RunSummary } from "../../sim-types.js";
import { Hasher } from "../../sim/hash.js";
import { validateSumoInputs } from "./codec.js";
import { Match, type Intent } from "./match.js";
import { MATCH_MAX_TICKS } from "./tuning.js";
import type { SumoConfig, SumoInput, SumoSim, SumoStats, SumoView } from "./types.js";

/** Version of the Bump Sumo rules; bump on any rule/tuning change that alters hashes. Mixed into every hash. */
export const SUMO_VERSION = 1;

/** Hash of the complete match state (16 hex chars). */
export function hashMatch(m: Match): string {
  const h = new Hasher();
  h.u32(SUMO_VERSION);
  h.u32(m.tick);
  h.u32(m.phase);
  h.u32(m.round);
  h.u32(m.phaseTicks + 1);
  h.f64(m.ringR);
  h.bool(m.done);
  h.u32(m.winner + 1);
  h.u32(m.score);
  for (const w of m.roundWinners) h.u32(w + 1);
  for (const r of [m.rngHit, m.rngDebris, ...m.rngBots]) for (const s of r.state()) h.u32(s);
  for (const f of m.fighters) {
    h.f64(f.x);
    h.f64(f.z);
    h.f64(f.vx);
    h.f64(f.vz);
    h.u32(f.facing);
    h.u32(f.state);
    h.u32(f.fallTicks);
    h.u32(f.hoverLeft);
    h.u32(f.chargeTicks);
    h.u32(f.armedTicks);
    h.f64(f.dashP);
    h.u32(f.cooldownUntil);
    h.u32(f.dodgeUntil);
    h.u32(f.stun);
    h.u32(f.stillTicks);
    h.u32(f.slickUntil);
    h.u32(f.lastHitBy + 1);
    h.u32(f.present);
    h.u32(f.wins);
    h.u32(f.kos);
    h.u32(f.grabbed);
    for (let i = 0; i < 256; i += 8) {
      let w = 0;
      for (let k = 0; k < 8; k++) w |= (f.pixels[i + k] ?? 0) << (k * 4);
      h.u32(w);
    }
  }
  for (const b of m.brains) {
    h.u32(b.target + 1);
    h.u32(b.think);
    h.u32(b.chargeGoal);
    h.u32(b.aimErr + 4096);
    h.u32(b.tap);
    h.u32(b.dodgeCd);
  }
  h.u32(m.debris.length);
  for (const d of m.debris) {
    h.u32(d.owner);
    h.u32(d.pid);
    h.f64(d.x);
    h.f64(d.y);
    h.f64(d.z);
    h.f64(d.vx);
    h.f64(d.vy);
    h.f64(d.vz);
    h.u32(d.left);
    h.bool(d.falling);
  }
  h.u32(m.trail.length);
  for (const p of m.trail) {
    h.f64(p.x);
    h.f64(p.z);
    h.u32(p.expires);
  }
  return h.hex();
}

/** Render snapshot of `m` (fresh objects; safe to keep). */
export function viewMatch(m: Match): SumoView {
  return {
    tick: m.tick,
    phase: m.phase,
    round: m.round,
    phaseTicks: m.phaseTicks < 0 ? 0 : m.phaseTicks,
    ringR: m.ringR,
    fighters: m.fighters.map((f) => ({
      x: f.x,
      z: f.z,
      vx: f.vx,
      vz: f.vz,
      facing: f.facing,
      state: f.state,
      fallTicks: f.fallTicks,
      charge: m.charge01(f),
      armed: f.armedTicks > 0,
      dodging: m.tick < f.dodgeUntil,
      braced: m.braced(f),
      slick: m.tick < f.slickUntil,
      stun: f.stun,
      present: f.present,
      total: f.total,
      mass: m.mass(f),
      radius: f.radius,
      familyId: f.familyId,
      heavySide: f.heavySide,
      wins: f.wins,
      kos: f.kos,
      pixels: f.pixels.slice(),
    })),
    debris: m.debris.map((d) => ({
      owner: d.owner,
      pid: d.pid,
      x: d.x,
      y: d.y,
      z: d.z,
      vx: d.vx,
      vz: d.vz,
      left: d.left,
      falling: d.falling,
    })),
    trail: m.trail.map((p) => ({ x: p.x, z: p.z, left: p.expires - m.tick })),
    roundWinners: m.roundWinners.slice(),
    winner: m.winner,
    score: m.score,
    done: m.done,
  };
}

/** Player (fighter 0) stats of `m`; `place` is 1-based in the current ranking. */
export function statsOf(m: Match): SumoStats {
  const f = m.fighters[0];
  const place = m.ranking().indexOf(0) + 1;
  return {
    place,
    wins: f?.wins ?? 0,
    kos: f?.kos ?? 0,
    grabbed: f?.grabbed ?? 0,
    knockedOff: f?.knockedOff ?? 0,
    ringouts: f?.ringouts ?? 0,
  };
}

/** Summary of `m` as it stands (final once done). `lostDelta` is always empty: Bump Sumo never scars. */
export function summarizeMatch(m: Match): RunSummary {
  const f = m.fighters[0];
  return {
    score: m.score,
    lostDelta: EMPTY_MASK,
    recovered: f?.grabbed ?? 0,
    smashed: f?.kos ?? 0,
    ticks: m.tick,
    finalHash: hashMatch(m),
  };
}

class SumoSimImpl implements SumoSim {
  private readonly m: Match;
  private readonly player: Intent = { move: false, dir: 0, charge: false };

  constructor(cfg: SumoConfig) {
    this.m = new Match(cfg);
  }

  get tick(): number {
    return this.m.tick;
  }

  get done(): boolean {
    return this.m.done;
  }

  step(inputs: readonly SumoInput[]): void {
    for (const i of inputs) {
      if (i.t !== this.m.tick) continue;
      this.player.move = i.move === 1;
      this.player.dir = i.dir;
      this.player.charge = i.charge === 1;
    }
    this.m.step(this.player);
  }

  view(): SumoView {
    return viewMatch(this.m);
  }

  drainEvents() {
    const e = this.m.events;
    this.m.events = [];
    return e;
  }

  hash(): string {
    return hashMatch(this.m);
  }

  summary(): RunSummary {
    return summarizeMatch(this.m);
  }

  stats(): SumoStats {
    return statsOf(this.m);
  }
}

/** Builds a match at tick 0; throws `RangeError` on an invalid config (fighter count, familyId, empty sprite). */
export function createSumo(cfg: SumoConfig): SumoSim {
  return new SumoSimImpl(cfg);
}

/**
 * Headless full match: applies each input at its tick until the match ends and returns its summary (the log must pass
 * `validateSumoInputs`). Equal `(cfg, inputs)` always give equal `finalHash`.
 */
export function replaySumo(cfg: SumoConfig, inputs: readonly SumoInput[]): RunSummary {
  validateSumoInputs(inputs);
  const m = new Match(cfg);
  m.recordEvents = false;
  const player: Intent = { move: false, dir: 0, charge: false };
  let k = 0;
  while (!m.done && m.tick < MATCH_MAX_TICKS) {
    const i = inputs[k];
    if (i && i.t === m.tick) {
      player.move = i.move === 1;
      player.dir = i.dir;
      player.charge = i.charge === 1;
      k++;
    }
    m.step(player);
  }
  return summarizeMatch(m);
}
