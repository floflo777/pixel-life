/**
 * Shot planner for the skilled bot profiles (GDD §9.7 "expert uses traits"): scores candidate flings by walking the
 * straight slide they would make — which creatures it pops in order (combo index × value), which loose pixels and
 * crumbs it sweeps, whether it cracks a Clank plate or a lit Gulp tooth, and where it lands — and keeps the best safe
 * one. Pure and deterministic; it only reads the `SimView` a player sees plus the public tuning constants.
 */
import type { SimView } from "../sim-types.js";
import type { Island } from "./arena.js";
import { angleOf, cosA, sinA } from "./fixed-math.js";
import * as T from "./tuning.js";
import { launchSpeed, slideDistance } from "./world.js";

/** Why a planned fling is worth it. */
export type PlanIntent = "escape" | "pixel" | "creature" | "tooth" | "stage" | "crumb";

/** A candidate fling direction (integer angle) with the reason it was proposed. */
export interface Aim {
  ang: number;
  intent: PlanIntent;
  /** Flat bonus when the plan lands where this aim wants (escape / stage points). */
  bonus: number;
  /** For escape and stage aims: where the landing should be (bonus only if it lands within `near` of it). */
  gx: number;
  gz: number;
  near: number;
}

/** The body and world facts a plan needs, measured once per decision. */
export interface PlanContext {
  view: SimView;
  island: Island;
  /** Where the Friend will be when the fling lands (its own drift over the reaction time, for leading profiles). */
  ox: number;
  oz: number;
  mass: number;
  r: number;
  damp: number;
  pierce: boolean;
  magnetMult: number;
  /** Highest power the planner may use (Cellular stays below the Mitosis split). */
  maxPow: number;
  /** Landing distance to keep from the rim (u). */
  rimMargin: number;
  /** Creature positions the plan aims at (predicted for leading profiles), indexed like `view.creatures`. */
  cx: Float64Array;
  cz: Float64Array;
  /** Extra value per creature (threat, Snatch carrier), indexed like `view.creatures`. */
  cBonus: Float64Array;
  /** Whether the combo index multiplies each pop's value (combo planning) or every pop counts once. */
  combos: boolean;
  /** Landing within this distance of Gulp's mouth is refused (inhale coming), 0 = no constraint. */
  mouthKeepOut: number;
}

/** A scored fling. */
export interface Plan {
  ang: number;
  pow: number;
  value: number;
  kills: number;
  intent: PlanIntent;
}

const enum Item {
  Creature,
  Pixel,
  Crumb,
  Tooth,
  Block,
}

interface RayItem {
  type: Item;
  /** Distance along the ray where contact starts (u). */
  s: number;
  /** Creature index / tooth index. */
  idx: number;
  /** Perpendicular offset of the target from the ray (u), for tooth rebounds. */
  perp: number;
  side: number;
}

const MARCH_MAX = 80;
/** Speed above FLY_THRESHOLD a planned pop needs at contact (u/s). */
const KILL_SPEED_MARGIN = 4;
/** Power step of the plan search (0..1023 scale). */
const POW_STEP = 28;

/** Everything one direction needs, measured once and reused for every power. */
class Ray {
  ux = 1;
  uz = 0;
  items: RayItem[] = [];
  /** First distance where the path leaves the ground (with a 1 u margin). */
  voidAt = MARCH_MAX;
  /** First distance where a bumper or an unlit tooth is hit. */
  blockAt = MARCH_MAX;
  /** landOK[i]: landing at i u is safe (rim margin, no Gulp shadow, clear of the mouth). */
  landOK: boolean[] = [];

  constructor(ctx: PlanContext, ang: number) {
    this.ux = cosA(ang);
    this.uz = sinA(ang);
    const v = ctx.view;
    const isl = ctx.island;
    const shadow = v.gulp.shadow;
    const push = (type: Item, x: number, z: number, reach: number, idx: number, minAlong = 0): void => {
      const dx = x - ctx.ox;
      const dz = z - ctx.oz;
      const along = dx * this.ux + dz * this.uz;
      const cross = dx * this.uz - dz * this.ux;
      const perp = Math.abs(cross);
      if (along <= minAlong || perp >= reach) return;
      const s = along - Math.sqrt(reach * reach - perp * perp);
      this.items.push({ type, s: s < 0 ? 0 : s, idx, perp, side: cross < 0 ? -1 : 1 });
    };
    for (let i = 0; i < v.creatures.length; i++) {
      const c = v.creatures[i];
      if (!c || c.spawning > 0) continue;
      // Aim a little inside the contact circle: the plan must still hit after small prediction errors.
      // Creatures already touching the start are not counted: their position is the least certain part of the plan.
      push(
        Item.Creature,
        ctx.cx[i] ?? c.x,
        ctx.cz[i] ?? c.z,
        ctx.r + (T.CREATURE_DEFS[c.kind]?.radius ?? 2) - 0.6,
        i,
        2,
      );
    }
    const magnet = T.MAGNET_PREY * ctx.magnetMult;
    for (let i = 0; i < v.debris.length; i++) {
      const d = v.debris[i];
      if (!d || d.carriedBy >= 0 || d.y < -1) continue;
      push(Item.Pixel, d.x, d.z, magnet, i);
    }
    for (let i = 0; i < v.crumbs.length; i++) {
      const c = v.crumbs[i];
      if (c) push(Item.Crumb, c.x, c.z, magnet, i);
    }
    const teeth = v.gulp.teeth;
    for (let i = 0; i < teeth.length; i++) {
      const t = teeth[i];
      if (!t || t.hit) continue;
      push(t.lit ? Item.Tooth : Item.Block, t.x, t.z, ctx.r + T.TOOTH_RADIUS, i);
    }
    for (const k of isl.bumpers) if (k.active) push(Item.Block, k.x, k.z, ctx.r + k.r, -1);
    this.items.sort((p, q) => p.s - q.s || p.type - q.type || p.idx - q.idx);
    for (const it of this.items)
      if (it.type === Item.Block) {
        this.blockAt = it.s;
        break;
      }
    const mx = v.gulp.mouthX;
    const mz = v.gulp.mouthZ;
    const keep2 = ctx.mouthKeepOut * ctx.mouthKeepOut;
    for (let s = 0; s <= MARCH_MAX; s++) {
      const x = ctx.ox + this.ux * s;
      const z = ctx.oz + this.uz * s;
      const ed = isl.edgeDistance(x, z);
      if (s > 0 && ed > -1 && this.voidAt === MARCH_MAX) this.voidAt = s;
      let ok = ed <= -ctx.rimMargin && !(shadow && isl.inWedgeSector(x, z));
      if (ok && keep2 > 0 && (x - mx) * (x - mx) + (z - mz) * (z - mz) < keep2) ok = false;
      this.landOK.push(ok);
    }
  }
}

/** Result of walking one ray at one power. */
interface Walk {
  valid: boolean;
  value: number;
  kills: number;
  /** Landing point. */
  ex: number;
  ez: number;
}

const walk: Walk = { valid: false, value: 0, kills: 0, ex: 0, ez: 0 };

/** Walks `ray` at power `pow` (fills the shared `walk` record), tick by tick with the sim's own damping integrator. */
function walkRay(ctx: PlanContext, ray: Ray, pow: number): Walk {
  const damp = ctx.damp;
  const view = ctx.view;
  let v = launchSpeed(pow, ctx.mass);
  let pos = 0;
  let kills = 0;
  let value = 0;
  walk.valid = false;
  walk.value = 0;
  walk.kills = 0;
  const taken = new Set<number>();
  const items = ray.items;
  let next = 0;
  for (let n = 0; v > 0 && n < 600; n++) {
    const dec = (T.DAMP_CONST + T.DAMP_LIN * v) * damp * T.DT;
    v = v > dec ? v - dec : 0;
    pos += v * T.DT;
    for (; next < items.length; next++) {
      const it = items[next];
      if (!it || it.s > pos || it.s >= ray.blockAt || it.s >= ray.voidAt) break;
      if (it.type === Item.Pixel) {
        value += pixelValue(view, it.idx);
        taken.add(it.idx);
        continue;
      }
      if (it.type === Item.Crumb) {
        value += T.PTS_CRUMB;
        continue;
      }
      if (it.type === Item.Tooth) {
        if (v < T.FLY_THRESHOLD || ctx.mass * v < 1.08 * T.smashThreshold(T.TOOTH_HP, ctx.mass)) return walk;
        return toothRebound(ctx, ray, it, v, value, kills);
      }
      // Still clearly FLYING at contact (a planned pop at the edge of the slide is a coin flip).
      if (it.type !== Item.Creature || v < T.FLY_THRESHOLD + KILL_SPEED_MARGIN) continue;
      const c = view.creatures[it.idx];
      if (!c) continue;
      let pts = T.CREATURE_DEFS[c.kind]?.points ?? 10;
      if (c.kind === T.CLANK) {
        const dx = ctx.ox + ray.ux * it.s - (ctx.cx[it.idx] ?? c.x);
        const dz = ctx.oz + ray.uz * it.s - (ctx.cz[it.idx] ?? c.z);
        const l = Math.sqrt(dx * dx + dz * dz) || 1;
        if ((cosA(c.facing) * dx + sinA(c.facing) * dz) / l > T.CLANK_PLATE_COS) {
          // A plate: crack it with margin or do not go there at all (bounce + bite).
          if (ctx.mass * v < 1.15 * T.smashThreshold(T.CLANK_FRONT_HP, ctx.mass)) return walk;
          pts += T.PTS_SHELL_CRACK;
        }
      }
      if (c.kind === T.SLURP && c.hp > 1) pts = 8;
      else if (c.kind === T.FIZZ) pts = 12;
      else {
        kills++;
        pts *= ctx.combos ? Math.min(kills, T.COMBO_CAP) : 1;
      }
      value += pts + (ctx.cBonus[it.idx] ?? 0);
      if (!ctx.pierce) v *= T.KILL_SPEED_KEEP;
    }
    if (pos >= ray.voidAt || pos >= ray.blockAt) return walk;
  }
  if (!ray.landOK[Math.round(pos)]) return walk;
  walk.ex = ctx.ox + ray.ux * pos;
  walk.ez = ctx.oz + ray.uz * pos;
  // Loose pixels at the landing spot come home too.
  const magnet = T.MAGNET_PREY * ctx.magnetMult;
  for (let i = 0; i < view.debris.length; i++) {
    const d = view.debris[i];
    if (!d || taken.has(i) || d.carriedBy >= 0 || d.y < -1) continue;
    if ((d.x - walk.ex) * (d.x - walk.ex) + (d.z - walk.ez) * (d.z - walk.ez) <= magnet * magnet)
      value += pixelValue(view, i);
  }
  walk.valid = true;
  walk.value = value;
  walk.kills = kills;
  return walk;
}

/** A loose pixel is worth more the less time it has left (it becomes a scar). */
function pixelValue(view: SimView, i: number): number {
  const d = view.debris[i];
  if (!d) return 0;
  return d.left < 45 ? 170 : 130;
}

/** A lit tooth hit rebounds the Friend off Gulp's jaw: the plan is only good if the rebound lands on the ground. */
function toothRebound(ctx: PlanContext, ray: Ray, it: RayItem, vAt: number, value: number, kills: number): Walk {
  const view = ctx.view;
  const t = view.gulp.teeth[it.idx];
  if (!t) return walk;
  const cx = ctx.ox + ray.ux * it.s;
  const cz = ctx.oz + ray.uz * it.s;
  const rr = ctx.r + T.TOOTH_RADIUS;
  const nx = (cx - t.x) / rr;
  const nz = (cz - t.z) / rr;
  let vx = ray.ux * vAt;
  let vz = ray.uz * vAt;
  const vn = vx * nx + vz * nz;
  if (vn < 0) {
    vx -= (1 + T.BUMPER_RESTITUTION) * vn * nx;
    vz -= (1 + T.BUMPER_RESTITUTION) * vn * nz;
  }
  const sp = Math.sqrt(vx * vx + vz * vz);
  const len = sp > 0 ? slideDistance(sp, ctx.damp) : 0;
  const ux = sp > 0 ? vx / sp : 0;
  const uz = sp > 0 ? vz / sp : 0;
  for (let s = 0; s <= len + 1; s += 1) {
    const x = cx + ux * s;
    const z = cz + uz * s;
    if (ctx.island.edgeDistance(x, z) > (s >= len ? -ctx.rimMargin / 2 : -1)) return walk;
  }
  const burp = view.gulp.teeth.filter((o) => o.hit).length === 2;
  walk.valid = true;
  walk.value = value + T.PTS_TOOTH * 4 + (burp ? T.PTS_BURP : 0);
  walk.kills = kills;
  walk.ex = cx + ux * len;
  walk.ez = cz + uz * len;
  return walk;
}

/**
 * Best plan over `aims`: every aim is tried at every power step (lowest power first, so ties keep the gentler fling).
 * Returns up to `keep` plans, best first (the caller executes the first whose noisy version is still safe).
 */
export function planShots(ctx: PlanContext, aims: readonly Aim[], keep: number): Plan[] {
  const best: Plan[] = [];
  const seen = new Set<number>();
  for (const aim of aims) {
    const ang = aim.ang & 4095;
    if (seen.has(ang)) continue;
    seen.add(ang);
    const ray = new Ray(ctx, ang);
    // Value per power step; the chosen power is the middle of the best run, not its weak end, so small power and
    // prediction errors still land the same pops.
    const raws: number[] = [];
    let max = 0;
    for (let pow = T.MIN_POW + 10; pow <= ctx.maxPow; pow += POW_STEP) {
      const w = walkRay(ctx, ray, pow);
      let raw = -1;
      if (w.valid) {
        raw = w.value;
        if (aim.bonus > 0) {
          const dx = w.ex - aim.gx;
          const dz = w.ez - aim.gz;
          if (dx * dx + dz * dz <= aim.near * aim.near) raw += aim.bonus;
        }
      }
      raws.push(raw);
      if (raw > max) max = raw;
    }
    if (max <= 0) continue;
    const bestIdx: number[] = [];
    for (let i = 0; i < raws.length; i++) if ((raws[i] ?? -1) >= max - 0.5) bestIdx.push(i);
    const pick = bestIdx[Math.floor((bestIdx.length - 1) / 2)] ?? 0;
    const pow = T.MIN_POW + 10 + pick * POW_STEP;
    const w = walkRay(ctx, ray, pow);
    // Gentle preference for landing nearer the centre (more room for the next shot).
    const value = max - 0.4 * Math.sqrt(w.ex * w.ex + w.ez * w.ez);
    const top: Plan | undefined = value > 0 ? { ang, pow, value, kills: w.kills, intent: aim.intent } : undefined;
    if (top) best.push(top);
  }
  best.sort((p, q) => q.value - p.value || p.pow - q.pow || p.ang - q.ang);
  return best.slice(0, keep);
}

/** Re-checks one concrete (noisy) fling: the value it really has, or undefined if it is unsafe. */
export function checkShot(ctx: PlanContext, ang: number, pow: number): Walk | undefined {
  const w = walkRay(ctx, new Ray(ctx, ang & 4095), pow);
  return w.valid ? { ...w } : undefined;
}

/** Aim straight at (x, z) from the plan origin. */
export function aimAt(ctx: PlanContext, x: number, z: number, intent: PlanIntent, bonus = 0, near = 0): Aim {
  return { ang: angleOf(x - ctx.ox, z - ctx.oz) & 4095, intent, bonus, gx: x, gz: z, near };
}
