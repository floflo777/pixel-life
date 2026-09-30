/**
 * Old Gulp, the run event (GDD §3.8): rumble + shadow wedge at 40 s, bites the wedge out at 42 s, three teeth light up one
 * at a time (a fling with m·v ≥ 1800 into the lit tooth scores), inhale at 52 s unless burped, wedge regrows at 55 s.
 * Mood, wedge jitter and tooth order are drawn at construction from Gulp's own PRNG stream, so they depend only on the seed.
 */
import { angleOf, cosA, sinA } from "./fixed-math.js";
import {
  GULP_EV_BITE,
  GULP_EV_BURP,
  GULP_EV_EATEN,
  GULP_EV_INHALE,
  GULP_EV_REGROW,
  GULP_EV_RUMBLE,
  GULP_EV_SINK,
  GULP_EV_TOOTH_HIT,
  GULP_EV_TOOTH_LIT,
  HIT_TOOTH_BOUNCE,
} from "./events.js";
import type { Rng } from "./rng.js";
import * as T from "./tuning.js";
import type { Body, World } from "./world.js";

/** Gulp phases. */
export const GULP_IDLE = 0;
/** Shadow wedge telegraphed (40–42 s). */
export const GULP_SHADOW = 1;
/** Wedge bitten, teeth out (42–52 s). */
export const GULP_TEETH_OUT = 2;
/** Inhaling. */
export const GULP_INHALING = 3;
/** Sunk; wedge still missing until regrow. */
export const GULP_SUNK = 4;
/** Wedge regrown; event over. */
export const GULP_DONE = 5;

/** One tooth. */
export interface Tooth {
  x: number;
  z: number;
  hit: boolean;
}

/** Old Gulp state for one run. */
export class GulpState {
  phase = GULP_IDLE;
  /** Index into GULP_MOODS. */
  readonly mood: number;
  private readonly jitter: number;
  private readonly fallbackDir: number;
  /** Tooth lighting order (permutation of 0..2). */
  readonly order: readonly number[];
  teeth: Tooth[] = [];
  /** Index of the lit tooth, or −1. */
  lit = -1;
  teethHit = 0;
  burped = false;
  mouthX = 0;
  mouthZ = 0;
  inhaleStart = 0;
  inhaleEnd = 0;

  /** Draws the per-run mood, wedge jitter and tooth order. */
  constructor(rng: Rng) {
    let total = 0;
    for (const m of T.GULP_MOODS) total += m.weight;
    let r = rng.float() * total;
    let mood = 0;
    for (let i = 0; i < T.GULP_MOODS.length; i++) {
      const w = T.GULP_MOODS[i]?.weight ?? 0;
      mood = i;
      if (r < w) break;
      r -= w;
    }
    this.mood = mood;
    this.jitter = rng.int(2 * T.GULP_WEDGE_JITTER + 1) - T.GULP_WEDGE_JITTER;
    this.fallbackDir = rng.int(4096);
    const order = [0, 1, 2];
    for (let i = 2; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = order[i] ?? 0;
      order[i] = order[j] ?? 0;
      order[j] = t;
    }
    this.order = order;
  }

  /** The mood definition. */
  moodDef(): T.GulpMood {
    const m = T.GULP_MOODS[this.mood] ?? T.GULP_MOODS[0];
    if (!m) throw new Error("No Gulp moods.");
    return m;
  }

  /** True while the inhale suction is on. */
  inhaling(): boolean {
    return this.phase === GULP_INHALING;
  }

  /** True iff teeth are out (collidable). */
  teethOut(): boolean {
    return this.phase === GULP_TEETH_OUT || this.phase === GULP_INHALING;
  }

  /** True iff body `b` is being swallowed right now (Hoverer glide cannot save it). */
  eatenBody(b: Body): boolean {
    if (this.phase !== GULP_INHALING) return false;
    const dx = b.x - this.mouthX;
    const dz = b.z - this.mouthZ;
    const rr = T.MOUTH_RADIUS + b.shape.r;
    return dx * dx + dz * dz <= rr * rr;
  }

  /** Friend body vs teeth: a lit tooth hit hard enough scores, anything else bounces. */
  collideTeeth(w: World, b: Body): void {
    if (!this.teethOut()) return;
    for (let i = 0; i < this.teeth.length; i++) {
      const t = this.teeth[i];
      if (!t || t.hit) continue;
      const rr = b.shape.r + T.TOOTH_RADIUS;
      const dx = b.x - t.x;
      const dz = b.z - t.z;
      if (dx * dx + dz * dz >= rr * rr) continue;
      const sp = w.speed(b);
      if (this.lit === i && sp >= T.FLY_THRESHOLD && b.shape.count * sp >= T.TOOTH_HP) {
        t.hit = true;
        this.teethHit++;
        this.lit = -1;
        w.score += T.PTS_TOOTH;
        w.emit("gulp", GULP_EV_TOOTH_HIT, i, t.x, t.z);
        this.spawnCrumbs(w, t);
        // The tooth pops out but the Friend still rebounds off Gulp's jaw (otherwise every hit would be a ring-out).
        w.bounceOff(b, t.x, t.z, rr, T.BUMPER_RESTITUTION);
        if (this.teethHit === 3) {
          this.burped = true;
          w.score += T.PTS_BURP;
          w.emit("gulp", GULP_EV_BURP, 0, this.mouthX, this.mouthZ);
          this.sink(w);
        }
        continue;
      }
      if (w.bounceOff(b, t.x, t.z, rr, T.BUMPER_RESTITUTION)) w.emit("hit", -1, HIT_TOOTH_BOUNCE, t.x, t.z);
    }
  }

  private spawnCrumbs(w: World, t: Tooth): void {
    for (let i = 0; i < T.CRUMBS_PER_TOOTH; i++) {
      const ang = Math.floor((i * 4096) / T.CRUMBS_PER_TOOTH) + w.rngGulp.int(256);
      let d = w.rngGulp.range(1.5, T.CRUMB_SCATTER);
      let x = t.x + cosA(ang) * d;
      let z = t.z + sinA(ang) * d;
      // Crumbs only land on ground: pull them toward the island centre until they do.
      for (let n = 0; n < 6 && !w.island.contains(x, z); n++) {
        d *= 0.5;
        x = x * 0.7;
        z = z * 0.7;
      }
      if (w.island.contains(x, z)) w.crumbs.push({ x, z, left: T.CRUMB_TTL });
    }
  }

  private sink(w: World): void {
    this.phase = GULP_SUNK;
    this.lit = -1;
    w.emit("gulp", GULP_EV_SINK, 0, this.mouthX, this.mouthZ);
  }

  /**
   * Places the three teeth on the new inner rim of the bite (Gulp "rests its chin on the new rim"), spread across the
   * notch and reachable from the island centre, and the mouth in the middle of the gap.
   */
  private placeTeeth(w: World): void {
    const isl = w.island;
    const dir = isl.wedgeDir;
    const spread = Math.round(isl.wedgeHalf * T.TOOTH_SPREAD);
    this.teeth = [];
    for (const k of [-1, 0, 1]) {
      const ang = dir + k * spread;
      const ux = cosA(ang);
      const uz = sinA(ang);
      const r = isl.rimRadius(ux, uz) * T.GULP_WEDGE_INNER;
      this.teeth.push({ x: ux * r, z: uz * r, hit: false });
    }
    const dx = cosA(dir);
    const dz = sinA(dir);
    const rm = isl.rimRadius(dx, dz) * T.MOUTH_RIM_SHARE;
    this.mouthX = dx * rm;
    this.mouthZ = dz * rm;
  }

  /** Advances Gulp by one tick. */
  step(w: World): void {
    const t = w.tick;
    const mood = this.moodDef();
    if (t === T.GULP_RUMBLE) {
      const b = w.body(0);
      const dir = b.x === 0 && b.z === 0 ? this.fallbackDir : angleOf(b.x, b.z);
      w.island.setWedge(dir + this.jitter, mood.wedgeHalf);
      this.phase = GULP_SHADOW;
      w.emit("gulp", GULP_EV_RUMBLE, w.island.wedgeDir, 0, 0);
      return;
    }
    if (t === T.GULP_BITE && this.phase === GULP_SHADOW) {
      w.island.biteWedge();
      this.placeTeeth(w);
      this.phase = GULP_TEETH_OUT;
      w.emit("gulp", GULP_EV_BITE, w.island.wedgeDir, this.mouthX, this.mouthZ);
      for (const c of w.creatures) {
        if (!c.dead && w.island.inWedgeSector(c.x, c.z)) {
          c.dead = true;
          w.emit("despawn", c.id, c.kind, c.x, c.z);
        }
      }
      if (w.inPlay()) {
        for (let i = 0; i < w.bodies.length; i++) {
          const b = w.body(i);
          if (w.island.edgeDistance(b.x, b.z) > 0) {
            w.startRingout(i);
            w.emit("gulp", GULP_EV_EATEN, 0, b.x, b.z);
            break;
          }
        }
      }
      return;
    }
    if (this.phase === GULP_TEETH_OUT) {
      let lit = -1;
      if (t >= T.GULP_TEETH) {
        const k = Math.floor((t - T.GULP_TEETH) / mood.toothLit);
        const idx = k < 3 ? (this.order[k] ?? -1) : -1;
        if (idx >= 0 && !this.teeth[idx]?.hit) lit = idx;
      }
      if (lit !== this.lit) {
        this.lit = lit;
        const tooth = this.teeth[lit];
        if (lit >= 0 && tooth) w.emit("gulp", GULP_EV_TOOTH_LIT, lit, tooth.x, tooth.z);
      }
      if (t >= T.GULP_INHALE) {
        if (mood.inhaleOnlyIfNoHit && this.teethHit > 0) {
          this.sink(w);
        } else {
          this.phase = GULP_INHALING;
          this.lit = -1;
          this.inhaleStart = t;
          this.inhaleEnd = t + mood.inhale;
          w.emit("gulp", GULP_EV_INHALE, mood.inhale, this.mouthX, this.mouthZ);
        }
      }
      return;
    }
    if (this.phase === GULP_INHALING) {
      const pull = T.INHALE_ACCEL * (t - this.inhaleStart) * T.DT * T.DT;
      for (const c of w.creatures) {
        if (c.dead) continue;
        const dx = this.mouthX - c.x;
        const dz = this.mouthZ - c.z;
        const l = Math.sqrt(dx * dx + dz * dz);
        if (l < T.MOUTH_RADIUS + c.r) {
          c.dead = true;
          w.emit("despawn", c.id, c.kind, c.x, c.z);
          continue;
        }
        c.x += (dx / l) * pull;
        c.z += (dz / l) * pull;
      }
      if (w.inPlay()) {
        for (let i = 0; i < w.bodies.length; i++) {
          if (this.eatenBody(w.body(i))) {
            w.emit("gulp", GULP_EV_EATEN, 1, this.mouthX, this.mouthZ);
            w.startRingout(i);
            break;
          }
        }
      }
      if (t >= this.inhaleEnd) this.sink(w);
    }
    if (t === T.GULP_REGROW && (this.phase === GULP_SUNK || this.phase === GULP_SHADOW)) {
      w.island.clearWedge();
      this.phase = GULP_DONE;
      this.teeth = [];
      w.emit("gulp", GULP_EV_REGROW, 0, 0, 0);
    }
  }
}

/** Advances Old Gulp for world `w`. */
export function stepGulp(w: World): void {
  w.gulp.step(w);
}
