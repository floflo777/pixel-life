/**
 * A small local stand-in for T2's deterministic sim, so the handheld is playable before `feat/sim` merges. It honours
 * the same config/input/view/event shapes (see `view.ts`) and is seeded (same config + inputs = same run), but it is
 * NOT the ranked sim: its numbers are rough and its summaries would fail server replay. Swap in the real `createSim`
 * through `mountHandheld(..., { createSim })`.
 */
import {
  RUN_TICKS,
  SIM_HZ,
  fnv1a32,
  fromIndices,
  getBit,
  mulberry32,
  popcount,
  runScarCap,
  type RunSummary,
  type SimConfig,
  type SimEvent,
  type SimInput,
} from "@pl/shared";
import { PX, type HandheldCreatureView, type HandheldDebrisView, type HandheldSim, type HandheldView } from "./view.js";

const DT = 1 / SIM_HZ;
const TAU = Math.PI * 2;
const ARENA = { a: 36, b: 24 };
const FLY_SPEED = 10;
const GRAB_WINDOW = 2 * SIM_HZ;
const COOLDOWN = Math.round(0.25 * SIM_HZ);
const TELEGRAPH = Math.round(0.45 * SIM_HZ);
const SPAWN_RIPPLE = Math.round(0.7 * SIM_HZ);

interface Mob {
  id: number;
  kind: number;
  x: number;
  z: number;
  y: number;
  facing: number;
  tele: number;
  stun: number;
  spawning: number;
}

interface Loose {
  pid: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  left: number;
}

/** Creates the fake sim at tick 0 (deterministic for a given config and input sequence). */
export function createFakeSim(cfg: SimConfig): HandheldSim {
  const u32 = mulberry32(cfg.seed >>> 0);
  // `mulberry32` yields uint32s; scale to [0, 1).
  const rnd = () => u32() / 4294967296;
  const pixels = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    if (!getBit(cfg.friend.front, i)) continue;
    pixels[i] = getBit(cfg.friend.lost, i) ? PX.scar : PX.body;
  }
  const allowance = runScarCap(popcount(cfg.friend.front));
  let tick = 0;
  let done = false;
  let score = 0;
  let fx = 0;
  let fz = 4;
  let vx = 0;
  let vz = 0;
  let flying = false;
  let cooldown = 0;
  let invuln = 0;
  let ringout = 0;
  let ringTicks = 0;
  let chain = 10;
  let combo = 0;
  let nextId = 1;
  let persisted = 0;
  const stats = { recovered: 0, smashed: 0, lost: 0 };
  const mobs: Mob[] = [];
  const loose: Loose[] = [];
  let events: SimEvent[] = [];
  const emit = (e: Omit<SimEvent, "t">) => events.push({ t: tick, ...e });

  const onBody = () => {
    const out: number[] = [];
    for (let i = 0; i < 256; i++) if (pixels[i] === PX.body) out.push(i);
    return out;
  };
  const loseForGood = (pid: number, x: number, z: number) => {
    const scar = persisted < allowance;
    if (scar) persisted++;
    pixels[pid] = scar ? PX.lost : PX.stitched;
    stats.lost++;
    emit({ type: "pixelLost", a: pid, b: 0, x, z });
  };
  const knockOff = (n: number, from: number) => {
    const body = onBody();
    for (let k = 0; k < n && body.length > 1; k++) {
      const pid = body.splice(Math.floor(rnd() * body.length), 1)[0];
      if (pid === undefined) break;
      pixels[pid] = PX.loose;
      const an = rnd() * TAU;
      const sp = 16 + rnd() * 10;
      loose.push({ pid, x: fx, y: 4, z: fz, vx: Math.cos(an) * sp, vy: 10, vz: Math.sin(an) * sp, left: GRAB_WINDOW });
      emit({ type: "pixelOff", a: pid, b: from, x: fx, z: fz });
    }
  };
  const spawn = () => {
    const an = rnd() * TAU;
    const r = 0.35 + rnd() * 0.5;
    const kind = Math.floor(rnd() * 6);
    mobs.push({
      id: nextId++,
      kind,
      x: Math.cos(an) * ARENA.a * r,
      z: Math.sin(an) * ARENA.b * r,
      y: 0,
      facing: 0,
      tele: 0,
      stun: 0,
      spawning: SPAWN_RIPPLE,
    });
  };

  const step = (inputs: readonly SimInput[]) => {
    if (done) return;
    for (const inp of inputs) {
      if (inp.t !== tick || inp.k !== 0 || flying || cooldown > 0 || ringout) continue;
      const a = (inp.ang / 4096) * TAU;
      const sp = 16 + (36 * inp.pow) / 1023;
      vx = Math.cos(a) * sp;
      vz = Math.sin(a) * sp;
      flying = true;
      combo = 0;
    }
    // Friend motion.
    if (ringout) {
      ringTicks++;
      if (ringTicks > SIM_HZ) {
        ringout = 0;
        fx = 0;
        fz = 0;
        vx = 0;
        vz = 0;
        invuln = Math.round(1.5 * SIM_HZ);
        emit({ type: "edge", a: 3, b: 0, x: 0, z: 0 });
      }
    } else {
      fx += vx * DT;
      fz += vz * DT;
      const damp = flying ? 1.6 : 6;
      vx -= vx * damp * DT;
      vz -= vz * damp * DT;
      const sp = Math.hypot(vx, vz);
      if (flying && sp < FLY_SPEED) {
        flying = false;
        cooldown = COOLDOWN;
        if (combo === 0) chain = 10;
      }
      if (!flying && cooldown > 0) cooldown--;
      if ((fx * fx) / (ARENA.a * ARENA.a) + (fz * fz) / (ARENA.b * ARENA.b) > 1) {
        ringout = 1;
        ringTicks = 0;
        flying = false;
        emit({ type: "edge", a: 0, b: 1, x: fx, z: fz });
        const body = onBody();
        const pid = body[Math.floor(rnd() * body.length)];
        if (pid !== undefined && body.length > 1) loseForGood(pid, fx, fz);
      }
    }
    if (invuln > 0) invuln--;

    // Creatures.
    const maxMobs = 3 + Math.min(4, Math.floor(tick / (12 * SIM_HZ)));
    if (tick % 50 === 0 && mobs.length < maxMobs) spawn();
    for (let i = mobs.length - 1; i >= 0; i--) {
      const m = mobs[i];
      if (!m) continue;
      if (m.spawning > 0) {
        m.spawning--;
        continue;
      }
      const dx = fx - m.x;
      const dz = fz - m.z;
      const d = Math.hypot(dx, dz) || 1;
      m.facing = Math.round(((Math.atan2(dz, dx) / TAU) * 4096 + 4096) % 4096);
      if (flying && d < 8) {
        const pts = Math.round((100 * chain) / 10);
        score += pts;
        combo++;
        chain = Math.min(30, chain + 5);
        stats.smashed++;
        emit({ type: "hit", a: m.id, b: 0, x: m.x, z: m.z });
        emit({ type: "smash", a: m.id, b: pts, x: m.x, z: m.z });
        mobs.splice(i, 1);
        continue;
      }
      if (m.stun > 0) {
        m.stun--;
        continue;
      }
      if (m.tele > 0) {
        m.tele--;
        if (m.tele === 0 && d < 13 && !flying && !invuln && !ringout) {
          emit({ type: "bite", a: m.id, b: m.kind === 2 ? 2 : 1, x: fx, z: fz });
          knockOff(m.kind === 2 ? 2 : 1, m.id);
          m.stun = SIM_HZ;
          m.x -= (dx / d) * 4;
          m.z -= (dz / d) * 4;
        }
        continue;
      }
      if (d < 12 && !flying && !invuln && !ringout) {
        m.tele = TELEGRAPH;
        continue;
      }
      const sp = (m.kind === 3 ? 9 : 5) * DT;
      m.x += (dx / d) * sp;
      m.z += (dz / d) * sp;
      m.y = m.kind === 1 ? Math.abs(Math.sin(tick / 8)) * 3 : m.kind === 3 ? 6 : 0;
    }

    // Loose pixels.
    for (let i = loose.length - 1; i >= 0; i--) {
      const p = loose[i];
      if (!p) continue;
      p.x += p.vx * DT;
      p.z += p.vz * DT;
      p.y = Math.max(0, p.y + p.vy * DT);
      p.vy -= 40 * DT;
      if (p.y === 0) {
        p.vx *= 0.9;
        p.vz *= 0.9;
        p.vy = Math.abs(p.vy) * 0.4;
      }
      p.left--;
      // A knocked-off pixel must land before it can be grabbed back.
      if (!ringout && p.left < GRAB_WINDOW - 20 && Math.hypot(p.x - fx, p.z - fz) < 5) {
        pixels[p.pid] = PX.body;
        stats.recovered++;
        score += 25;
        emit({ type: "pixelBack", a: p.pid, b: p.left < 20 ? 1 : 0, x: p.x, z: p.z });
        loose.splice(i, 1);
      } else if (p.left <= 0) {
        loseForGood(p.pid, p.x, p.z);
        loose.splice(i, 1);
      }
    }

    tick++;
    if (tick >= RUN_TICKS) {
      done = true;
      for (const p of loose) loseForGood(p.pid, p.x, p.z);
      loose.length = 0;
      emit({ type: "end", a: 0, b: score });
    }
  };

  const view = (): HandheldView => ({
    tick,
    score,
    done,
    arena: {
      a: ARENA.a,
      b: ARENA.b,
      bumpers: [0, 1, 2, 3].map((k) => {
        const an = (k / 4) * TAU + TAU / 8;
        return { x: Math.cos(an) * ARENA.a * 0.97, z: Math.sin(an) * ARENA.b * 0.97, r: 2.2, active: true };
      }),
      pondA: 0,
      pondB: 0,
    },
    friend: {
      bodies: [{ x: fx, z: fz, vx, vz, flying }],
      pixels: pixels.slice(),
      ready: !flying && cooldown === 0 && ringout === 0,
      invulnerable: invuln > 0,
      ringout,
      chain,
    },
    debris: loose.map((p): HandheldDebrisView => ({
      pid: p.pid,
      x: p.x,
      y: p.y,
      z: p.z,
      left: p.left,
      window: GRAB_WINDOW,
    })),
    creatures: mobs.map((m): HandheldCreatureView => ({
      id: m.id,
      kind: m.kind,
      x: m.x,
      y: m.y,
      z: m.z,
      facing: m.facing,
      telegraph: m.tele > 0,
      stun: m.stun,
      spawning: m.spawning,
    })),
    stats: { ...stats },
  });

  const summary = (): RunSummary => {
    const lostIdx: number[] = [];
    for (let i = 0; i < 256; i++) if (pixels[i] === PX.lost) lostIdx.push(i);
    const lostDelta = fromIndices(lostIdx);
    return {
      score,
      lostDelta,
      recovered: stats.recovered,
      smashed: stats.smashed,
      ticks: tick,
      finalHash: fnv1a32(`${tick}|${score}|${lostDelta}|${stats.recovered}|${stats.smashed}`)
        .toString(16)
        .padStart(8, "0"),
    };
  };

  return {
    get tick() {
      return tick;
    },
    get done() {
      return done;
    },
    step,
    view,
    drainEvents() {
      const out = events;
      events = [];
      return out;
    },
    summary,
  };
}
