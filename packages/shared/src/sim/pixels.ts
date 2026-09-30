/**
 * The Friend's pixels during a run (GDD §2.5). One slot per sprite pixel id (pid = row·16 + col, same bit order as
 * `Hex64`). Implements the bite rule: candidates are boundary pixels of the bitten body half, scored by
 * dot(normalize(pixel − centroid), −a) + 0.15·exposure, ties broken by the run PRNG, gold glances onto the next ink pixel.
 */
import { toIndices } from "../bitmap.js";
import type { Hex64 } from "../ids.js";
import type { Rng } from "./rng.js";
import { BITE_EXPOSURE_W, COLLIDER_K, COLLIDER_MAX, COLLIDER_MIN } from "./tuning.js";

/** Slot states. */
export const SLOT_NONE = 0;
/** On the body. */
export const SLOT_BODY = 1;
/** Knocked off, a loose cube in the world. */
export const SLOT_LOOSE = 2;
/** Lost this run and persisted as a scar (counts toward the per-run cap). */
export const SLOT_LOST = 3;
/** Lost this run after the cap / floor: missing for gameplay, returns at run end ("safety stitch"). */
export const SLOT_SAFE = 4;
/** A scar from before the run (`SimConfig.friend.lost`). */
export const SLOT_SCAR = 5;

/** Geometry of one body (the whole Friend, or one Mitosis half) in sprite coordinates. */
export interface BodyShape {
  /** Present pixel count = mass (gold counts as 1). */
  count: number;
  /** Centroid (sprite units: column + 0.5, row + 0.5). */
  cx: number;
  /** See cx. */
  cz: number;
  /** Bounding box of present pixels (inclusive columns/rows). */
  minCol: number;
  /** See minCol. */
  maxCol: number;
  /** See minCol. */
  minRow: number;
  /** See minCol. */
  maxRow: number;
  /** Ground collider radius: clamp(0.45 · bbox width, 3, 7). */
  r: number;
}

/** A new, empty shape. */
export function emptyShape(): BodyShape {
  return { count: 0, cx: 8, cz: 8, minCol: 0, maxCol: 0, minRow: 0, maxRow: 0, r: COLLIDER_MIN };
}

interface Candidate {
  pid: number;
  score: number;
  tie: number;
}

/** In-run pixel state of the player's Friend. */
export class FriendPixels {
  /** Slot state per pid (SLOT_*). */
  readonly slot = new Uint8Array(256);
  /** 1 where a Gold Pixel is worn. */
  readonly gold = new Uint8Array(256);
  /** Glow cracks gained this run per gold pid (cosmetic, reported to the renderer). */
  readonly cracks = new Uint8Array(256);
  /** Which body (0 or 1, Mitosis halves) owns each pid. */
  readonly half = new Uint8Array(256);
  /** Canonical pixel count N0 (popcount of the front mask). */
  readonly n0: number;
  /** Pixels present at run start. */
  readonly startPresent: number;

  /** Builds from the config masks; `lost` and `gold` are clipped to `front`, gold never sits on a scar. */
  constructor(front: Hex64, lost: Hex64, gold: Hex64 | undefined) {
    for (const i of toIndices(front)) this.slot[i] = SLOT_BODY;
    for (const i of toIndices(lost)) if (this.slot[i] === SLOT_BODY) this.slot[i] = SLOT_SCAR;
    if (gold !== undefined) for (const i of toIndices(gold)) if (this.slot[i] === SLOT_BODY) this.gold[i] = 1;
    let n0 = 0;
    let present = 0;
    for (let i = 0; i < 256; i++) {
      const s = this.slot[i] ?? 0;
      if (s !== SLOT_NONE) n0++;
      if (s === SLOT_BODY) present++;
    }
    this.n0 = n0;
    this.startPresent = present;
  }

  /** True iff pid is on the body and owned by `body`. */
  private onBody(pid: number, body: number): boolean {
    return this.slot[pid] === SLOT_BODY && this.half[pid] === body;
  }

  /** Recomputes `out` for body `body` from the current slots. */
  measure(body: number, out: BodyShape): void {
    let n = 0;
    let sx = 0;
    let sz = 0;
    let minC = 16;
    let maxC = -1;
    let minR = 16;
    let maxR = -1;
    for (let pid = 0; pid < 256; pid++) {
      if (!this.onBody(pid, body)) continue;
      const col = pid & 15;
      const row = pid >> 4;
      n++;
      sx += col + 0.5;
      sz += row + 0.5;
      if (col < minC) minC = col;
      if (col > maxC) maxC = col;
      if (row < minR) minR = row;
      if (row > maxR) maxR = row;
    }
    out.count = n;
    if (n === 0) {
      out.r = COLLIDER_MIN;
      return;
    }
    out.cx = sx / n;
    out.cz = sz / n;
    out.minCol = minC;
    out.maxCol = maxC;
    out.minRow = minR;
    out.maxRow = maxR;
    const w = COLLIDER_K * (maxC - minC + 1);
    out.r = w < COLLIDER_MIN ? COLLIDER_MIN : w > COLLIDER_MAX ? COLLIDER_MAX : w;
  }

  /**
   * Chooses up to `k` pixels of body `body` to detach for a bite whose contact direction (creature → Friend centre,
   * unit) is (ax, az). Returns the chosen pids in order; pushes glanced gold pids into `glanced`. Consumes one PRNG draw
   * per candidate (tie-breaks), so the choice is fully deterministic.
   */
  selectBite(body: number, shape: BodyShape, ax: number, az: number, k: number, rng: Rng, glanced: number[]): number[] {
    const cands: Candidate[] = [];
    for (let pid = 0; pid < 256; pid++) {
      if (!this.onBody(pid, body)) continue;
      const col = pid & 15;
      const row = pid >> 4;
      let empty = 0;
      if (col === 0 || !this.onBody(pid - 1, body)) empty++;
      if (col === 15 || !this.onBody(pid + 1, body)) empty++;
      if (row === 0 || !this.onBody(pid - 16, body)) empty++;
      if (row === 15 || !this.onBody(pid + 16, body)) empty++;
      if (empty === 0) continue;
      const dx = col + 0.5 - shape.cx;
      const dz = row + 0.5 - shape.cz;
      const l = Math.sqrt(dx * dx + dz * dz);
      const facing = l === 0 ? 0 : -(dx * ax + dz * az) / l;
      cands.push({ pid, score: facing + (BITE_EXPOSURE_W * empty) / 4, tie: rng.u32() });
    }
    cands.sort((p, q) => q.score - p.score || p.tie - q.tie || p.pid - q.pid);
    const out: number[] = [];
    for (const c of cands) {
      if (out.length >= k) break;
      if (this.gold[c.pid] === 1) {
        // GDD §2.5 rule 4: gold is never lost; the bite glances onto the next best ink pixel.
        glanced.push(c.pid);
        this.cracks[c.pid] = Math.min(3, (this.cracks[c.pid] ?? 0) + 1);
        continue;
      }
      out.push(c.pid);
    }
    return out;
  }

  /** Count of pixels in a given slot state. */
  count(state: number): number {
    let n = 0;
    for (let i = 0; i < 256; i++) if (this.slot[i] === state) n++;
    return n;
  }

  /**
   * Splits the Friend into two halves by column (Mitosis): half 0 gets the leftmost columns holding at least half the
   * present pixels. Applies to every pixel (loose ones return to their own half). Returns false if a half would be empty.
   */
  split(): boolean {
    const perCol = new Array<number>(16).fill(0);
    let total = 0;
    for (let pid = 0; pid < 256; pid++) {
      if (this.slot[pid] === SLOT_BODY) {
        perCol[pid & 15] = (perCol[pid & 15] ?? 0) + 1;
        total++;
      }
    }
    let acc = 0;
    let cut = -1;
    for (let c = 0; c < 16; c++) {
      acc += perCol[c] ?? 0;
      if (acc * 2 >= total) {
        cut = c;
        break;
      }
    }
    if (cut < 0 || acc >= total) return false;
    for (let pid = 0; pid < 256; pid++) this.half[pid] = (pid & 15) <= cut ? 0 : 1;
    return true;
  }

  /** Merges both halves back into body 0. */
  merge(): void {
    this.half.fill(0);
  }

  /**
   * Asymmetry's heavy side: +1 if more present pixels without a mirror twin (mirrored about the 16-px sprite's centre
   * line, as the art is drawn) sit on the right, −1 if on the left; ties go right (the GDD's odd-tokenId tie-break needs
   * the token id, which the sim does not receive).
   */
  heavySide(): number {
    let left = 0;
    let right = 0;
    for (let pid = 0; pid < 256; pid++) {
      if (this.slot[pid] !== SLOT_BODY) continue;
      const col = pid & 15;
      const twin = (pid & ~15) | (15 - col);
      if (this.slot[twin] === SLOT_BODY) continue;
      if (col >= 8) right++;
      else left++;
    }
    return left > right ? -1 : 1;
  }
}
