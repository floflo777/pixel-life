/**
 * A search bot for Pixel Putt: it ghost-simulates candidate flings (angles toward the cup and the hole's route
 * waypoints, a power ladder, a few wait times for moving obstacles) and plays the best outcome. Used by the tests to
 * prove every hole template is playable, by the dev page's autoplay and by the capture script. Deterministic.
 */
import { angleOf } from "../../sim/fixed-math.js";
import type { PuttSim } from "./sim.js";

const len = (dx: number, dz: number): number => Math.sqrt(dx * dx + dz * dz);

/** A chosen shot: wait `wait` ticks, then fling at `ang` (0..4095) with `pow` (0..1023). */
export interface PuttBotShot {
  readonly ang: number;
  readonly pow: number;
  readonly wait: number;
}

/** Search breadth. Defaults are tuned for tests (fast) rather than for a perfect round. */
export interface PuttBotOptions {
  /** Angle offsets (steps of 4096) tried around every target direction. */
  readonly spread?: readonly number[];
  readonly powers?: readonly number[];
  readonly waits?: readonly number[];
}

const DEFAULT_SPREAD = [0, -40, 40, -110, 110, -220, 220];
const DEFAULT_POWERS = [180, 260, 340, 420, 500, 580, 660, 740, 820, 900, 1000];
const DEFAULT_WAITS = [0, 45, 90];

/** Picks the best next shot from the sim's current (ready) state, or null when a fling would not be accepted. */
export function chooseShot(sim: PuttSim, opts: PuttBotOptions = {}): PuttBotShot | null {
  const v = sim.view();
  if (!v.ready) return null;
  const hole = sim.course.holes[v.hole];
  if (!hole) return null;
  const { x, z } = v.ball;
  const cup = hole.cup;
  // Remaining route: waypoints ahead of the ball (the first one whose remaining path is shorter than from here).
  const pts = [...hole.route, cup];
  const remaining = (px: number, pz: number): number => {
    let best = Infinity;
    let tail = 0;
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      if (!p) continue;
      const next = pts[i + 1];
      if (next) tail += len(next.x - p.x, next.z - p.z);
      const d = len(p.x - px, p.z - pz) + tail;
      if (d < best) best = d;
    }
    return best;
  };
  const targets = pts.map((p) => angleOf(p.x - x, p.z - z));
  const spread = opts.spread ?? DEFAULT_SPREAD;
  const powers = opts.powers ?? DEFAULT_POWERS;
  const waits =
    hole.windmills?.length || hole.movers?.length || hole.nibs?.length ? (opts.waits ?? DEFAULT_WAITS) : [0];
  let best: PuttBotShot | null = null;
  let bestCost = Infinity;
  const seen = new Set<number>();
  for (const wait of waits) {
    for (const base of targets) {
      for (const d of spread) {
        const ang = (base + d) & 4095;
        for (const pow of powers) {
          const key = (wait * 4096 + ang) * 1024 + pow;
          if (seen.has(key)) continue;
          seen.add(key);
          const o = sim.simulateShot(ang, pow, wait);
          const cost =
            (o.sunk ? -1000 + o.ticks / 1000 : remaining(o.x, o.z)) + (o.fell ? 30 : 0) + o.penalties * 25 + wait / 600;
          if (cost < bestCost) {
            bestCost = cost;
            best = { ang, pow, wait };
          }
        }
      }
    }
    // A sink without waiting is as good as it gets.
    if (bestCost < -900) break;
  }
  return best;
}
