/**
 * The Munchies (GDD §3): per-kind state machines with telegraphs, Friend contact resolution (pops, Clank plate, Slurp
 * sulk, Fizz launch), Fizz explosions, Last Light flee. All creatures are kinematic (they set their own velocity); only
 * the Friend is dynamic. Every damaging action goes through a telegraph state first.
 */
import { angleOf, cosA, degToAngle, sinA } from "./fixed-math.js";
import { HIT_LAUNCH_FIZZ, HIT_PLATE, HIT_SLURP, LOST_SLURP, LOST_SNATCH } from "./events.js";
import * as T from "./tuning.js";
import type { World } from "./world.js";

/** One creature. `state`/`t` are per-kind (see the *_ state constants); `t` counts down. */
export interface Creature {
  id: number;
  kind: number;
  x: number;
  z: number;
  /** Height above ground (Pogo hops, Snatch flight). */
  y: number;
  vx: number;
  vz: number;
  /** Integer heading 0..4095 (Clank's plate faces this way). */
  facing: number;
  r: number;
  state: number;
  t: number;
  /** Hits left (Slurp 2). */
  hp: number;
  /** Ticks stunned. */
  stun: number;
  /** Spawn ripple ticks left (inactive and intangible while > 0). */
  spawn: number;
  dead: boolean;
  /** Target pixel id (Snatch, Slurp) or −1. */
  target: number;
  hops: number;
  hopsPlanned: number;
  hx0: number;
  hz0: number;
  hx1: number;
  hz1: number;
  /** Per-kind scratch: Pogo pounce flag, Snatch idle ticks, Slurp puff start tick. */
  aux: number;
  /** Per-kind scratch: Snatch orbit angle. */
  aux2: number;
  /** Fizz launched by the Friend. */
  banked: boolean;
  /** No Friend contact is resolved before this tick (prevents double hits). */
  hitCd: number;
  /** No Spark Trail hit before this tick. */
  trailCd: number;
}

/** Nib states. */
export const NIB_CHASE = 0;
/** See NIB_CHASE. */
export const NIB_BOWING = 1;
/** See NIB_CHASE. */
export const NIB_RETREAT = 2;
/** See NIB_CHASE. */
export const NIB_WAITING = 3;
/** Pogo states. */
export const POGO_CROUCHING = 0;
/** See POGO_CROUCHING. */
export const POGO_HOPPING = 1;
/** See POGO_CROUCHING. */
export const POGO_RESTING = 2;
/** Clank states. */
export const CLANK_WALK = 0;
/** See CLANK_WALK. */
export const CLANK_JAWS = 1;
/** See CLANK_WALK. */
export const CLANK_RECOVERING = 2;
/** Snatch states. */
export const SNATCH_CIRCLE = 0;
/** See SNATCH_CIRCLE. */
export const SNATCH_AIM = 1;
/** See SNATCH_CIRCLE. */
export const SNATCH_SWOOPING = 2;
/** See SNATCH_CIRCLE. */
export const SNATCH_CARRY = 3;
/** See SNATCH_CIRCLE. */
export const SNATCH_LEAVING = 4;
/** Slurp states. */
export const SLURP_SLEEPING = 0;
/** See SLURP_SLEEPING. */
export const SLURP_AWAKE = 1;
/** See SLURP_SLEEPING. */
export const SLURP_TONGUING = 2;
/** See SLURP_SLEEPING. */
export const SLURP_PUFFING = 3;
/** Fizz states. */
export const FIZZ_RUSH = 0;
/** See FIZZ_RUSH. */
export const FIZZ_FUSED = 1;
/** See FIZZ_RUSH. */
export const FIZZ_PROJECTILE = 2;
/** Any kind: fleeing to the rim in Last Light. */
export const FLEEING = 9;

const POGO_JITTER = degToAngle(20);

/** Creates a creature (not yet added to the world). */
export function newCreature(w: World, id: number, kind: number, x: number, z: number, ripple: number): Creature {
  const def = T.CREATURE_DEFS[kind];
  if (!def) throw new RangeError(`Unknown creature kind ${kind}.`);
  const b = w.body(0);
  return {
    id,
    kind,
    x,
    z,
    y: kind === T.SNATCH ? T.SNATCH_HEIGHT : 0,
    vx: 0,
    vz: 0,
    facing: angleOf(b.x - x, b.z - z),
    r: def.radius,
    state: 0,
    t: 0,
    hp: def.hits,
    stun: 0,
    spawn: ripple,
    dead: false,
    target: -1,
    hops: 0,
    hopsPlanned: T.POGO_HOPS_MIN + w.rngAi.int(2),
    hx0: x,
    hz0: z,
    hx1: x,
    hz1: z,
    aux: 0,
    aux2: angleOf(x, z),
    banked: false,
    hitCd: 0,
    trailCd: 0,
  };
}

/** True iff the creature is in a telegraph (wind-up) state: the renderer shows its tell. */
export function isTelegraphing(c: Creature): boolean {
  switch (c.kind) {
    case T.NIB:
      return c.state === NIB_BOWING;
    case T.POGO:
      return c.state === POGO_CROUCHING;
    case T.CLANK:
      return c.state === CLANK_JAWS;
    case T.SNATCH:
      return c.state === SNATCH_AIM;
    case T.SLURP:
      return c.state === SLURP_TONGUING || c.state === SLURP_PUFFING;
    default:
      return c.state === FIZZ_FUSED;
  }
}

function moveToward(c: Creature, tx: number, tz: number, speed: number): void {
  const dx = tx - c.x;
  const dz = tz - c.z;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l < 1e-9) {
    c.vx = 0;
    c.vz = 0;
    return;
  }
  const s = l < speed * T.DT ? l / T.DT : speed;
  c.vx = (dx / l) * s;
  c.vz = (dz / l) * s;
}

/** Moves by velocity, sliding along (never crossing) the rim. */
function moveClamped(w: World, c: Creature): void {
  if (c.vx === 0 && c.vz === 0) return;
  const nx = c.x + c.vx * T.DT;
  const nz = c.z + c.vz * T.DT;
  const lim = -c.r * 0.5;
  if (w.island.edgeDistance(nx, nz) <= lim) {
    c.x = nx;
    c.z = nz;
  } else if (w.island.edgeDistance(nx, c.z) <= lim) {
    c.x = nx;
    c.vz = 0;
  } else if (w.island.edgeDistance(c.x, nz) <= lim) {
    c.z = nz;
    c.vx = 0;
  } else {
    c.vx = 0;
    c.vz = 0;
  }
}

function moveFree(c: Creature): void {
  c.x += c.vx * T.DT;
  c.z += c.vz * T.DT;
}

function despawn(w: World, c: Creature): void {
  releaseClaims(w, c);
  c.dead = true;
  w.emit("despawn", c.id, c.kind, c.x, c.z);
}

function releaseClaims(w: World, c: Creature): void {
  if (c.kind !== T.SNATCH) return;
  for (const d of w.debris) {
    if (d.gone) continue;
    if (d.carriedBy === c.id) w.dropDebris(d, c.x, c.z);
    else if (d.claimedBy === c.id) d.claimedBy = -1;
  }
}

/** Pops creature `c`: scores it if `scored` (player-caused), drops anything a Snatch carried. */
export function killCreature(w: World, c: Creature, scored: boolean, air: boolean): void {
  if (c.dead) return;
  releaseClaims(w, c);
  c.dead = true;
  if (scored) w.scoreKill(c, air);
  else w.emit("smash", c.id, 0, c.x, c.z);
}

/** Surface distance from creature to body i and the unit direction creature → body. */
function toBody(w: World, c: Creature, bi: number, out: { d: number; ux: number; uz: number; surface: number }): void {
  const b = w.body(bi);
  const dx = b.x - c.x;
  const dz = b.z - c.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  out.d = d;
  out.ux = d > 0 ? dx / d : 1;
  out.uz = d > 0 ? dz / d : 0;
  out.surface = d - b.shape.r - c.r;
}

const scratch = { d: 0, ux: 0, uz: 0, surface: 0 };
const dirOut = { x: 0, z: 0 };

/**
 * A creature's bite lands now: Mask parry (fling released within PARRY_WINDOW before) reflects it; otherwise it needs the
 * Friend PREY, vulnerable and within `range`. Returns true iff pixels were knocked off.
 */
function creatureBite(w: World, c: Creature, k: number, range: number, j: number): boolean {
  const bi = w.nearestBody(c.x, c.z);
  toBody(w, c, bi, scratch);
  const parryable = c.kind === T.NIB || c.kind === T.POGO || c.kind === T.CLANK;
  if (
    parryable &&
    w.traits.parry &&
    w.inPlay() &&
    w.tick - w.lastFlingTick <= T.PARRY_WINDOW &&
    w.lastFlingPow >= T.PARRY_MIN_POW &&
    // The parrying fling must have been released within the bite's reach (it has flown since then).
    scratch.surface <= range + 1 + (w.tick - w.lastFlingTick) * T.DT * w.speed(w.body(bi))
  ) {
    c.stun = T.PARRY_STUN;
    w.score += T.PTS_PARRY;
    w.emit("parry", c.id, c.kind, c.x, c.z);
    return false;
  }
  if (scratch.surface > range || !w.isPrey(w.body(bi)) || !w.vulnerable()) return false;
  return w.biteFriend(bi, k, scratch.ux, scratch.uz, c.id, j) > 0;
}

function canStartAttack(w: World, c: Creature, range: number): boolean {
  if (!w.vulnerable()) return false;
  const bi = w.nearestBody(c.x, c.z);
  toBody(w, c, bi, scratch);
  return scratch.surface <= range && w.isPrey(w.body(bi));
}

// ── Kinds ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function stepNib(w: World, c: Creature): void {
  const bi = w.nearestBody(c.x, c.z);
  const b = w.body(bi);
  switch (c.state) {
    case NIB_CHASE: {
      toBody(w, c, bi, scratch);
      const off = b.shape.r + c.r + 0.5;
      moveToward(c, b.x - scratch.ux * off, b.z - scratch.uz * off, T.CREATURE_DEFS[T.NIB]?.speed ?? 0);
      moveClamped(w, c);
      if (canStartAttack(w, c, T.NIB_RANGE)) {
        c.state = NIB_BOWING;
        c.t = T.NIB_BOW;
        c.vx = 0;
        c.vz = 0;
        w.emit("telegraph", c.id, c.kind, b.x, b.z);
      }
      return;
    }
    case NIB_BOWING:
      c.facing = angleOf(b.x - c.x, b.z - c.z);
      if (--c.t > 0) return;
      creatureBite(w, c, 1, T.NIB_RANGE, T.J_NIB);
      c.state = NIB_RETREAT;
      c.t = T.NIB_HOP_TIME;
      toBody(w, c, bi, scratch);
      c.vx = (-scratch.ux * T.NIB_HOP_BACK) / (T.NIB_HOP_TIME * T.DT);
      c.vz = (-scratch.uz * T.NIB_HOP_BACK) / (T.NIB_HOP_TIME * T.DT);
      return;
    case NIB_RETREAT:
      moveClamped(w, c);
      if (--c.t > 0) return;
      c.state = NIB_WAITING;
      c.t = T.NIB_WAIT;
      c.vx = 0;
      c.vz = 0;
      return;
    default:
      if (--c.t <= 0) c.state = NIB_CHASE;
  }
}

function pogoCrouch(w: World, c: Creature): void {
  c.state = POGO_CROUCHING;
  c.t = T.POGO_CROUCH;
  c.vx = 0;
  c.vz = 0;
  const bi = w.nearestBody(c.x, c.z);
  const b = w.body(bi);
  toBody(w, c, bi, scratch);
  let tx: number;
  let tz: number;
  if (c.hops >= c.hopsPlanned || scratch.surface <= T.POGO_HOP_LEN) {
    c.aux = 1;
    const land = b.shape.r + c.r - 0.5;
    tx = b.x - scratch.ux * land;
    tz = b.z - scratch.uz * land;
  } else {
    c.aux = 0;
    const ang = angleOf(scratch.ux, scratch.uz) + w.rngAi.int(2 * POGO_JITTER + 1) - POGO_JITTER;
    const len = Math.min(T.POGO_HOP_LEN, scratch.surface - 1);
    tx = c.x + cosA(ang) * len;
    tz = c.z + sinA(ang) * len;
  }
  let dx = tx - c.x;
  let dz = tz - c.z;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l > T.POGO_HOP_LEN) {
    dx = (dx / l) * T.POGO_HOP_LEN;
    dz = (dz / l) * T.POGO_HOP_LEN;
  }
  for (let n = 0; n < 4 && w.island.edgeDistance(c.x + dx, c.z + dz) > -c.r * 0.5; n++) {
    dx *= 0.5;
    dz *= 0.5;
  }
  if (w.island.edgeDistance(c.x + dx, c.z + dz) > -c.r * 0.5) {
    dx = 0;
    dz = 0;
  }
  c.hx0 = c.x;
  c.hz0 = c.z;
  c.hx1 = c.x + dx;
  c.hz1 = c.z + dz;
  c.facing = angleOf(dx, dz);
  w.emit("telegraph", c.id, c.kind, c.hx1, c.hz1);
}

function stepPogo(w: World, c: Creature): void {
  switch (c.state) {
    case POGO_CROUCHING:
      if (--c.t > 0) return;
      c.state = POGO_HOPPING;
      c.t = T.POGO_HOP;
      c.vx = (c.hx1 - c.hx0) / (T.POGO_HOP * T.DT);
      c.vz = (c.hz1 - c.hz0) / (T.POGO_HOP * T.DT);
      return;
    case POGO_HOPPING: {
      c.t--;
      const s = 1 - c.t / T.POGO_HOP;
      c.x = c.hx0 + (c.hx1 - c.hx0) * s;
      c.z = c.hz0 + (c.hz1 - c.hz0) * s;
      c.y = 4 * T.POGO_APEX * s * (1 - s);
      if (c.t > 0) return;
      c.y = 0;
      c.vx = 0;
      c.vz = 0;
      if (c.aux === 1) {
        creatureBite(w, c, 1, T.POGO_RANGE, T.J_POGO);
        c.state = POGO_RESTING;
        c.t = T.POGO_REST;
        c.hops = 0;
        c.hopsPlanned = T.POGO_HOPS_MIN + w.rngAi.int(2);
        return;
      }
      c.hops++;
      pogoCrouch(w, c);
      return;
    }
    default:
      if (--c.t <= 0) pogoCrouch(w, c);
  }
}

function stepClank(w: World, c: Creature): void {
  const bi = w.nearestBody(c.x, c.z);
  const b = w.body(bi);
  c.facing = w.turnToward(c.facing, angleOf(b.x - c.x, b.z - c.z), T.CLANK_TURN);
  switch (c.state) {
    case CLANK_WALK: {
      toBody(w, c, bi, scratch);
      if (scratch.surface > 1) {
        const sp = T.CREATURE_DEFS[T.CLANK]?.speed ?? 0;
        c.vx = cosA(c.facing) * sp;
        c.vz = sinA(c.facing) * sp;
        moveClamped(w, c);
      } else {
        c.vx = 0;
        c.vz = 0;
      }
      if (canStartAttack(w, c, T.CLANK_RANGE)) {
        c.state = CLANK_JAWS;
        c.t = T.CLANK_JAW;
        c.vx = 0;
        c.vz = 0;
        w.emit("telegraph", c.id, c.kind, b.x, b.z);
      }
      return;
    }
    case CLANK_JAWS:
      if (--c.t > 0) return;
      creatureBite(w, c, 2, T.CLANK_RANGE, T.J_CLANK);
      c.state = CLANK_RECOVERING;
      c.t = T.CLANK_RECOVER;
      return;
    default:
      if (--c.t <= 0) c.state = CLANK_WALK;
  }
}

function stepSnatch(w: World, c: Creature): void {
  const sp = T.CREATURE_DEFS[T.SNATCH]?.speed ?? 0;
  c.y = T.SNATCH_HEIGHT;
  switch (c.state) {
    case SNATCH_CIRCLE: {
      let best = -1;
      let bestLeft = -1;
      for (let i = 0; i < w.debris.length; i++) {
        const d = w.debris[i];
        if (!d || d.gone || d.carriedBy >= 0 || d.claimedBy >= 0) continue;
        if (d.left > bestLeft) {
          bestLeft = d.left;
          best = i;
        }
      }
      const d = w.debris[best];
      if (best >= 0 && d) {
        d.claimedBy = c.id;
        c.target = d.pid;
        c.state = SNATCH_AIM;
        c.t = T.SNATCH_SWOOP_TELEGRAPH;
        c.vx = 0;
        c.vz = 0;
        w.emit("telegraph", c.id, c.kind, d.x, d.z);
        return;
      }
      c.aux++;
      c.aux2 = (c.aux2 + 10) & 4095;
      moveToward(c, w.island.a * 0.6 * cosA(c.aux2), w.island.b * 0.6 * sinA(c.aux2), sp);
      moveFree(c);
      if (c.aux >= T.SNATCH_LEAVE) c.state = SNATCH_LEAVING;
      return;
    }
    case SNATCH_AIM: {
      const d = w.debrisOf(c.target);
      if (!d || d.carriedBy >= 0 || d.claimedBy !== c.id) {
        c.state = SNATCH_CIRCLE;
        return;
      }
      if (--c.t <= 0) c.state = SNATCH_SWOOPING;
      return;
    }
    case SNATCH_SWOOPING: {
      const d = w.debrisOf(c.target);
      if (!d || d.carriedBy >= 0 || d.claimedBy !== c.id) {
        c.state = SNATCH_CIRCLE;
        return;
      }
      moveToward(c, d.x, d.z, T.SNATCH_SWOOP_SPEED);
      moveFree(c);
      const dx = d.x - c.x;
      const dz = d.z - c.z;
      if (dx * dx + dz * dz <= T.SNATCH_PICK_RADIUS * T.SNATCH_PICK_RADIUS) {
        d.carriedBy = c.id;
        c.state = SNATCH_CARRY;
        w.emit("steal", c.id, d.pid, d.x, d.z);
      }
      return;
    }
    case SNATCH_CARRY: {
      const d = w.debrisOf(c.target);
      if (!d || d.carriedBy !== c.id) {
        c.state = SNATCH_LEAVING;
        return;
      }
      const o = dirOut;
      w.island.outward(o, c.x, c.z);
      c.vx = o.x * sp;
      c.vz = o.z * sp;
      moveFree(c);
      d.x = c.x;
      d.z = c.z;
      d.y = T.SNATCH_HEIGHT - 1;
      if (w.island.edgeDistance(c.x, c.z) > 1) {
        w.loseDebris(d, LOST_SNATCH);
        c.dead = true;
        w.emit("despawn", c.id, c.kind, c.x, c.z);
      }
      return;
    }
    default: {
      const o = dirOut;
      w.island.outward(o, c.x, c.z);
      c.vx = o.x * sp;
      c.vz = o.z * sp;
      moveFree(c);
      if (w.island.edgeDistance(c.x, c.z) > 1) despawn(w, c);
    }
  }
}

function stepSlurp(w: World, c: Creature): void {
  c.vx = 0;
  c.vz = 0;
  switch (c.state) {
    case SLURP_SLEEPING:
      for (const d of w.debris) {
        if (d.gone || d.carriedBy >= 0) continue;
        if ((d.x - c.x) * (d.x - c.x) + (d.z - c.z) * (d.z - c.z) <= T.SLURP_WAKE * T.SLURP_WAKE) {
          c.state = SLURP_AWAKE;
          c.t = 60;
          w.emit("telegraph", c.id, c.kind, c.x, c.z);
          return;
        }
      }
      return;
    case SLURP_AWAKE: {
      if (--c.t > 0) return;
      let best = -1;
      let bestD = T.SLURP_RANGE * T.SLURP_RANGE;
      for (const d of w.debris) {
        if (d.gone || d.carriedBy >= 0 || d.y > 1) continue;
        const dd = (d.x - c.x) * (d.x - c.x) + (d.z - c.z) * (d.z - c.z);
        if (dd <= bestD) {
          bestD = dd;
          best = d.pid;
        }
      }
      const bd = best >= 0 ? w.debrisOf(best) : undefined;
      if (bd) {
        c.state = SLURP_TONGUING;
        c.t = T.SLURP_TONGUE;
        c.target = best;
        c.facing = angleOf(bd.x - c.x, bd.z - c.z);
        w.emit("telegraph", c.id, c.kind, bd.x, bd.z);
        return;
      }
      const bi = w.nearestBody(c.x, c.z);
      toBody(w, c, bi, scratch);
      if (w.inPlay() && scratch.d - w.body(bi).shape.r <= T.SLURP_RANGE) {
        c.state = SLURP_PUFFING;
        c.t = T.SLURP_PUFF;
        c.aux = w.tick;
        c.facing = angleOf(scratch.ux, scratch.uz);
        w.emit("telegraph", c.id, c.kind, w.body(bi).x, w.body(bi).z);
        return;
      }
      c.t = 30;
      return;
    }
    case SLURP_TONGUING: {
      if (--c.t > 0) return;
      const d = w.debrisOf(c.target);
      if (d && d.carriedBy < 0) {
        const dd = (d.x - c.x) * (d.x - c.x) + (d.z - c.z) * (d.z - c.z);
        if (dd <= (T.SLURP_RANGE + 2) * (T.SLURP_RANGE + 2)) w.loseDebris(d, LOST_SLURP);
      }
      c.state = SLURP_AWAKE;
      c.t = T.SLURP_PERIOD;
      return;
    }
    default: {
      if (--c.t > 0) return;
      const bi = w.nearestBody(c.x, c.z);
      toBody(w, c, bi, scratch);
      const b = w.body(bi);
      // Dodge: any fling released during the puff (or being fast) escapes the tongue.
      if (w.lastFlingTick < c.aux && scratch.d - b.shape.r <= T.SLURP_RANGE && w.isPrey(b) && w.vulnerable()) {
        b.vx = -scratch.ux * T.SLURP_YANK_SPEED;
        b.vz = -scratch.uz * T.SLURP_YANK_SPEED;
        w.emit("yank", c.id, 0, b.x, b.z);
      }
      c.state = SLURP_AWAKE;
      c.t = T.SLURP_PERIOD;
    }
  }
}

function stepFizz(w: World, c: Creature): void {
  if (c.state === FIZZ_PROJECTILE) {
    const sp = Math.sqrt(c.vx * c.vx + c.vz * c.vz);
    if (sp > 0) {
      const dec = (T.DAMP_CONST + T.DAMP_LIN * sp) * T.DT;
      const k = sp > dec ? (sp - dec) / sp : 0;
      c.vx *= k;
      c.vz *= k;
    }
    moveFree(c);
    if (w.island.edgeDistance(c.x, c.z) > 0) {
      despawn(w, c);
      return;
    }
    let boom = sp < T.FIZZ_DUD_SPEED;
    for (const o of w.creatures) {
      if (boom) break;
      if (o === c || o.dead || o.spawn > 0) continue;
      const rr = o.r + c.r;
      if ((o.x - c.x) * (o.x - c.x) + (o.z - c.z) * (o.z - c.z) < rr * rr) boom = true;
    }
    for (const k of w.island.bumpers) {
      if (boom) break;
      const rr = k.r + c.r;
      if (k.active && (k.x - c.x) * (k.x - c.x) + (k.z - c.z) * (k.z - c.z) < rr * rr) boom = true;
    }
    if (boom) explodeFizz(w, c);
    return;
  }
  const bi = w.nearestBody(c.x, c.z);
  const b = w.body(bi);
  if (c.state === FIZZ_RUSH) {
    moveToward(c, b.x, b.z, T.CREATURE_DEFS[T.FIZZ]?.speed ?? 0);
    moveClamped(w, c);
    toBody(w, c, bi, scratch);
    if (w.inPlay() && scratch.d - b.shape.r <= T.FIZZ_TRIGGER) {
      c.state = FIZZ_FUSED;
      c.t = T.FIZZ_FUSE;
      w.emit("telegraph", c.id, c.kind, c.x, c.z);
    }
    return;
  }
  moveToward(c, b.x, b.z, T.FIZZ_FUSED_SPEED);
  moveClamped(w, c);
  if (--c.t <= 0) explodeFizz(w, c);
}

/**
 * Fizz explosion: kills creatures within FIZZ_BLAST (scored only if the Friend banked it), and, unless banked, gives each
 * Friend body in range three separate 1-px bites from the Fizz's direction (GDD §3.7). A banked Fizz never hurts the
 * Friend that launched it (tuning decision, see TUNING.md).
 */
export function explodeFizz(w: World, c: Creature): void {
  if (c.dead) return;
  c.dead = true;
  w.emit("explode", c.id, c.banked ? 1 : 0, c.x, c.z);
  if (c.banked) w.scoreKill(c, false);
  for (const o of w.creatures) {
    if (o.dead || o.spawn > 0) continue;
    const dx = o.x - c.x;
    const dz = o.z - c.z;
    if (Math.sqrt(dx * dx + dz * dz) - o.r <= T.FIZZ_BLAST) killCreature(w, o, c.banked, false);
  }
  if (c.banked || !w.vulnerable()) return;
  for (let bi = 0; bi < w.bodies.length; bi++) {
    const b = w.body(bi);
    const dx = b.x - c.x;
    const dz = b.z - c.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d - b.shape.r > T.FIZZ_BLAST) continue;
    const ux = d > 0 ? dx / d : 1;
    const uz = d > 0 ? dz / d : 0;
    for (let n = 0; n < (T.CREATURE_DEFS[T.FIZZ]?.bite ?? 0); n++) w.biteFriend(bi, 1, ux, uz, c.id, T.J_FIZZ / 3);
  }
}

/** Spark Trail contact: one hit (Clank's plate does not protect, a Fizz goes off as if banked). */
export function trailHitCreature(w: World, c: Creature): void {
  if (c.kind === T.FIZZ && c.state !== FIZZ_PROJECTILE) {
    c.banked = true;
    explodeFizz(w, c);
    return;
  }
  if (c.kind === T.SLURP && c.hp > 1) {
    c.hp--;
    c.stun = T.SLURP_SULK;
    w.emit("hit", c.id, HIT_SLURP, c.x, c.z);
    return;
  }
  killCreature(w, c, true, c.kind === T.POGO && c.state === POGO_HOPPING);
}

// ── Friend contact ───────────────────────────────────────────────────────────────────────────────────────────────────

function killMomentum(w: World, bi: number, c: Creature): void {
  if (w.traits.pierce) return;
  const b = w.body(bi);
  b.vx *= T.KILL_SPEED_KEEP;
  b.vz *= T.KILL_SPEED_KEEP;
  const dx = c.x - b.x;
  const dz = c.z - b.z;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l === 0) return;
  const nx = dx / l;
  const nz = dz / l;
  const vn = b.vx * nx + b.vz * nz;
  if (vn > 0) {
    b.vx -= T.KILL_DEFLECT * vn * nx;
    b.vz -= T.KILL_DEFLECT * vn * nz;
  }
  w.fling.hookTotal = 0;
}

function hitCreature(w: World, bi: number, c: Creature): void {
  const b = w.body(bi);
  const sp = w.speed(b);
  switch (c.kind) {
    case T.FIZZ:
      if (c.state === FIZZ_PROJECTILE) return;
      c.state = FIZZ_PROJECTILE;
      c.banked = true;
      c.vx = b.vx * T.FIZZ_LAUNCH_FACTOR;
      c.vz = b.vz * T.FIZZ_LAUNCH_FACTOR;
      c.hitCd = w.tick + 30;
      w.emit("hit", c.id, HIT_LAUNCH_FIZZ, c.x, c.z);
      killMomentum(w, bi, c);
      return;
    case T.CLANK: {
      const dx = b.x - c.x;
      const dz = b.z - c.z;
      const l = Math.sqrt(dx * dx + dz * dz);
      const nx = l > 0 ? dx / l : 1;
      const nz = l > 0 ? dz / l : 0;
      if (cosA(c.facing) * nx + sinA(c.facing) * nz > T.CLANK_PLATE_COS) {
        if (b.shape.count * sp >= T.CLANK_FRONT_HP) {
          killCreature(w, c, true, false);
          w.score += T.PTS_SHELL_CRACK;
          killMomentum(w, bi, c);
          return;
        }
        w.bounceOff(b, c.x, c.z, b.shape.r + c.r, T.CLANK_PLATE_RESTITUTION);
        w.fling.hookTotal = 0;
        c.hitCd = w.tick + 20;
        w.emit("hit", c.id, HIT_PLATE, c.x, c.z);
        if (w.vulnerable()) w.biteFriend(bi, 1, nx, nz, c.id, 0);
        return;
      }
      break;
    }
    case T.SLURP:
      if (c.hp > 1) {
        c.hp--;
        c.stun = T.SLURP_SULK;
        c.state = SLURP_AWAKE;
        c.t = T.SLURP_PERIOD;
        c.hitCd = w.tick + 30;
        const dx = c.x - b.x;
        const dz = c.z - b.z;
        const l = Math.sqrt(dx * dx + dz * dz);
        if (l > 0) {
          const nx = c.x + (dx / l) * T.SLURP_KNOCK;
          const nz = c.z + (dz / l) * T.SLURP_KNOCK;
          if (w.island.edgeDistance(nx, nz) <= -c.r * 0.5) {
            c.x = nx;
            c.z = nz;
          }
        }
        w.emit("hit", c.id, HIT_SLURP, c.x, c.z);
        killMomentum(w, bi, c);
        return;
      }
      break;
    default:
      break;
  }
  killCreature(w, c, true, c.kind === T.POGO && c.state === POGO_HOPPING);
  killMomentum(w, bi, c);
}

function resolveContacts(w: World): void {
  if (!w.inPlay()) return;
  for (const c of w.creatures) {
    if (c.dead || c.spawn > 0 || c.hitCd > w.tick) continue;
    if (c.kind === T.FIZZ && c.state === FIZZ_PROJECTILE) continue;
    for (let bi = 0; bi < w.bodies.length; bi++) {
      const b = w.body(bi);
      const rr = b.shape.r + c.r;
      const dx = c.x - b.x;
      const dz = c.z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      if (w.speed(b) >= T.FLY_THRESHOLD) {
        hitCreature(w, bi, c);
        break;
      }
      if (c.kind === T.SNATCH) continue;
      // Slow contact: no damage, just keep them apart (the Friend yields to a sitting Slurp).
      const d = Math.sqrt(d2);
      const nx = d > 0 ? dx / d : 1;
      const nz = d > 0 ? dz / d : 0;
      if (c.kind === T.SLURP) {
        b.x = c.x - nx * rr;
        b.z = c.z - nz * rr;
      } else if (!(c.kind === T.POGO && c.state === POGO_HOPPING)) {
        const px = b.x + nx * rr;
        const pz = b.z + nz * rr;
        if (w.island.edgeDistance(px, pz) <= 0) {
          c.x = px;
          c.z = pz;
        }
      }
    }
  }
}

function separate(w: World): void {
  const cs = w.creatures;
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    if (!a || !grounded(a)) continue;
    for (let j = i + 1; j < cs.length; j++) {
      const b = cs[j];
      if (!b || !grounded(b)) continue;
      const gap = a.kind === T.NIB && b.kind === T.NIB ? T.NIB_SPACING : 0;
      const rr = a.r + b.r + gap;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      const nx = d > 0 ? dx / d : 1;
      const nz = d > 0 ? dz / d : 0;
      const push = rr - d;
      const aFixed = a.kind === T.SLURP;
      const bFixed = b.kind === T.SLURP;
      if (aFixed && bFixed) continue;
      const pa = aFixed ? 0 : bFixed ? push : push / 2;
      const pb = bFixed ? 0 : aFixed ? push : push / 2;
      if (w.island.edgeDistance(a.x - nx * pa, a.z - nz * pa) <= 0) {
        a.x -= nx * pa;
        a.z -= nz * pa;
      }
      if (w.island.edgeDistance(b.x + nx * pb, b.z + nz * pb) <= 0) {
        b.x += nx * pb;
        b.z += nz * pb;
      }
    }
  }
}

function grounded(c: Creature): boolean {
  if (c.dead || c.spawn > 0 || c.kind === T.SNATCH) return false;
  if (c.kind === T.POGO && c.state === POGO_HOPPING) return false;
  return !(c.kind === T.FIZZ && c.state === FIZZ_PROJECTILE);
}

/** Starts a creature's behaviour once its spawn ripple is over (Pogo plans its first hop). */
export function activateCreature(w: World, c: Creature): void {
  if (c.kind === T.POGO) pogoCrouch(w, c);
}

function flee(w: World, c: Creature): void {
  const o = dirOut;
  w.island.outward(o, c.x, c.z);
  const sp = Math.max(6, (T.CREATURE_DEFS[c.kind]?.speed ?? 0) * T.FLEE_SPEED_MULT);
  c.vx = o.x * sp;
  c.vz = o.z * sp;
  c.y = c.kind === T.SNATCH ? T.SNATCH_HEIGHT : 0;
  moveFree(c);
  if (w.island.edgeDistance(c.x, c.z) > 0) despawn(w, c);
}

/** Advances every creature one tick, then resolves Friend contacts and creature spacing. */
export function stepCreatures(w: World): void {
  const lastLight = w.tick >= T.LAST_LIGHT_START;
  const shadow = w.island.wedgeShadow;
  for (const c of w.creatures) {
    if (c.dead) continue;
    if (c.spawn > 0) {
      if (--c.spawn === 0) activateCreature(w, c);
      continue;
    }
    if (c.stun > 0) {
      c.stun--;
      c.vx = 0;
      c.vz = 0;
      continue;
    }
    const special =
      (c.kind === T.SNATCH && c.state === SNATCH_CARRY) || (c.kind === T.FIZZ && c.state === FIZZ_PROJECTILE);
    if (lastLight && !special) {
      if (c.state !== FLEEING) {
        releaseClaims(w, c);
        c.state = FLEEING;
        c.y = c.kind === T.SNATCH ? T.SNATCH_HEIGHT : 0;
      }
      flee(w, c);
      continue;
    }
    if (shadow && !special && c.kind !== T.SLURP && w.island.inWedgeSector(c.x, c.z)) {
      // Creatures on the shadow wedge scurry off it (GDD §3.8).
      const ax = dirOut;
      w.island.wedgeAxis(ax);
      moveToward(c, -ax.x * 12, -ax.z * 12, Math.max(6, T.CREATURE_DEFS[c.kind]?.speed ?? 0));
      if (c.kind === T.SNATCH) moveFree(c);
      else moveClamped(w, c);
      continue;
    }
    switch (c.kind) {
      case T.NIB:
        stepNib(w, c);
        break;
      case T.POGO:
        stepPogo(w, c);
        break;
      case T.CLANK:
        stepClank(w, c);
        break;
      case T.SNATCH:
        stepSnatch(w, c);
        break;
      case T.SLURP:
        stepSlurp(w, c);
        break;
      default:
        stepFizz(w, c);
    }
    if (c.kind !== T.CLANK && (c.vx !== 0 || c.vz !== 0)) c.facing = angleOf(c.vx, c.vz);
  }
  resolveContacts(w);
  separate(w);
}
