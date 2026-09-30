/**
 * Old Gulp's pure, stepped animation (GDD §3.8, bible §5): phase + time + mood → pose. Voxel units, radians, seconds.
 */
import { STEP_FPS, hash01 } from "./animation";
import type { GulpMood, GulpPhase } from "./states";

/** Gulp's resolved pose. */
export interface GulpPose {
  readonly visible: boolean;
  /** Body height offset (voxels); 0 = chin on the rim. */
  readonly lift: number;
  /** Sideways rumble (voxels). */
  readonly shift: number;
  /** Head tilt: + lifts the snout. */
  readonly pitch: number;
  readonly mouthOpen: boolean;
  /** Body puff (inhale) and squash (burp). */
  readonly sx: number;
  readonly sy: number;
  /** Paper lid rows over the 3-row eye (0 open … 3 shut). */
  readonly lid: number;
  /** Tongue slope shown across the island. */
  readonly tongue: boolean;
  /** Suction rings (inhale): ring radii in voxels, largest first; empty when none. */
  readonly rings: readonly number[];
}

/** Mood tempo and face (GDD §3.8 moods). */
export const GULP_MOOD_STYLE: Readonly<
  Record<
    GulpMood,
    { readonly lidRest: number; readonly blinkEvery: number; readonly brow: boolean; readonly grumble: boolean }
  >
> = {
  hungry: { lidRest: 0, blinkEvery: 3, brow: false, grumble: false },
  sleepy: { lidRest: 1, blinkEvery: 2, brow: false, grumble: false },
  grumpy: { lidRest: 0, blinkEvery: 4, brow: true, grumble: true },
};

/** Seconds the rise takes (the 2.0 s shadow-wedge telegraph). */
export const RISE_S = 2;
/** Seconds of the bite leap at the start of the teeth phase. */
export const BITE_S = 0.5;
/** Seconds to sink out of sight. */
export const SINK_S = 1;
/** Seconds of the burp. */
export const BURP_S = 0.75;

const DEG = Math.PI / 180;
const step = (t: number, fps: number): number => Math.floor(Math.max(0, t) * fps + 1e-6);

/** Eye lid rows at `t` for a mood: resting lid plus a slow 2-step blink (half, shut, half) every `blinkEvery` s. */
export function gulpLid(mood: GulpMood, t: number): number {
  const m = GULP_MOOD_STYLE[mood];
  const into = t - Math.floor(t / m.blinkEvery) * m.blinkEvery;
  const k = step(into, 6);
  const blink = [2, 3, 2][k] ?? m.lidRest;
  return Math.max(m.lidRest, blink);
}

/** Bite leap keys (12 fps): rise open-mouthed out of the cloud sea, snap shut on the wedge, settle open on the rim. */
const BITE_KEYS: readonly { lift: number; pitch: number; open: boolean }[] = [
  { lift: -6, pitch: 10, open: true },
  { lift: 2, pitch: 16, open: true },
  { lift: 4, pitch: 8, open: true },
  { lift: 3, pitch: -4, open: false },
  { lift: 0, pitch: -2, open: false },
  { lift: 0, pitch: 0, open: true },
];

/** Resolves Gulp's pose for a phase after `t` seconds in it. Deterministic and stepped. */
export function gulpPose(phase: GulpPhase, t: number, mood: GulpMood): GulpPose {
  const style = GULP_MOOD_STYLE[mood];
  const neutral = {
    visible: true,
    lift: 0,
    shift: 0,
    pitch: 0,
    mouthOpen: false,
    sx: 1,
    sy: 1,
    lid: gulpLid(mood, t),
    tongue: false,
    rings: [] as number[],
  };
  switch (phase) {
    case "hidden":
      return { ...neutral, visible: false };
    case "rising": {
      // Under the cloud sea: climbs in 4 steps while the wedge darkens; rumble jitter at 12 fps.
      const k = Math.min(3, step(t / RISE_S, 4));
      return { ...neutral, lift: -22 + k * 3, shift: step(t, STEP_FPS) % 2 === 0 ? 0.5 : -0.5 };
    }
    case "teeth": {
      const k = step(t, STEP_FPS);
      const b = BITE_KEYS[k];
      if (b)
        return { ...neutral, lift: b.lift, pitch: b.pitch * DEG, mouthOpen: b.open, tongue: k >= BITE_KEYS.length - 1 };
      // Resting on the rim: slow 2-frame breathing at 2 fps; Grumpy grumbles (a 1-voxel shake every other second).
      const breath = step(t, 2) % 2;
      const grumble = style.grumble && step(t, 1) % 2 === 1 ? (step(t, STEP_FPS) % 2 === 0 ? 0.5 : -0.5) : 0;
      return {
        ...neutral,
        mouthOpen: true,
        tongue: true,
        sy: breath ? 1.02 : 1,
        lift: breath ? 0.5 : 0,
        shift: grumble,
      };
    }
    case "inhale": {
      // Mouth wide, cheeks puffing in 4 steps, 3 suction rings converging on the mouth every 0.5 s.
      const puff = 1 + 0.02 * Math.min(4, step(t, 2) + 1);
      const cyc = (t % 0.5) / 0.5;
      const base = 24 - Math.floor(cyc * 4) * 5;
      return {
        ...neutral,
        mouthOpen: true,
        tongue: true,
        sx: puff,
        sy: puff,
        pitch: 6 * DEG,
        shift: step(t, STEP_FPS) % 2 === 0 ? 0.3 : -0.3,
        rings: [base, base + 10, base + 20].filter((r) => r > 2),
        lid: 0,
      };
    }
    case "sinking": {
      const k = step(t / SINK_S, 4);
      if (k >= 4) return { ...neutral, visible: false };
      return { ...neutral, lift: -k * 6, lid: Math.max(neutral.lid, 1) };
    }
  }
}

/** Burp overlay (0.75 s): mouth "O", squash, 3 paper rings expanding from the mouth. Null when finished. */
export function burpOverlay(t: number): { sy: number; rings: readonly number[] } | null {
  if (t < 0 || t >= BURP_S) return null;
  const k = step(t, STEP_FPS);
  const sy = k < 2 ? 1.1 : k < 4 ? 0.94 : 1;
  const rings = [0, 1, 2].map((i) => 4 + (k - i * 2) * 3).filter((r) => r >= 4);
  return { sy, rings };
}

/** A popped tooth's stepped arc (voxels, relative to its socket); null once gone (0.6 s). */
export function toothPop(t: number): { x: number; y: number; spin: number } | null {
  if (t < 0 || t >= 0.6) return null;
  const ts = step(t, STEP_FPS) / STEP_FPS;
  return { x: -18 * ts, y: 14 * ts - 40 * ts * ts, spin: step(t, STEP_FPS) * (Math.PI / 2) };
}

/** Star crumb `i` (of 6) flying from a popped tooth (voxels, relative to the socket). Null once gone (0.6 s). */
export function starCrumb(i: number, t: number): { x: number; y: number; z: number } | null {
  if (t < 0 || t >= 0.6) return null;
  const ts = step(t, STEP_FPS) / STEP_FPS;
  const a = (i / 6) * Math.PI * 2 + hash01(i, 3) * 0.5;
  return { x: -6 * ts - Math.cos(a) * 10 * ts, y: 12 * ts - 30 * ts * ts + 1, z: Math.sin(a) * 10 * ts };
}

/** Shadow wedge darkening (bible §8.13): Bayer coverage 25 → 75 % over 2 s in 4 steps; 0 before, 0.75 after. */
export function wedgeCoverage(t: number): number {
  if (t < 0) return 0;
  const k = Math.min(3, step(t / RISE_S, 4));
  return 0.25 + (k * 0.5) / 3;
}
