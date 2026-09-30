/**
 * Input → hub intents (pure). The scene projects Friends and doors to screen rectangles each frame; these functions
 * decide what a tap means, turn a drag into a stick, and rotate screen-space axes onto the ground.
 */
import type { TokenIdStr } from "@pl/shared";

/** A tappable Friend on screen (CSS px), with its camera depth for front-most picking. */
export interface FriendHitBox {
  readonly key: string;
  readonly tokenId: TokenIdStr;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly depth: number;
  /** Has lost pixels right now (a Mend target). */
  readonly scarred: boolean;
  readonly isYou: boolean;
}

/** A tappable door on screen (CSS px). */
export interface DoorHitBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** What a tap asks for. */
export type TapIntent =
  | { readonly type: "mend"; readonly tokenId: TokenIdStr; readonly key: string }
  | { readonly type: "inspect"; readonly tokenId: TokenIdStr; readonly key: string }
  | { readonly type: "self" }
  | { readonly type: "door"; readonly id: string }
  | { readonly type: "ground" };

/** Extra touch slop around Friend boxes: thumbs are wide (44 px targets). */
export const FRIEND_TAP_SLOP = 6;

/**
 * Resolves a tap at (x, y): the front-most Friend under it wins (a scarred stranger → mend, anyone else → inspect,
 * yourself → self), then the nearest door within its radius, else the ground.
 */
export function classifyTap(
  x: number,
  y: number,
  friends: readonly FriendHitBox[],
  doors: readonly DoorHitBox[],
  slop = FRIEND_TAP_SLOP,
): TapIntent {
  let best: FriendHitBox | null = null;
  for (const f of friends) {
    if (x < f.left - slop || x > f.right + slop || y < f.top - slop || y > f.bottom + slop) continue;
    if (!best || f.depth < best.depth) best = f;
  }
  if (best) {
    if (best.isYou) return { type: "self" };
    return { type: best.scarred ? "mend" : "inspect", tokenId: best.tokenId, key: best.key };
  }
  let door: DoorHitBox | null = null;
  let dBest = Infinity;
  for (const d of doors) {
    const dd = Math.sqrt((x - d.x) ** 2 + (y - d.y) ** 2);
    if (dd <= d.radius && dd < dBest) {
      door = d;
      dBest = dd;
    }
  }
  return door ? { type: "door", id: door.id } : { type: "ground" };
}

/** Virtual stick tuning (CSS px). */
export const STICK = { deadZone: 12, fullAt: 64 } as const;

/**
 * A drag vector (CSS px, y down) as a stick axis: null inside the dead zone, else a vector whose length ramps from 0
 * to 1 between the dead zone and `fullAt` (direction preserved).
 */
export function stickAxis(vx: number, vy: number, stick = STICK): { x: number; y: number } | null {
  const l = Math.sqrt(vx * vx + vy * vy);
  if (l < stick.deadZone) return null;
  const k = Math.min(1, (l - stick.deadZone) / Math.max(1, stick.fullAt - stick.deadZone));
  return { x: (vx / l) * Math.max(k, 0.35), y: (vy / l) * Math.max(k, 0.35) };
}

/**
 * Rotates a screen axis (x right, y down) onto the ground plane for a camera orbiting at `yawRad` (yaw 0 = camera on
 * +z looking toward −z): screen right → camera right, screen down → toward the camera.
 */
export function screenToGround(ax: number, ay: number, yawRad: number): [number, number] {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  return [ax * c + ay * s, -ax * s + ay * c];
}
