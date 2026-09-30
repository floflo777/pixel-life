/**
 * The Pixel Life world: all mutable run state and the fixed 60 Hz step (architecture §3, GDD §2–§4). Creature AI lives in
 * `creatures.ts`, Old Gulp in `gulp.ts`; everything else (Friend body, fling, traits, loose pixels, scoring, spawning,
 * run end) is here. Iteration order is always array order; removal is stable compaction, so replays are bit-identical.
 */
import { fromIndices } from "../bitmap.js";
import { maxPersistedLost, runScarCap } from "../friend.js";
import { RUN_TICKS, type SimConfig, type SimEvent, type SimEventType, type SimInput } from "../sim-types.js";
import { angleDelta, angleOf, cosA, powerCurve, sinA } from "./fixed-math.js";
import { Island } from "./arena.js";
import {
  activateCreature,
  type Creature,
  killCreature,
  newCreature,
  stepCreatures,
  trailHitCreature,
} from "./creatures.js";
import {
  EDGE_FALL,
  EDGE_HOVER,
  EDGE_PIXELS,
  EDGE_RESPAWN,
  EDGE_SAVED,
  END_CRUMBLE,
  END_TIME,
  HIT_BUMPER,
  LOST_EDGE,
  LOST_END,
  LOST_GULP,
  LOST_RINGOUT,
  LOST_TIMEOUT,
  TRAIT_HOOK,
  TRAIT_MERGE,
  TRAIT_QUAKE,
  TRAIT_SPLIT,
  TRAIT_TRAIL,
} from "./events.js";
import { GulpState, stepGulp } from "./gulp.js";
import { type BodyShape, emptyShape, FriendPixels, SLOT_BODY, SLOT_LOOSE, SLOT_LOST, SLOT_SAFE } from "./pixels.js";
import { Rng } from "./rng.js";
import { trait, type TraitParams } from "./traits.js";
import * as T from "./tuning.js";
import type { V2 } from "./vec.js";

/** One physical Friend body: the whole Friend, or one Mitosis half. Position = world position of its sprite centroid. */
export interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Shape (mass, centroid, collider) measured from its pixels. */
  shape: BodyShape;
}

/** A loose pixel cube (GDD §2.5). */
export interface Debris {
  pid: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Ticks left in the grab window (frozen while carried). */
  left: number;
  /** Window length it started with (for the renderer's shrinking ring). */
  window: number;
  /** Ticks since it detached. */
  age: number;
  /** Id of the Snatch carrying it, or −1. */
  carriedBy: number;
  /** Id of the Snatch that has claimed it (swooping), or −1. */
  claimedBy: number;
  /** Spark Trail bonus already granted. */
  boosted: boolean;
  /** Pond float bonus already granted. */
  ponded: boolean;
  /** Marked for removal (grabbed or lost this tick). */
  gone: boolean;
  /** Id of the bite that knocked it off (perfect-sweep bookkeeping). */
  bite: number;
}

/** A bite whose loose pixels are still out (perfect-sweep bookkeeping, GDD §2.9 balance pass). */
export interface OpenBite {
  id: number;
  /** Loose pixels of this bite not yet grabbed back or lost. */
  left: number;
  /** At least one of its pixels was lost: no perfect sweep. */
  lost: boolean;
  /** Chain (tenths) the bite broke; a perfect sweep wins back half of what it lost. */
  chain: number;
}

/** A star crumb popped out of a Gulp tooth (+20 when swept). */
export interface Crumb {
  x: number;
  z: number;
  left: number;
}

/** A Spark Trail sample (Sparkling). */
export interface TrailPoint {
  x: number;
  z: number;
  expires: number;
}

/** The fling currently in progress (release until every body drops below FLY_THRESHOLD). */
interface Fling {
  active: boolean;
  start: number;
  kills: number;
  pow: number;
  ang: number;
  quake: boolean;
  trail: boolean;
  hookTotal: number;
  hookDone: number;
  /** The fling did something useful without a kill (grab-back, crumb, tooth): it holds the chain instead of whiffing. */
  kept: boolean;
}

const RS_NONE = 0;
const RS_FALLING = 1;
const RS_WAITING = 2;

/** Stream ids for the per-subsystem PRNGs. */
const STREAM_SPAWN = 1;
const STREAM_BITE = 2;
const STREAM_AI = 3;
const STREAM_GULP = 4;
const STREAM_WORLD = 5;

/** Full mutable state of one run plus the step function. Construct through `createSim` unless testing internals. */
export class World {
  readonly cfg: SimConfig;
  readonly island: Island;
  readonly pixels: FriendPixels;
  readonly traits: TraitParams;
  readonly familyId: number;
  readonly rngSpawn: Rng;
  readonly rngBite: Rng;
  readonly rngAi: Rng;
  readonly rngGulp: Rng;
  readonly rngWorld: Rng;
  /** Whether events are recorded (headless replays turn it off). */
  recordEvents = true;
  events: SimEvent[] = [];

  tick = 0;
  done = false;
  endReason = -1;
  score = 0;
  /** Chain multiplier in tenths (10 = ×1.0). */
  chain = T.CHAIN_BASE;
  /** Combo of the current fling (0 when none). */
  combo = 0;
  smashed = 0;
  recovered = 0;
  /** Pixels lost this run (persisted + safety). */
  lostRun = 0;
  /** Pixels lost this run that persist as scars. */
  persisted = 0;
  /** Effective persisted-scar allowance this run: min(runScarCap, room above the 50 % floor). */
  readonly scarAllowance: number;
  ringouts = 0;
  bitesTaken = 0;
  pixelsOff = 0;

  bodies: Body[] = [];
  split = false;
  /** Ticks both Mitosis halves have been still. */
  mergeStill = 0;
  cooldownUntil = 0;
  invulnUntil = 0;
  ringState = RS_NONE;
  ringTimer = 0;
  ringDirX = 1;
  ringDirZ = 0;
  /** Hoverer hover ticks left (0 = not hovering). */
  hover = 0;
  hoverPushOn = false;
  hoverPushAng = 0;
  steerOn = false;
  steerDir = 0;
  lastFlingTick = -1000;
  lastFlingPow = 0;
  readonly heavySide: number;
  fling: Fling = {
    active: false,
    start: 0,
    kills: 0,
    pow: 0,
    ang: 0,
    quake: false,
    trail: false,
    hookTotal: 0,
    hookDone: 0,
    kept: false,
  };
  /** Tick at which a pending whiff resets the chain (−1 = none pending), see WHIFF_GRACE. */
  whiffAt = -1;
  /** Bites whose loose pixels are still out, oldest first. */
  openBites: OpenBite[] = [];
  nextBiteId = 1;

  debris: Debris[] = [];
  creatures: Creature[] = [];
  nextCreatureId = 1;
  spawnBank = 0;
  /** Kind drawn for the next spawn (−1 = draw again). */
  nextKind = -1;
  phase = 0;
  crumbs: Crumb[] = [];
  trail: TrailPoint[] = [];
  lastTrailSample = -1000;
  windX = 0;
  windZ = 0;
  readonly gulp: GulpState;

  /** Scratch vector (never escapes a method). */
  private readonly tmp: V2 = { x: 0, z: 0 };

  /** Builds tick 0 from `cfg`; throws `RangeError` on an invalid config. */
  constructor(cfg: SimConfig) {
    validateConfig(cfg);
    this.cfg = cfg;
    const seed = cfg.seed >>> 0;
    this.rngSpawn = new Rng(seed, STREAM_SPAWN);
    this.rngBite = new Rng(seed, STREAM_BITE);
    this.rngAi = new Rng(seed, STREAM_AI);
    this.rngGulp = new Rng(seed, STREAM_GULP);
    this.rngWorld = new Rng(seed, STREAM_WORLD);
    this.island = new Island(cfg.arena);
    this.pixels = new FriendPixels(cfg.friend.front, cfg.friend.lost, cfg.friend.gold);
    this.familyId = cfg.friend.familyId;
    this.traits = trait(cfg.friend.familyId);
    const n0 = this.pixels.n0;
    const priorLost = n0 - this.pixels.startPresent;
    this.scarAllowance = n0 === 0 ? 0 : Math.max(0, Math.min(runScarCap(n0), maxPersistedLost(n0) - priorLost));
    const shape = emptyShape();
    this.pixels.measure(0, shape);
    this.bodies.push({ x: 0, z: 0, vx: 0, vz: 0, shape });
    this.heavySide = this.pixels.heavySide();
    this.gulp = new GulpState(this.rngGulp);
    if (this.island.def.wind > 0) this.reseedWind();
  }

  // ── Events ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Records an event (no-op in headless replays). */
  emit(type: SimEventType, a = 0, b = 0, x = 0, z = 0): void {
    if (this.recordEvents) this.events.push({ t: this.tick, type, a, b, x, z });
  }

  // ── Queries used by creatures / gulp ─────────────────────────────────────────────────────────────────────────────

  /** Speed of body i. */
  speed(b: Body): number {
    return Math.sqrt(b.vx * b.vx + b.vz * b.vz);
  }

  /** True iff the body is PREY (slow enough to be bitten). */
  isPrey(b: Body): boolean {
    return this.speed(b) < T.FLY_THRESHOLD;
  }

  /** True iff creatures can currently hurt the Friend (not falling, respawning or invulnerable). */
  vulnerable(): boolean {
    return !this.done && this.ringState === RS_NONE && this.hover === 0 && this.tick >= this.invulnUntil;
  }

  /** True iff the Friend is physically in play (not falling or waiting to respawn). */
  inPlay(): boolean {
    return this.ringState === RS_NONE;
  }

  /** Index of the body nearest to (x, z). */
  nearestBody(x: number, z: number): number {
    if (this.bodies.length === 1) return 0;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if (!b) continue;
      const d = (b.x - x) * (b.x - x) + (b.z - z) * (b.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Body i (always exists for i in range; falls back to body 0). */
  body(i: number): Body {
    const b = this.bodies[i] ?? this.bodies[0];
    if (!b) throw new Error("World has no body.");
    return b;
  }

  /** True iff at least one loose pixel exists that is not carried. */
  hasLooseDebris(): boolean {
    for (const d of this.debris) if (!d.gone && d.carriedBy < 0) return true;
    return false;
  }

  /** Current wave phase: 0 drop-in, 1 snack time, 2 rush, 3 frenzy, 4 last light. */
  wavePhase(): number {
    const t = this.tick;
    if (t < T.WAVE1_START) return 0;
    if (t < T.WAVE2_START) return 1;
    if (t < T.FRENZY_START) return 2;
    if (t < T.LAST_LIGHT_START) return 3;
    return 4;
  }

  // ── Inputs ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Applies a fling input (angle 0..4095, power 0..1023). Invalid or ill-timed flings are ignored deterministically. */
  applyFling(ang: number, pow: number): void {
    if (this.done || this.tick < T.DROP_IN_LOCK) return;
    if (this.hover > 0) {
      this.hoverPushOn = true;
      this.hoverPushAng = ang;
      return;
    }
    if (this.ringState !== RS_NONE || pow < T.MIN_POW || this.tick < this.cooldownUntil) return;
    for (const b of this.bodies) if (this.speed(b) >= T.READY_THRESHOLD) return;
    if (this.fling.active) this.endFling();
    if (this.whiffAt >= 0) this.resolveWhiff();
    this.lastFlingTick = this.tick;
    this.lastFlingPow = pow;
    this.cooldownUntil = this.tick + T.LAUNCH_COOLDOWN;
    const mass = this.totalMass();
    const mf = Math.sqrt(T.M_REF / mass);
    const v0 =
      T.V_MAX *
      powerCurve(pow) *
      (mf < T.MASS_FACTOR_MIN ? T.MASS_FACTOR_MIN : mf > T.MASS_FACTOR_MAX ? T.MASS_FACTOR_MAX : mf);
    if (this.traits.mitosis && !this.split && pow >= T.MITOSIS_MIN_POW) this.doSplit();
    if (this.bodies.length === 2) {
      this.launchBody(this.body(0), ang - T.MITOSIS_SPREAD, v0);
      this.launchBody(this.body(1), ang + T.MITOSIS_SPREAD, v0);
      this.mergeStill = 0;
    } else {
      this.launchBody(this.body(0), ang, v0);
    }
    const f = this.fling;
    f.active = true;
    f.start = this.tick;
    f.kills = 0;
    f.kept = false;
    f.pow = pow;
    f.ang = ang;
    f.quake = this.traits.quake && pow >= T.QUAKE_MIN_POW;
    f.trail = this.traits.sparkTrail;
    f.hookDone = 0;
    f.hookTotal =
      this.traits.hook && this.bodies.length === 1
        ? Math.round(T.HOOK_PATH_SHARE * stopTicks(v0, this.dampMult(this.body(0))))
        : 0;
    this.combo = 0;
    this.emit("launch", ang, pow, this.body(0).x, this.body(0).z);
    if (f.hookTotal > 0) this.emit("trait", this.familyId, TRAIT_HOOK, this.heavySide, 0);
    if (f.trail) this.emit("trait", this.familyId, TRAIT_TRAIL, 0, 0);
  }

  /** Applies a steer toggle (k = 1). */
  applySteer(dir: number, on: 0 | 1): void {
    if (this.done) return;
    this.steerOn = on === 1;
    this.steerDir = dir;
    if (this.hover > 0 && this.steerOn) {
      this.hoverPushOn = true;
      this.hoverPushAng = dir;
    }
  }

  private launchBody(b: Body, ang: number, v0: number): void {
    b.vx = cosA(ang) * v0;
    b.vz = sinA(ang) * v0;
  }

  /** Total present mass (pixels on the body, gold counts as 1), at least 1. */
  totalMass(): number {
    let m = 0;
    for (const b of this.bodies) m += b.shape.count;
    return m < 1 ? 1 : m;
  }

  /** Damping multiplier for a body at its position (Glide, pond). */
  dampMult(b: Body): number {
    let m = this.traits.dampMult;
    if (this.island.inPond(b.x, b.z)) m *= T.POND_DAMP_MULT;
    return m;
  }

  // ── Mitosis ───────────────────────────────────────────────────────────────────────────────────────────────────────

  private doSplit(): void {
    const whole = this.body(0);
    const old = whole.shape;
    if (!this.pixels.split()) return;
    const s0 = emptyShape();
    const s1 = emptyShape();
    this.pixels.measure(0, s0);
    this.pixels.measure(1, s1);
    const b0: Body = { x: whole.x + s0.cx - old.cx, z: whole.z + s0.cz - old.cz, vx: 0, vz: 0, shape: s0 };
    const b1: Body = { x: whole.x + s1.cx - old.cx, z: whole.z + s1.cz - old.cz, vx: 0, vz: 0, shape: s1 };
    this.bodies = [b0, b1];
    this.split = true;
    this.mergeStill = 0;
    this.emit("trait", this.familyId, TRAIT_SPLIT, whole.x, whole.z);
  }

  private doMerge(): void {
    const b0 = this.body(0);
    const s0 = b0.shape;
    this.pixels.merge();
    const s = emptyShape();
    this.pixels.measure(0, s);
    this.bodies = [{ x: b0.x + s.cx - s0.cx, z: b0.z + s.cz - s0.cz, vx: 0, vz: 0, shape: s }];
    this.split = false;
    this.mergeStill = 0;
    this.emit("trait", this.familyId, TRAIT_MERGE, this.body(0).x, this.body(0).z);
  }

  private stepMerge(): void {
    if (!this.split || this.ringState !== RS_NONE) return;
    const b0 = this.body(0);
    const b1 = this.body(1);
    if (this.speed(b0) > 0.5 || this.speed(b1) > 0.5) {
      this.mergeStill = 0;
      return;
    }
    this.mergeStill++;
    if (this.mergeStill < T.MITOSIS_MERGE_DELAY) return;
    // Pull the halves together until they sit at their sprite offset again (kinematic: they stay PREY while merging).
    const ex = b1.x - b0.x - (b1.shape.cx - b0.shape.cx);
    const ez = b1.z - b0.z - (b1.shape.cz - b0.shape.cz);
    const l = Math.sqrt(ex * ex + ez * ez);
    const stepLen = T.MITOSIS_PULL_SPEED * T.DT;
    if (l <= stepLen * 2 || l < 0.5) {
      b1.x -= ex / 2;
      b1.z -= ez / 2;
      b0.x += ex / 2;
      b0.z += ez / 2;
      this.doMerge();
      return;
    }
    b0.x += (ex / l) * stepLen;
    b0.z += (ez / l) * stepLen;
    b1.x -= (ex / l) * stepLen;
    b1.z -= (ez / l) * stepLen;
  }

  // ── Pixel damage ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** Re-measures body i after its pixels changed, keeping the remaining pixels where they were in the world. */
  remeasure(i: number): void {
    const b = this.bodies[i];
    if (!b) return;
    const ocx = b.shape.cx;
    const ocz = b.shape.cz;
    this.pixels.measure(i, b.shape);
    if (b.shape.count > 0) {
      b.x += b.shape.cx - ocx;
      b.z += b.shape.cz - ocz;
    }
  }

  /**
   * Knocks `k` pixels off body `bi` for a hit whose contact direction (attacker → Friend, unit) is (ax, az). Detached
   * pixels become loose debris flung away from the attacker; the Friend is knocked back by J / m. Returns pixels detached.
   */
  biteFriend(bi: number, k: number, ax: number, az: number, attacker: number, j: number): number {
    const b = this.body(bi);
    const glanced: number[] = [];
    const picked = this.pixels.selectBite(bi, b.shape, ax, az, k, this.rngBite, glanced);
    for (const g of glanced) this.emit("glance", g, this.pixels.cracks[g] ?? 0, b.x, b.z);
    if (picked.length === 0) return 0;
    const shape = b.shape;
    const baseAng = angleOf(ax, az);
    const biteId = this.nextBiteId++;
    this.openBites.push({ id: biteId, left: picked.length, lost: false, chain: this.chain });
    for (const pid of picked) {
      this.pixels.slot[pid] = SLOT_LOOSE;
      const col = pid & 15;
      const row = pid >> 4;
      const ang = baseAng + this.rngBite.int(2 * T.DEBRIS_CONE + 1) - T.DEBRIS_CONE;
      const sp = this.rngBite.range(T.DEBRIS_SPEED_MIN, T.DEBRIS_SPEED_MAX);
      const window = this.traits.grabWindow;
      const d: Debris = {
        pid,
        x: b.x + (col + 0.5 - shape.cx),
        y: shape.maxRow - row + 0.5,
        z: b.z,
        vx: cosA(ang) * sp,
        vy: this.rngBite.range(T.DEBRIS_UP_MIN, T.DEBRIS_UP_MAX),
        vz: sinA(ang) * sp,
        left: window,
        window,
        age: 0,
        carriedBy: -1,
        claimedBy: -1,
        boosted: false,
        ponded: false,
        gone: false,
        bite: biteId,
      };
      this.debris.push(d);
      this.pixelsOff++;
      this.emit("pixelOff", pid, attacker, d.x, d.z);
    }
    this.remeasure(bi);
    const m = b.shape.count < 1 ? 1 : b.shape.count;
    b.vx += (ax * j) / m;
    b.vz += (az * j) / m;
    this.bitesTaken++;
    this.whiffAt = -1;
    if (this.chain !== T.CHAIN_BASE) {
      this.chain = T.CHAIN_BASE;
      this.emit("chain", this.chain, 0, b.x, b.z);
    }
    this.emit("bite", attacker, picked.length, b.x, b.z);
    return picked.length;
  }

  /** Marks pid lost this run: a persisted scar while the allowance lasts, otherwise a safety-stitched (returning) loss. */
  losePixel(pid: number, reason: number, x: number, z: number): void {
    if (this.persisted < this.scarAllowance) {
      this.pixels.slot[pid] = SLOT_LOST;
      this.persisted++;
    } else {
      this.pixels.slot[pid] = SLOT_SAFE;
    }
    this.lostRun++;
    this.emit("pixelLost", pid, reason, x, z);
  }

  /** Loses a loose debris cube (removed at the end of the tick). */
  loseDebris(d: Debris, reason: number): void {
    if (d.gone) return;
    d.gone = true;
    const ob = this.settleBite(d.bite);
    if (ob) ob.lost = true;
    this.losePixel(d.pid, reason, d.x, d.z);
  }

  /** One loose pixel of bite `id` is resolved (grabbed or lost): returns its record, dropped once nothing is left. */
  private settleBite(id: number): OpenBite | undefined {
    for (let i = 0; i < this.openBites.length; i++) {
      const ob = this.openBites[i];
      if (!ob || ob.id !== id) continue;
      ob.left--;
      if (ob.left <= 0) this.openBites.splice(i, 1);
      return ob;
    }
    return undefined;
  }

  private grabDebris(d: Debris, bi: number): void {
    d.gone = true;
    this.pixels.slot[d.pid] = SLOT_BODY;
    this.remeasure(this.pixels.half[d.pid] ?? 0);
    this.recovered++;
    const clutch = d.left <= T.CLUTCH_LEFT;
    this.score += clutch ? T.PTS_CLUTCH : T.PTS_GRAB;
    this.keepChain();
    const b = this.body(bi);
    this.emit("pixelBack", d.pid, clutch ? 1 : 0, b.x, b.z);
    const ob = this.settleBite(d.bite);
    if (ob && ob.left <= 0 && !ob.lost) {
      // Perfect sweep: the whole bite came home, so half of the chain the bite broke comes back. No extra points (a
      // bonus here paid novices for being bitten) and not the whole chain (novices are bitten, and sweep, far more).
      const back = Math.floor((ob.chain + T.CHAIN_BASE) / 2);
      if (back > this.chain) {
        this.chain = back;
        this.emit("chain", this.chain, 0, b.x, b.z);
      }
    }
  }

  // ── Scoring ───────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Scores a pop of creature `c` (value × combo × chain, ×1.5 in Last Light, ×2 for an air pop). Returns points. */
  scoreKill(c: Creature, air: boolean): number {
    const def = T.CREATURE_DEFS[c.kind];
    const base = def ? def.points : 0;
    let combo = 1;
    if (this.fling.active) {
      this.fling.kills++;
      combo = this.fling.kills > T.COMBO_CAP ? T.COMBO_CAP : this.fling.kills;
      this.combo = combo;
    }
    const last = this.tick >= T.LAST_LIGHT_START ? 3 : 2;
    const pts = Math.round((base * combo * this.chain * last * (air ? 2 : 1)) / 20);
    this.score += pts;
    this.smashed++;
    this.emit("smash", c.id, pts, c.x, c.z);
    if (combo >= 2) this.emit("combo", combo, pts, c.x, c.z);
    return pts;
  }

  /** Adds (or with a negative value, removes) points; the score never drops below 0. */
  addScore(p: number): void {
    this.score = Math.max(0, this.score + p);
  }

  /**
   * Ends the current fling: Quake stomp, then the chain rule (≥ 1 kill: +CHAIN_STEP; a fling that grabbed back a pixel,
   * swept a crumb or knocked a tooth holds the chain; otherwise it is a whiff costing CHAIN_WHIFF, unless a grab-back or
   * crumb follows within WHIFF_GRACE).
   */
  endFling(): void {
    const f = this.fling;
    if (!f.active) return;
    if (f.quake && this.inPlay()) this.quake();
    f.active = false;
    const prev = this.chain;
    if (f.kills > 0) this.chain = Math.min(T.CHAIN_CAP, this.chain + T.CHAIN_STEP);
    else if (!f.kept) this.whiffAt = this.tick + T.WHIFF_GRACE;
    if (this.chain !== prev) this.emit("chain", this.chain, f.kills, this.body(0).x, this.body(0).z);
    this.combo = 0;
    f.hookTotal = 0;
  }

  /** Something useful happened (grab-back, crumb, tooth): the current fling, or a pending whiff, holds the chain. */
  keepChain(): void {
    if (this.fling.active) this.fling.kept = true;
    else this.whiffAt = -1;
  }

  /** A whiff's grace ran out (or a new fling started first): the chain drops by CHAIN_WHIFF (not below ×1.0). */
  private resolveWhiff(): void {
    this.whiffAt = -1;
    if (this.chain === T.CHAIN_BASE) return;
    this.chain = Math.max(T.CHAIN_BASE, this.chain - T.CHAIN_WHIFF);
    this.emit("chain", this.chain, 0, this.body(0).x, this.body(0).z);
  }

  private quake(): void {
    const b = this.body(0);
    this.emit("trait", this.familyId, TRAIT_QUAKE, b.x, b.z);
    for (const c of this.creatures) {
      if (c.dead || c.spawn > 0) continue;
      const d = Math.sqrt((c.x - b.x) * (c.x - b.x) + (c.z - b.z) * (c.z - b.z)) - c.r;
      if (d > T.QUAKE_RADIUS) continue;
      if (c.kind === T.NIB || c.kind === T.POGO || c.kind === T.FIZZ) killCreature(this, c, true, false);
      else c.stun = Math.max(c.stun, T.QUAKE_STUN);
    }
  }

  // ── Step ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Advances one tick; `inputs` are applied first, in order. No-op once done. */
  step(inputs: readonly SimInput[]): void {
    if (this.done) return;
    for (const i of inputs) {
      if (i.k === 0) this.applyFling(i.ang, i.pow);
      else this.applySteer(i.dir, i.on);
    }
    const ph = this.wavePhase();
    if (ph !== this.phase) {
      this.phase = ph;
      this.emit("phase", ph);
    }
    if (this.island.def.wind > 0 && this.tick > 0 && this.tick % T.WIND_PERIOD === 0) this.reseedWind();
    stepGulp(this);
    this.spawn();
    this.stepFriend();
    stepCreatures(this);
    this.stepDebris();
    this.stepCrumbs();
    this.stepTrail();
    if (this.fling.active && this.tick > this.fling.start) {
      let stopped = true;
      for (const b of this.bodies) if (this.speed(b) >= T.FLY_THRESHOLD) stopped = false;
      if (stopped || this.ringState !== RS_NONE) this.endFling();
    }
    if (this.whiffAt >= 0 && this.tick >= this.whiffAt) this.resolveWhiff();
    this.compact();
    this.tick++;
    if (this.lostRun > 0 && (this.pixels.startPresent - this.lostRun) * 2 <= this.pixels.n0) this.endRun(END_CRUMBLE);
    else if (this.tick >= RUN_TICKS) this.endRun(END_TIME);
  }

  private reseedWind(): void {
    const ang = this.rngWorld.int(4096);
    this.windX = cosA(ang) * this.island.def.wind;
    this.windZ = sinA(ang) * this.island.def.wind;
  }

  private compact(): void {
    if (this.debris.some((d) => d.gone)) this.debris = this.debris.filter((d) => !d.gone);
    if (this.creatures.some((c) => c.dead)) this.creatures = this.creatures.filter((c) => !c.dead);
  }

  private endRun(reason: number): void {
    for (const d of this.debris) if (!d.gone) this.loseDebris(d, LOST_END);
    this.debris = [];
    const start = this.pixels.startPresent;
    if (start > 0) this.score += Math.round((T.PTS_SURVIVAL * (start - this.persisted)) / start);
    if (this.lostRun === 0) this.score += T.PTS_FLAWLESS;
    this.done = true;
    this.endReason = reason;
    this.emit("end", reason, this.score);
  }

  // ── Spawning (GDD §3.9) ───────────────────────────────────────────────────────────────────────────────────────────

  private spawn(): void {
    const t = this.tick;
    if (t < T.WAVE1_START || t >= T.LAST_LIGHT_START || (t - T.WAVE1_START) % T.SPAWN_STEP !== 0) return;
    let win: T.SpawnWindow | undefined;
    for (const w of T.SPAWN_WINDOWS) if (t >= w.from && t < w.to) win = w;
    if (!win) return;
    const budget = win.b0 + ((win.b1 - win.b0) * (t - win.from)) / (win.to - win.from);
    this.spawnBank = Math.min(6, this.spawnBank + budget * 0.25);
    const counts = [0, 0, 0, 0, 0, 0];
    for (const c of this.creatures) if (!c.dead) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    let alive = 0;
    for (const n of counts) alive += n;
    if (alive >= win.maxAlive) return;
    // The next kind is drawn by weight among the kinds allowed now, then waits until the bank can pay for it, so
    // expensive creatures appear at their table share instead of being starved by cheap ones.
    const loose = this.hasLooseDebris();
    const allowed = (k: number): boolean => {
      const def = T.CREATURE_DEFS[k];
      if (!def || (win.weights[k] ?? 0) <= 0 || (counts[k] ?? 0) >= def.maxAlive) return false;
      return k !== T.SNATCH || loose;
    };
    if (this.nextKind < 0 || !allowed(this.nextKind)) {
      let total = 0;
      const weights = [0, 0, 0, 0, 0, 0];
      for (let k = 0; k < T.KIND_COUNT; k++) {
        if (!allowed(k)) continue;
        const w = (win.weights[k] ?? 0) * (k === T.SNATCH ? this.island.def.snatchMult : 1);
        weights[k] = w;
        total += w;
      }
      if (total <= 0) return;
      let r = this.rngSpawn.float() * total;
      this.nextKind = -1;
      for (let k = 0; k < T.KIND_COUNT && this.nextKind < 0; k++) {
        const w = weights[k] ?? 0;
        if (w <= 0) continue;
        if (r < w) this.nextKind = k;
        else r -= w;
      }
      if (this.nextKind < 0) this.nextKind = weights.findLastIndex((w) => w > 0);
    }
    const kind = this.nextKind;
    const cost = T.CREATURE_DEFS[kind]?.cost ?? 0;
    if (cost > this.spawnBank) return;
    const valid: number[] = [];
    for (let s = 0; s < this.island.slots.length; s++) {
      const p = this.island.slots[s];
      if (!p) continue;
      if ((this.island.wedgeOn || this.island.wedgeShadow) && this.island.inWedgeSector(p.x, p.z)) continue;
      let ok = true;
      for (const b of this.bodies)
        if ((b.x - p.x) * (b.x - p.x) + (b.z - p.z) * (b.z - p.z) < T.SPAWN_MIN_DIST * T.SPAWN_MIN_DIST) ok = false;
      if (ok) valid.push(s);
    }
    if (valid.length === 0) return;
    const slot = this.island.slots[valid[this.rngSpawn.int(valid.length)] ?? 0];
    if (!slot) return;
    this.spawnBank -= cost;
    this.nextKind = -1;
    this.addCreature(kind, slot.x, slot.z, T.SPAWN_RIPPLE);
  }

  /** Adds a creature (with a ripple of `ripple` ticks before it acts). Exposed for tests and scripted spawns. */
  addCreature(kind: number, x: number, z: number, ripple: number): Creature {
    const c = newCreature(this, this.nextCreatureId++, kind, x, z, ripple);
    this.creatures.push(c);
    this.emit("spawn", c.id, kind, x, z);
    if (ripple <= 0) activateCreature(this, c);
    return c;
  }

  // ── Friend physics ────────────────────────────────────────────────────────────────────────────────────────────────

  private stepFriend(): void {
    if (this.ringState !== RS_NONE) {
      this.stepRingout();
      return;
    }
    const f = this.fling;
    for (let bi = 0; bi < this.bodies.length; bi++) {
      const b = this.body(bi);
      let sp = this.speed(b);
      // Steering (a gentle sweep that never reaches FLYING speed).
      if (this.steerOn && this.hover === 0 && sp < T.STEER_MAX_SPEED) {
        b.vx += cosA(this.steerDir) * T.STEER_ACCEL * T.DT;
        b.vz += sinA(this.steerDir) * T.STEER_ACCEL * T.DT;
      }
      if (this.windX !== 0 || this.windZ !== 0) {
        b.vx += this.windX * T.DT;
        b.vz += this.windZ * T.DT;
      }
      if (this.gulp.inhaling()) {
        const dx = this.gulp.mouthX - b.x;
        const dz = this.gulp.mouthZ - b.z;
        const l = Math.sqrt(dx * dx + dz * dz);
        if (l > 0) {
          b.vx += (dx / l) * T.INHALE_ACCEL * T.DT;
          b.vz += (dz / l) * T.INHALE_ACCEL * T.DT;
        }
      }
      if (this.hover > 0 && this.hoverPushOn) {
        b.vx += cosA(this.hoverPushAng) * T.HOVER_PUSH * T.DT;
        b.vz += sinA(this.hoverPushAng) * T.HOVER_PUSH * T.DT;
      }
      sp = this.speed(b);
      // Asymmetry hook: bend the heading by HOOK_ANGLE over the first 60 % of the predicted slide.
      if (bi === 0 && f.active && f.hookTotal > 0 && f.hookDone < f.hookTotal && sp > 0) {
        f.hookDone++;
        const ang = f.ang + this.heavySide * Math.round((T.HOOK_ANGLE * f.hookDone) / f.hookTotal);
        b.vx = cosA(ang) * sp;
        b.vz = sinA(ang) * sp;
      }
      if (sp > 0) {
        const dec = (T.DAMP_CONST + T.DAMP_LIN * sp) * this.dampMult(b) * T.DT;
        const ns = sp > dec ? sp - dec : 0;
        const k = ns / sp;
        b.vx *= k;
        b.vz *= k;
      }
      b.x += b.vx * T.DT;
      b.z += b.vz * T.DT;
      this.collideStatic(b);
    }
    this.stepMerge();
    this.checkEdge();
  }

  /** Bumpers and Gulp teeth. */
  private collideStatic(b: Body): void {
    const r = b.shape.r;
    for (const k of this.island.bumpers) {
      if (!k.active) continue;
      if (this.bounceOff(b, k.x, k.z, r + k.r, T.BUMPER_RESTITUTION)) {
        this.fling.hookTotal = 0;
        this.emit("hit", -1, HIT_BUMPER, k.x, k.z);
      }
    }
    this.gulp.collideTeeth(this, b);
  }

  /**
   * Pushes body `b` out of a static circle at (cx, cz) with combined radius `rr`, reflecting its normal velocity with
   * restitution `e`. Returns true iff they touched.
   */
  bounceOff(b: Body, cx: number, cz: number, rr: number, e: number): boolean {
    const dx = b.x - cx;
    const dz = b.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) return false;
    const d = Math.sqrt(d2);
    const nx = d > 0 ? dx / d : 1;
    const nz = d > 0 ? dz / d : 0;
    b.x = cx + nx * rr;
    b.z = cz + nz * rr;
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      b.vx -= (1 + e) * vn * nx;
      b.vz -= (1 + e) * vn * nz;
    }
    return true;
  }

  /** Ring-out / Glide check (GDD §2.6, Hoverer trait). */
  private checkEdge(): void {
    let worst = -Infinity;
    let wi = 0;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.body(i);
      const d = this.island.edgeDistance(b.x, b.z);
      if (d > worst) {
        worst = d;
        wi = i;
      }
    }
    if (this.hover > 0) {
      if (worst <= 0) {
        this.hover = 0;
        this.hoverPushOn = false;
        this.emit("edge", EDGE_SAVED, 0, this.body(wi).x, this.body(wi).z);
        return;
      }
      this.hover--;
      if (this.hover === 0) this.startRingout(wi);
      return;
    }
    if (worst <= T.RINGOUT_MARGIN) return;
    if (this.traits.glide && !this.gulp.eatenBody(this.body(wi))) {
      this.hover = T.HOVER_TIME;
      this.hoverPushOn = this.steerOn;
      this.hoverPushAng = this.steerDir;
      this.emit("edge", EDGE_HOVER, 0, this.body(wi).x, this.body(wi).z);
      return;
    }
    this.startRingout(wi);
  }

  /** Starts a ring-out fall from body `wi`. */
  startRingout(wi: number): void {
    const b = this.body(wi);
    this.hover = 0;
    this.hoverPushOn = false;
    const l = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
    if (l > 0) {
      this.ringDirX = b.vx / l;
      this.ringDirZ = b.vz / l;
    } else {
      this.island.outward(this.tmp, b.x, b.z);
      this.ringDirX = this.tmp.x;
      this.ringDirZ = this.tmp.z;
    }
    this.ringState = RS_FALLING;
    this.ringTimer = 0;
    this.ringouts++;
    this.addScore(T.PTS_RINGOUT);
    if (this.fling.active) this.endFling();
    this.whiffAt = -1;
    if (this.chain !== T.CHAIN_BASE) {
      this.chain = T.CHAIN_BASE;
      this.emit("chain", this.chain, 0, b.x, b.z);
    }
    this.emit("edge", EDGE_FALL, wi, b.x, b.z);
  }

  private stepRingout(): void {
    this.ringTimer++;
    for (const b of this.bodies) {
      b.x += b.vx * T.DT;
      b.z += b.vz * T.DT;
    }
    if (this.ringState === RS_FALLING && this.ringTimer >= T.RINGOUT_FALL) {
      this.ringState = RS_WAITING;
      // GDD §2.6: RINGOUT_PX edge pixels lost immediately, chosen by the bite rule with a = the fall direction.
      let lost = 0;
      for (let n = 0; n < T.RINGOUT_PX; n++) {
        const bi = this.bodies.length === 2 ? n % 2 : 0;
        const b = this.body(bi);
        const glanced: number[] = [];
        const pick = this.pixels.selectBite(bi, b.shape, this.ringDirX, this.ringDirZ, 1, this.rngBite, glanced);
        for (const pid of pick) {
          this.losePixel(pid, LOST_RINGOUT, b.x, b.z);
          this.remeasure(bi);
          lost++;
        }
      }
      this.emit("edge", EDGE_PIXELS, lost, this.body(0).x, this.body(0).z);
    }
    if (this.ringTimer >= T.RESPAWN_AFTER) {
      if (this.split) this.doMerge();
      const b = this.body(0);
      this.island.respawnPoint(this.tmp);
      b.x = this.tmp.x;
      b.z = this.tmp.z;
      b.vx = 0;
      b.vz = 0;
      this.ringState = RS_NONE;
      this.invulnUntil = this.tick + T.INVULN;
      this.cooldownUntil = this.tick;
      this.emit("edge", EDGE_RESPAWN, 0, b.x, b.z);
    }
  }

  /** Ring-out state for views: 0 in play, 1 falling, 2 waiting to respawn. */
  ringout(): number {
    return this.ringState;
  }

  /** Ticks since the ring-out started. */
  ringTicks(): number {
    return this.ringTimer;
  }

  // ── Loose pixels ──────────────────────────────────────────────────────────────────────────────────────────────────

  private stepDebris(): void {
    const tr = this.traits;
    for (const d of this.debris) {
      if (d.gone) continue;
      d.age++;
      if (d.carriedBy >= 0) continue;
      d.left--;
      if (d.left <= 0) {
        this.loseDebris(d, LOST_TIMEOUT);
        continue;
      }
      const onGround = d.y <= 0 && this.island.contains(d.x, d.z);
      // Ballistic height with ground bounce; no ground → it keeps falling into the cloud sea.
      if (!onGround || d.vy > 0) {
        d.vy -= T.GRAVITY * T.DT;
        d.y += d.vy * T.DT;
        if (d.y <= 0 && this.island.contains(d.x, d.z) && d.vy < 0) {
          d.y = 0;
          d.vy = -d.vy > 2 ? -d.vy * T.DEBRIS_RESTITUTION : 0;
        }
      }
      const f = 1 - (d.y <= 0 ? T.DEBRIS_FRICTION : T.DEBRIS_AIR_DRAG) * T.DT;
      d.vx *= f;
      d.vz *= f;
      if (this.windX !== 0 || this.windZ !== 0) {
        d.vx += this.windX * T.DT;
        d.vz += this.windZ * T.DT;
      }
      if (this.gulp.inhaling()) {
        const dx = this.gulp.mouthX - d.x;
        const dz = this.gulp.mouthZ - d.z;
        const l = Math.sqrt(dx * dx + dz * dz);
        if (l > 0) {
          d.vx += (dx / l) * T.INHALE_ACCEL * T.DT;
          d.vz += (dz / l) * T.INHALE_ACCEL * T.DT;
        }
        if (l < T.MOUTH_RADIUS) {
          this.loseDebris(d, LOST_GULP);
          continue;
        }
      }
      d.x += d.vx * T.DT;
      d.z += d.vz * T.DT;
      // Traits that pull loose pixels home (Skeleton crawl on the ground, Family drift).
      if (this.inPlay() && d.y <= 0) {
        const bi = this.nearestBody(d.x, d.z);
        const b = this.body(bi);
        const dx = b.x - d.x;
        const dz = b.z - d.z;
        const l = Math.sqrt(dx * dx + dz * dz);
        let pull = 0;
        if (tr.crawl > 0) pull = tr.crawl;
        if (tr.drift > 0 && l <= T.HUDDLE_DRIFT_RADIUS && tr.drift > pull) pull = tr.drift;
        if (pull > 0 && l > 0) {
          d.x += (dx / l) * pull * T.DT;
          d.z += (dz / l) * pull * T.DT;
        }
      }
      if (!d.ponded && d.y <= 0 && this.island.inPond(d.x, d.z)) {
        d.ponded = true;
        d.left += T.POND_PIXEL_BONUS;
      }
      if (d.y < T.DEBRIS_LOST_DEPTH) {
        this.loseDebris(d, this.island.wedgeOn && this.island.inWedgeSector(d.x, d.z) ? LOST_GULP : LOST_EDGE);
        continue;
      }
      if (d.age >= T.PICKUP_DELAY && d.y > T.DEBRIS_LOST_DEPTH / 2 && this.inPlay()) {
        for (let bi = 0; bi < this.bodies.length; bi++) {
          const b = this.body(bi);
          const magnet = (this.speed(b) >= T.FLY_THRESHOLD ? T.MAGNET_FLY : T.MAGNET_PREY) * tr.magnetMult;
          const reach = magnet + T.GRAB_BODY_K * b.shape.r;
          if ((b.x - d.x) * (b.x - d.x) + (b.z - d.z) * (b.z - d.z) <= reach * reach) {
            this.grabDebris(d, bi);
            break;
          }
        }
      }
    }
  }

  /** Drops a carried pixel at (x, z) with a fresh window (Snatch hit). */
  dropDebris(d: Debris, x: number, z: number): void {
    d.carriedBy = -1;
    d.claimedBy = -1;
    d.x = x;
    d.z = z;
    d.y = T.SNATCH_HEIGHT;
    d.vx = 0;
    d.vy = 0;
    d.vz = 0;
    d.left = T.SNATCH_DROP_WINDOW;
    d.window = T.SNATCH_DROP_WINDOW;
    d.age = T.PICKUP_DELAY;
  }

  /** Finds the loose debris cube for pid. */
  debrisOf(pid: number): Debris | undefined {
    for (const d of this.debris) if (d.pid === pid && !d.gone) return d;
    return undefined;
  }

  // ── Crumbs and trail ──────────────────────────────────────────────────────────────────────────────────────────────

  private stepCrumbs(): void {
    if (this.crumbs.length === 0) return;
    const keep: Crumb[] = [];
    for (const c of this.crumbs) {
      c.left--;
      let taken = false;
      if (this.inPlay()) {
        for (const b of this.bodies) {
          const reach = T.MAGNET_PREY * this.traits.magnetMult + T.GRAB_BODY_K * b.shape.r;
          if ((b.x - c.x) * (b.x - c.x) + (b.z - c.z) * (b.z - c.z) <= reach * reach) taken = true;
        }
      }
      if (taken) {
        this.score += T.PTS_CRUMB;
        this.keepChain();
        this.emit("crumb", T.PTS_CRUMB, 0, c.x, c.z);
      } else if (c.left > 0) keep.push(c);
    }
    this.crumbs = keep;
  }

  private stepTrail(): void {
    if (this.trail.length > 0 && (this.trail[0]?.expires ?? 0) <= this.tick)
      this.trail = this.trail.filter((p) => p.expires > this.tick);
    const b = this.body(0);
    if (
      this.fling.active &&
      this.fling.trail &&
      this.inPlay() &&
      this.speed(b) >= T.FLY_THRESHOLD &&
      this.tick - this.lastTrailSample >= T.TRAIL_SAMPLE
    ) {
      this.lastTrailSample = this.tick;
      for (const bb of this.bodies) this.trail.push({ x: bb.x, z: bb.z, expires: this.tick + T.TRAIL_TTL });
      if (this.trail.length > T.TRAIL_MAX_POINTS) this.trail = this.trail.slice(this.trail.length - T.TRAIL_MAX_POINTS);
    }
    if (this.trail.length === 0) return;
    for (const c of this.creatures) {
      if (c.dead || c.spawn > 0 || c.trailCd > this.tick) continue;
      for (const p of this.trail) {
        const rr = c.r + T.TRAIL_HALF_WIDTH;
        if ((p.x - c.x) * (p.x - c.x) + (p.z - c.z) * (p.z - c.z) <= rr * rr) {
          c.trailCd = this.tick + T.TRAIL_TTL;
          trailHitCreature(this, c);
          break;
        }
      }
    }
    for (const d of this.debris) {
      if (d.gone || d.boosted || d.carriedBy >= 0) continue;
      for (const p of this.trail) {
        const rr = T.TRAIL_HALF_WIDTH + 0.5;
        if ((p.x - d.x) * (p.x - d.x) + (p.z - d.z) * (p.z - d.z) <= rr * rr) {
          d.boosted = true;
          d.left += T.TRAIL_PIXEL_BONUS;
          break;
        }
      }
    }
  }

  // ── Results ───────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Persisted scars gained this run as a mask (always within the per-run cap and the 50 % floor). */
  lostDelta(): string {
    const out: number[] = [];
    for (let i = 0; i < 256; i++) if (this.pixels.slot[i] === SLOT_LOST) out.push(i);
    return fromIndices(out);
  }

  /** Heading difference helper exposed for creatures (Clank turning). */
  turnToward(from: number, to: number, maxStep: number): number {
    const d = angleDelta(from, to);
    return (from + (d > maxStep ? maxStep : d < -maxStep ? -maxStep : d)) & 4095;
  }
}

/** Ticks until a slide at `v0` stops under ground damping × `mult` (simulated, deterministic). */
export function stopTicks(v0: number, mult: number): number {
  let v = v0;
  let n = 0;
  while (v > 0 && n < 600) {
    v -= (T.DAMP_CONST + T.DAMP_LIN * v) * mult * T.DT;
    n++;
  }
  return n;
}

/** Distance a slide at `v0` travels before stopping under ground damping × `mult` (same integrator as the sim). */
export function slideDistance(v0: number, mult: number): number {
  let v = v0;
  let d = 0;
  let n = 0;
  while (v > 0 && n < 600) {
    const dec = (T.DAMP_CONST + T.DAMP_LIN * v) * mult * T.DT;
    v = v > dec ? v - dec : 0;
    d += v * T.DT;
    n++;
  }
  return d;
}

/** Speed left after sliding `dist` from launch speed `v0` under damping × `mult` (0 if it stops first). */
export function slideSpeedAt(v0: number, dist: number, mult: number): number {
  let v = v0;
  let d = 0;
  let n = 0;
  while (v > 0 && d < dist && n < 600) {
    const dec = (T.DAMP_CONST + T.DAMP_LIN * v) * mult * T.DT;
    v = v > dec ? v - dec : 0;
    d += v * T.DT;
    n++;
  }
  return d >= dist ? v : 0;
}

/** Launch speed (u/s) of a fling with power 0..1023 for a Friend of `mass` pixels (GDD §2.3). */
export function launchSpeed(pow: number, mass: number): number {
  const mf = Math.sqrt(T.M_REF / (mass < 1 ? 1 : mass));
  return (
    T.V_MAX *
    powerCurve(pow) *
    (mf < T.MASS_FACTOR_MIN ? T.MASS_FACTOR_MIN : mf > T.MASS_FACTOR_MAX ? T.MASS_FACTOR_MAX : mf)
  );
}

function validateConfig(cfg: SimConfig): void {
  if (!Number.isInteger(cfg.seed)) throw new RangeError("seed must be an integer.");
  if (cfg.kind !== "free" && cfg.kind !== "daily") throw new RangeError("kind must be free or daily.");
  const hex = /^[0-9a-f]{64}$/;
  const f = cfg.friend;
  if (!hex.test(f.front) || !hex.test(f.lost)) throw new RangeError("front/lost must be Hex64.");
  if (f.gold !== undefined && !hex.test(f.gold)) throw new RangeError("gold must be Hex64.");
  if (!Number.isInteger(f.familyId) || f.familyId < 0 || f.familyId > 8) throw new RangeError("familyId must be 0..8.");
  if (!Number.isInteger(f.goldHeld) || f.goldHeld < 0) throw new RangeError("goldHeld must be a non-negative integer.");
}
