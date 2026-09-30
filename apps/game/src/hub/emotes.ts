/**
 * Emote body animation (pure). Stepped at 12 fps, 6–10 frames each (GDD §11.4, art bible §7): offsets and scales
 * applied to a Friend's root on top of its sprite pose. Reduced motion keeps the bubble and drops the body motion.
 */
import type { EmoteName } from "@pl/shared";

/** Presentation rate for emotes. */
export const EMOTE_FPS = 12;

/** One stepped emote frame applied to the Friend root. */
export interface EmoteFrame {
  /** Lift above the ground, world units. */
  readonly dy: number;
  /** Roll about the view axis, radians (spin is roll-only: GDD §11.4). */
  readonly roll: number;
  readonly sx: number;
  readonly sy: number;
  /** Pixel-burst scatter 0..1 (the model scales out, the scene adds sparkles). */
  readonly burst: number;
  /** True on the frame a stomp lands (dust puff + footstep thud). */
  readonly impact: boolean;
}

const REST: EmoteFrame = { dy: 0, roll: 0, sx: 1, sy: 1, burst: 0, impact: false };
const f = (p: Partial<EmoteFrame>): EmoteFrame => ({ ...REST, ...p });

const TABLE: Readonly<Record<EmoteName, readonly EmoteFrame[]>> = {
  wave: [0.14, -0.14, 0.14, -0.14, 0.14, -0.14, 0, 0].map((roll) => f({ roll })),
  hop: [0, 0.22, 0.4, 0.46, 0.4, 0.22, 0, 0].map((dy, i) => f({ dy, sy: i === 0 || i === 6 ? 0.9 : 1 })),
  spin: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => f({ roll: (-k * Math.PI) / 4 })),
  heart: [0, 0.08, 0.12, 0.08, 0, 0.08, 0.12, 0.08, 0].map((dy) => f({ dy })),
  "pixel-burst": [0, 0.5, 1, 1, 0.5, 0, 0, 0].map((b) => f({ burst: b, sx: 1 + 0.18 * b, sy: 1 + 0.18 * b })),
  sit: [0.9, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.9, 1].map((sy) => f({ sy, sx: 1 + (1 - sy) * 0.5 })),
  flex: [0.75, 1.2, 0.75, 1.2, 0.9, 1].map((sy) => f({ sy, sx: 1 / Math.sqrt(sy) })),
  stomp: [0, 0.2, 0.34, 0.2, 0, 0, 0, 0].map((dy, i) => f({ dy, impact: i === 4, sy: i === 4 ? 0.85 : 1 })),
};

/** Number of frames an emote lasts. */
export function emoteFrames(name: EmoteName): number {
  return TABLE[name].length;
}

/** Duration of an emote in ms. */
export function emoteDurationMs(name: EmoteName): number {
  return (emoteFrames(name) * 1000) / EMOTE_FPS;
}

/**
 * The frame of `name` at `elapsedMs` after it started, or null once finished. Under reduced motion only `sit` keeps
 * its (static) pose; everything else stays at rest and the bubble carries the emote.
 */
export function emoteFrame(name: EmoteName, elapsedMs: number, reducedMotion = false): EmoteFrame | null {
  if (elapsedMs < 0) return REST;
  const frames = TABLE[name];
  const i = Math.floor((elapsedMs * EMOTE_FPS) / 1000);
  if (i >= frames.length) return null;
  if (reducedMotion) return name === "sit" ? f({ sy: 0.8, sx: 1.1 }) : REST;
  return frames[i] ?? REST;
}
