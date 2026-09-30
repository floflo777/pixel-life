/**
 * Headless bot player for balance runs (GDD §9.7): three skill profiles that differ by aim noise, power noise and
 * reaction time. The bot only reads `SimView` (like a player sees the screen) and emits `SimInput`s stamped `reaction`
 * ticks later. Deterministic (own sfc32 stream), so balance numbers are reproducible.
 */
import type { RunSummary, SimConfig, SimInput, SimView } from "../sim-types.js";
import { Island } from "./arena.js";
import { angleOf, cosA, degToAngle, sinA } from "./fixed-math.js";
import { Rng } from "./rng.js";
import { createSim } from "./sim.js";
import { trait } from "./traits.js";
import * as T from "./tuning.js";
import { launchSpeed, slideDistance, slideSpeedAt } from "./world.js";

/** A bot skill profile. */
export interface BotProfile {
  readonly name: string;
  /** Uniform aim error ± this integer angle. */
  readonly aimNoise: number;
  /** Relative power error ± this fraction. */
  readonly powNoise: number;
  /** Ticks between seeing the screen and the input landing: reaction time plus the time a drag-aim takes. */
  readonly reaction: number;
  /** Ticks between looks at the screen. */
  readonly thinkEvery: number;
  /** Chance (0..1) to notice a loose pixel / telegraph at each look (attention). */
  readonly attention: number;
  /** Lines up shots through several creatures (combo planning) and stages for Gulp's teeth. */
  readonly combos: boolean;
  /** Steers onto nearby loose pixels (the sweep); novices only fling at them. */
  readonly sweeps: boolean;
  /** Required distance between a planned landing point and the rim (u). */
  readonly rimMargin: number;
}

/**
 * The GDD §9.7 profiles: novice ±30° / 400 ms, average ±12° / 250 ms, expert ±4° / 150 ms reaction, each plus a drag-aim
 * time (novice 500 ms, average 300 ms, expert 150 ms) because a fling is a gesture, not a key press.
 */
export const BOT_PROFILES: Readonly<Record<"novice" | "average" | "expert", BotProfile>> = {
  novice: {
    name: "novice",
    aimNoise: degToAngle(30),
    powNoise: 0.25,
    reaction: 54,
    thinkEvery: 6,
    attention: 0.35,
    combos: false,
    sweeps: false,
    rimMargin: 3,
  },
  average: {
    name: "average",
    aimNoise: degToAngle(12),
    powNoise: 0.12,
    reaction: 33,
    thinkEvery: 4,
    attention: 0.8,
    combos: true,
    sweeps: true,
    rimMargin: 4,
  },
  expert: {
    name: "expert",
    aimNoise: degToAngle(4),
    powNoise: 0.05,
    reaction: 18,
    thinkEvery: 3,
    attention: 1,
    combos: true,
    sweeps: true,
    rimMargin: 6,
  },
};

/** A bot: look at a view, return inputs (stamped for future ticks). */
export interface Bot {
  decide(v: SimView): SimInput[];
}

interface Target {
  x: number;
  z: number;
  score: number;
  /** Extra travel past the target (u). */
  over: number;
  /** Minimum impact speed (tooth / Clank plate), u/s. */
  minSpeed: number;
  /** Allowed to end near the rim (worth the risk). */
  risky: boolean;
  /** Centre distance at which contact happens (impact speed is measured there). */
  contact: number;
}

/** Creates a bot with `profile`, seeded by `seed`. */
export function createBot(profile: BotProfile, seed: number): Bot {
  const rng = new Rng(seed, 99);
  let island: Island | undefined;
  let nextFlingAt = -1;
  let steering = false;

  function sync(v: SimView): Island {
    if (!island || island.name !== v.arena.name) island = new Island(v.arena.name);
    const g = v.gulp;
    if ((g.wedgeOn || g.shadow) && island.wedgeDir !== g.wedgeDir) island.setWedge(g.wedgeDir, g.wedgeHalf);
    if (g.wedgeOn && !island.wedgeOn) island.biteWedge();
    if (!g.wedgeOn && !g.shadow && (island.wedgeOn || island.wedgeShadow)) island.clearWedge();
    return island;
  }

  function safe(isl: Island, x: number, z: number, margin: number, shadow: boolean): boolean {
    if (isl.edgeDistance(x, z) > -margin) return false;
    return !(shadow && isl.inWedgeSector(x, z));
  }

  return {
    decide(v: SimView): SimInput[] {
      const out: SimInput[] = [];
      if (v.done) return out;
      const f = v.friend;
      const b = f.bodies[0];
      if (!b) return out;
      const isl = sync(v);
      const at = v.tick + profile.reaction;
      const shadow = v.gulp.shadow;

      if (f.hover > 0) {
        out.push({ t: at, k: 1, dir: angleOf(-b.x, -b.z), on: 1 });
        steering = true;
        return out;
      }

      const attentive = rng.float() < profile.attention;
      // Sweep: steer onto a nearby loose pixel instead of flinging.
      let near: { x: number; z: number; d: number } | undefined;
      for (const d of v.debris) {
        if (d.carriedBy >= 0 || d.y < -1) continue;
        const dd = Math.sqrt((d.x - b.x) * (d.x - b.x) + (d.z - b.z) * (d.z - b.z));
        if (!near || dd < near.d) near = { x: d.x, z: d.z, d: dd };
      }
      if (profile.sweeps && attentive && near && near.d < 9 && !b.flying && safe(isl, near.x, near.z, 2, shadow)) {
        out.push({ t: at, k: 1, dir: angleOf(near.x - b.x, near.z - b.z), on: 1 });
        steering = true;
        return out;
      }
      if (steering) {
        out.push({ t: at, k: 1, dir: 0, on: 0 });
        steering = false;
      }

      if (!f.ready || v.tick < nextFlingAt || f.ringout !== 0) return out;

      const targets: Target[] = [];
      // Old Gulp's shadow: get off the wedge before it is bitten (always noticed: the whole screen rumbles).
      if (shadow && isl.inWedgeSector(b.x, b.z)) {
        const ax = { x: 0, z: 0 };
        isl.wedgeAxis(ax);
        for (let k = 0; k < 4; k++) {
          const px = -ax.x * (6 + 4 * k) + ax.z * (k % 2 === 0 ? 8 : -8);
          const pz = -ax.z * (6 + 4 * k) - ax.x * (k % 2 === 0 ? 8 : -8);
          targets.push({ x: px, z: pz, score: 1000 - k, over: 0, minSpeed: 0, risky: false, contact: 0 });
        }
      }
      if (attentive) {
        for (const d of v.debris) {
          if (d.carriedBy >= 0 || d.y < -1) continue;
          targets.push({
            x: d.x,
            z: d.z,
            score: 140 - Math.sqrt((d.x - b.x) * (d.x - b.x) + (d.z - b.z) * (d.z - b.z)),
            over: 1,
            minSpeed: 0,
            risky: false,
            contact: 0,
          });
        }
      }
      for (const c of v.creatures) {
        if (c.spawning > 0 || c.state === 9) continue;
        const dx = c.x - b.x;
        const dz = c.z - b.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        let minSpeed = 0;
        if (c.kind === T.CLANK) {
          // Facing us → the plate: only worth it if we can crack it head-on.
          const face = cosA(c.facing) * (-dx / (d || 1)) + sinA(c.facing) * (-dz / (d || 1));
          if (face > T.CLANK_PLATE_COS) minSpeed = (1.3 * T.CLANK_FRONT_HP) / Math.max(1, b.mass);
        }
        const pts = T.CREATURE_DEFS[c.kind]?.points ?? 10;
        const threat = c.telegraph && d < 12 && attentive ? 60 : 0;
        const carrier = c.kind === T.SNATCH && attentive ? 40 : 0;
        let lined = 0;
        let over = 6;
        if (profile.combos && d > 0) {
          // Other creatures within the Friend's swept corridor past this one: aim through all of them.
          for (const o of v.creatures) {
            if (o === c || o.spawning > 0) continue;
            const ox = o.x - b.x;
            const oz = o.z - b.z;
            const along = (ox * dx + oz * dz) / d;
            if (along < d || along > d + 18) continue;
            const perp = Math.abs(ox * dz - oz * dx) / d;
            if (perp <= b.r + 2) {
              lined++;
              if (along - d + 4 > over) over = along - d + 4;
            }
          }
        }
        targets.push({
          x: c.x,
          z: c.z,
          score: 40 + pts / 2 + threat + carrier + 35 * lined - d,
          over,
          minSpeed,
          risky: false,
          contact: b.r + (T.CREATURE_DEFS[c.kind]?.radius ?? 2),
        });
      }
      for (const t of v.gulp.teeth) {
        if (!t.lit || t.hit) continue;
        targets.push({
          x: t.x,
          z: t.z,
          score: 400,
          over: 4,
          minSpeed: T.TOOTH_HP / Math.max(1, b.mass) + 2,
          risky: true,
          contact: b.r + T.TOOTH_RADIUS,
        });
        if (profile.combos) {
          // Too far or blocked: reposition to a staging point on the land side of the lit tooth.
          const ox = t.x - v.gulp.mouthX;
          const oz = t.z - v.gulp.mouthZ;
          const ol = Math.sqrt(ox * ox + oz * oz) || 1;
          const sx = t.x + (ox / ol) * 14;
          const sz = t.z + (oz / ol) * 14;
          const sd = Math.sqrt((sx - b.x) * (sx - b.x) + (sz - b.z) * (sz - b.z));
          if (sd > 6) targets.push({ x: sx, z: sz, score: 300, over: 0, minSpeed: 0, risky: false, contact: 0 });
        }
      }
      for (const c of v.crumbs)
        targets.push({ x: c.x, z: c.z, score: 60, over: 1, minSpeed: 0, risky: false, contact: 0 });
      targets.sort((p, q) => q.score - p.score);

      const damp = trait(f.familyId).dampMult;
      for (const tg of targets) {
        const dx = tg.x - b.x;
        const dz = tg.z - b.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 1) continue;
        const ang = angleOf(dx, dz) + rng.int(2 * profile.aimNoise + 1) - profile.aimNoise;
        const ux = cosA(ang);
        const uz = sinA(ang);
        let pow = -1;
        // Lowest power that reaches the target with the required impact speed, then back off until the landing is safe.
        for (let p = T.MIN_POW + 10; p <= 1023; p += 24) {
          const v0 = launchSpeed(p, b.mass);
          if (
            slideDistance(v0, damp) >= d + tg.over &&
            (tg.minSpeed === 0 || slideSpeedAt(v0, Math.max(0, d - tg.contact), damp) >= tg.minSpeed)
          ) {
            pow = p;
            break;
          }
        }
        if (pow < 0) continue;
        pow = Math.max(T.MIN_POW, Math.min(1023, Math.round(pow * (1 + (rng.float() * 2 - 1) * profile.powNoise))));
        const slide = slideDistance(launchSpeed(pow, b.mass), damp);
        const ex = b.x + ux * slide;
        const ez = b.z + uz * slide;
        if (!tg.risky && !safe(isl, ex, ez, profile.rimMargin, shadow)) continue;
        if (f.familyId === 3 && pow >= T.MITOSIS_MIN_POW) {
          // Cellular: both halves fly ±10° apart; both must land safely, and halves can't crack a plate.
          if (tg.minSpeed > 0 && !tg.risky) continue;
          let halvesSafe = true;
          for (const sgn of [-1, 1]) {
            const ha = ang + sgn * T.MITOSIS_SPREAD;
            if (!safe(isl, b.x + cosA(ha) * slide, b.z + sinA(ha) * slide, 5, shadow)) halvesSafe = false;
          }
          if (!halvesSafe) continue;
        }
        // Never plan a path that crosses the void before reaching the target (Gulp's notch).
        let clear = true;
        const reach = tg.risky ? Math.max(0, d - tg.contact) : slide;
        for (let s = 1; s <= reach && clear; s += 1.5)
          if (!safe(isl, b.x + ux * s, b.z + uz * s, tg.risky ? 0 : 1.5, false)) clear = false;
        // Unlit (or other) teeth in the way would just bounce us.
        for (const t of v.gulp.teeth) {
          if (t.hit || (t.x === tg.x && t.z === tg.z)) continue;
          const ox = t.x - b.x;
          const oz = t.z - b.z;
          const along = ox * ux + oz * uz;
          if (along > 0 && along < reach && Math.abs(ox * uz - oz * ux) < b.r + T.TOOTH_RADIUS) clear = false;
        }
        if (!clear) continue;
        out.push({ t: at, k: 0, ang: ang & 4095, pow });
        nextFlingAt = at + T.LAUNCH_COOLDOWN;
        return out;
      }
      return out;
    },
  };
}

/** Per-run bot statistics. */
export interface BotRun {
  summary: RunSummary;
  inputs: SimInput[];
  /** Pixels knocked off / grabbed back / lost this run (incl. safety) / ring-outs / crumbled / gulp burped. */
  pixelsOff: number;
  recovered: number;
  lost: number;
  persisted: number;
  ringouts: number;
  crumbled: boolean;
  burped: boolean;
}

/** Plays one full run with a bot; returns the summary, the recorded input log and balance counters. */
export function playBot(cfg: SimConfig, profile: BotProfile, botSeed: number): BotRun {
  const sim = createSim(cfg);
  const bot = createBot(profile, botSeed);
  const pending: SimInput[] = [];
  const log: SimInput[] = [];
  let pixelsOff = 0;
  let burped = false;
  let crumbled = false;
  while (!sim.done) {
    if (sim.tick % profile.thinkEvery === 0) for (const i of bot.decide(sim.view())) pending.push(i);
    const now: SimInput[] = [];
    for (let k = pending.length - 1; k >= 0; k--) {
      const p = pending[k];
      if (p && p.t <= sim.tick) {
        now.unshift({ ...p, t: sim.tick });
        pending.splice(k, 1);
      }
    }
    for (const i of now) log.push(i);
    sim.step(now);
    for (const e of sim.drainEvents()) {
      if (e.type === "pixelOff") pixelsOff++;
      else if (e.type === "gulp" && e.a === 4) burped = true;
      else if (e.type === "end" && e.a === 1) crumbled = true;
    }
  }
  const v = sim.view();
  return {
    summary: sim.summary(),
    inputs: log,
    pixelsOff,
    recovered: v.stats.recovered,
    lost: v.stats.lost,
    persisted: v.stats.persisted,
    ringouts: v.stats.ringouts,
    crumbled,
    burped,
  };
}
