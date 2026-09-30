/**
 * 16x16 one-bit pixel masks (`Hex64`) and their conversions to SDK sprite frames.
 *
 * Bit order is the FriendSDK's (`generation-sprites.ts` `decodeSpriteBitmap`): bit i = pixel (i % 16, i >> 4), bit 0 is the
 * top-left pixel and bit 255 the bottom-right, no mirroring. A `Hex64` is the big-endian hex of that uint256, so
 * `BigInt("0x" + mask)` is exactly the registry's frame value.
 *
 * All functions are pure, total on valid input, and throw `RangeError` on malformed masks (never silently coerce).
 */
import { type Hex64, isHex64, parseHex64, UINT256_MAX } from "./ids.js";

/** Sprite side length in pixels. */
export const SPRITE_SIZE = 16;
/** Number of pixels (bits) in a mask. */
export const MASK_BITS = 256;
/** The mask with no pixel set. */
export const EMPTY_MASK: Hex64 = "0".repeat(64);
/** The mask with all 256 pixels set. */
export const FULL_MASK: Hex64 = "f".repeat(64);

/** The character the SDK uses for a set pixel in decoded rows. */
export const INK = "#";
/** The character the SDK uses for an empty pixel in decoded rows. */
export const PAPER = ".";

/** Eight 32-bit words, word 0 holding bits 0..31. Internal working form for fast boolean ops. */
type Words = Uint32Array;

function assertMask(m: Hex64): void {
  if (!isHex64(m)) throw new RangeError("Invalid Hex64 mask.");
}

function toWords(m: Hex64): Words {
  assertMask(m);
  const w = new Uint32Array(8);
  for (let i = 0; i < 8; i++) w[i] = Number.parseInt(m.slice(56 - 8 * i, 64 - 8 * i), 16);
  return w;
}

function fromWords(w: Words): Hex64 {
  let out = "";
  for (let i = 7; i >= 0; i--) out += (w[i] ?? 0).toString(16).padStart(8, "0");
  return out;
}

function popcount32(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

function combine(a: Hex64, b: Hex64, op: (x: number, y: number) => number): Hex64 {
  const wa = toWords(a);
  const wb = toWords(b);
  for (let i = 0; i < 8; i++) wa[i] = op(wa[i] ?? 0, wb[i] ?? 0) >>> 0;
  return fromWords(wa);
}

function assertIndex(i: number): void {
  if (!Number.isInteger(i) || i < 0 || i >= MASK_BITS) throw new RangeError("Pixel index must be 0..255.");
}

/** Number of set pixels in `m` (0..256). */
export function popcount(m: Hex64): number {
  const w = toWords(m);
  let n = 0;
  for (let i = 0; i < 8; i++) n += popcount32(w[i] ?? 0);
  return n;
}

/** Pixels set in both `a` and `b`. */
export function and(a: Hex64, b: Hex64): Hex64 {
  return combine(a, b, (x, y) => x & y);
}

/** Pixels set in `a` or `b`. */
export function or(a: Hex64, b: Hex64): Hex64 {
  return combine(a, b, (x, y) => x | y);
}

/** Pixels set in `a` but not in `b` (`a & ~b`). */
export function andNot(a: Hex64, b: Hex64): Hex64 {
  return combine(a, b, (x, y) => x & ~y);
}

/** Pixels set in exactly one of `a` and `b`. */
export function xor(a: Hex64, b: Hex64): Hex64 {
  return combine(a, b, (x, y) => x ^ y);
}

/** The complement of `m` within the 16x16 grid. */
export function not(m: Hex64): Hex64 {
  return andNot(FULL_MASK, m);
}

/** True iff every pixel of `sub` is also set in `sup`. */
export function isSubset(sub: Hex64, sup: Hex64): boolean {
  return andNot(sub, sup) === EMPTY_MASK;
}

/** True iff no pixel is set. */
export function isEmpty(m: Hex64): boolean {
  assertMask(m);
  return m === EMPTY_MASK;
}

/** Pixel index of (x, y): `y * 16 + x`. Throws `RangeError` outside the 16x16 grid. */
export function pixelIndex(x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= SPRITE_SIZE || y >= SPRITE_SIZE) {
    throw new RangeError("Pixel coordinates must be 0..15.");
  }
  return y * SPRITE_SIZE + x;
}

/** Coordinates `[x, y]` of pixel index `i` (inverse of `pixelIndex`). */
export function pixelXY(i: number): readonly [x: number, y: number] {
  assertIndex(i);
  return [i % SPRITE_SIZE, i >> 4];
}

/** True iff pixel `i` is set in `m`. */
export function getBit(m: Hex64, i: number): boolean {
  assertIndex(i);
  assertMask(m);
  const nibble = Number.parseInt(m.charAt(63 - (i >> 2)), 16);
  return ((nibble >> (i & 3)) & 1) === 1;
}

/** Returns `m` with pixel `i` set to `on`. */
export function setBit(m: Hex64, i: number, on: boolean): Hex64 {
  assertIndex(i);
  const w = toWords(m);
  const wi = i >> 5;
  const bit = 1 << (i & 31);
  w[wi] = (on ? (w[wi] ?? 0) | bit : (w[wi] ?? 0) & ~bit) >>> 0;
  return fromWords(w);
}

/** Set pixel indices of `m` in ascending order (row-major from the top-left). */
export function toIndices(m: Hex64): number[] {
  const w = toWords(m);
  const out: number[] = [];
  for (let wi = 0; wi < 8; wi++) {
    const word = w[wi] ?? 0;
    if (word === 0) continue;
    for (let b = 0; b < 32; b++) if ((word >>> b) & 1) out.push(wi * 32 + b);
  }
  return out;
}

/** The mask with exactly the given pixel indices set; duplicates are ignored, out-of-range indices throw. */
export function fromIndices(indices: Iterable<number>): Hex64 {
  const w = new Uint32Array(8);
  for (const i of indices) {
    assertIndex(i);
    const wi = i >> 5;
    w[wi] = ((w[wi] ?? 0) | (1 << (i & 31))) >>> 0;
  }
  return fromWords(w);
}

/** The 16 SDK-style rows (`#` set, `.` empty), top row first; identical to SDK `decodeSpriteBitmap(bitmap).rows`. */
export function toRows(m: Hex64): string[] {
  const w = toWords(m);
  const rows: string[] = [];
  for (let y = 0; y < SPRITE_SIZE; y++) {
    let row = "";
    // Row y occupies bits 16y..16y+15, i.e. one half of word y >> 1.
    const half = ((w[y >> 1] ?? 0) >>> ((y & 1) * 16)) & 0xffff;
    for (let x = 0; x < SPRITE_SIZE; x++) row += (half >> x) & 1 ? INK : PAPER;
    rows.push(row);
  }
  return rows;
}

/** Parses 16 rows of 16 `#`/`.` chars (SDK decoded frame / `friends.json` layout); throws `RangeError` on any other shape. */
export function fromRows(rows: readonly string[]): Hex64 {
  if (rows.length !== SPRITE_SIZE) throw new RangeError("A sprite must have 16 rows.");
  const w = new Uint32Array(8);
  rows.forEach((row, y) => {
    if (row.length !== SPRITE_SIZE) throw new RangeError("A sprite row must have 16 pixels.");
    for (let x = 0; x < SPRITE_SIZE; x++) {
      const c = row.charAt(x);
      if (c === INK) {
        const i = y * SPRITE_SIZE + x;
        w[i >> 5] = ((w[i >> 5] ?? 0) | (1 << (i & 31))) >>> 0;
      } else if (c !== PAPER) {
        throw new RangeError(`Unexpected sprite character ${JSON.stringify(c)}.`);
      }
    }
  });
  return fromWords(w);
}

/** Converts an SDK/registry uint256 frame bitmap to a `Hex64`; throws `RangeError` outside 0..2^256-1. */
export function fromSdkBitmap(bitmap: bigint): Hex64 {
  if (bitmap < 0n || bitmap > UINT256_MAX) throw new RangeError("A sprite bitmap must fit uint256.");
  return bitmap.toString(16).padStart(64, "0");
}

/** Converts a `Hex64` to the uint256 bitmap the SDK / registry uses. */
export function toSdkBitmap(m: Hex64): bigint {
  return BigInt(`0x${parseHex64(m)}`);
}

/** Converts an SDK `SpriteFrame` (`{ bitmap }`, e.g. from `spriteFrame(...).frame`) to a `Hex64`. */
export function fromSdkFrame(frame: { readonly bitmap: bigint }): Hex64 {
  return fromSdkBitmap(frame.bitmap);
}

/** Converts all 64 SDK frames (registry `frames(id, seed)` order) to `Hex64`s; throws unless exactly 64 are given. */
export function fromSdkFrames(bitmaps: readonly bigint[]): Hex64[] {
  if (bitmaps.length !== 64) throw new RangeError("The registry returns exactly 64 frames.");
  return bitmaps.map(fromSdkBitmap);
}

/**
 * Pixels of `m` that have at least one empty 4-neighbour (outside the grid counts as empty). These are the only
 * pixels a bite can detach (GDD §2.5), and are exposed here because both the sim and the renderer need them.
 */
export function boundary(m: Hex64): Hex64 {
  const out: number[] = [];
  for (const i of toIndices(m)) {
    const [x, y] = pixelXY(i);
    const inside = (nx: number, ny: number): boolean =>
      nx >= 0 && ny >= 0 && nx < SPRITE_SIZE && ny < SPRITE_SIZE && getBit(m, ny * SPRITE_SIZE + nx);
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) out.push(i);
  }
  return fromIndices(out);
}
