/**
 * The Bump Sumo match (deterministic): four Friends on a shrinking floating ring, three rounds. Rules in one breath:
 * walk, hold to charge, release to dash-shove; a shove knocks pixels off the victim's contact side and mass is the
 * pixels you still have, so a battered Friend flies farther. Leave the ring and you are out of the round; the last Friend
 * standing wins it. Loose pixels can be grabbed back by their owner; the ones that fall or fizzle are gone until the
 * match ends (Bump Sumo is scarless: every pixel comes home afterwards).
 *
 * Determinism: only + − × ÷, `Math.sqrt/floor/abs/min/max`, table trig from `sim/fixed-math.ts` and the sfc32 `Rng`
 * (per-purpose streams). Fixed 60 Hz ticks, no wall clock. Enforced by `determinism.test.ts`.
 */
import { toIndices } from "../../bitmap.js";
import type { FamilyId } from "../../ids.js";
import { angleOf, cosA, sinA, wrapAngle } from "../../sim/fixed-math.js";
import { Rng } from "../../sim/rng.js";
import { botIntent, newBrain, type BotBrain } from "./bot.js";
import { sumoTrait, type SumoTrait } from "./traits.js";
import * as T from "./tuning.js";
import { SumoFighterState, SumoPhase, SumoPx, type SumoConfig, type SumoEvent, type SumoEventType } from "./types.js";

/** What a fighter wants this tick (the player's latest input, or a bot's decision). */
export interface Intent {
  move: boolean;
  dir: number;
  charge: boolean;
}

/** One Friend in the ring (mutable sim state; the view copies it). */
export interface Fighter {
  readonly idx: number;
  readonly familyId: FamilyId;
  readonly trait: SumoTrait;
  readonly radius: number;
  readonly heavySide: number;
  /** `SumoPx` per pixel id. */
  readonly pixels: Uint8Array;
  /** Pixels on the body at match start, and the knock-off floor. */
  readonly total: number;
  readonly floor: number;
  present: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  state: SumoFighterState;
  fallTicks: number;
  hoverLeft: number;
  chargeTicks: number;
  armedTicks: number;
  dashP: number;
  dashAge: number;
  cooldownUntil: number;
  dodgeUntil: number;
  stun: number;
  stillTicks: number;
  slickUntil: number;
  lastReleaseTick: number;
  lastHitBy: number;
  lastHitTick: number;
  quakePending: boolean;
  wins: number;
  kos: number;
  grabbed: number;
  knockedOff: number;
  ringouts: number;
  readonly intent: Intent;
}

/** A loose pixel. */
export interface Debris {
  readonly owner: number;
  readonly pid: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  left: number;
  falling: boolean;
  kickCd: number;
}

/** A spark-trail point. */
export interface TrailPoint {
  readonly owner: number;
  readonly x: number;
  readonly z: number;
  expires: number;
}

/** Pad angles: the player in front (toward the camera), rivals right, back, left. */
const PAD_ANGLES = [1024, 0, 3072, 2048] as const;

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Collider radius from a front mask's bounding-box width. */
function radiusOf(front: readonly number[]): number {
  let minC = 16;
  let maxC = -1;
  for (const pid of front) {
    const c = pid & 15;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  if (maxC < 0) return T.RADIUS_MIN;
  return clampNum(T.RADIUS_K * (maxC - minC + 1), T.RADIUS_MIN, T.RADIUS_MAX);
}

/** Asymmetry heavy side: +1 if more unmirrored body pixels sit right of the sprite's centre line, −1 left; ties right. */
export function heavySideOf(pixels: Uint8Array): number {
  let left = 0;
  let right = 0;
  for (let pid = 0; pid < 256; pid++) {
    if (pixels[pid] !== SumoPx.Body) continue;
    const col = pid & 15;
    if (pixels[(pid & ~15) | (15 - col)] === SumoPx.Body) continue;
    if (col >= 8) right++;
    else left++;
  }
  return left > right ? -1 : 1;
}

/** Deterministic match state. `step` advances one tick. */
export class Match {
  tick = 0;
  phase: SumoPhase = SumoPhase.Ready;
  round = 0;
  phaseTicks = 0;
  ringR = T.RING_R0;
  done = false;
  winner = -1;
  score = 0;
  readonly roundWinners: number[] = [];
  readonly fighters: Fighter[] = [];
  debris: Debris[] = [];
  trail: TrailPoint[] = [];
  events: SumoEvent[] = [];
  recordEvents = true;
  /** False freezes every bot's controls (unit tests and tooling isolate physics with it). */
  botsActive = true;
  readonly botLevel: number;
  readonly rngHit: Rng;
  readonly rngDebris: Rng;
  readonly rngBots: Rng[] = [];
  readonly brains: BotBrain[] = [];
  private shrinkAnnounced = false;

  /** Builds a match at tick 0 (round 1, "ready"); throws `RangeError` on a malformed config. */
  constructor(cfg: SumoConfig) {
    if (cfg.fighters.length !== T.FIGHTERS) throw new RangeError(`Bump Sumo needs exactly ${T.FIGHTERS} fighters.`);
    const lvl = cfg.botLevel ?? 1;
    if (!(lvl >= 0 && lvl <= 2)) throw new RangeError("botLevel must be 0..2.");
    this.botLevel = lvl;
    const seed = cfg.seed >>> 0;
    this.rngHit = new Rng(seed, 101);
    this.rngDebris = new Rng(seed, 102);
    cfg.fighters.forEach((fc, idx) => {
      const trait = sumoTrait(fc.familyId);
      const frontIdx = toIndices(fc.front);
      const lostIdx = new Set(toIndices(fc.lost));
      const pixels = new Uint8Array(256);
      let present = 0;
      for (const pid of frontIdx) {
        if (lostIdx.has(pid)) pixels[pid] = SumoPx.Scar;
        else {
          pixels[pid] = SumoPx.Body;
          present++;
        }
      }
      if (present === 0) throw new RangeError("Every fighter needs at least one pixel on its body.");
      this.fighters.push({
        idx,
        familyId: fc.familyId,
        trait,
        radius: radiusOf(frontIdx),
        heavySide: heavySideOf(pixels),
        pixels,
        total: present,
        floor: Math.floor(present * T.PIXEL_FLOOR + 0.5),
        present,
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        facing: 0,
        state: SumoFighterState.Ring,
        fallTicks: 0,
        hoverLeft: 0,
        chargeTicks: 0,
        armedTicks: 0,
        dashP: 0,
        dashAge: 0,
        cooldownUntil: 0,
        dodgeUntil: 0,
        stun: 0,
        stillTicks: 0,
        slickUntil: 0,
        lastReleaseTick: -1000,
        lastHitBy: -1,
        lastHitTick: -1000,
        quakePending: false,
        wins: 0,
        kos: 0,
        grabbed: 0,
        knockedOff: 0,
        ringouts: 0,
        intent: { move: false, dir: 0, charge: false },
      });
      if (idx > 0) {
        this.rngBots.push(new Rng(seed, 200 + idx));
        this.brains.push(newBrain());
      }
    });
    this.startRound();
  }

  /** Physics mass of fighter `f` (present pixels × family × brace), never below `MASS_MIN`. */
  mass(f: Fighter): number {
    const brace = this.braced(f) ? T.BRACE_MULT : 1;
    const m = f.present * f.trait.massMult * brace;
    return m < T.MASS_MIN ? T.MASS_MIN : m;
  }

  /** True while a Family fighter stands braced. */
  braced(f: Fighter): boolean {
    return f.trait.brace && f.stillTicks >= T.BRACE_TICKS;
  }

  /** Charge 0..1 of a fighter (family charge time applied). */
  charge01(f: Fighter): number {
    if (f.chargeTicks <= 0) return 0;
    const full = T.CHARGE_TICKS * f.trait.chargeMult;
    return f.chargeTicks >= full ? 1 : f.chargeTicks / full;
  }

  /** True if the fighter takes part in collisions (on the ring or hovering). */
  inPlay(f: Fighter): boolean {
    return f.state === SumoFighterState.Ring || f.state === SumoFighterState.Hover;
  }

  /** Advances one tick; `player` is the player's control state (already resolved from the input log). */
  step(player: Intent): void {
    if (this.done) return;
    const p0 = this.fighters[0];
    if (p0) {
      p0.intent.move = player.move;
      p0.intent.dir = wrapAngle(player.dir);
      p0.intent.charge = player.charge;
    }
    switch (this.phase) {
      case SumoPhase.Ready:
        if (this.phaseTicks === 0) this.emit("ready", this.round);
        if (this.phaseTicks + 1 >= T.READY_TICKS) {
          this.setPhase(SumoPhase.Fight);
          this.emit("fight", this.round);
          this.tick++;
          return;
        }
        break;
      case SumoPhase.Fight:
        this.fight();
        break;
      case SumoPhase.RoundEnd:
        // The world keeps drifting (falls finish, pixels settle) but nobody acts.
        for (const f of this.fighters) {
          f.intent.move = false;
          f.intent.charge = false;
          f.chargeTicks = 0;
        }
        this.physics(false);
        if (this.phaseTicks + 1 >= T.END_TICKS) {
          this.tick++;
          if (this.round + 1 >= T.ROUNDS) this.finish();
          else {
            this.round++;
            this.startRound();
          }
          return;
        }
        break;
      case SumoPhase.Done:
        break;
    }
    this.phaseTicks++;
    this.tick++;
  }

  private setPhase(p: SumoPhase): void {
    this.phase = p;
    this.phaseTicks = 0;
  }

  emit(type: SumoEventType, a?: number, b?: number, n?: number, x?: number, z?: number): void {
    if (!this.recordEvents) return;
    const e: SumoEvent = { t: this.tick, type };
    if (a !== undefined) e.a = a;
    if (b !== undefined) e.b = b;
    if (n !== undefined) e.n = n;
    if (x !== undefined) e.x = x;
    if (z !== undefined) e.z = z;
    this.events.push(e);
  }

  /** Puts everyone on their pad, returns loose pixels home and resets the ring. */
  private startRound(): void {
    this.setPhase(SumoPhase.Ready);
    this.ringR = T.RING_R0;
    this.shrinkAnnounced = false;
    for (const d of this.debris) {
      const f = this.fighters[d.owner];
      if (!f) continue;
      f.pixels[d.pid] = SumoPx.Body;
      f.present++;
      this.emit("pixelBack", d.owner, d.pid, 2, d.x, d.z);
    }
    this.debris = [];
    this.trail = [];
    for (const f of this.fighters) {
      const a = PAD_ANGLES[f.idx] ?? 0;
      f.x = cosA(a) * T.PAD_RADIUS;
      f.z = sinA(a) * T.PAD_RADIUS;
      f.vx = 0;
      f.vz = 0;
      f.facing = wrapAngle(a + 2048);
      f.state = SumoFighterState.Ring;
      f.fallTicks = 0;
      f.hoverLeft = f.trait.hover ? T.HOVER_TICKS : 0;
      f.chargeTicks = 0;
      f.armedTicks = 0;
      f.dashP = 0;
      f.dashAge = 0;
      f.cooldownUntil = 0;
      f.dodgeUntil = 0;
      f.stun = 0;
      f.stillTicks = 0;
      f.slickUntil = 0;
      f.lastReleaseTick = -1000;
      f.lastHitBy = -1;
      f.lastHitTick = -1000;
      f.quakePending = false;
    }
    for (const b of this.brains) Object.assign(b, newBrain());
  }

  private finish(): void {
    const order = this.ranking();
    this.winner = order[0] ?? -1;
    if (this.winner === 0) this.score += T.SCORE_MATCH;
    // Scarless venue: every pixel comes home when the match ends.
    for (const f of this.fighters) {
      for (let pid = 0; pid < 256; pid++) {
        const s = f.pixels[pid];
        if (s === SumoPx.Loose || s === SumoPx.Gone) f.pixels[pid] = SumoPx.Body;
      }
      f.present = f.total;
    }
    this.debris = [];
    this.trail = [];
    this.setPhase(SumoPhase.Done);
    this.done = true;
    this.emit("matchEnd", this.winner, this.score);
  }

  /** Fighter indices best-first: round wins, then ring-outs scored, then pixels kept, then index. */
  ranking(): number[] {
    return this.fighters
      .map((f) => f.idx)
      .sort((ia, ib) => {
        const a = this.fighters[ia];
        const b = this.fighters[ib];
        if (!a || !b) return ia - ib;
        if (a.wins !== b.wins) return b.wins - a.wins;
        if (a.kos !== b.kos) return b.kos - a.kos;
        if (a.present !== b.present) return b.present - a.present;
        return ia - ib;
      });
  }

  private fight(): void {
    const t = this.phaseTicks;
    if (t >= T.SHRINK_START) {
      if (!this.shrinkAnnounced) {
        this.shrinkAnnounced = true;
        this.emit("shrink", this.round);
      }
      const r = T.RING_R0 - ((t - T.SHRINK_START) * T.SHRINK_RATE) / T.SUMO_HZ;
      this.ringR = r < T.RING_MIN ? T.RING_MIN : r;
    }
    for (let i = 1; i < this.fighters.length && this.botsActive; i++) {
      const f = this.fighters[i];
      const brain = this.brains[i - 1];
      const rng = this.rngBots[i - 1];
      if (!f || !brain || !rng) continue;
      const want = botIntent(this, i, brain, rng);
      f.intent.move = want.move;
      f.intent.dir = want.dir;
      f.intent.charge = want.charge;
    }
    for (const f of this.fighters) this.control(f);
    this.physics(true);
    this.checkRoundEnd();
  }

  /** Turns a fighter's intent into charge / dash / dodge / walking. */
  private control(f: Fighter): void {
    if (!this.inPlay(f)) {
      f.chargeTicks = 0;
      return;
    }
    const it = f.intent;
    if (f.stun > 0) {
      f.stun--;
      f.chargeTicks = 0;
      f.stillTicks = 0;
      return;
    }
    const hovering = f.state === SumoFighterState.Hover;
    // Charge & release.
    if (it.charge && !hovering) {
      if (f.chargeTicks > 0 || (f.armedTicks === 0 && this.tick >= f.cooldownUntil)) f.chargeTicks++;
    } else if (f.chargeTicks > 0) {
      const ticks = f.chargeTicks;
      f.chargeTicks = 0;
      if (ticks < T.TAP_TICKS) this.dodge(f);
      else this.dash(f, ticks);
    }
    // Facing: the stick, else (while charging) the nearest rival, so a keyboard-only shove still lands.
    if (it.move) f.facing = it.dir;
    else if (f.chargeTicks > 0) {
      const n = this.nearestRival(f);
      if (n) f.facing = angleOf(n.x - f.x, n.z - f.z);
    }
    // Walking (not while dashing).
    if (it.move && f.armedTicks === 0) {
      const slick = this.tick < f.slickUntil;
      const k = (f.chargeTicks > 0 ? T.CHARGE_WALK : 1) * (slick ? T.SLICK_WALK : 1);
      const dx = cosA(it.dir);
      const dz = sinA(it.dir);
      if (hovering) {
        f.vx += dx * T.HOVER_ACCEL * T.DT;
        f.vz += dz * T.HOVER_ACCEL * T.DT;
      } else if (f.vx * dx + f.vz * dz < T.WALK_MAX * k) {
        f.vx += dx * T.MOVE_ACCEL * k * T.DT;
        f.vz += dz * T.MOVE_ACCEL * k * T.DT;
      }
    }
    const still = !it.move && f.armedTicks === 0 && f.vx * f.vx + f.vz * f.vz < 4;
    f.stillTicks = still ? f.stillTicks + 1 : 0;
  }

  private nearestRival(f: Fighter): Fighter | null {
    let best: Fighter | null = null;
    let bd = Infinity;
    for (const o of this.fighters) {
      if (o === f || !this.inPlay(o)) continue;
      const dx = o.x - f.x;
      const dz = o.z - f.z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Releases a charge of `ticks` as a dash-shove along the facing. */
  private dash(f: Fighter, ticks: number): void {
    const full = T.CHARGE_TICKS * f.trait.chargeMult;
    const pw = ticks >= full ? 1 : ticks / full;
    const speed = (T.DASH_MIN + (T.DASH_MAX - T.DASH_MIN) * pw) / Math.sqrt(f.trait.massMult);
    f.vx = cosA(f.facing) * speed;
    f.vz = sinA(f.facing) * speed;
    f.armedTicks = T.DASH_TICKS;
    f.dashP = pw;
    f.dashAge = 0;
    f.lastReleaseTick = this.tick;
    f.cooldownUntil = this.tick + T.SHOVE_COOLDOWN;
    f.quakePending = f.trait.quake && pw >= T.QUAKE_MIN_P;
    f.stillTicks = 0;
    this.emit("shove", f.idx, undefined, Math.round(pw * 1023), f.x, f.z);
  }

  private dodge(f: Fighter): void {
    // Side-step along the stick, else perpendicular to where you face.
    const dir = f.intent.move ? f.intent.dir : wrapAngle(f.facing + 1024);
    f.vx = cosA(dir) * T.DODGE_SPEED;
    f.vz = sinA(dir) * T.DODGE_SPEED;
    f.dodgeUntil = this.tick + T.DODGE_INVULN;
    f.cooldownUntil = this.tick + T.SHOVE_COOLDOWN;
    this.emit("dodge", f.idx, undefined, undefined, f.x, f.z);
  }

  /** Integration, collisions, edges, debris, trail. `live` = fighting (false in the round-end beat). */
  private physics(live: boolean): void {
    for (const f of this.fighters) this.integrate(f);
    if (live) this.collide();
    // After the round is decided nobody else can ring out: the end beat only lets falls finish.
    if (live) for (const f of this.fighters) this.edge(f);
    this.stepDebris();
    this.stepTrail();
  }

  private integrate(f: Fighter): void {
    if (f.state === SumoFighterState.Out) return;
    if (f.state === SumoFighterState.Falling) {
      f.fallTicks++;
      f.x += f.vx * T.DT;
      f.z += f.vz * T.DT;
      if (f.fallTicks >= T.FALL_TICKS) f.state = SumoFighterState.Out;
      return;
    }
    // Hook: an Asymmetry dash curves toward the heavy side over its first ticks.
    if (f.armedTicks > 0 && f.trait.hook && f.dashAge < T.HOOK_TICKS) {
      const a = T.HOOK_STEP * f.heavySide;
      const c = cosA(a);
      const s = sinA(a);
      const vx = f.vx * c - f.vz * s;
      const vz = f.vx * s + f.vz * c;
      f.vx = vx;
      f.vz = vz;
      f.facing = angleOf(vx, vz);
    }
    const slick = this.tick < f.slickUntil;
    const k = T.GROUND_DAMP * f.trait.dampMult * (slick ? T.SLICK_DAMP : 1) * (f.armedTicks > 0 ? T.DASH_DAMP_MULT : 1);
    const keep = 1 - k * T.DT;
    f.vx *= keep < 0 ? 0 : keep;
    f.vz *= keep < 0 ? 0 : keep;
    f.x += f.vx * T.DT;
    f.z += f.vz * T.DT;
    if (f.armedTicks > 0) {
      f.dashAge++;
      f.armedTicks--;
      const sp2 = f.vx * f.vx + f.vz * f.vz;
      if (sp2 < T.DASH_END_SPEED * T.DASH_END_SPEED) f.armedTicks = 0;
      if (f.trait.sparkTrail && f.dashAge % T.TRAIL_EVERY === 1)
        this.trail.push({ owner: f.idx, x: f.x, z: f.z, expires: this.tick + T.TRAIL_TICKS });
    }
    // Colossus: the stomp lands when the dash ends, whether it ran out or hit someone.
    if (f.armedTicks === 0 && f.quakePending) this.quake(f);
  }

  private quake(f: Fighter): void {
    f.quakePending = false;
    const mf = this.mass(f);
    for (const o of this.fighters) {
      if (o === f || !this.inPlay(o)) continue;
      const dx = o.x - f.x;
      const dz = o.z - f.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > T.QUAKE_RADIUS + o.radius || d === 0) continue;
      const kv = clampNum(T.QUAKE_KNOCK * Math.sqrt(mf / this.mass(o)), T.KNOCK_MIN, T.KNOCK_MAX);
      o.vx += (dx / d) * kv;
      o.vz += (dz / d) * kv;
      o.lastHitBy = f.idx;
      o.lastHitTick = this.tick;
    }
    this.emit("quake", f.idx, undefined, undefined, f.x, f.z);
  }

  private collide(): void {
    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i];
      if (!a || !this.inPlay(a)) continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j];
        if (!b || !this.inPlay(b)) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        let d = Math.sqrt(d2);
        let nx: number;
        let nz: number;
        if (d === 0) {
          // Perfect overlap: separate along a deterministic axis.
          nx = 1;
          nz = 0;
          d = 0;
        } else {
          nx = dx / d;
          nz = dz / d;
        }
        const ma = this.mass(a);
        const mb = this.mass(b);
        // Positional separation, weighted by inverse mass.
        const overlap = rr - d;
        const ia = 1 / ma;
        const ib = 1 / mb;
        const sa = (overlap * ia) / (ia + ib);
        const sb = (overlap * ib) / (ia + ib);
        a.x -= nx * sa;
        a.z -= nz * sa;
        b.x += nx * sb;
        b.z += nz * sb;
        const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        const cx = a.x + nx * a.radius;
        const cz = a.z + nz * a.radius;
        const aHits = a.armedTicks > 0 && a.vx * nx + a.vz * nz > 0;
        const bHits = b.armedTicks > 0 && -(b.vx * nx + b.vz * nz) > 0;
        if (aHits && bHits) {
          this.emit("clash", a.idx, b.idx, Math.round((a.dashP > b.dashP ? a.dashP : b.dashP) * 1023), cx, cz);
          const pa = a.dashP;
          const pb = b.dashP;
          this.shove(a, b, nx, nz, pa, ma, mb, cx, cz);
          this.shove(b, a, -nx, -nz, pb, mb, ma, cx, cz);
          continue;
        }
        if (aHits) {
          this.shove(a, b, nx, nz, a.dashP, ma, mb, cx, cz);
          continue;
        }
        if (bHits) {
          this.shove(b, a, -nx, -nz, b.dashP, mb, ma, cx, cz);
          continue;
        }
        if (rv < 0) {
          const jImp = (-(1 + T.BUMP_RESTITUTION) * rv) / (ia + ib);
          a.vx -= jImp * ia * nx;
          a.vz -= jImp * ia * nz;
          b.vx += jImp * ib * nx;
          b.vz += jImp * ib * nz;
          if (-rv >= T.BUMP_EVENT_SPEED) this.emit("bump", a.idx, b.idx, Math.round(-rv), cx, cz);
        }
      }
    }
  }

  /** Attacker `a` lands a shove on victim `v` along unit (nx, nz) with power `p`. */
  private shove(
    a: Fighter,
    v: Fighter,
    nx: number,
    nz: number,
    p: number,
    ma: number,
    mv: number,
    cx: number,
    cz: number,
  ): void {
    a.armedTicks = 0;
    if (this.tick < v.dodgeUntil) return;
    // Mask parry: a shove released just before the hit bounces it back at the attacker.
    if (v.trait.parry && this.tick - v.lastReleaseTick <= T.PARRY_TICKS && v.idx !== a.idx) {
      this.emit("parry", v.idx, a.idx, undefined, cx, cz);
      const kv = clampNum((T.SHOVE_MIN + T.SHOVE_P * p) * Math.sqrt(mv / ma), T.KNOCK_MIN, T.KNOCK_MAX);
      a.vx = -nx * kv;
      a.vz = -nz * kv;
      a.stun = T.HIT_STUN;
      a.lastHitBy = v.idx;
      a.lastHitTick = this.tick;
      a.quakePending = false;
      return;
    }
    let kv = clampNum((T.SHOVE_MIN + T.SHOVE_P * p) * Math.sqrt(ma / mv), T.KNOCK_MIN, T.KNOCK_MAX);
    let n = 1 + Math.floor(p * T.HIT_PIXELS_P);
    if (v.trait.shed && p >= T.SHED_MIN_P) {
      kv *= T.SHED_KNOCK;
      n += 1;
    }
    n = Math.floor(n * v.trait.lossMult + 0.5);
    if (n < 1) n = 1;
    a.vx *= T.ATTACKER_KEEP;
    a.vz *= T.ATTACKER_KEEP;
    v.vx = nx * kv + v.vx * T.VICTIM_KEEP;
    v.vz = nz * kv + v.vz * T.VICTIM_KEEP;
    v.stun = T.HIT_STUN;
    v.chargeTicks = 0;
    v.armedTicks = 0;
    v.stillTicks = 0;
    v.lastHitBy = a.idx;
    v.lastHitTick = this.tick;
    this.emit("hit", a.idx, v.idx, Math.round(p * 1023), cx, cz);
    this.knockPixels(v, -nx, -nz, n, kv);
  }

  /**
   * Knocks up to `n` pixels off `v` from the side facing (sx, sz) (toward the attacker), respecting the floor. Pixels
   * fly away from the contact along the victim's new heading, scattered by the debris stream.
   */
  private knockPixels(v: Fighter, sx: number, sz: number, n: number, kv: number): void {
    const room = v.present - v.floor;
    const k = n < room ? n : room;
    if (k <= 0) return;
    // Score each body pixel by how far it sits toward the contact (screen x ↔ sprite columns, z ↔ rows).
    const cand: { pid: number; s: number }[] = [];
    for (let pid = 0; pid < 256; pid++) {
      if (v.pixels[pid] !== SumoPx.Body) continue;
      const col = (pid & 15) - 7.5;
      const row = (pid >> 4) - 7.5;
      cand.push({ pid, s: col * sx - row * sz * 0.5 + this.rngHit.float() * 2 });
    }
    cand.sort((p, q) => q.s - p.s || p.pid - q.pid);
    const hx = sx === 0 && sz === 0 ? 1 : -sx;
    const hz = sx === 0 && sz === 0 ? 0 : -sz;
    for (let i = 0; i < k; i++) {
      const c = cand[i];
      if (!c) break;
      v.pixels[c.pid] = SumoPx.Loose;
      v.present--;
      v.knockedOff++;
      const r = this.rngDebris;
      const spread = r.range(-0.6, 0.6);
      const sp = r.range(T.DEBRIS_SPEED_MIN, T.DEBRIS_SPEED_MAX) + kv * 0.15;
      // Heading (hx, hz) rotated a little: v' = h + perp·spread, renormalised.
      let dx = hx - hz * spread;
      let dz = hz + hx * spread;
      const l = Math.sqrt(dx * dx + dz * dz);
      dx /= l;
      dz /= l;
      const px = v.x + ((c.pid & 15) - 7.5) * 0.5;
      const pz = v.z;
      this.debris.push({
        owner: v.idx,
        pid: c.pid,
        x: px,
        y: 4 + (15 - (c.pid >> 4)) * 0.5,
        z: pz,
        vx: dx * sp,
        vy: r.range(T.DEBRIS_UP_MIN, T.DEBRIS_UP_MAX),
        vz: dz * sp,
        age: 0,
        left: T.LOOSE_TICKS,
        falling: false,
        kickCd: 0,
      });
      this.emit("pixelOff", v.idx, c.pid, undefined, px, pz);
    }
  }

  private edge(f: Fighter): void {
    if (f.state === SumoFighterState.Falling || f.state === SumoFighterState.Out) return;
    const d2 = f.x * f.x + f.z * f.z;
    const outside = d2 > this.ringR * this.ringR;
    if (f.state === SumoFighterState.Hover) {
      if (!outside) {
        f.state = SumoFighterState.Ring;
        return;
      }
      f.hoverLeft--;
      if (f.hoverLeft <= 0) this.ringOut(f);
      return;
    }
    if (!outside) return;
    if (f.hoverLeft > 0) {
      f.state = SumoFighterState.Hover;
      f.armedTicks = 0;
      f.chargeTicks = 0;
      // Hover kills most of the outward momentum (the glide catches the wind).
      f.vx *= 0.35;
      f.vz *= 0.35;
      this.emit("hover", f.idx, undefined, undefined, f.x, f.z);
      return;
    }
    this.ringOut(f);
  }

  private ringOut(f: Fighter): void {
    f.state = SumoFighterState.Falling;
    f.fallTicks = 0;
    f.armedTicks = 0;
    f.chargeTicks = 0;
    f.ringouts++;
    const credit = f.lastHitBy >= 0 && this.tick - f.lastHitTick <= T.CREDIT_TICKS ? f.lastHitBy : -1;
    if (credit >= 0 && this.phase === SumoPhase.Fight) {
      const c = this.fighters[credit];
      if (c) c.kos++;
      if (credit === 0) this.score += T.SCORE_KO;
    }
    this.emit("ringout", f.idx, credit, undefined, f.x, f.z);
  }

  private stepDebris(): void {
    const keep: Debris[] = [];
    for (const d of this.debris) {
      const owner = this.fighters[d.owner];
      if (!owner) continue;
      d.age++;
      d.left--;
      if (d.kickCd > 0) d.kickCd--;
      if (d.falling) {
        d.vy -= T.DEBRIS_G * T.DT;
        d.y += d.vy * T.DT;
        d.x += d.vx * T.DT;
        d.z += d.vz * T.DT;
        if (d.y < -T.DEBRIS_FALL_DEPTH) {
          owner.pixels[d.pid] = SumoPx.Gone;
          this.emit("pixelGone", d.owner, d.pid, 1, d.x, d.z);
          continue;
        }
        keep.push(d);
        continue;
      }
      // Air / ground motion.
      if (d.y > 0 || d.vy > 0) {
        d.vy -= T.DEBRIS_G * T.DT;
        d.y += d.vy * T.DT;
        if (d.y <= 0) {
          d.y = 0;
          d.vy = d.vy < -24 ? -d.vy * 0.3 : 0;
        }
      } else {
        const keepV = 1 - T.DEBRIS_DAMP * T.DT;
        d.vx *= keepV;
        d.vz *= keepV;
        if (owner.trait.crawl && this.inPlay(owner)) {
          const dx = owner.x - d.x;
          const dz = owner.z - d.z;
          const l = Math.sqrt(dx * dx + dz * dz);
          if (l > 0.5) {
            d.x += (dx / l) * T.CRAWL_SPEED * T.DT;
            d.z += (dz / l) * T.CRAWL_SPEED * T.DT;
          }
        }
      }
      d.x += d.vx * T.DT;
      d.z += d.vz * T.DT;
      // Off the edge: it falls (gone for the match).
      if (d.x * d.x + d.z * d.z > (this.ringR + 1) * (this.ringR + 1)) {
        d.falling = true;
        if (d.vy > 0) d.vy = 0;
        keep.push(d);
        continue;
      }
      // Pickup by its owner, kicks by the others.
      let taken = false;
      for (const f of this.fighters) {
        if (!this.inPlay(f)) continue;
        const dx = f.x - d.x;
        const dz = f.z - d.z;
        const reach = f.radius + T.PICK_REACH * (f === owner && this.braced(f) ? 2 : 1);
        if (dx * dx + dz * dz > reach * reach) continue;
        if (f === owner) {
          if (d.age >= T.PICK_DELAY && d.y <= 1 && this.phase !== SumoPhase.Done) {
            owner.pixels[d.pid] = SumoPx.Body;
            owner.present++;
            owner.grabbed++;
            if (owner.idx === 0 && this.phase === SumoPhase.Fight) this.score += T.SCORE_GRAB;
            this.emit("pixelBack", d.owner, d.pid, 1, d.x, d.z);
            taken = true;
            break;
          }
        } else if (d.kickCd === 0 && f.vx * f.vx + f.vz * f.vz > T.KICK_SPEED * T.KICK_SPEED && d.y <= 1) {
          d.vx += f.vx * 0.8;
          d.vz += f.vz * 0.8;
          d.vy = 12;
          d.kickCd = 12;
        }
      }
      if (taken) continue;
      if (d.left <= 0) {
        owner.pixels[d.pid] = SumoPx.Gone;
        this.emit("pixelGone", d.owner, d.pid, 2, d.x, d.z);
        continue;
      }
      keep.push(d);
    }
    this.debris = keep;
  }

  private stepTrail(): void {
    if (this.trail.length === 0) return;
    this.trail = this.trail.filter((p) => p.expires > this.tick);
    for (const f of this.fighters) {
      if (!this.inPlay(f)) continue;
      for (const p of this.trail) {
        if (p.owner === f.idx) continue;
        const dx = f.x - p.x;
        const dz = f.z - p.z;
        const r = T.TRAIL_RADIUS + f.radius * 0.5;
        if (dx * dx + dz * dz <= r * r) {
          f.slickUntil = this.tick + T.SLICK_TICKS;
          break;
        }
      }
    }
  }

  private checkRoundEnd(): void {
    let alive = 0;
    let last = -1;
    let falling = false;
    for (const f of this.fighters) {
      if (this.inPlay(f)) {
        alive++;
        last = f.idx;
      } else if (f.state === SumoFighterState.Falling) falling = true;
    }
    let winner: number | null = null;
    if (alive <= 1 && !falling) winner = alive === 1 ? last : -1;
    else if (this.phaseTicks + 1 >= T.ROUND_MAX) {
      // Time: the survivor with the most pixels, then the one nearest the centre, then the lowest index.
      let best: Fighter | null = null;
      for (const f of this.fighters) {
        if (!this.inPlay(f)) continue;
        if (
          !best ||
          f.present > best.present ||
          (f.present === best.present && f.x * f.x + f.z * f.z < best.x * best.x + best.z * best.z)
        )
          best = f;
      }
      winner = best ? best.idx : -1;
    }
    if (winner === null) return;
    const w = this.fighters[winner];
    if (w) {
      w.wins++;
      if (winner === 0) this.score += T.SCORE_ROUND;
    }
    this.roundWinners.push(winner);
    this.emit("roundEnd", winner, this.round);
    this.setPhase(SumoPhase.RoundEnd);
    // `step` increments phaseTicks after this; start the end beat at 0.
    this.phaseTicks = -1;
  }
}
