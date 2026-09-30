/**
 * Bot Friends for Bump Sumo: deterministic (own sfc32 stream each), readable and beatable. Each bot picks a target,
 * walks around to the centre side of it (so a shove pushes it outward), charges when lined up, and backs off the edge.
 * Three personalities (bruiser, trickster, lurker) keep a 4-way ring from looking like one brain; skill ramps a little
 * every round. Bots decide from the same state the player sees and use the same controls (walk, charge, release).
 */
import { angleOf, wrapAngle } from "../../sim/fixed-math.js";
import type { Rng } from "../../sim/rng.js";
import type { Fighter, Intent, Match } from "./match.js";
import { SumoFighterState } from "./types.js";

/** A bot's short-term memory (reset every round). */
export interface BotBrain {
  target: number;
  think: number;
  chargeGoal: number;
  aimErr: number;
  /** Tap sequence countdown (a dodge is a very short charge). */
  tap: number;
  tapDir: number;
  dodgeCd: number;
  /** Id of the last incoming dash already rolled for (one dodge roll per dash). */
  lastThreat: number;
  wobble: number;
  /** Ticks left of the opening size-up (circling before the first charge); −1 = not rolled yet. */
  sizeUp: number;
}

/** A fresh brain. */
export function newBrain(): BotBrain {
  return {
    target: -1,
    think: 0,
    chargeGoal: 0,
    aimErr: 0,
    tap: 0,
    tapDir: 0,
    dodgeCd: 0,
    lastThreat: -1,
    wobble: 0,
    sizeUp: -1,
  };
}

interface Personality {
  /** Charge goal range in ticks. */
  readonly goalMin: number;
  readonly goalSpan: number;
  /** Extra distance (beyond touching) at which it starts charging. */
  readonly range: number;
  /** Dodge chance multiplier. */
  readonly dodge: number;
  /** Extra edge margin (u). */
  readonly edgeCare: number;
  /** How much it prefers victims near the edge. */
  readonly opportunist: number;
}

/** Bruiser (full charges), trickster (quick pokes, dodges), lurker (edge hunter, careful). */
const PERSONALITIES: readonly Personality[] = [
  { goalMin: 32, goalSpan: 14, range: 18, dodge: 0.5, edgeCare: 1, opportunist: 10 },
  { goalMin: 12, goalSpan: 16, range: 12, dodge: 1.6, edgeCare: 2, opportunist: 8 },
  { goalMin: 20, goalSpan: 20, range: 15, dodge: 1, edgeCare: 4, opportunist: 22 },
];

function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Bot skill 0..1 this round (level 0..2 plus half a level per round). */
function skillOf(m: Match): number {
  const lv = m.botLevel + m.round * 0.5;
  return lv >= 2 ? 1 : lv / 2;
}

function pickTarget(m: Match, me: Fighter, rng: Rng, s: number, p: Personality): number {
  let best = -1;
  let bestScore = Infinity;
  for (const o of m.fighters) {
    if (o === me || !m.inPlay(o)) continue;
    const edge = Math.sqrt(o.x * o.x + o.z * o.z) / m.ringR;
    let score = dist(me.x, me.z, o.x, o.z) - edge * p.opportunist + rng.float() * 8;
    // A light pull toward the player keeps the human in the action without ganging up.
    if (o.idx === 0) score -= 6 + 6 * s;
    if (score < bestScore) {
      bestScore = score;
      best = o.idx;
    }
  }
  return best;
}

/** The bot's controls this tick. Mutates its brain; draws from its own stream only. */
export function botIntent(m: Match, i: number, b: BotBrain, rng: Rng): Intent {
  const me = m.fighters[i];
  const idle: Intent = { move: false, dir: me ? me.facing : 0, charge: false };
  if (!me || !m.inPlay(me)) return idle;
  const p = PERSONALITIES[(i - 1) % PERSONALITIES.length] ?? PERSONALITIES[0];
  if (!p) return idle;
  const s = skillOf(m);
  const distC = Math.sqrt(me.x * me.x + me.z * me.z);
  const inward = distC > 0.01 ? angleOf(-me.x, -me.z) : me.facing;
  if (me.state === SumoFighterState.Hover) return { move: true, dir: inward, charge: false };
  if (me.stun > 0) return idle;
  if (b.dodgeCd > 0) b.dodgeCd--;

  // A dodge in progress: two ticks of "charge", then release while stepping sideways.
  if (b.tap > 0) {
    b.tap--;
    return { move: true, dir: b.tapDir, charge: b.tap > 0 };
  }

  // Incoming dash? One dodge roll per dash.
  if (me.chargeTicks === 0 && b.dodgeCd === 0 && m.tick >= me.cooldownUntil) {
    for (const o of m.fighters) {
      if (o === me || !m.inPlay(o) || o.armedTicks === 0) continue;
      const dx = me.x - o.x;
      const dz = me.z - o.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 18 + me.radius || d === 0) continue;
      const sp = Math.sqrt(o.vx * o.vx + o.vz * o.vz);
      if (sp === 0 || (o.vx * dx + o.vz * dz) / (sp * d) < 0.8) continue;
      const key = o.idx * 100000 + o.cooldownUntil;
      if (key === b.lastThreat) continue;
      b.lastThreat = key;
      if (rng.float() < (0.08 + 0.32 * s) * p.dodge) {
        // Step to whichever side of the dash keeps us nearer the centre.
        const a = angleOf(o.vx, o.vz);
        const left = wrapAngle(a - 1024);
        const right = wrapAngle(a + 1024);
        const dl = Math.abs(((left - inward + 2048) & 4095) - 2048);
        const dr = Math.abs(((right - inward + 2048) & 4095) - 2048);
        b.tapDir = dl < dr ? left : right;
        b.tap = 2;
        b.dodgeCd = 40;
        return { move: true, dir: b.tapDir, charge: true };
      }
    }
  }

  // Shikiri: circle a moment before the first charge of the round (sharper bots commit sooner).
  if (b.sizeUp < 0) b.sizeUp = Math.floor(50 - 20 * s) + rng.int(50);
  if (b.sizeUp > 0) {
    b.sizeUp--;
    return {
      move: true,
      dir: wrapAngle(inward + (i % 2 === 0 ? 1024 : -1024) + (distC > 14 ? -300 : 300)),
      charge: false,
    };
  }

  // Too close to the edge: get back in (a held charge is released as a dash toward the centre).
  const margin = m.ringR - distC;
  if (margin < me.radius + 2 + p.edgeCare * (0.5 + s)) {
    return { move: true, dir: inward, charge: false };
  }

  // Re-think the target now and then.
  let target = m.fighters[b.target];
  b.think--;
  if (b.think <= 0 || !target || !m.inPlay(target) || target === me) {
    b.think = Math.floor(34 - 16 * s) + rng.int(12);
    b.target = pickTarget(m, me, rng, s, p);
    b.wobble = rng.int(241) - 120;
    target = m.fighters[b.target];
  }
  if (!target || !m.inPlay(target) || target === me) return { move: true, dir: inward, charge: false };

  const gap = me.radius + target.radius;
  const dT = dist(me.x, me.z, target.x, target.z);
  const toT = angleOf(target.x - me.x, target.z - me.z);

  // Charging: keep the aim on the target (with this charge's error) and let go at the goal or on contact.
  if (me.chargeTicks > 0) {
    const release = me.chargeTicks >= b.chargeGoal || dT < gap + 3;
    return { move: true, dir: wrapAngle(toT + b.aimErr), charge: !release };
  }

  // Grab own loose pixels when nobody is close.
  if (dT > gap + 14) {
    let bestD = 14;
    let pick: { x: number; z: number } | null = null;
    for (const d of m.debris) {
      if (d.owner !== i || d.falling || d.y > 1) continue;
      const dd = dist(me.x, me.z, d.x, d.z);
      if (dd < bestD && d.x * d.x + d.z * d.z < (m.ringR - 4) * (m.ringR - 4)) {
        bestD = dd;
        pick = d;
      }
    }
    if (pick) return { move: true, dir: angleOf(pick.x - me.x, pick.z - me.z), charge: false };
  }

  // Outward direction of the target (from the ring centre), or from us when it stands in the middle.
  const tC = Math.sqrt(target.x * target.x + target.z * target.z);
  const ux = tC > 3 ? target.x / tC : dT > 0 ? (target.x - me.x) / dT : 1;
  const uz = tC > 3 ? target.z / tC : dT > 0 ? (target.z - me.z) / dT : 0;
  const aligned = dT > 0 && ((target.x - me.x) * ux + (target.z - me.z) * uz) / dT > 0.35;
  const targetEdge = tC / m.ringR;
  if (dT < gap + p.range && (aligned || targetEdge > 0.65) && m.tick >= me.cooldownUntil && me.armedTicks === 0) {
    b.chargeGoal = p.goalMin + rng.int(p.goalSpan);
    const err = Math.floor(260 - 190 * s);
    b.aimErr = rng.int(2 * err + 1) - err;
    return { move: false, dir: toT, charge: true };
  }

  // Walk to the attack point on the centre side of the target.
  const px = target.x - ux * (gap + 6);
  const pz = target.z - uz * (gap + 6);
  const dP = dist(me.x, me.z, px, pz);
  if (dP > 2.5) return { move: true, dir: wrapAngle(angleOf(px - me.x, pz - me.z) + b.wobble), charge: false };
  return { move: true, dir: toT, charge: false };
}
