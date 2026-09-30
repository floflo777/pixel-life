/**
 * Pure, deterministic creature animation: (kind, state, time) → pose. Presentation is stepped (art bible §7): idles are
 * 2 frames at 6 fps, everything else holds keys at 12 fps; nothing eases. Poses swap whole sprite frames (so crouches,
 * puffs and jaw moves stay on the voxel grid) and add squash & stretch, lift, pitch and roll on top.
 */
import type { CreatureKind } from "./sprites";
import type { CreatureState } from "./states";

/** A resolved pose. Lengths are in voxels, angles in radians. */
export interface CreaturePose {
  /** Sprite frame name (see CREATURE_SPRITES). */
  readonly frame: string;
  /** Squash & stretch (x/z and y); feet stay on the ground. */
  readonly sx: number;
  readonly sy: number;
  /** Uniform scale (spawn pop, Slurp sulk). */
  readonly scale: number;
  /** Height above the creature's ground point. */
  readonly lift: number;
  /** Lean toward the front (+) about the feet: Nib's bow. */
  readonly pitch: number;
  /** Side roll about the feet: dizzy wobble, Fizz tumble. */
  readonly roll: number;
  /** Sideways jitter (telegraph tremble). */
  readonly shift: number;
  readonly visible: boolean;
  /** Fizz fuse spark lit this frame. */
  readonly spark: boolean;
}

/** One key of a clip; missing fields take the neutral pose. Angles in degrees for readability. */
export interface PoseKey {
  readonly frame?: string;
  readonly sx?: number;
  readonly sy?: number;
  readonly scale?: number;
  readonly lift?: number;
  readonly pitchDeg?: number;
  readonly rollDeg?: number;
  readonly shift?: number;
  readonly visible?: boolean;
  readonly spark?: boolean;
}

/** A stepped clip: `keys` played at `fps`, looping or holding the last key. */
export interface Clip {
  readonly fps: number;
  readonly loop: boolean;
  readonly keys: readonly PoseKey[];
}

/** Presentation rate for creature cycles (bible §7). */
export const STEP_FPS = 12;
/** Idle rate: 2 frames at 6 fps. */
export const IDLE_FPS = 6;

const DEG = Math.PI / 180;

const loop = (fps: number, ...keys: PoseKey[]): Clip => ({ fps, loop: true, keys });
const once = (fps: number, ...keys: PoseKey[]): Clip => ({ fps, loop: false, keys });

/** Spawn: 0.35 s of ground ripple (body hidden), then a sprout pop 0.5 → 1.15 → 1 (bible §8.10 rhythm). */
const SPAWN = once(
  STEP_FPS,
  { visible: false },
  { visible: false },
  { visible: false },
  { visible: false },
  { scale: 0.5, sy: 1.2 },
  { scale: 1.15, sy: 0.9 },
  { scale: 1 },
);
const SMASHED = once(STEP_FPS, { visible: false });
const DIZZY = (frame: string, deg: number): Clip =>
  loop(IDLE_FPS, { frame, rollDeg: deg, sx: 1.04, sy: 0.96 }, { frame, rollDeg: -deg, sx: 0.98, sy: 1.02 });

type ClipTable = Partial<Record<CreatureState, Clip>>;

/** State → clip, per kind. States a kind never enters fall back to FALLBACK. */
export const CLIPS: Readonly<Record<CreatureKind, ClipTable>> = {
  nib: {
    idle: loop(IDLE_FPS, { frame: "idle0" }, { frame: "idle1", sx: 1.06, sy: 0.94 }),
    move: loop(
      STEP_FPS,
      { frame: "idle0" },
      { frame: "idle1", sx: 1.1, sy: 0.9 },
      { frame: "idle0", sx: 0.95, sy: 1.06, lift: 1 },
      { frame: "idle1", sx: 1, sy: 1, lift: 1 },
    ),
    // The bow: whole-body 20° dip in 2 steps, eyes shut, then held until the bite.
    telegraph: once(
      STEP_FPS,
      { frame: "bow", pitchDeg: 10, sy: 0.97 },
      { frame: "bow", pitchDeg: 20, sy: 0.94, sx: 1.04 },
    ),
    // "nom" then hop back 3 u.
    attack: once(
      STEP_FPS,
      { frame: "bite", pitchDeg: 12, sx: 1.15, sy: 0.88 },
      { frame: "bite", pitchDeg: 6, sx: 1.08, sy: 0.95 },
      { frame: "idle0", sx: 0.9, sy: 1.12, lift: 2, pitchDeg: -6 },
      { frame: "idle1", sx: 0.94, sy: 1.08, lift: 3, pitchDeg: -6 },
      { frame: "idle0", lift: 2 },
      { frame: "idle0", sx: 1.12, sy: 0.88 },
      { frame: "idle0" },
    ),
    stunned: DIZZY("stun", 8),
    flee: loop(
      STEP_FPS,
      { frame: "idle1", sx: 0.94, sy: 1.08, lift: 1 },
      { frame: "idle0", lift: 2 },
      { frame: "idle1", sx: 1.1, sy: 0.9 },
    ),
  },
  pogo: {
    // Can't sit still: a jittery 4-key shuffle.
    idle: loop(
      STEP_FPS,
      { frame: "idle0" },
      { frame: "idle1", sx: 1.08, sy: 0.93 },
      { frame: "idle0", sy: 1.05, lift: 1 },
      { frame: "idle1" },
    ),
    move: loop(STEP_FPS, { frame: "crouch", sx: 1.1, sy: 0.92 }, { frame: "hop", sx: 0.9, sy: 1.12, lift: 1 }),
    // Crouch 0.3 s: legs compress 3 → 1 in the sprite, then squash.
    telegraph: once(STEP_FPS, { frame: "crouch", sx: 1.08, sy: 0.95 }, { frame: "crouch", sx: 1.16, sy: 0.88 }),
    airborne: once(
      STEP_FPS,
      { frame: "hop", sx: 0.86, sy: 1.18 },
      { frame: "hop", sx: 0.94, sy: 1.08 },
      { frame: "hop" },
    ),
    attack: once(
      STEP_FPS,
      { frame: "crouch", sx: 1.22, sy: 0.84 },
      { frame: "idle0", sx: 1.06, sy: 0.96 },
      { frame: "idle0" },
    ),
    stunned: DIZZY("stun", 10),
    flee: loop(
      STEP_FPS,
      { frame: "crouch", sx: 1.1, sy: 0.9 },
      { frame: "hop", sx: 0.9, sy: 1.14, lift: 2 },
      { frame: "hop", lift: 3 },
      { frame: "hop", lift: 1 },
    ),
  },
  clank: {
    idle: loop(IDLE_FPS, { frame: "idle0" }, { frame: "idle1", sx: 1.03, sy: 0.97 }),
    move: loop(IDLE_FPS, { frame: "idle0" }, { frame: "idle1", sx: 1.04, sy: 0.96, shift: 0.5 }),
    // Jaw open 0.6 s: the plate splits and the whole beetle trembles.
    telegraph: loop(STEP_FPS, { frame: "jaws", shift: 0.5, sy: 1.03 }, { frame: "jaws", shift: -0.5, sy: 1.03 }),
    attack: once(
      STEP_FPS,
      { frame: "idle0", pitchDeg: 10, sx: 1.12, sy: 0.9 },
      { frame: "idle0", pitchDeg: 4, sx: 1.05, sy: 0.95 },
      { frame: "idle0" },
    ),
    stunned: DIZZY("stun", 6),
    flee: loop(STEP_FPS, { frame: "idle0", lift: 1 }, { frame: "idle1", sx: 1.06, sy: 0.94 }),
  },
  snatch: {
    // Wings flapping in 2 frames (GDD §3.5); the body bobs with the downstroke.
    idle: loop(IDLE_FPS, { frame: "up" }, { frame: "down", lift: 1, sy: 0.96 }),
    move: loop(IDLE_FPS, { frame: "up" }, { frame: "down", lift: 1, sy: 0.96 }),
    // Aim 0.4 s: wings high and still, nose tipping down toward the swoop line.
    telegraph: once(STEP_FPS, { frame: "up", sy: 1.08, pitchDeg: 6 }, { frame: "up", sy: 1.12, pitchDeg: 14 }),
    // Swoop: folded into a dart.
    attack: once(STEP_FPS, { frame: "dart", pitchDeg: 24, sx: 0.9, sy: 1.1 }),
    carry: loop(STEP_FPS, { frame: "carryUp" }, { frame: "carryDown", lift: 1, sy: 0.95 }),
    stunned: loop(STEP_FPS, { frame: "stun", rollDeg: 20 }, { frame: "stun", rollDeg: -20, lift: -1 }),
    flee: loop(STEP_FPS, { frame: "up" }, { frame: "down", lift: 1, sy: 0.95 }),
  },
  slurp: {
    // Slow sleepy breathing; "zzz" comes from the speech hook.
    sleep: loop(2, { frame: "sleep" }, { frame: "sleep", sx: 1.04, sy: 0.97 }),
    // Awake: breathes at 6 fps and blinks once per 8 keys.
    idle: loop(
      IDLE_FPS,
      { frame: "idle0" },
      { frame: "idle0", sx: 1.02, sy: 0.98 },
      { frame: "idle0" },
      { frame: "idle0", sx: 1.02, sy: 0.98 },
      { frame: "idle0" },
      { frame: "sleep", sx: 1.02, sy: 0.98 },
      { frame: "idle0" },
      { frame: "idle0", sx: 1.02, sy: 0.98 },
    ),
    // Cheek puff 0.7 s (+2 voxels each side), trembling before the yank.
    telegraph: loop(STEP_FPS, { frame: "puff", shift: 0.4, sy: 1.02 }, { frame: "puff", shift: -0.4, sy: 1.04 }),
    // Tongue out (the ribbon itself follows tongueExtension()).
    attack: once(STEP_FPS, { frame: "open", sx: 1.04, sy: 0.96 }, { frame: "open" }),
    // Sulk: shrinks and droops for the 1.5 s stun.
    stunned: loop(IDLE_FPS, { frame: "sulk", scale: 0.84, sy: 0.94 }, { frame: "sulk", scale: 0.84, sy: 0.9 }),
    flee: loop(
      STEP_FPS,
      { frame: "awake", sx: 1.08, sy: 0.9 },
      { frame: "awake", sy: 1.1, lift: 2 },
      { frame: "awake", lift: 1 },
    ),
  },
  fizz: {
    idle: loop(IDLE_FPS, { frame: "idle0", spark: true }, { frame: "idle1", sx: 1.05, sy: 0.95 }),
    move: loop(STEP_FPS, { frame: "idle0", rollDeg: 8, spark: true }, { frame: "idle1", rollDeg: -8, lift: 1 }),
    // The fuse: see fizzFuse() (blink 4 → 12 Hz, swelling).
    telegraph: loop(STEP_FPS, { frame: "fused" }),
    // Launched: tumbling in 90° steps.
    projectile: loop(
      STEP_FPS,
      { frame: "fused", rollDeg: 0, spark: true },
      { frame: "fused", rollDeg: 90, spark: true },
      { frame: "fused", rollDeg: 180, spark: true },
      { frame: "fused", rollDeg: 270, spark: true },
    ),
    stunned: DIZZY("stun", 12),
    flee: loop(STEP_FPS, { frame: "idle0", rollDeg: 8 }, { frame: "idle1", rollDeg: -8, lift: 1 }),
  },
};

const FALLBACK: ClipTable = {
  spawn: SPAWN,
  smashed: SMASHED,
};

/** The clip a kind plays for a state (kind-specific, then spawn/smashed, then the kind's idle). */
export function clipFor(kind: CreatureKind, state: CreatureState): Clip {
  const table = CLIPS[kind];
  const idle = table.idle ?? table.sleep;
  const c =
    table[state] ?? FALLBACK[state] ?? (state === "carry" || state === "airborne" ? table.move : undefined) ?? idle;
  if (!c) throw new Error(`No clip for ${kind}.${state}`);
  return c;
}

/** Index of the key shown at time `t` (seconds in state). `phase` offsets looping clips so crowds don't march in step. */
export function keyIndex(clip: Clip, t: number, phase = 0): number {
  const n = clip.keys.length;
  const step = Math.floor(Math.max(0, t) * clip.fps + 1e-6);
  if (clip.loop) return (((step + phase) % n) + n) % n;
  return Math.min(step, n - 1);
}

const FUSE_S = 1.5;

/**
 * Fizz fuse (GDD §3.7): the spark blinks at a rate rising linearly 4 → 12 Hz over 1.5 s (phase = ∫f dt), sampled on
 * the 12 fps grid until the rate outruns it, then on a 24 Hz grid; the body swells in 4 steps.
 */
export function fizzFuse(t: number): { spark: boolean; swell: number } {
  const tt = Math.min(Math.max(0, t), FUSE_S);
  const grid = tt < 0.75 ? STEP_FPS : 24;
  const ts = Math.floor(tt * grid + 1e-6) / grid;
  const cycles = 4 * ts + ((12 - 4) / (2 * FUSE_S)) * ts * ts;
  const spark = Math.floor(cycles * 2) % 2 === 0;
  const swell = 1 + 0.05 * Math.min(4, Math.floor((tt / FUSE_S) * 4));
  return { spark, swell };
}

/** Resolves the pose for `kind` in `state` after `t` seconds in that state. Deterministic and stepped. */
export function creaturePose(kind: CreatureKind, state: CreatureState, t: number, phase = 0): CreaturePose {
  const clip = clipFor(kind, state);
  const k = clip.keys[keyIndex(clip, t, phase)] ?? {};
  let sx = k.sx ?? 1;
  let sy = k.sy ?? 1;
  let spark = k.spark ?? false;
  if (kind === "fizz" && state === "telegraph") {
    const f = fizzFuse(t);
    spark = f.spark;
    sx *= f.swell;
    sy *= f.swell;
  }
  return {
    frame: k.frame ?? "idle0",
    sx,
    sy,
    scale: k.scale ?? 1,
    lift: k.lift ?? 0,
    pitch: (k.pitchDeg ?? 0) * DEG,
    roll: (k.rollDeg ?? 0) * DEG,
    shift: k.shift ?? 0,
    visible: k.visible ?? true,
    spark,
  };
}

/** Hit reaction overlay (0.25 s): a paper flash for 2 frames, then squash → stretch → rest. Null once finished. */
export function hitOverlay(t: number): { flash: boolean; sx: number; sy: number } | null {
  if (t < 0) return null;
  const keys = [
    { flash: true, sx: 1.25, sy: 0.8 },
    { flash: true, sx: 1.18, sy: 0.86 },
    { flash: false, sx: 0.9, sy: 1.12 },
  ];
  return keys[Math.floor(t * STEP_FPS + 1e-6)] ?? null;
}

/** Slurp's tongue reach 0..1 after `t` seconds: 3 frames out, 2 back (bible §8.7), then 0. */
export function tongueExtension(t: number): number {
  if (t < 0) return 0;
  const keys = [1 / 3, 2 / 3, 1, 0.5];
  return keys[Math.floor(t * STEP_FPS + 1e-6)] ?? 0;
}

/** Deterministic hash → [0, 1) (mulberry-style integer mix, no Math.random). */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Death shatter duration (bible §5: gone in 0.5 s). */
export const SHATTER_S = 0.5;

/** One shard's stepped trajectory sample. Units are voxels, relative to the creature's centre. */
export interface ShardSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Tumble angle (radians, 90° steps). */
  readonly spin: number;
  /** Size multiplier (shrinks in the last steps). */
  readonly size: number;
}

/**
 * Where shard `i` of `seed` is at `t` (bible §5: 6–10 pastel shards, stepped fall, gone in 0.5 s). Sampled on the
 * 12 fps grid so the fall reads as stepped. Null once gone.
 */
export function shardSample(seed: number, i: number, t: number, halfW: number, halfH: number): ShardSample | null {
  if (t < 0 || t >= SHATTER_S) return null;
  const ts = Math.floor(t * STEP_FPS + 1e-6) / STEP_FPS;
  const a = hash01(seed, i * 3) * Math.PI * 2;
  const up = 10 + 14 * hash01(seed, i * 3 + 1);
  const out = 10 + 12 * hash01(seed, i * 3 + 2);
  const x0 = Math.cos(a) * halfW * 0.6;
  const y0 = halfH + Math.sin(a) * halfH * 0.6;
  const g = 90;
  return {
    x: x0 + Math.cos(a) * out * ts,
    y: Math.max(0, y0 + up * ts - 0.5 * g * ts * ts),
    z: (hash01(seed, i + 101) - 0.5) * 8 * ts,
    spin: Math.floor(ts * STEP_FPS + i) * (Math.PI / 2),
    size: ts > SHATTER_S * 0.66 ? 0.5 : 1,
  };
}

/** Shard count for a creature (6–10, deterministic per seed). */
export function shardCount(seed: number): number {
  return 6 + Math.floor(hash01(seed, 7) * 5);
}
