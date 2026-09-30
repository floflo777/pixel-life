/**
 * Cosmetic layers drawn on top of a Friend's canonical pixels: where its Gold Pixels sit and which pixels show
 * Mend stitches. Both are pure functions of public state, so every client draws the same Friend.
 */
import { and, andNot, EMPTY_MASK, fromIndices, getBit, isSubset, or } from "./bitmap.js";
import { type Hex64, type TokenIdStr } from "./ids.js";
import { fnv1a32, mulberry32 } from "./util.js";

/** Most Gold Pixels that change a Friend's look (the economy perk caps at the same number, tokenomics §4). */
export const MAX_VISIBLE_GOLD = 2;
/** How long Mend stitches stay visible after the Mend that made them. */
export const STITCH_VISIBLE_MS = 7 * 24 * 60 * 60 * 1000;

/** A fixed per-token permutation of 0..255, independent of the regrowth order. */
function goldOrder(tokenId: TokenIdStr): number[] {
  const next = mulberry32(fnv1a32(`pixel-life/gold/${tokenId}`));
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = next() % (i + 1);
    const t = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = t;
  }
  return order;
}

/**
 * The pixels drawn in gold: the first `min(goldHeld, MAX_VISIBLE_GOLD)` present pixels (`front & ~lost`) in the
 * token's gold order. Deterministic; empty when nothing is held or nothing is present. Gold never sits on a scar.
 */
export function goldSlots(front: Hex64, lost: Hex64, tokenId: TokenIdStr, goldHeld: number): Hex64 {
  const count = Math.max(0, Math.min(MAX_VISIBLE_GOLD, Math.floor(goldHeld)));
  if (count === 0) return EMPTY_MASK;
  const present = andNot(front, lost);
  const picked: number[] = [];
  for (const i of goldOrder(tokenId)) {
    if (picked.length === count) break;
    if (getBit(present, i)) picked.push(i);
  }
  return fromIndices(picked);
}

/** A pixel set restored by someone else's Mend, and when. */
export interface StitchRecord {
  pixels: Hex64;
  at: number;
}

/**
 * Pixels showing Mend stitches at `now`: the union of records younger than `STITCH_VISIBLE_MS`, limited to pixels that
 * are currently present (a stitch that was bitten off again is gone).
 */
export function visibleStitches(records: readonly StitchRecord[], front: Hex64, lost: Hex64, now: number): Hex64 {
  const present = andNot(front, lost);
  let out = EMPTY_MASK;
  for (const r of records) {
    if (now - r.at >= STITCH_VISIBLE_MS || r.at > now) continue;
    out = or(out, and(r.pixels, present));
  }
  return out;
}

/** True when `slots` is a valid gold layout for this Friend state (used by the server to reject tampered views). */
export function isValidGoldLayout(slots: Hex64, front: Hex64, lost: Hex64): boolean {
  return isSubset(slots, andNot(front, lost));
}
