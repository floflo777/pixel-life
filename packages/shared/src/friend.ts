/**
 * Friend appearance, persistent scars and free regrowth.
 *
 * Scars are a `Hex64` "lost" mask over the Friend's front mask. Free regrowth is lazy and deterministic: nothing is stored
 * per pixel, `effectiveLost()` derives the current mask from the stored one, the regrowth anchor and `now`. Pixels heal
 * in a fixed per-Friend order derived from the token id, so every client and the server agree without coordination.
 */
import { andNot, EMPTY_MASK, fromIndices, getBit, isSubset, or, and, popcount } from "./bitmap.js";
import { regrowthMsPerPx } from "./economy.js";
import { COLOSSUS_FAMILY_ID, type FamilyId, type Hex64, isHex64, type TokenIdStr } from "./ids.js";
import { fnv1a32, mulberry32 } from "./util.js";

/** Number of frames the registry returns per Friend. */
export const FRAME_COUNT = 64;
/** SDK facing order inside each clip. */
export const FACINGS = ["down", "up", "left", "right"] as const;
/** A sprite facing. */
export type Facing = (typeof FACINGS)[number];
/** Frames per facing per clip. */
export const FRAMES_PER_FACING = 8;

/** Immutable on-chain art of a Friend. `frames` is SDK order: idle[down,up,left,right] x 8, then walk[...] x 8. */
export interface FriendAppearance {
  tokenId: TokenIdStr;
  familyId: FamilyId;
  seed: number;
  frames: readonly Hex64[];
}

/**
 * Persistent scars. `lost` is always a subset of `frontMask(appearance)`.
 * `updatedAt` (ms since epoch) is the free-regrowth anchor: regrowth accrues from it. It only moves forward, and is reset
 * to the write time whenever nothing is left to heal (so regrowth never banks while whole).
 * `version` increases by exactly 1 per write (compare-and-swap key).
 */
export interface ScarState {
  lost: Hex64;
  updatedAt: number;
  version: number;
}

/** Public, cacheable state of a Friend (`GET /api/friends/:id/public`). `scars` is effective at serve time. */
export interface FriendPublic {
  tokenId: TokenIdStr;
  scars: ScarState;
  goldHeld: number;
  glowCracks: number;
  streak: number;
  lastSeen: number;
  economy: "sim" | "live";
  /** Pixels showing Mend stitches at serve time (`visibleStitches`); absent when there are none. */
  stitched?: Hex64;
}

/** Everything a client needs to render and reason about a Friend. `loaned` marks a guest's borrowed Friend. */
export interface FriendView {
  appearance: FriendAppearance;
  pub: FriendPublic;
  loaned: boolean;
}

/** Options for regrowth-aware scar functions. */
export interface RegrowthOptions {
  /**
   * Gold Pixels held throughout the accrual interval (the server passes the minimum held over it, tokenomics §4).
   * Default 0.
   */
  goldHeld?: number;
  /** Pixels locked by an open paid quote: free regrowth skips them (tokenomics §5.3). Default none. */
  locked?: Hex64;
}

/** Options for `applyLoss`: regrowth options plus the front mask used to clamp and floor the loss. */
export interface LossOptions extends RegrowthOptions {
  /**
   * The Friend's `frontMask`. When given, the delta is clipped to it and the result never loses more than
   * `maxPersistedLost(popcount(front))` pixels (GDD §2.5 floor). Servers must always pass it.
   */
  front?: Hex64;
}

/** A scar state for a whole Friend, anchored at `now`. */
export function wholeScars(now: number): ScarState {
  return { lost: EMPTY_MASK, updatedAt: now, version: 0 };
}

/** Index of the frame for a clip/facing/frame number in SDK order. */
export function frameIndex(walking: boolean, facing: Facing, frame: number): number {
  if (!Number.isInteger(frame) || frame < 0 || frame >= FRAMES_PER_FACING) throw new RangeError("Frame must be 0..7.");
  return (walking ? 32 : 0) + FACINGS.indexOf(facing) * FRAMES_PER_FACING + frame;
}

/**
 * The canonical front-facing mask that scars live on: idle-down frame 0, except for Colossus, which has no up/down
 * frames (they are blank on-chain), where it is idle-right frame 0, the same fallback as SDK `spriteFrame()`.
 */
export function frontMask(a: FriendAppearance): Hex64 {
  if (a.frames.length !== FRAME_COUNT) throw new RangeError("A Friend has exactly 64 frames.");
  const idx = a.familyId === COLOSSUS_FAMILY_ID ? frameIndex(false, "right", 0) : frameIndex(false, "down", 0);
  const m = a.frames[idx];
  if (!isHex64(m)) throw new RangeError("Invalid frame mask.");
  return m;
}

/** Canonical pixel count N0 of a Friend (popcount of its front mask). */
export function pixelCount(a: FriendAppearance): number {
  return popcount(frontMask(a));
}

/** Pixels still present on the front mask: `front & ~lost`. */
export function presentMask(front: Hex64, lost: Hex64): Hex64 {
  return andNot(front, lost);
}

/** Most pixels a Friend may have persistently lost: `N0 - ceil(N0 / 2)` (the 50 % floor, GDD §2.5). */
export function maxPersistedLost(n0: number): number {
  if (!Number.isInteger(n0) || n0 < 0 || n0 > 256) throw new RangeError("Pixel count must be 0..256.");
  return Math.floor(n0 / 2);
}

/**
 * Per-run scar cap: `max(6, round(0.15 * N0))` (GDD §2.5), clamped to the 12 px/run ceiling tokenomics.md §1.3 assumes.
 * Integer arithmetic only, so the sim can share it.
 */
export function runScarCap(n0: number): number {
  if (!Number.isInteger(n0) || n0 < 0 || n0 > 256) throw new RangeError("Pixel count must be 0..256.");
  return Math.min(12, Math.max(6, Math.floor((15 * n0 + 50) / 100)));
}

const orderCache = new Map<TokenIdStr, readonly number[]>();
const ORDER_CACHE_MAX = 512;

/**
 * The fixed order in which a Friend's pixels regrow: a permutation of 0..255 seeded by FNV-1a(tokenId) through
 * mulberry32 + Fisher-Yates. Identical on every engine; cached per token.
 */
export function regrowthOrder(tokenId: TokenIdStr): readonly number[] {
  const hit = orderCache.get(tokenId);
  if (hit) return hit;
  const next = mulberry32(fnv1a32(`pixel-life/regrowth/${tokenId}`));
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    // Unbiased enough for ordering: 2^32 mod (i+1) bias is < 1e-7 and does not affect determinism.
    const j = next() % (i + 1);
    const t = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = t;
  }
  const frozen = Object.freeze(order);
  if (orderCache.size >= ORDER_CACHE_MAX) {
    const oldest = orderCache.keys().next();
    if (!oldest.done) orderCache.delete(oldest.value);
  }
  orderCache.set(tokenId, frozen);
  return frozen;
}

/** The first `k` set pixels of `m` in the token's regrowth order. */
function firstInOrder(m: Hex64, k: number, tokenId: TokenIdStr): Hex64 {
  if (k <= 0) return EMPTY_MASK;
  const picked: number[] = [];
  for (const i of regrowthOrder(tokenId)) {
    if (picked.length >= k) break;
    if (getBit(m, i)) picked.push(i);
  }
  return fromIndices(picked);
}

interface Settled {
  lost: Hex64;
  anchor: number;
}

function assertTime(t: number, name: string): void {
  if (!Number.isSafeInteger(t) || t < 0) throw new RangeError(`${name} must be a non-negative integer ms timestamp.`);
}

/** Applies free regrowth up to `now`, returning the effective mask and the anchor that preserves partial progress. */
function settle(s: ScarState, now: number, tokenId: TokenIdStr, opts: RegrowthOptions): Settled {
  assertTime(now, "now");
  assertTime(s.updatedAt, "updatedAt");
  const locked = opts.locked ?? EMPTY_MASK;
  const healable = andNot(s.lost, locked);
  const available = popcount(healable);
  const msPerPx = regrowthMsPerPx(opts.goldHeld ?? 0);
  const elapsed = now - s.updatedAt;
  const due = elapsed > 0 ? Math.floor(elapsed / msPerPx) : 0;
  const healed = Math.min(due, available);
  const lost = andNot(s.lost, firstInOrder(healable, healed, tokenId));
  // Nothing left that could heal: restart the clock at `now` so time spent whole (or fully locked) never banks.
  const anchor = healed === available ? Math.max(now, s.updatedAt) : s.updatedAt + healed * msPerPx;
  return { lost, anchor };
}

/**
 * The scars as of `now` after lazy free regrowth: `floor((now - updatedAt) / msPerPx)` pixels heal in regrowth order,
 * skipping `opts.locked`. Always a subset of `s.lost`; equals `s.lost` when `now <= updatedAt`.
 */
export function effectiveLost(s: ScarState, now: number, tokenId: TokenIdStr, opts: RegrowthOptions = {}): Hex64 {
  return settle(s, now, tokenId, opts).lost;
}

/**
 * Records new scars at `now`: settles regrowth first, then adds `lostDelta` (clipped to `opts.front` and to the 50 %
 * floor, dropping excess pixels in regrowth order). Returns a new state with `version + 1`; never mutates `s`.
 */
export function applyLoss(
  s: ScarState,
  lostDelta: Hex64,
  now: number,
  tokenId: TokenIdStr,
  opts: LossOptions = {},
): ScarState {
  const settled = settle(s, now, tokenId, opts);
  let added = andNot(opts.front ? and(lostDelta, opts.front) : lostDelta, settled.lost);
  if (opts.front) {
    const room = Math.max(0, maxPersistedLost(popcount(opts.front)) - popcount(settled.lost));
    if (popcount(added) > room) added = firstInOrder(added, room, tokenId);
  }
  // `settle` already restarted the clock at `now` if nothing was healing, so new scars start accruing from then.
  return { lost: or(settled.lost, added), updatedAt: settled.anchor, version: s.version + 1 };
}

/**
 * Heals `restore` (paid Regrow/Mend/plant) at `now`: settles regrowth first, then clears those pixels. Pixels in
 * `restore` that are not lost are ignored (callers must reject such requests before charging). Returns `version + 1`.
 */
export function applyRestore(
  s: ScarState,
  restore: Hex64,
  now: number,
  tokenId: TokenIdStr,
  opts: RegrowthOptions = {},
): ScarState {
  const settled = settle(s, now, tokenId, opts);
  const lost = andNot(settled.lost, restore);
  const idle = andNot(lost, opts.locked ?? EMPTY_MASK) === EMPTY_MASK;
  return { lost, updatedAt: idle ? Math.max(now, s.updatedAt) : settled.anchor, version: s.version + 1 };
}

/** Returns the state materialised at `now` (regrowth applied, same version) — what `/public` serves. */
export function settleScars(s: ScarState, now: number, tokenId: TokenIdStr, opts: RegrowthOptions = {}): ScarState {
  const settled = settle(s, now, tokenId, opts);
  return { lost: settled.lost, updatedAt: settled.anchor, version: s.version };
}

/** Timestamp at which the next pixel regrows for free, or `null` if nothing can heal. */
export function nextRegrowthAt(
  s: ScarState,
  now: number,
  tokenId: TokenIdStr,
  opts: RegrowthOptions = {},
): number | null {
  const settled = settle(s, now, tokenId, opts);
  if (andNot(settled.lost, opts.locked ?? EMPTY_MASK) === EMPTY_MASK) return null;
  return settled.anchor + regrowthMsPerPx(opts.goldHeld ?? 0);
}

/** Timestamp at which every healable pixel has regrown for free, or `null` if nothing can heal. */
export function wholeAt(s: ScarState, now: number, tokenId: TokenIdStr, opts: RegrowthOptions = {}): number | null {
  const settled = settle(s, now, tokenId, opts);
  const n = popcount(andNot(settled.lost, opts.locked ?? EMPTY_MASK));
  if (n === 0) return null;
  return settled.anchor + n * regrowthMsPerPx(opts.goldHeld ?? 0);
}

/** True iff `s.lost` is a subset of `front` (the persistent scar invariant). */
export function scarsWithinFront(s: ScarState, front: Hex64): boolean {
  return isSubset(s.lost, front);
}

/** Short change-detection tag for presence (`PresenceEntity.scarsHash`): 8 hex chars over lost mask + version. */
export function scarsHash(s: ScarState): string {
  return fnv1a32(`${s.lost}:${s.version}`).toString(16).padStart(8, "0");
}
