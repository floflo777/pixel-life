/**
 * The deterministic Pixel Putt sim: fling the curled-up Friend across 9 floating holes in as few strokes as you can.
 * Same rules as `packages/shared/src/sim`: fixed 60 Hz ticks, sfc32 streams, table trig, only + − × ÷ and
 * `Math.sqrt/floor/round/abs/min/max`, no wall clock. The input log reuses the Loose Pixels `SimInput` fling
 * (`k: 0`, angle 0..4095, power 0..1023) and its binary codec, so the server can store and replay it unchanged.
 */
import { EMPTY_MASK } from "../../bitmap.js";
import { RUN_TICKS, type RunKind, type RunSummary, type SimInput } from "../../sim-types.js";
import { cosA, powerCurve, sinA } from "../../sim/fixed-math.js";
import { Hasher } from "../../sim/hash.js";
import { cellIndex, cellKey, generateCourse, inRect, motionOffset, type PuttCourse, type PuttHole } from "./course.js";
import { DT, PUTT, PUTT_SCORE_BASE, PUTT_SIM_VERSION } from "./tuning.js";

/** Everything that determines a round besides inputs. */
export interface PuttConfig {
  seed: number;
  kind: RunKind;
  /** The Friend's size, for the mass factor (a scarred Friend flies farther). Absent = unscarred. */
  friend?: { total: number; present: number };
}

/** What the ball is doing. */
export type BallMode = "rest" | "roll" | "air" | "fall" | "sunk";

/** Round phase: playing a hole, the post-sink fanfare, or finished. */
export type PuttPhase = "play" | "sunk" | "done";

/** What the ball bounced off. */
export type PuttBounceKind = "rail" | "bumper" | "blade" | "nib";

/** A sim beat for juice/audio/HUD, stamped with its tick. */
export type PuttEvent =
  | { t: number; type: "tee"; hole: number }
  | { t: number; type: "launch"; hole: number; pow: number; x: number; z: number }
  | { t: number; type: "bounce"; hole: number; kind: PuttBounceKind; speed: number; x: number; z: number }
  | { t: number; type: "land"; hole: number; speed: number; x: number; z: number }
  | { t: number; type: "lip"; hole: number; x: number; z: number }
  | { t: number; type: "penalty"; hole: number; reason: "nib" | "fall"; strokes: number }
  | { t: number; type: "fall"; hole: number; x: number; z: number }
  | { t: number; type: "reset"; hole: number; x: number; z: number }
  | { t: number; type: "rest"; hole: number; x: number; z: number }
  | { t: number; type: "sink"; hole: number; strokes: number; par: number; x: number; z: number }
  | { t: number; type: "pickup"; hole: number; strokes: number; par: number }
  | { t: number; type: "end"; total: number; par: number };

/** A read-only snapshot for rendering. */
export interface PuttView {
  readonly tick: number;
  /** 0-based index of the current hole. */
  readonly hole: number;
  /** Ticks since the current hole's tee (moving obstacles are animated on it). */
  readonly holeTick: number;
  readonly phase: PuttPhase;
  readonly ball: {
    readonly x: number;
    readonly z: number;
    /** Height above the surface (u); negative while dropping off the course. */
    readonly y: number;
    readonly vx: number;
    readonly vz: number;
    readonly mode: BallMode;
  };
  /** True when a fling would be accepted now. */
  readonly ready: boolean;
  /** Strokes on the current hole (penalties included). */
  readonly strokes: number;
  /** Strokes of every finished hole, in order. */
  readonly card: readonly number[];
  /** Strokes so far (finished holes + the current one). */
  readonly total: number;
  /** Par of the finished holes. */
  readonly parSoFar: number;
}

/** A round summary: the `RunSummary` the venue reports plus the scorecard. */
export interface PuttSummary {
  readonly run: RunSummary;
  readonly card: readonly number[];
  readonly total: number;
  readonly par: number;
  readonly holeInOnes: number;
}

/** A predicted point of a ghost shot (aim preview). */
export interface PuttPreviewPoint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

/** Outcome of a simulated shot (bot and tests). */
export interface PuttShotOutcome {
  readonly sunk: boolean;
  readonly fell: boolean;
  readonly penalties: number;
  readonly x: number;
  readonly z: number;
  readonly ticks: number;
}

/** The running round. */
export interface PuttSim {
  readonly config: Readonly<PuttConfig>;
  readonly course: PuttCourse;
  readonly tick: number;
  readonly done: boolean;
  /** Advances one tick, applying these inputs first (only flings, only when ready; others are ignored). */
  step(inputs?: readonly SimInput[]): void;
  view(): PuttView;
  /** Events since the last drain, in order. */
  drainEvents(): PuttEvent[];
  /** Summary of the round so far (final once `done`). */
  summary(): PuttSummary;
  /** State checksum (16 hex chars). */
  hash(): string;
  /** Ghost-simulates a fling from the current state for `ticks` ticks, sampling every `every` ticks. No side effects. */
  preview(ang: number, pow: number, ticks: number, every?: number): PuttPreviewPoint[];
  /** Ghost-simulates a fling after waiting `wait` ticks, until the ball rests, sinks or falls. No side effects. */
  simulateShot(ang: number, pow: number, wait?: number): PuttShotOutcome;
}

/** Mutable round state (plain data, cloned for ghost shots). */
interface State {
  tick: number;
  hole: number;
  holeTick: number;
  phase: PuttPhase;
  phaseLeft: number;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  mode: BallMode;
  modeTicks: number;
  slowTicks: number;
  shotTicks: number;
  inShot: boolean;
  nibPaid: boolean;
  lipArmed: boolean;
  restX: number;
  restZ: number;
  strokes: number;
  card: number[];
}

function cloneState(s: State): State {
  return { ...s, card: s.card.slice() };
}

type Emit = (e: PuttEvent) => void;
const NO_EMIT: Emit = () => undefined;

/** 2π, written out so the sim never reads `Math.PI` through a trig call. */
const TAU = 6.283185307179586;

function surfaceAt(hole: PuttHole, cells: ReadonlySet<number>, x: number, z: number, t: number): number {
  if (cells.has(cellKey(cellIndex(x), cellIndex(z)))) return -1;
  const movers = hole.movers ?? [];
  for (let i = 0; i < movers.length; i++) {
    const m = movers[i];
    if (!m) continue;
    const o = motionOffset(m.move, t);
    if (x >= m.x0 + o.x && x <= m.x1 + o.x && z >= m.z0 + o.z && z <= m.z1 + o.z) return i;
  }
  return -2;
}

/** Mass factor: 1 unscarred, up to 1 + massK when every pixel is gone. */
function massFactor(cfg: PuttConfig): number {
  const f = cfg.friend;
  if (!f || !(f.total > 0)) return 1;
  const lost = Math.min(1, Math.max(0, (f.total - f.present) / f.total));
  return 1 + PUTT.massK * lost;
}

/** Launch velocity components for an input fling (shared with the preview). */
export function launchVelocity(ang: number, pow: number, mass = 1): { vx: number; vz: number; vy: number } {
  const p = powerCurve(pow);
  const v = PUTT.vMax * p * mass;
  return { vx: cosA(ang) * v, vz: sinA(ang) * v, vy: PUTT.hopBase + PUTT.hopK * p };
}

/** Pushes the ball out of a capsule/circle and reflects its velocity relative to the obstacle's surface velocity. */
function resolveContact(
  s: State,
  qx: number,
  qz: number,
  reach: number,
  e: number,
  ovx: number,
  ovz: number,
  fallbackNx: number,
  fallbackNz: number,
): number {
  let nx = s.x - qx;
  let nz = s.z - qz;
  const d2 = nx * nx + nz * nz;
  if (d2 >= reach * reach) return -1;
  const d = Math.sqrt(d2);
  if (d > 1e-9) {
    nx /= d;
    nz /= d;
  } else {
    nx = fallbackNx;
    nz = fallbackNz;
  }
  s.x = qx + nx * reach;
  s.z = qz + nz * reach;
  const rvx = s.vx - ovx;
  const rvz = s.vz - ovz;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return 0;
  s.vx = rvx - (1 + e) * vn * nx + ovx;
  s.vz = rvz - (1 + e) * vn * nz + ovz;
  return -vn;
}

function closestOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const ex = bx - ax;
  const ez = bz - az;
  const l2 = ex * ex + ez * ez;
  let t = l2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + ex * t, az + ez * t];
}

/** The world-space blade segments of windmill `w` at hole tick `t` (hub → tip). Shared with the renderer. */
export function bladeAngle(w: { speed: number; phase: number }, t: number, blade: number, blades: number): number {
  return w.phase + w.speed * t + Math.floor((4096 * blade) / blades);
}

/** Collides the ball with every obstacle once; returns nothing, emits bounces. */
function collide(s: State, hole: PuttHole, t: number, emit: Emit, cfgHole: number): void {
  const R = PUTT.ballR;
  const bounce = (kind: "rail" | "bumper" | "blade" | "nib", speed: number): void => {
    if (speed > 0.8) emit({ t: s.tick, type: "bounce", hole: cfgHole, kind, speed, x: s.x, z: s.z });
  };
  for (const r of hole.rails) {
    const [qx, qz] = closestOnSegment(s.x, s.z, r.ax, r.az, r.bx, r.bz);
    const hit = resolveContact(s, qx, qz, R, PUTT.railE, 0, 0, r.az === r.bz ? 0 : 1, r.az === r.bz ? 1 : 0);
    if (hit > 0) bounce("rail", hit);
  }
  for (const b of hole.bumpers ?? []) {
    const hit = resolveContact(s, b.x, b.z, R + b.r, PUTT.bumperE, 0, 0, 1, 0);
    if (hit > 0) {
      // Pinball kick: never leave a bumper slower than `bumperKick` along its normal.
      const nx = (s.x - b.x) / (R + b.r);
      const nz = (s.z - b.z) / (R + b.r);
      const out = s.vx * nx + s.vz * nz;
      if (out < PUTT.bumperKick) {
        s.vx += (PUTT.bumperKick - out) * nx;
        s.vz += (PUTT.bumperKick - out) * nz;
      }
      bounce("bumper", hit);
    }
  }
  const omegaPerStep = (TAU / 4096) * 60;
  for (const w of hole.windmills ?? []) {
    const hub = resolveContact(s, w.x, w.z, R + PUTT.hubR, PUTT.bladeE, 0, 0, 1, 0);
    if (hub > 0) bounce("blade", hub);
    for (let b = 0; b < w.blades; b++) {
      const a = bladeAngle(w, t, b, w.blades);
      const tx = w.x + cosA(a) * w.len;
      const tz = w.z + sinA(a) * w.len;
      const [qx, qz] = closestOnSegment(s.x, s.z, w.x, w.z, tx, tz);
      // Blade surface velocity at the contact: ω × r (ω in rad/s, positive = +x toward +z).
      const om = w.speed * omegaPerStep;
      const ovx = -om * (qz - w.z);
      const ovz = om * (qx - w.x);
      const hit = resolveContact(s, qx, qz, R + PUTT.bladeHalf, PUTT.bladeE, ovx, ovz, -sinA(a), cosA(a));
      if (hit > 0) bounce("blade", hit);
    }
  }
  for (const n of hole.nibs ?? []) {
    const o = motionOffset(n.move, t);
    const hit = resolveContact(s, n.x + o.x, n.z + o.z, R + PUTT.nibR, PUTT.nibE, 0, 0, 1, 0);
    if (hit >= 0) {
      if (hit > 0) bounce("nib", hit);
      if (s.inShot && !s.nibPaid) {
        s.nibPaid = true;
        s.strokes += 1;
        emit({ t: s.tick, type: "penalty", hole: cfgHole, reason: "nib", strokes: s.strokes });
      }
    }
  }
}

/** Starts the given hole: ball on the tee, at rest. */
function teeUp(s: State, course: PuttCourse, index: number, emit: Emit): void {
  const hole = course.holes[index];
  if (!hole) return;
  s.hole = index;
  s.holeTick = 0;
  s.phase = "play";
  s.phaseLeft = 0;
  s.x = hole.tee.x;
  s.z = hole.tee.z;
  s.y = 0;
  s.vx = 0;
  s.vz = 0;
  s.vy = 0;
  s.mode = "rest";
  s.modeTicks = 0;
  s.slowTicks = 0;
  s.shotTicks = 0;
  s.inShot = false;
  s.nibPaid = false;
  s.lipArmed = true;
  s.restX = hole.tee.x;
  s.restZ = hole.tee.z;
  s.strokes = 0;
  emit({ t: s.tick, type: "tee", hole: index });
}

function finishHole(s: State, course: PuttCourse, emit: Emit, sunk: boolean): void {
  const hole = course.holes[s.hole];
  const par = hole?.par ?? 3;
  const strokes = Math.min(PUTT.maxStrokes, s.strokes);
  s.card.push(strokes);
  s.phase = "sunk";
  s.phaseLeft = PUTT.sunkTicks;
  s.inShot = false;
  if (sunk) emit({ t: s.tick, type: "sink", hole: s.hole, strokes, par, x: s.x, z: s.z });
  else emit({ t: s.tick, type: "pickup", hole: s.hole, strokes, par });
}

function endShotAtRest(s: State, course: PuttCourse, emit: Emit): void {
  s.mode = "rest";
  s.vx = 0;
  s.vz = 0;
  s.vy = 0;
  s.y = 0;
  s.modeTicks = 0;
  s.slowTicks = 0;
  const wasShot = s.inShot;
  s.inShot = false;
  s.restX = s.x;
  s.restZ = s.z;
  if (wasShot) emit({ t: s.tick, type: "rest", hole: s.hole, x: s.x, z: s.z });
  if (s.strokes >= PUTT.maxStrokes) finishHole(s, course, emit, false);
}

/** One tick of physics for the current hole. */
function physics(s: State, course: PuttCourse, cells: ReadonlySet<number>, emit: Emit): void {
  const hole = course.holes[s.hole];
  if (!hole) return;
  const t = s.holeTick;
  if (s.mode === "fall") {
    s.modeTicks++;
    s.vy -= PUTT.gravity * DT;
    s.y += s.vy * DT;
    s.x += s.vx * DT * 0.5;
    s.z += s.vz * DT * 0.5;
    if (s.modeTicks >= PUTT.fallTicks) {
      s.strokes += 1;
      emit({ t: s.tick, type: "penalty", hole: s.hole, reason: "fall", strokes: s.strokes });
      // Back to the last rest spot if it is still solid ground, else the tee (a rest spot on a platform has moved).
      const back = surfaceAt(hole, cells, s.restX, s.restZ, t) === -1 ? { x: s.restX, z: s.restZ } : hole.tee;
      s.x = back.x;
      s.z = back.z;
      emit({ t: s.tick, type: "reset", hole: s.hole, x: s.x, z: s.z });
      endShotAtRest(s, course, emit);
    }
    return;
  }
  // Moving platforms carry whatever sits on them (resting or rolling) by their per-tick displacement.
  if (s.mode !== "air") {
    const on = surfaceAt(hole, cells, s.x, s.z, t);
    const m = on >= 0 ? hole.movers?.[on] : undefined;
    if (m) {
      const a = motionOffset(m.move, t);
      const b = motionOffset(m.move, t + 1);
      s.x += b.x - a.x;
      s.z += b.z - a.z;
    }
  }
  if (s.mode === "rest") {
    // Obstacles can still shove a resting ball (a windmill blade, a patrolling Nib): that starts a roll, not a stroke.
    const bx = s.x;
    const bz = s.z;
    collide(s, hole, t + 1, NO_EMIT, s.hole);
    if (s.vx !== 0 || s.vz !== 0 || s.x !== bx || s.z !== bz) {
      if (s.vx * s.vx + s.vz * s.vz > PUTT.restSpeed * PUTT.restSpeed) s.mode = "roll";
    }
    if (s.mode === "rest") {
      if (surfaceAt(hole, cells, s.x, s.z, t + 1) === -2) {
        s.mode = "fall";
        s.modeTicks = 0;
        s.vy = 0;
        emit({ t: s.tick, type: "fall", hole: s.hole, x: s.x, z: s.z });
      }
      return;
    }
  }
  s.shotTicks++;
  const n = PUTT.substeps;
  const h = DT / n;
  for (let k = 0; k < n; k++) {
    const tt = t + (k + 1) / n;
    if (s.mode === "air") {
      s.vy -= PUTT.gravity * h;
      s.y += s.vy * h;
      const drag = 1 - PUTT.airDrag * h;
      s.vx *= drag;
      s.vz *= drag;
      if (s.y <= 0) {
        const vy = -s.vy;
        s.y = 0;
        const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
        if (surfaceAt(hole, cells, s.x, s.z, tt) === -2) {
          s.mode = "fall";
          s.modeTicks = 0;
          s.vy = -vy;
          emit({ t: s.tick, type: "fall", hole: s.hole, x: s.x, z: s.z });
          return;
        }
        emit({ t: s.tick, type: "land", hole: s.hole, speed: vy, x: s.x, z: s.z });
        if (vy > PUTT.bounceMinVy && sp > 0) s.vy = vy * PUTT.bounceK;
        else {
          s.vy = 0;
          s.mode = "roll";
        }
      }
    } else {
      // Rolling resistance, slopes and the cup funnel.
      const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
      let ax = 0;
      let az = 0;
      for (const sl of hole.slopes ?? []) {
        if (inRect(sl, s.x, s.z)) {
          ax += sl.ax;
          az += sl.az;
        }
      }
      const cdx = hole.cup.x - s.x;
      const cdz = hole.cup.z - s.z;
      const cd = Math.sqrt(cdx * cdx + cdz * cdz);
      if (cd < PUTT.funnelR && cd > 1e-6 && sp < PUTT.funnelMaxV) {
        ax += (cdx / cd) * PUTT.funnelA;
        az += (cdz / cd) * PUTT.funnelA;
      }
      s.vx += ax * h;
      s.vz += az * h;
      const sp2 = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
      if (sp2 > 0) {
        const dec = (PUTT.rollA + PUTT.rollB * sp2) * h;
        const f = sp2 > dec ? (sp2 - dec) / sp2 : 0;
        s.vx *= f;
        s.vz *= f;
      }
    }
    s.x += s.vx * h;
    s.z += s.vz * h;
    collide(s, hole, tt, emit, s.hole);
    if (s.mode === "roll") {
      // The cup.
      const dx = s.x - hole.cup.x;
      const dz = s.z - hole.cup.z;
      const d2 = dx * dx + dz * dz;
      const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
      if (d2 < PUTT.cupR * PUTT.cupR) {
        if (sp < PUTT.sinkSpeed) {
          s.x = hole.cup.x;
          s.z = hole.cup.z;
          s.vx = 0;
          s.vz = 0;
          s.mode = "sunk";
          s.modeTicks = 0;
          finishHole(s, course, emit, true);
          return;
        }
        if (s.lipArmed) {
          s.lipArmed = false;
          // Lip-out: lose some pace and get nudged off the cup's centre line (a quarter of the offset, sideways).
          s.vx = s.vx * PUTT.lipKeep - dz * 0.25 * sp;
          s.vz = s.vz * PUTT.lipKeep + dx * 0.25 * sp;
          emit({ t: s.tick, type: "lip", hole: s.hole, x: s.x, z: s.z });
        }
      } else if (d2 > (PUTT.cupR + 0.3) * (PUTT.cupR + 0.3)) s.lipArmed = true;
      if (surfaceAt(hole, cells, s.x, s.z, tt) === -2) {
        s.mode = "fall";
        s.modeTicks = 0;
        s.vy = 0;
        emit({ t: s.tick, type: "fall", hole: s.hole, x: s.x, z: s.z });
        return;
      }
    }
  }
  if (s.mode === "roll") {
    const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
    s.slowTicks = sp < PUTT.restSpeed ? s.slowTicks + 1 : 0;
    const onSlope = (hole.slopes ?? []).some((sl) => inRect(sl, s.x, s.z));
    if ((sp < PUTT.restSpeed && !onSlope) || s.slowTicks >= PUTT.restTicks || s.shotTicks >= PUTT.shotMaxTicks) {
      endShotAtRest(s, course, emit);
    }
  } else if (s.mode === "air" && s.shotTicks >= PUTT.shotMaxTicks) endShotAtRest(s, course, emit);
}

function fling(s: State, ang: number, pow: number, mass: number, emit: Emit): void {
  const v = launchVelocity(ang, pow, mass);
  s.vx = v.vx;
  s.vz = v.vz;
  s.vy = v.vy;
  s.y = 0;
  s.mode = "air";
  s.modeTicks = 0;
  s.slowTicks = 0;
  s.shotTicks = 0;
  s.inShot = true;
  s.nibPaid = false;
  s.lipArmed = true;
  s.restX = s.x;
  s.restZ = s.z;
  s.strokes += 1;
  emit({ t: s.tick, type: "launch", hole: s.hole, pow, x: s.x, z: s.z });
}

/** One whole tick: inputs, physics, hole transitions, round end. */
function advance(
  s: State,
  course: PuttCourse,
  cellSets: readonly ReadonlySet<number>[],
  inputs: readonly SimInput[],
  mass: number,
  emit: Emit,
): void {
  if (s.phase === "done") return;
  for (const i of inputs) {
    if (i.k !== 0) continue;
    if (s.phase === "play" && s.mode === "rest")
      fling(s, i.ang & 4095, Math.max(0, Math.min(1023, i.pow | 0)), mass, emit);
  }
  if (s.phase === "play") physics(s, course, cellSets[s.hole] ?? new Set<number>(), emit);
  else if (s.phase === "sunk") {
    s.phaseLeft--;
    if (s.phaseLeft <= 0) {
      if (s.hole + 1 < course.holes.length) teeUp(s, course, s.hole + 1, emit);
      else endRound(s, course, emit);
    }
  }
  s.tick++;
  s.holeTick++;
  // Re-read through a widened type: the calls above may have ended the round.
  if ((s.phase as PuttPhase) !== "done" && s.tick >= PUTT.maxTicks) {
    // Time's up: the current hole and every unplayed hole score the cap.
    while (s.card.length < course.holes.length) s.card.push(PUTT.maxStrokes);
    endRound(s, course, emit);
  }
}

function endRound(s: State, course: PuttCourse, emit: Emit): void {
  s.phase = "done";
  const total = s.card.reduce((a, b) => a + b, 0);
  emit({ t: s.tick, type: "end", total, par: course.par });
}

function hashState(s: State, cfg: PuttConfig): string {
  const h = new Hasher();
  h.u32(PUTT_SIM_VERSION);
  h.u32(cfg.seed);
  h.u32(s.tick);
  h.u32(s.hole);
  h.u32(s.holeTick);
  h.u32(s.phase === "play" ? 0 : s.phase === "sunk" ? 1 : 2);
  h.u32(s.strokes);
  for (const c of s.card) h.u32(c);
  for (const v of [s.x, s.z, s.y, s.vx, s.vz, s.vy, s.restX, s.restZ]) h.f64(v);
  h.u32(["rest", "roll", "air", "fall", "sunk"].indexOf(s.mode));
  return h.hex();
}

/** Round score for the leaderboard: `PUTT_SCORE_BASE − strokes` (fewer strokes = higher score, never negative). */
export function puttScore(totalStrokes: number): number {
  return Math.max(0, PUTT_SCORE_BASE - totalStrokes);
}

/** Creates a round. Equal configs and equal input logs give equal hashes on every engine. */
export function createPuttSim(cfg: PuttConfig): PuttSim {
  const config: PuttConfig = { ...cfg, seed: cfg.seed | 0 };
  const course = generateCourse(config.seed);
  const cellSets = course.holes.map((h) => new Set(h.cells));
  const mass = massFactor(config);
  let events: PuttEvent[] = [];
  const emit: Emit = (e) => {
    events.push(e);
  };
  const s: State = {
    tick: 0,
    hole: 0,
    holeTick: 0,
    phase: "play",
    phaseLeft: 0,
    x: 0,
    z: 0,
    y: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    mode: "rest",
    modeTicks: 0,
    slowTicks: 0,
    shotTicks: 0,
    inShot: false,
    nibPaid: false,
    lipArmed: true,
    restX: 0,
    restZ: 0,
    strokes: 0,
    card: [],
  };
  teeUp(s, course, 0, emit);

  const summary = (): PuttSummary => {
    const total = s.card.reduce((a, b) => a + b, 0) + (s.phase === "play" ? Math.min(PUTT.maxStrokes, s.strokes) : 0);
    const par = course.par;
    return {
      run: {
        score: puttScore(total),
        lostDelta: EMPTY_MASK,
        recovered: 0,
        smashed: 0,
        // The shared RunSummary bounds `ticks` by the Loose Pixels run length; the full count is in the hash.
        ticks: Math.min(s.tick, RUN_TICKS),
        finalHash: hashState(s, config),
      },
      card: s.card.slice(),
      total,
      par,
      holeInOnes: s.card.filter((c) => c === 1).length,
    };
  };

  /** A private copy of the state, advanced `wait` idle ticks, then flung (when the ball is still ready). */
  const ghost = (wait: number, ang: number, pow: number, sink: Emit): { g: State; ok: boolean } => {
    const g = cloneState(s);
    for (let i = 0; i < wait && g.phase === "play"; i++) advance(g, course, cellSets, [], mass, sink);
    const ok = g.phase === "play" && g.mode === "rest";
    if (ok) fling(g, ang & 4095, pow, mass, sink);
    return { g, ok };
  };

  return {
    config,
    course,
    get tick() {
      return s.tick;
    },
    get done() {
      return s.phase === "done";
    },
    step(inputs = []) {
      advance(s, course, cellSets, inputs, mass, emit);
    },
    view() {
      const total = s.card.reduce((a, b) => a + b, 0) + (s.phase === "play" ? s.strokes : 0);
      let parSoFar = 0;
      for (let i = 0; i < s.card.length; i++) parSoFar += course.holes[i]?.par ?? 0;
      return {
        tick: s.tick,
        hole: s.hole,
        holeTick: s.holeTick,
        phase: s.phase,
        ball: { x: s.x, z: s.z, y: s.y, vx: s.vx, vz: s.vz, mode: s.mode },
        ready: s.phase === "play" && s.mode === "rest",
        strokes: s.strokes,
        card: s.card.slice(),
        total,
        parSoFar,
      };
    },
    drainEvents() {
      const out = events;
      events = [];
      return out;
    },
    summary,
    hash: () => hashState(s, config),
    preview(ang, pow, ticks, every = 3) {
      const { g, ok } = ghost(0, ang, pow, NO_EMIT);
      const pts: PuttPreviewPoint[] = [];
      if (!ok) return pts;
      for (let i = 1; i <= ticks && g.phase === "play"; i++) {
        advance(g, course, cellSets, [], mass, NO_EMIT);
        const settled = g.mode === "rest" || g.mode === "fall" || g.mode === "sunk";
        if (i % every === 0 || settled) pts.push({ x: g.x, z: g.z, y: g.y });
        if (settled) break;
      }
      return pts;
    },
    simulateShot(ang, pow, wait = 0) {
      let sunk = false;
      let fell = false;
      let penalties = 0;
      const record: Emit = (e) => {
        if (e.type === "sink") sunk = true;
        else if (e.type === "fall") fell = true;
        else if (e.type === "penalty") penalties++;
      };
      const { g, ok } = ghost(wait, ang, pow, NO_EMIT);
      if (!ok) return { sunk: false, fell: false, penalties: 0, x: g.x, z: g.z, ticks: 0 };
      let ticks = 0;
      while (g.phase === "play" && ticks < PUTT.shotMaxTicks + PUTT.fallTicks + 2) {
        advance(g, course, cellSets, [], mass, record);
        ticks++;
        if (g.mode === "rest" && !g.inShot) break;
      }
      return { sunk, fell, penalties, x: g.x, z: g.z, ticks };
    },
  };
}

/** Replays a whole input log to the end of the round (or `PUTT.maxTicks`), returning the summary. */
export function replayPutt(cfg: PuttConfig, inputs: readonly SimInput[]): PuttSummary {
  const sim = createPuttSim(cfg);
  let i = 0;
  while (!sim.done) {
    const batch: SimInput[] = [];
    while (i < inputs.length && (inputs[i]?.t ?? Infinity) <= sim.tick) {
      const inp = inputs[i];
      if (inp && inp.t === sim.tick) batch.push(inp);
      i++;
    }
    sim.step(batch);
    sim.drainEvents();
  }
  return sim.summary();
}
