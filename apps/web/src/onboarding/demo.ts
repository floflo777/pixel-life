/**
 * Scripted frames for the first-visit illustrations. Pure: given a real Friend's appearance, it picks which pixels a
 * "hit" knocks off (only boundary pixels, exactly like the sim) and in which order they heal (the Friend's real
 * `regrowthOrder`), so the cards show that Friend's actual behaviour rather than a stock drawing.
 */
import {
  boundary,
  EMPTY_MASK,
  type FriendAppearance,
  type FriendView,
  frontMask,
  fromIndices,
  type Hex64,
  pixelXY,
  regrowthOrder,
  toIndices,
} from "@pl/shared";

/** One frame of an illustration. */
export interface DemoFrame {
  /** Scar mask drawn on the portrait. */
  lost: Hex64;
  /** Pixels shown as "about to be filled" (Regrow / Mend preview). */
  highlight: Hex64;
  /** Stitch mask (mended pixels). */
  stitched: Hex64;
  /** Pixels drawn loose beside the Friend (knocked off, not yet grabbed or scarred). */
  loose: readonly number[];
  /** Caption shown under the Friend for this frame. */
  caption: string;
  /** How long the frame holds (ms). */
  ms: number;
}

/**
 * `n` boundary pixels of the Friend's front sprite, spread evenly around the silhouette (deterministic per token).
 * Returns fewer when the sprite has fewer boundary pixels.
 */
export function knockPixels(appearance: FriendAppearance, n: number, offset = 0): number[] {
  const edge = toIndices(boundary(frontMask(appearance)));
  if (edge.length === 0 || n <= 0) return [];
  const count = Math.min(n, edge.length);
  const step = edge.length / count;
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const i = edge[Math.floor(k * step + offset) % edge.length];
    if (i !== undefined && !out.includes(i)) out.push(i);
  }
  return out;
}

/** `lost` pixels in the order free regrowth heals them for this token. */
export function healOrder(tokenId: string, lost: readonly number[]): number[] {
  const set = new Set(lost);
  return regrowthOrder(tokenId).filter((i) => set.has(i));
}

/** Unit vector (in sprite pixels) pointing from the sprite centre to pixel `i`: where a knocked pixel flies. */
export function outward(i: number): readonly [dx: number, dy: number] {
  const [x, y] = pixelXY(i);
  const dx = x - 7.5;
  const dy = y - 7.5;
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

const frame = (f: Partial<DemoFrame> & Pick<DemoFrame, "caption" | "ms">): DemoFrame => ({
  lost: EMPTY_MASK,
  highlight: EMPTY_MASK,
  stitched: EMPTY_MASK,
  loose: [],
  ...f,
});

/** Card 1: a hit knocks 5 pixels loose, you grab 3 back, 2 become scars. */
export function hitFrames(appearance: FriendAppearance): DemoFrame[] {
  const k = knockPixels(appearance, 5);
  const kept = k.slice(3);
  return [
    frame({ caption: "whole", ms: 900 }),
    frame({ lost: fromIndices(k), loose: k, caption: `hit: ${k.length} px knocked off`, ms: 1300 }),
    frame({ lost: fromIndices(kept), loose: kept, caption: "3 grabbed back", ms: 1100 }),
    frame({ lost: fromIndices(kept), caption: `${kept.length} missed: scars`, ms: 1800 }),
  ];
}

/** Card 2: scars heal one at a time for free, then the rest regrow at once with RF. */
export function healFrames(appearance: FriendAppearance): DemoFrame[] {
  const order = healOrder(appearance.tokenId, knockPixels(appearance, 7, 3));
  const after = (n: number): Hex64 => fromIndices(order.slice(n));
  return [
    frame({ lost: after(0), caption: `${order.length} scars`, ms: 900 }),
    frame({ lost: after(1), caption: "free: 1 px every 2 h", ms: 800 }),
    frame({ lost: after(2), caption: "free: 1 px every 2 h", ms: 800 }),
    frame({ lost: after(2), highlight: after(2), caption: "or regrow now with RF", ms: 1200 }),
    frame({ caption: "whole again", ms: 1500 }),
  ];
}

/** Card 3: a stranger's scars get mended; mended pixels carry visible stitches. */
export function mendFrames(appearance: FriendAppearance): DemoFrame[] {
  const k = knockPixels(appearance, 6, 1);
  const m = fromIndices(k);
  return [
    frame({ lost: m, caption: `a stranger, ${k.length} scars`, ms: 1000 }),
    frame({ lost: m, highlight: m, caption: "you mend them", ms: 1200 }),
    frame({ stitched: m, caption: "stitched, and paid", ms: 1800 }),
  ];
}

/** A display-only `FriendView` for an illustration (loaned: no gold, no economy). */
export function demoView(appearance: FriendAppearance, now = 0): FriendView {
  return {
    appearance,
    loaned: true,
    pub: {
      tokenId: appearance.tokenId,
      scars: { lost: EMPTY_MASK, updatedAt: now, version: 0 },
      goldHeld: 0,
      glowCracks: 0,
      streak: 0,
      lastSeen: now,
      economy: "sim",
    },
  };
}
