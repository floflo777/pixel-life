/**
 * A small stand-in for the deterministic `@pl/shared` sim, implementing the same `Sim` contract and the full renderer
 * view. It exists so the venue, its dev page and its tests run before T2's sim merges; it is NOT the game's rules
 * (no traits, no Slurp, simplified creatures) and is never used for a reported run once the real sim is wired.
 * Deterministic from the seed (mulberry32), float maths: fine for a client-side preview, not for replays.
 */
import {
  EMPTY_MASK,
  fnv1a32,
  fromIndices,
  getBit,
  mulberry32,
  popcount,
  RUN_TICKS,
  runScarCap,
  SIM_HZ,
  type RunSummary,
  type Sim,
  type SimConfig,
  type SimEvent,
  type SimInput,
} from "@pl/shared";
import { EV, KIND, PX, type AnyEvent, type CreatureView, type FullSimView, type SimModule } from "./sim-view";

const DT = 1 / SIM_HZ;
const sec = (s: number): number => Math.round(s * SIM_HZ);
const T = {
  vMax: 70,
  mRef: 70,
  fly: 14,
  ready: 30,
  cooldown: sec(0.25),
  dropIn: sec(1.2),
  grab: sec(2),
  clutch: sec(0.3),
  pickup: sec(0.3),
  magnetPrey: 3,
  magnetFly: 4.5,
  steerAccel: 30,
  steerMax: 8,
  gravity: 40,
  wave1: sec(2.5),
  wave2: sec(20),
  frenzy: sec(40),
  last: sec(55),
  gulpShadow: sec(40),
  gulpBite: sec(42),
  gulpTeeth: sec(42.5),
  gulpInhale: sec(52),
  gulpRegrow: sec(55),
  toothLit: sec(3),
} as const;

/** Points per kind (GDD §3.1). */
const POINTS = [10, 15, 40, 25, 30, 20] as const;
/** Kill momentum for the Clank front plate. */
const PLATE_HP = 2400;
const TOOTH_HP = 1800;

interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

interface Debris {
  pid: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  left: number;
  window: number;
  carriedBy: number;
  safety: boolean;
}

interface Creature {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  state: number;
  stateTicks: number;
  telegraph: boolean;
  hp: number;
  stun: number;
  spawning: number;
  target: number;
  life: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function angOf(x: number, z: number): number {
  return ((Math.round((Math.atan2(z, x) / (2 * Math.PI)) * 4096) % 4096) + 4096) % 4096;
}
function rad(ang: number): number {
  return (ang / 4096) * 2 * Math.PI;
}

class FakeSim implements Sim {
  tick = 0;
  done = false;
  private score = 0;
  private readonly rnd: () => number;
  private readonly pixels = new Uint8Array(256);
  private readonly half = new Uint8Array(256);
  private readonly gold = new Uint8Array(256);
  private readonly cracks = new Uint8Array(256);
  private readonly n0: number;
  private readonly cap: number;
  private readonly cx: number;
  private readonly cz: number;
  private readonly maxRow: number;
  private readonly body: Body = { x: 0, z: 0, vx: 0, vz: 0 };
  private readonly a = 36;
  private readonly b = 24;
  private readonly bumpers: { x: number; z: number; r: number }[] = [];
  private cooldownUntil = 0;
  private flingActive = false;
  private flingKills = 0;
  private combo = 0;
  private chain = 10;
  private ringState = 0;
  private ringTicks = 0;
  private invulnUntil = 0;
  private steerOn = false;
  private steerDir = 0;
  private debris: Debris[] = [];
  private creatures: Creature[] = [];
  private nextId = 1;
  private bank = 0;
  private phase = 0;
  private events: AnyEvent[] = [];
  private readonly lostRun = new Set<number>();
  private persisted = 0;
  private recovered = 0;
  private smashed = 0;
  private lostCount = 0;
  private ringouts = 0;
  private gulp = {
    phase: 0,
    mood: 0,
    wedgeDir: 0,
    wedgeHalf: 512,
    wedgeOn: false,
    shadow: false,
    teeth: [] as { x: number; z: number; lit: boolean; hit: boolean }[],
    mouthX: 0,
    mouthZ: 0,
    order: [0, 1, 2],
    burped: false,
  };

  constructor(private readonly cfg: SimConfig) {
    this.rnd = mulberry32(cfg.seed >>> 0);
    let sx = 0;
    let sz = 0;
    let n = 0;
    let maxRow = 0;
    for (let i = 0; i < 256; i++) {
      if (!getBit(cfg.friend.front, i)) continue;
      this.pixels[i] = getBit(cfg.friend.lost, i) ? PX.oldScar : PX.body;
      // `gold` is T2's additive SimConfig field (worn Gold Pixel slots); absent on main's contract.
      const gold = (cfg.friend as { gold?: string }).gold;
      if (gold && getBit(gold, i)) this.gold[i] = 1;
      sx += i % 16;
      sz += i >> 4;
      n++;
      maxRow = Math.max(maxRow, i >> 4);
    }
    this.n0 = n;
    this.cap = runScarCap(n);
    this.cx = n ? sx / n + 0.5 : 8;
    this.cz = n ? sz / n + 0.5 : 8;
    this.maxRow = maxRow;
    for (let k = 0; k < 8; k++) {
      const t = ((k + 0.5) / 8) * 2 * Math.PI;
      this.bumpers.push({ x: Math.cos(t) * this.a * 0.97, z: Math.sin(t) * this.b * 0.97, r: 2.2 });
    }
    this.gulp.mood = Math.floor(this.rnd() * 3);
    const o = [0, 1, 2];
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));
      [o[i], o[j]] = [o[j] ?? 0, o[i] ?? 0];
    }
    this.gulp.order = o;
  }

  // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────
  private emit(type: AnyEvent["type"], a?: number, b?: number, x?: number, z?: number): void {
    const e: { t: number; type: AnyEvent["type"]; a?: number; b?: number; x?: number; z?: number } = {
      t: this.tick,
      type,
    };
    if (a !== undefined) e.a = a;
    if (b !== undefined) e.b = b;
    if (x !== undefined) e.x = x;
    if (z !== undefined) e.z = z;
    this.events.push(e);
  }
  private present(): number {
    let n = 0;
    for (let i = 0; i < 256; i++) if (this.pixels[i] === PX.body) n++;
    return n;
  }
  private mass(): number {
    return Math.max(1, this.present());
  }
  private radius(): number {
    let lo = 16;
    let hi = -1;
    for (let i = 0; i < 256; i++)
      if (this.pixels[i] === PX.body) {
        lo = Math.min(lo, i % 16);
        hi = Math.max(hi, i % 16);
      }
    return clamp(0.45 * (hi - lo + 1), 3, 7);
  }
  private speed(): number {
    return Math.hypot(this.body.vx, this.body.vz);
  }
  private flying(): boolean {
    return this.speed() >= T.fly;
  }
  private inside(x: number, z: number, grow = 0): boolean {
    return (x / (this.a + grow)) ** 2 + (z / (this.b + grow)) ** 2 <= 1;
  }
  private inWedge(x: number, z: number): boolean {
    if (!this.gulp.wedgeOn && !this.gulp.shadow) return false;
    const n = (x / this.a) ** 2 + (z / this.b) ** 2;
    if (n < 0.16) return false;
    const d = Math.abs(((angOf(x, z) - this.gulp.wedgeDir + 6144) % 4096) - 2048);
    return d <= this.gulp.wedgeHalf;
  }
  private points(kind: number, airBonus: boolean): number {
    const combo = Math.min(8, Math.max(1, this.combo));
    let p = (POINTS[kind] ?? 10) * (airBonus ? 2 : 1) * combo * (this.chain / 10);
    if (this.phase === 4) p *= 1.5;
    return Math.round(p);
  }

  /** Knocks `k` pixels off the Friend, from an attacker at (ax, az). */
  private bite(k: number, ax: number, az: number, attacker: number): number {
    if (this.tick < this.invulnUntil || this.ringState !== 0) return 0;
    const dx = this.body.x - ax;
    const dz = this.body.z - az;
    const len = Math.hypot(dx, dz) || 1;
    const picks = this.pickEdge(k, -dx / len, -dz / len);
    for (const pid of picks) {
      this.pixels[pid] = PX.loose;
      const spread = (this.rnd() - 0.5) * 1.2;
      const base = Math.atan2(dz, dx) + spread;
      const sp = 8 + this.rnd() * 6;
      const d: Debris = {
        pid,
        x: this.body.x + (pid % 16) + 0.5 - this.cx,
        y: this.maxRow - (pid >> 4) + 0.5,
        z: this.body.z,
        vx: Math.cos(base) * sp,
        vy: 3 + this.rnd() * 4,
        vz: Math.sin(base) * sp,
        left: T.grab,
        window: T.grab,
        carriedBy: -1,
        safety: this.persisted >= this.cap,
      };
      this.debris.push(d);
      this.emit("pixelOff", pid, attacker, d.x, d.z);
    }
    if (picks.length) {
      this.emit("bite", attacker, picks.length, this.body.x, this.body.z);
      if (this.chain !== 10) {
        this.chain = 10;
        this.emit("chain", 10, 0, this.body.x, this.body.z);
      }
    }
    return picks.length;
  }

  /** The `k` boundary pixels facing direction (fx, fz) on the ground (x → columns, −z → top rows). */
  private pickEdge(k: number, fx: number, fz: number): number[] {
    const cand: { pid: number; s: number }[] = [];
    for (let i = 0; i < 256; i++) {
      if (this.pixels[i] !== PX.body || this.gold[i]) continue;
      const c = i % 16;
      const r = i >> 4;
      let empty = 0;
      for (const [nc, nr] of [
        [c - 1, r],
        [c + 1, r],
        [c, r - 1],
        [c, r + 1],
      ] as const) {
        if (nc < 0 || nc > 15 || nr < 0 || nr > 15 || this.pixels[nr * 16 + nc] !== PX.body) empty++;
      }
      if (empty === 0) continue;
      const px = c + 0.5 - this.cx;
      const pz = r + 0.5 - this.cz;
      const l = Math.hypot(px, pz) || 1;
      cand.push({ pid: i, s: (px / l) * fx + (pz / l) * fz + 0.15 * (empty / 4) + this.rnd() * 1e-3 });
    }
    cand.sort((p, q) => q.s - p.s);
    return cand.slice(0, k).map((c) => c.pid);
  }

  private lose(d: Debris | null, pid: number, reason: number, x: number, z: number): void {
    const safety = d ? d.safety : this.persisted >= this.cap;
    this.pixels[pid] = safety ? PX.safety : PX.lost;
    if (!safety) {
      this.persisted++;
      this.lostRun.add(pid);
    }
    this.lostCount++;
    this.emit("pixelLost", pid, reason, x, z);
  }

  private startRingout(): void {
    if (this.ringState !== 0) return;
    this.ringState = 1;
    this.ringTicks = 0;
    this.ringouts++;
    this.score -= 50;
    this.emit("edge", EV.EDGE_FALL, 0, this.body.x, this.body.z);
  }

  // ── step ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  step(inputs: readonly SimInput[]): void {
    if (this.done) return;
    for (const i of inputs) {
      if (i.k === 0) this.fling(i.ang, i.pow);
      else {
        this.steerOn = i.on === 1;
        this.steerDir = i.dir;
      }
    }
    const ph =
      this.tick < T.wave1 ? 0 : this.tick < T.wave2 ? 1 : this.tick < T.frenzy ? 2 : this.tick < T.last ? 3 : 4;
    if (ph !== this.phase) {
      this.phase = ph;
      this.emit("phase", ph, 0);
    }
    this.stepGulp();
    this.spawn();
    this.stepFriend();
    this.stepCreatures();
    this.stepDebris();
    this.tick++;
    const crumbled = this.present() <= this.n0 / 2;
    if (this.tick >= RUN_TICKS || crumbled) this.finish(crumbled);
  }

  private fling(ang: number, pow: number): void {
    if (this.tick < T.dropIn || this.ringState !== 0 || pow < 82 || this.tick < this.cooldownUntil) return;
    if (this.speed() >= T.ready) return;
    this.endFling();
    const mf = clamp(Math.sqrt(T.mRef / this.mass()), 0.8, 1.35);
    const v0 = T.vMax * (pow / 1023) ** 1.15 * mf;
    this.body.vx = Math.cos(rad(ang)) * v0;
    this.body.vz = Math.sin(rad(ang)) * v0;
    this.cooldownUntil = this.tick + T.cooldown;
    this.flingActive = true;
    this.flingKills = 0;
    this.combo = 0;
    this.emit("launch", ang, pow, this.body.x, this.body.z);
  }

  private endFling(): void {
    if (!this.flingActive) return;
    this.flingActive = false;
    const next = this.flingKills > 0 ? Math.min(20, this.chain + 1) : 10;
    if (next !== this.chain) {
      this.chain = next;
      this.emit("chain", next, this.flingKills, this.body.x, this.body.z);
    }
    this.combo = 0;
  }

  private stepFriend(): void {
    const b = this.body;
    if (this.ringState === 1) {
      this.ringTicks++;
      if (this.ringTicks === sec(0.35)) {
        const len = Math.hypot(b.x, b.z) || 1;
        for (const pid of this.pickEdge(3, b.x / len, b.z / len)) this.lose(null, pid, EV.LOST_RINGOUT, b.x, b.z);
        this.emit("edge", EV.EDGE_PIXELS, 3, b.x, b.z);
        this.ringState = 2;
        this.ringTicks = 0;
      }
      return;
    }
    if (this.ringState === 2) {
      this.ringTicks++;
      if (this.ringTicks >= sec(1)) {
        this.ringState = 0;
        b.x = 0;
        b.z = 0;
        b.vx = 0;
        b.vz = 0;
        this.invulnUntil = this.tick + sec(1.5);
        this.endFling();
        this.emit("edge", EV.EDGE_RESPAWN, 0, 0, 0);
      }
      return;
    }
    let sp = this.speed();
    if (this.steerOn && sp < T.steerMax) {
      b.vx += Math.cos(rad(this.steerDir)) * T.steerAccel * DT;
      b.vz += Math.sin(rad(this.steerDir)) * T.steerAccel * DT;
      sp = this.speed();
    }
    if (this.gulp.phase === 3) {
      const dx = this.gulp.mouthX - b.x;
      const dz = this.gulp.mouthZ - b.z;
      const l = Math.hypot(dx, dz) || 1;
      b.vx += (dx / l) * 22 * DT;
      b.vz += (dz / l) * 22 * DT;
      if (l < 3) this.startRingout();
      sp = this.speed();
    }
    if (sp > 0) {
      const nsp = Math.max(0, sp - (10 + 1.8 * sp) * DT);
      b.vx *= nsp / sp;
      b.vz *= nsp / sp;
    }
    b.x += b.vx * DT;
    b.z += b.vz * DT;
    const r = this.radius();
    for (const bu of this.bumpers) {
      if (this.gulp.wedgeOn && this.inWedge(bu.x, bu.z)) continue;
      const dx = b.x - bu.x;
      const dz = b.z - bu.z;
      const d = Math.hypot(dx, dz);
      if (d < r + bu.r && d > 0) {
        const nx = dx / d;
        const nz = dz / d;
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
          b.vx -= 1.55 * vn * nx;
          b.vz -= 1.55 * vn * nz;
          this.emit("hit", -1, EV.HIT_BUMPER, bu.x, bu.z);
        }
        b.x = bu.x + nx * (r + bu.r);
        b.z = bu.z + nz * (r + bu.r);
      }
    }
    if (this.flingActive && this.speed() < T.fly) this.endFling();
    const off = !this.inside(b.x, b.z, 1) || (this.gulp.wedgeOn && this.inWedge(b.x, b.z));
    if (off && this.tick >= this.invulnUntil) this.startRingout();
    else if (off) {
      // Invulnerable: clamp back onto the island.
      const n = Math.sqrt((b.x / this.a) ** 2 + (b.z / this.b) ** 2) || 1;
      b.x /= n;
      b.z /= n;
    }
    // Gulp teeth.
    if (this.gulp.phase === 2 && this.flying()) {
      for (const [i, t] of this.gulp.teeth.entries()) {
        if (t.hit || Math.hypot(t.x - b.x, t.z - b.z) > r + 3) continue;
        if (t.lit && this.mass() * this.speed() >= TOOTH_HP) {
          t.hit = true;
          t.lit = false;
          this.score += 100;
          this.emit("gulp", EV.GULP_TOOTH_HIT, i, t.x, t.z);
          if (this.gulp.teeth.every((q) => q.hit)) {
            this.gulp.burped = true;
            this.score += 500;
            this.gulp.phase = 4;
            this.emit("gulp", EV.GULP_BURP, 0, this.gulp.mouthX, this.gulp.mouthZ);
          }
        } else this.emit("hit", -1, EV.HIT_TOOTH_BOUNCE, t.x, t.z);
        b.vx = -b.vx * 0.6;
        b.vz = -b.vz * 0.6;
      }
    }
  }

  private stepGulp(): void {
    const g = this.gulp;
    const t = this.tick;
    if (t === T.gulpShadow) {
      const fa = angOf(this.body.x, this.body.z);
      g.wedgeDir = (fa + Math.round((this.rnd() - 0.5) * 512) + 4096) % 4096;
      g.wedgeHalf = g.mood === 1 ? 400 : 512;
      g.shadow = true;
      g.phase = 1;
      const c = Math.cos(rad(g.wedgeDir));
      const s = Math.sin(rad(g.wedgeDir));
      g.mouthX = c * this.a * 0.7;
      g.mouthZ = s * this.b * 0.7;
      g.teeth = [-1, 0, 1].map((k) => {
        const aa = rad(g.wedgeDir + k * g.wedgeHalf * 0.6);
        return { x: Math.cos(aa) * this.a * 0.62, z: Math.sin(aa) * this.b * 0.62, lit: false, hit: false };
      });
      this.emit("gulp", EV.GULP_RUMBLE, 0, g.mouthX, g.mouthZ);
    } else if (t === T.gulpBite) {
      g.wedgeOn = true;
      g.shadow = false;
      g.phase = 2;
      this.emit("gulp", EV.GULP_BITE, g.wedgeHalf, g.mouthX, g.mouthZ);
      if (this.inWedge(this.body.x, this.body.z)) this.startRingout();
      for (const d of [...this.debris])
        if (this.inWedge(d.x, d.z)) {
          this.debris.splice(this.debris.indexOf(d), 1);
          this.lose(d, d.pid, EV.LOST_GULP, d.x, d.z);
        }
      for (const c of [...this.creatures]) if (this.inWedge(c.x, c.z)) this.despawn(c, 1);
    } else if (g.phase === 2 && t >= T.gulpTeeth && t < T.gulpInhale) {
      const slot = Math.floor((t - T.gulpTeeth) / T.toothLit);
      const lit = g.order[slot % 3] ?? 0;
      for (const [i, th] of g.teeth.entries()) {
        const on = i === lit && !th.hit;
        if (on && !th.lit) this.emit("gulp", EV.GULP_TOOTH_LIT, i, th.x, th.z);
        th.lit = on;
      }
    } else if (t === T.gulpInhale && g.phase === 2) {
      g.phase = 3;
      for (const th of g.teeth) th.lit = false;
      this.emit("gulp", EV.GULP_INHALE, sec(2), g.mouthX, g.mouthZ);
    } else if (t === T.gulpInhale + sec(2) && g.phase === 3) {
      g.phase = 4;
      this.emit("gulp", EV.GULP_SINK, 0, g.mouthX, g.mouthZ);
    } else if (t === T.gulpRegrow) {
      g.wedgeOn = false;
      g.phase = 5;
      this.emit("gulp", EV.GULP_REGROW, 0, g.mouthX, g.mouthZ);
    }
  }

  private spawn(): void {
    if (this.tick < T.wave1 || this.tick >= T.last || this.tick % 15 !== 0) return;
    const t = this.tick / SIM_HZ;
    let budget: number;
    let max: number;
    let weights: readonly number[];
    if (t < 20) {
      budget = 0.8 + ((t - 2.5) / 17.5) * 0.6;
      max = 6;
      weights = [70, 30, 0, 0, 0, 0];
    } else if (t < 40) {
      budget = 1.6 + ((t - 20) / 20) * 0.8;
      max = 10;
      weights = [40, 22, 15, this.debris.length ? 12 : 0, 0, 11];
    } else {
      budget = 3;
      max = 14;
      weights = [30, 20, 15, this.debris.length ? 10 : 0, 0, 25];
    }
    this.bank += budget * 0.25;
    if (this.bank < 1 || this.creatures.length >= max) return;
    const total = weights.reduce((s, w) => s + w, 0);
    let pick = this.rnd() * total;
    let kind = 0;
    for (const [k, w] of weights.entries()) {
      if (pick < w) {
        kind = k;
        break;
      }
      pick -= w;
    }
    if (kind === KIND.clank && this.creatures.filter((c) => c.kind === KIND.clank).length >= 3) kind = KIND.nib;
    for (let tries = 0; tries < 12; tries++) {
      const slot = Math.floor(this.rnd() * 12);
      const th = ((slot + 0.5) / 12) * 2 * Math.PI;
      const x = Math.cos(th) * this.a * 0.86;
      const z = Math.sin(th) * this.b * 0.86;
      if (Math.hypot(x - this.body.x, z - this.body.z) < 12 || this.inWedge(x, z)) continue;
      this.bank -= [1, 1.5, 3, 2, 3, 2][kind] ?? 1;
      const c: Creature = {
        id: this.nextId++,
        kind,
        x,
        y: kind === KIND.snatch ? 4 : 0,
        z,
        vx: 0,
        vz: 0,
        facing: angOf(-x, -z),
        state: 0,
        stateTicks: 0,
        telegraph: false,
        hp: 1,
        stun: 0,
        spawning: sec(0.6),
        target: -1,
        life: 0,
      };
      this.creatures.push(c);
      this.emit("spawn", c.id, kind, x, z);
      return;
    }
  }

  private despawn(c: Creature, why: number): void {
    const i = this.creatures.indexOf(c);
    if (i >= 0) this.creatures.splice(i, 1);
    if (c.target >= 0) {
      const d = this.debris.find((q) => q.carriedBy === c.id);
      if (d) d.carriedBy = -1;
    }
    this.emit("despawn", c.id, why, c.x, c.z);
  }

  private setState(c: Creature, state: number, ticks: number, telegraph: boolean): void {
    c.state = state;
    c.stateTicks = ticks;
    c.telegraph = telegraph;
    if (telegraph) this.emit("telegraph", c.id, c.kind, c.x, c.z);
  }

  private stepCreatures(): void {
    const b = this.body;
    const r = this.radius();
    const prey = !this.flying() && this.ringState === 0;
    for (const c of [...this.creatures]) {
      c.life++;
      if (c.spawning > 0) {
        c.spawning--;
        continue;
      }
      if (c.stun > 0) {
        c.stun--;
        continue;
      }
      const dx = b.x - c.x;
      const dz = b.z - c.z;
      const dist = Math.hypot(dx, dz) || 1;
      if (c.stateTicks > 0) c.stateTicks--;
      // Last light: everyone flees to the rim.
      if (this.phase === 4 && c.state !== 9) this.setState(c, 9, 0, false);
      if (c.state === 9) {
        const l = Math.hypot(c.x, c.z) || 1;
        c.vx = (c.x / l) * 10;
        c.vz = (c.z / l) * 10;
        if (!this.inside(c.x, c.z, 2)) {
          this.despawn(c, 0);
          continue;
        }
      } else if (c.kind === KIND.snatch) this.stepSnatch(c);
      else {
        const speed = [9, 0, 5, 0, 0, 12][c.kind] ?? 6;
        const reach = r + (c.kind === KIND.clank ? 2.5 : 2);
        if (c.kind === KIND.pogo) {
          if (c.state === 0 && c.stateTicks === 0) this.setState(c, 1, sec(0.3), true);
          else if (c.state === 1 && c.stateTicks === 0) {
            this.setState(c, 2, sec(0.6), false);
            c.vx = (dx / dist) * 16;
            c.vz = (dz / dist) * 16;
          } else if (c.state === 2) {
            const u = 1 - c.stateTicks / sec(0.6);
            c.y = 4 * u * (1 - u) * 3;
            if (c.stateTicks === 0) {
              c.y = 0;
              c.vx = 0;
              c.vz = 0;
              if (prey && dist < r + 2.5) this.bite(1, c.x, c.z, c.id);
              this.setState(c, 0, sec(0.35), false);
            }
          }
        } else if (c.kind === KIND.fizz) {
          if (c.state === 0) {
            c.vx = (dx / dist) * speed;
            c.vz = (dz / dist) * speed;
            if (dist < 6 + r) this.setState(c, 1, sec(1.5), true);
          } else {
            c.vx *= 0.9;
            c.vz *= 0.9;
            if (c.stateTicks === 0) this.explode(c);
          }
        } else {
          // Nib (0) and Clank (2): chase → telegraph → bite → back off.
          if (c.state === 0) {
            c.vx = (dx / dist) * speed;
            c.vz = (dz / dist) * speed;
            if (dist < reach && prey) this.setState(c, 1, c.kind === KIND.clank ? sec(0.6) : sec(0.45), true);
          } else if (c.state === 1) {
            c.vx = 0;
            c.vz = 0;
            if (c.stateTicks === 0) {
              if (prey && dist < reach + 0.5) this.bite(c.kind === KIND.clank ? 2 : 1, c.x, c.z, c.id);
              this.setState(c, 2, sec(0.3), false);
            }
          } else if (c.state === 2) {
            c.vx = (-dx / dist) * 10;
            c.vz = (-dz / dist) * 10;
            if (c.stateTicks === 0) this.setState(c, 3, sec(1.2), false);
          } else if (c.state === 3) {
            c.vx = 0;
            c.vz = 0;
            if (c.stateTicks === 0) this.setState(c, 0, 0, false);
          }
        }
      }
      if (c.kind !== KIND.snatch) {
        const want = angOf(dx, dz);
        const turn = ((want - c.facing + 6144) % 4096) - 2048;
        c.facing = (c.facing + clamp(turn, -17, 17) + 4096) % 4096;
      }
      c.x += c.vx * DT;
      c.z += c.vz * DT;
      if (c.kind !== KIND.snatch && c.state !== 9 && !this.inside(c.x, c.z, -1)) {
        const n = Math.sqrt((c.x / (this.a - 1)) ** 2 + (c.z / (this.b - 1)) ** 2) || 1;
        c.x /= n;
        c.z /= n;
      }
      if (this.creatures.includes(c)) this.collide(c, r);
    }
  }

  private stepSnatch(c: Creature): void {
    const carried = this.debris.find((d) => d.carriedBy === c.id);
    if (carried) {
      const l = Math.hypot(c.x, c.z) || 1;
      c.vx = (c.x / l) * 14;
      c.vz = (c.z / l) * 14;
      carried.x = c.x;
      carried.z = c.z;
      carried.y = c.y - 1;
      if (!this.inside(c.x, c.z, 2)) {
        this.debris.splice(this.debris.indexOf(carried), 1);
        this.lose(carried, carried.pid, EV.LOST_SNATCH, c.x, c.z);
        this.despawn(c, 2);
      }
    } else {
      let best: Debris | null = null;
      for (const d of this.debris) if (d.carriedBy < 0 && (!best || d.left > best.left)) best = d;
      if (best) {
        const dx = best.x - c.x;
        const dz = best.z - c.z;
        const l = Math.hypot(dx, dz) || 1;
        if (c.state !== 2) this.setState(c, 2, sec(0.4), true);
        c.vx = (dx / l) * 14;
        c.vz = (dz / l) * 14;
        if (l < 1.2) {
          best.carriedBy = c.id;
          c.target = best.pid;
          this.setState(c, 3, 0, false);
          this.emit("steal", c.id, best.pid, best.x, best.z);
        }
      } else {
        const th = c.life * 0.03;
        c.vx = -Math.sin(th) * 8;
        c.vz = Math.cos(th) * 8;
        if (c.life > sec(8)) this.despawn(c, 0);
      }
    }
    c.facing = angOf(c.vx, c.vz);
  }

  private explode(c: Creature): void {
    this.emit("explode", c.id, 0, c.x, c.z);
    const b = this.body;
    if (Math.hypot(b.x - c.x, b.z - c.z) < 5 + this.radius()) for (let i = 0; i < 3; i++) this.bite(1, c.x, c.z, c.id);
    for (const o of [...this.creatures]) {
      if (o === c || Math.hypot(o.x - c.x, o.z - c.z) > 5) continue;
      this.kill(o, true);
    }
    this.despawn(c, 1);
  }

  private kill(c: Creature, byPlayer: boolean): void {
    const air = c.kind === KIND.pogo && c.y > 0.5;
    if (byPlayer) {
      this.combo = Math.min(8, this.combo + 1);
      this.flingKills++;
    }
    const pts = byPlayer ? this.points(c.kind, air) : 0;
    this.score += pts;
    this.smashed++;
    const i = this.creatures.indexOf(c);
    if (i >= 0) this.creatures.splice(i, 1);
    const d = this.debris.find((q) => q.carriedBy === c.id);
    if (d) {
      d.carriedBy = -1;
      d.left = sec(1);
      d.window = sec(1);
      this.score += 25;
    }
    this.emit("smash", c.id, pts, c.x, c.z);
    if (byPlayer && this.combo >= 2) this.emit("combo", this.combo, pts, c.x, c.z);
  }

  private collide(c: Creature, r: number): void {
    if (this.ringState !== 0 || c.spawning > 0) return;
    const b = this.body;
    const dx = c.x - b.x;
    const dz = c.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d > r + 1.5 || (c.kind === KIND.snatch && c.y > 2 && !this.flying())) return;
    if (!this.flying()) return;
    if (c.kind === KIND.clank) {
      const toFriend = angOf(-dx, -dz);
      const off = Math.abs(((toFriend - c.facing + 6144) % 4096) - 2048);
      if (off < 683 && this.mass() * this.speed() < PLATE_HP) {
        const nx = dx / (d || 1);
        const nz = dz / (d || 1);
        const vn = b.vx * nx + b.vz * nz;
        b.vx -= 1.8 * vn * nx;
        b.vz -= 1.8 * vn * nz;
        this.emit("hit", c.id, EV.HIT_PLATE, c.x, c.z);
        this.bite(1, c.x, c.z, c.id);
        return;
      }
    }
    this.kill(c, true);
    b.vx *= 0.9;
    b.vz *= 0.9;
  }

  private stepDebris(): void {
    const b = this.body;
    const r = this.radius();
    const magnet = (this.flying() ? T.magnetFly : T.magnetPrey) + r * 0.25;
    for (const d of [...this.debris]) {
      if (d.carriedBy >= 0) continue;
      d.left--;
      d.vy -= T.gravity * DT;
      d.x += d.vx * DT;
      d.y += d.vy * DT;
      d.z += d.vz * DT;
      const on = this.inside(d.x, d.z) && !(this.gulp.wedgeOn && this.inWedge(d.x, d.z));
      if (on && d.y < 0.5) {
        d.y = 0.5;
        if (d.vy < 0) d.vy = -d.vy * 0.45;
        if (d.vy < 1) d.vy = 0;
        const f = Math.max(0, 1 - 5 * DT);
        d.vx *= f;
        d.vz *= f;
      }
      if (this.gulp.phase === 3) {
        const dx = this.gulp.mouthX - d.x;
        const dz = this.gulp.mouthZ - d.z;
        const l = Math.hypot(dx, dz) || 1;
        d.vx += (dx / l) * 22 * DT;
        d.vz += (dz / l) * 22 * DT;
        if (l < 3) {
          this.debris.splice(this.debris.indexOf(d), 1);
          this.lose(d, d.pid, EV.LOST_GULP, d.x, d.z);
          continue;
        }
      }
      if (d.y < -4) {
        this.debris.splice(this.debris.indexOf(d), 1);
        this.lose(d, d.pid, EV.LOST_EDGE, d.x, d.z);
        continue;
      }
      if (d.left <= 0) {
        this.debris.splice(this.debris.indexOf(d), 1);
        this.lose(d, d.pid, EV.LOST_TIMEOUT, d.x, d.z);
        continue;
      }
      const grabbable = this.ringState === 0 && d.window - d.left >= T.pickup;
      if (grabbable && Math.hypot(d.x - b.x, d.z - b.z) < magnet) {
        this.debris.splice(this.debris.indexOf(d), 1);
        this.pixels[d.pid] = PX.body;
        const clutch = d.left <= T.clutch;
        this.recovered++;
        this.score += clutch ? 25 : 5;
        this.emit("pixelBack", d.pid, clutch ? 1 : 0, b.x, b.z);
      }
    }
  }

  private finish(crumbled: boolean): void {
    for (const d of [...this.debris]) this.lose(d, d.pid, EV.LOST_END, d.x, d.z);
    this.debris = [];
    // Safety-stitched pixels come home at the end.
    for (let i = 0; i < 256; i++) if (this.pixels[i] === PX.safety) this.pixels[i] = PX.body;
    const kept = this.present() / Math.max(1, this.n0 - popcount(this.cfg.friend.lost));
    this.score += Math.round(300 * kept);
    if (this.lostRun.size === 0) this.score += 500;
    this.done = true;
    this.emit("end", crumbled ? EV.END_CRUMBLE : EV.END_TIME, this.score);
  }

  // ── contract ─────────────────────────────────────────────────────────────────────────────────────────────────────
  view(): FullSimView {
    const b = this.body;
    const creatures: CreatureView[] = this.creatures.map((c) => ({
      id: c.id,
      kind: c.kind,
      x: c.x,
      y: c.y,
      z: c.z,
      vx: c.vx,
      vz: c.vz,
      facing: c.facing,
      state: c.state,
      stateTicks: c.stateTicks,
      telegraph: c.telegraph,
      hp: c.hp,
      stun: c.stun,
      spawning: c.spawning,
    }));
    const g = this.gulp;
    return {
      tick: this.tick,
      score: this.score,
      done: this.done,
      phase: this.phase,
      arena: {
        name: this.cfg.arena,
        a: this.a,
        b: this.b,
        bumpers: this.bumpers.map((q) => ({ ...q, active: !(g.wedgeOn && this.inWedge(q.x, q.z)) })),
        pondA: 0,
        pondB: 0,
        windX: 0,
        windZ: 0,
      },
      friend: {
        bodies: [
          {
            x: b.x,
            z: b.z,
            vx: b.vx,
            vz: b.vz,
            cx: this.cx,
            cz: this.cz,
            maxRow: this.maxRow,
            r: this.radius(),
            mass: this.mass(),
            flying: this.flying(),
          },
        ],
        pixels: this.pixels.slice(),
        half: this.half.slice(),
        gold: this.gold.slice(),
        cracks: this.cracks.slice(),
        ready:
          this.ringState === 0 && this.tick >= this.cooldownUntil && this.tick >= T.dropIn && this.speed() < T.ready,
        invulnerable: this.tick < this.invulnUntil,
        ringout: this.ringState,
        ringTicks: this.ringTicks,
        hover: 0,
        combo: this.combo,
        chain: this.chain,
        familyId: this.cfg.friend.familyId,
        heavySide: 1,
      },
      debris: this.debris.map((d) => ({ ...d })),
      creatures,
      gulp: {
        phase: g.phase,
        mood: g.mood,
        wedgeDir: g.wedgeDir,
        wedgeHalf: g.wedgeHalf,
        wedgeOn: g.wedgeOn,
        shadow: g.shadow,
        teeth: g.teeth.map((t) => ({ ...t })),
        mouthX: g.mouthX,
        mouthZ: g.mouthZ,
      },
      crumbs: [],
      trail: [],
      stats: {
        recovered: this.recovered,
        smashed: this.smashed,
        lost: this.lostCount,
        persisted: this.persisted,
        scarAllowance: this.cap,
        ringouts: this.ringouts,
      },
    };
  }

  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    // The extended event types are a superset of SimEventType (T2 widens the union additively).
    return out as SimEvent[];
  }

  hash(): string {
    const b = this.body;
    return fnv1a32(`${this.tick}|${this.score}|${b.x.toFixed(3)}|${b.z.toFixed(3)}|${this.pixels.join("")}`)
      .toString(16)
      .padStart(8, "0");
  }

  summary(): RunSummary {
    return {
      score: this.score,
      lostDelta: this.lostRun.size ? fromIndices(this.lostRun) : EMPTY_MASK,
      recovered: this.recovered,
      smashed: this.smashed,
      ticks: this.tick,
      finalHash: this.hash(),
    };
  }
}

/** Fake input log: 7 bytes per input (t u32 LE, k u8, value u16 LE). Only the fake sim reads it. */
function encodeFake(inputs: readonly SimInput[]): Uint8Array {
  const out = new Uint8Array(inputs.length * 7);
  const dv = new DataView(out.buffer);
  inputs.forEach((i, n) => {
    dv.setUint32(n * 7, i.t, true);
    dv.setUint8(n * 7 + 4, i.k);
    dv.setUint16(n * 7 + 5, i.k === 0 ? (i.ang << 4) | (i.pow >> 6) : (i.dir << 1) | i.on, true);
  });
  return out;
}

/** The fake sim as an injectable module. */
export const FAKE_SIM: SimModule = {
  name: "fake",
  createSim: (cfg) => new FakeSim(cfg),
  encodeInputs: encodeFake,
};
