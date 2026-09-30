/**
 * Public face of the sim (architecture §2.1): `createSim`, `replay`, the render `view()`, the state `hash()` and the run
 * `summary()`. The server verifies a run by `replay(cfg, decodeInputs(log)).finalHash === claimed.finalHash`.
 */
import {
  type CreateSim,
  type Replay,
  RUN_TICKS,
  type RunSummary,
  type Sim,
  type SimConfig,
  type SimEvent,
  type SimInput,
  type SimView,
} from "../sim-types.js";
import { validateInputs } from "./codec.js";
import { isTelegraphing } from "./creatures.js";
import { Hasher } from "./hash.js";
import * as T from "./tuning.js";
import { World } from "./world.js";

/** Version of the simulation rules; bump with every rule/tuning change that alters hashes. Mixed into every hash. */
export const SIM_VERSION = 2;

/** Hash of the complete world state (16 hex chars). Equal worlds hash equal; any divergence changes it. */
export function hashWorld(w: World): string {
  const h = new Hasher();
  h.u32(SIM_VERSION);
  h.u32(w.tick);
  h.bool(w.done);
  h.u32(w.endReason);
  h.f64(w.score);
  h.u32(w.chain);
  h.u32(w.combo);
  h.u32(w.smashed);
  h.u32(w.recovered);
  h.u32(w.lostRun);
  h.u32(w.persisted);
  h.u32(w.ringouts);
  for (const r of [w.rngSpawn, w.rngBite, w.rngAi, w.rngGulp, w.rngWorld]) for (const s of r.state()) h.u32(s);
  for (let i = 0; i < 256; i += 4) {
    const s = w.pixels.slot;
    h.u32((s[i] ?? 0) | ((s[i + 1] ?? 0) << 8) | ((s[i + 2] ?? 0) << 16) | ((s[i + 3] ?? 0) << 24));
    const hf = w.pixels.half;
    const c = w.pixels.cracks;
    h.u32(
      (hf[i] ?? 0) | ((hf[i + 1] ?? 0) << 1) | ((hf[i + 2] ?? 0) << 2) | ((hf[i + 3] ?? 0) << 3) | ((c[i] ?? 0) << 8),
    );
  }
  h.u32(w.bodies.length);
  for (const b of w.bodies) {
    h.f64(b.x);
    h.f64(b.z);
    h.f64(b.vx);
    h.f64(b.vz);
    h.u32(b.shape.count);
  }
  h.bool(w.split);
  h.u32(w.mergeStill);
  h.u32(w.cooldownUntil);
  h.u32(w.invulnUntil);
  h.u32(w.ringout());
  h.u32(w.ringTicks());
  h.u32(w.hover);
  h.bool(w.hoverPushOn);
  h.u32(w.hoverPushAng);
  h.bool(w.steerOn);
  h.u32(w.steerDir);
  h.u32(w.lastFlingTick);
  h.u32(w.lastFlingPow);
  const f = w.fling;
  h.bool(f.active);
  h.u32(f.start);
  h.u32(f.kills);
  h.u32(f.hookTotal);
  h.u32(f.hookDone);
  h.bool(f.kept);
  h.u32(w.whiffAt);
  h.u32(w.nextBiteId);
  h.u32(w.openBites.length);
  for (const ob of w.openBites) {
    h.u32(ob.id);
    h.u32(ob.left);
    h.bool(ob.lost);
    h.u32(ob.chain);
  }
  h.u32(w.debris.length);
  for (const d of w.debris) {
    h.u32(d.pid);
    h.f64(d.x);
    h.f64(d.y);
    h.f64(d.z);
    h.f64(d.vx);
    h.f64(d.vy);
    h.f64(d.vz);
    h.u32(d.left);
    h.u32(d.window);
    h.u32(d.age);
    h.u32(d.carriedBy);
    h.u32(d.claimedBy);
    h.u32((d.boosted ? 1 : 0) | (d.ponded ? 2 : 0));
    h.u32(d.bite);
  }
  h.u32(w.creatures.length);
  h.u32(w.nextCreatureId);
  for (const c of w.creatures) {
    h.u32(c.id);
    h.u32(c.kind);
    h.f64(c.x);
    h.f64(c.z);
    h.f64(c.y);
    h.f64(c.vx);
    h.f64(c.vz);
    h.u32(c.facing);
    h.u32(c.state);
    h.u32(c.t);
    h.u32(c.hp);
    h.u32(c.stun);
    h.u32(c.spawn);
    h.u32(c.target);
    h.u32(c.hops);
    h.u32(c.hopsPlanned);
    h.f64(c.hx0);
    h.f64(c.hz0);
    h.f64(c.hx1);
    h.f64(c.hz1);
    h.u32(c.aux);
    h.u32(c.aux2);
    h.bool(c.banked);
    h.u32(c.hitCd);
    h.u32(c.trailCd);
  }
  h.f64(w.spawnBank);
  h.u32(w.nextKind);
  const g = w.gulp;
  h.u32(g.phase);
  h.u32(g.mood);
  h.u32(g.lit);
  h.u32(g.teethHit);
  h.bool(g.burped);
  h.u32(g.inhaleStart);
  h.u32(g.inhaleEnd);
  for (const t of g.teeth) h.bool(t.hit);
  h.u32(w.island.wedgeDir);
  h.u32((w.island.wedgeOn ? 1 : 0) | (w.island.wedgeShadow ? 2 : 0));
  h.u32(w.crumbs.length);
  for (const c of w.crumbs) {
    h.f64(c.x);
    h.f64(c.z);
    h.u32(c.left);
  }
  h.u32(w.lastTrailSample);
  h.u32(w.trail.length);
  for (const p of w.trail) {
    h.f64(p.x);
    h.f64(p.z);
    h.u32(p.expires);
  }
  h.f64(w.windX);
  h.f64(w.windZ);
  return h.hex();
}

/** Builds the render snapshot of `w` (fresh objects; safe to keep). */
export function viewWorld(w: World): SimView {
  const readyNow =
    w.inPlay() &&
    w.hover === 0 &&
    !w.done &&
    w.tick >= w.cooldownUntil &&
    w.tick >= T.DROP_IN_LOCK &&
    w.bodies.every((b) => w.speed(b) < T.READY_THRESHOLD);
  const safety = w.persisted >= w.scarAllowance;
  return {
    tick: w.tick,
    score: w.score,
    done: w.done,
    phase: w.wavePhase(),
    arena: {
      name: w.island.name,
      a: w.island.a,
      b: w.island.b,
      bumpers: w.island.bumpers.map((b) => ({ x: b.x, z: b.z, r: b.r, active: b.active })),
      pondA: w.island.def.pondA,
      pondB: w.island.def.pondB,
      windX: w.windX,
      windZ: w.windZ,
    },
    friend: {
      bodies: w.bodies.map((b) => ({
        x: b.x,
        z: b.z,
        vx: b.vx,
        vz: b.vz,
        cx: b.shape.cx,
        cz: b.shape.cz,
        maxRow: b.shape.maxRow,
        r: b.shape.r,
        mass: b.shape.count,
        flying: w.speed(b) >= T.FLY_THRESHOLD,
      })),
      pixels: w.pixels.slot.slice(),
      half: w.pixels.half.slice(),
      gold: w.pixels.gold.slice(),
      cracks: w.pixels.cracks.slice(),
      ready: readyNow,
      invulnerable: w.tick < w.invulnUntil,
      ringout: w.ringout(),
      ringTicks: w.ringTicks(),
      hover: w.hover,
      combo: w.combo,
      chain: w.chain,
      familyId: w.familyId,
      heavySide: w.heavySide,
    },
    debris: w.debris.map((d) => ({
      pid: d.pid,
      x: d.x,
      y: d.y,
      z: d.z,
      vx: d.vx,
      vy: d.vy,
      vz: d.vz,
      left: d.left,
      window: d.window,
      carriedBy: d.carriedBy,
      safety,
    })),
    creatures: w.creatures.map((c) => ({
      id: c.id,
      kind: c.kind,
      x: c.x,
      y: c.y,
      z: c.z,
      vx: c.vx,
      vz: c.vz,
      facing: c.facing,
      state: c.state,
      stateTicks: c.t,
      telegraph: c.spawn === 0 && isTelegraphing(c),
      hp: c.hp,
      stun: c.stun,
      spawning: c.spawn,
    })),
    gulp: {
      phase: w.gulp.phase,
      mood: w.gulp.mood,
      wedgeDir: w.island.wedgeDir,
      wedgeHalf: w.island.wedgeHalf,
      wedgeOn: w.island.wedgeOn,
      shadow: w.island.wedgeShadow,
      teeth: w.gulp.teethOut()
        ? w.gulp.teeth.map((t, i) => ({ x: t.x, z: t.z, lit: w.gulp.lit === i, hit: t.hit }))
        : [],
      mouthX: w.gulp.mouthX,
      mouthZ: w.gulp.mouthZ,
    },
    crumbs: w.crumbs.map((c) => ({ x: c.x, z: c.z, left: c.left })),
    trail: w.trail.map((p) => ({ x: p.x, z: p.z, left: p.expires - w.tick })),
    stats: {
      recovered: w.recovered,
      smashed: w.smashed,
      lost: w.lostRun,
      persisted: w.persisted,
      scarAllowance: w.scarAllowance,
      ringouts: w.ringouts,
    },
  };
}

/** Summary of `w` as it stands (final once `w.done`). */
export function summarizeWorld(w: World): RunSummary {
  return {
    score: w.score,
    lostDelta: w.lostDelta(),
    recovered: w.recovered,
    smashed: w.smashed,
    ticks: w.tick,
    finalHash: hashWorld(w),
  };
}

class SimImpl implements Sim {
  private readonly w: World;

  constructor(cfg: SimConfig) {
    this.w = new World(cfg);
  }

  get tick(): number {
    return this.w.tick;
  }

  get done(): boolean {
    return this.w.done;
  }

  step(inputs: readonly SimInput[]): void {
    const t = this.w.tick;
    let own = true;
    for (const i of inputs) if (i.t !== t) own = false;
    // Only inputs stamped for this tick apply, exactly as `replay` would apply the recorded log.
    this.w.step(own ? inputs : inputs.filter((i) => i.t === t));
  }

  view(): SimView {
    return viewWorld(this.w);
  }

  drainEvents(): SimEvent[] {
    const e = this.w.events;
    this.w.events = [];
    return e;
  }

  hash(): string {
    return hashWorld(this.w);
  }

  summary(): RunSummary {
    return summarizeWorld(this.w);
  }
}

/** Builds a sim at tick 0; throws `RangeError` on an invalid config (unknown arena, malformed masks, familyId). */
export const createSim: CreateSim = (cfg) => new SimImpl(cfg);

/**
 * Headless full run: applies each input at its tick (the log must be tick-sorted, see `validateInputs`) until the run
 * ends, and returns its summary. Inputs stamped at or after the end are ignored. Events are not recorded (speed).
 */
export const replay: Replay = (cfg, inputs) => {
  validateInputs(inputs);
  const w = new World(cfg);
  w.recordEvents = false;
  const batch: SimInput[] = [];
  let i = 0;
  while (!w.done && w.tick < RUN_TICKS) {
    batch.length = 0;
    while (i < inputs.length && (inputs[i]?.t ?? Infinity) <= w.tick) {
      const inp = inputs[i++];
      if (inp && inp.t === w.tick) batch.push(inp);
    }
    w.step(batch);
  }
  return summarizeWorld(w);
};
