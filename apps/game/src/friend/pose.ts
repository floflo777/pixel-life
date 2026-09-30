/**
 * Pose → SDK frame mapping and the stepped animation clock. Pure.
 *
 * Mirrors FriendSDK `spriteFrame()`: Colossus has blank up/down frames on-chain, so vertical facings resolve to the last
 * horizontal facing (right by default). Nothing is mirrored or invented.
 */
import {
  COLOSSUS_FAMILY_ID,
  EMPTY_MASK,
  FRAMES_PER_FACING,
  frameIndex,
  type Facing,
  type FriendAppearance,
} from "@pl/shared";

/** A resolved pose: the frame index to draw and which facing it really shows. */
export interface ResolvedPose {
  index: number;
  resolvedFacing: Facing;
  usedFallback: boolean;
}

/**
 * The frame to draw for a pose. Colossus up/down → `sideFallback`. A blank frame (never expected on-chain, but a
 * corrupt bake must not make a Friend vanish) falls back to frame 0 of the same clip/facing, then to idle frame 0.
 */
export function resolvePose(
  a: FriendAppearance,
  facing: Facing,
  walking: boolean,
  frame: number,
  sideFallback: "left" | "right" = "right",
): ResolvedPose {
  const usedFallback = a.familyId === COLOSSUS_FAMILY_ID && (facing === "down" || facing === "up");
  const resolvedFacing: Facing = usedFallback ? sideFallback : facing;
  const f = ((Math.floor(frame) % FRAMES_PER_FACING) + FRAMES_PER_FACING) % FRAMES_PER_FACING;
  for (const [w, k] of [
    [walking, f],
    [walking, 0],
    [false, 0],
  ] as const) {
    const index = frameIndex(w, resolvedFacing, k);
    if (a.frames[index] !== undefined && a.frames[index] !== EMPTY_MASK) return { index, resolvedFacing, usedFallback };
  }
  return { index: frameIndex(walking, resolvedFacing, f), resolvedFacing, usedFallback };
}

/** Presentation animation rate (art bible §7: stepped at 12 fps). */
export const POSE_FPS = 12;

/**
 * A stepped animation clock over the 8 SDK frames per clip. Advances in whole frames only (no easing); switching
 * between idle and walk restarts the clip at frame 0 so a walk always starts on its contact pose.
 */
export class PoseClock {
  private acc = 0;
  private walking = false;
  /** Current frame 0..7. */
  frame = 0;

  constructor(private readonly fps: number = POSE_FPS) {
    if (!(fps > 0)) throw new RangeError("fps must be positive.");
  }

  /** Advances by `dtMs` and returns the current frame. Negative or non-finite `dt` is ignored. */
  update(dtMs: number, walking: boolean): number {
    if (walking !== this.walking) {
      this.walking = walking;
      this.acc = 0;
      this.frame = 0;
    }
    if (Number.isFinite(dtMs) && dtMs > 0) this.acc += dtMs;
    const step = 1000 / this.fps;
    if (this.acc >= step) {
      const n = Math.floor(this.acc / step);
      this.acc -= n * step;
      this.frame = (this.frame + n) % FRAMES_PER_FACING;
    }
    return this.frame;
  }
}

/**
 * The facing for a ground-plane move `(dx, dz)` seen from a camera looking toward −z: +z (toward the camera) is
 * "down", −z "up". The dominant axis wins; ties go horizontal so diagonal walks show the side frames. `(0, 0)` keeps
 * `current`.
 */
export function facingFromDelta(dx: number, dz: number, current: Facing = "down"): Facing {
  if (dx === 0 && dz === 0) return current;
  if (Math.abs(dx) >= Math.abs(dz)) return dx < 0 ? "left" : "right";
  return dz > 0 ? "down" : "up";
}
