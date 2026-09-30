/**
 * Pure layer composition for one rendered frame of a Friend: which cells are ink body, gold, scar slot, stitched,
 * cracked, and which small enclosed holes get a paper eye back-plate. No three.js here, so it is unit-tested directly.
 *
 * Scars, gold and stitches live on the front mask (D-03). On any other frame they apply by pixel-index coincidence
 * (art bible §11.2): a lost pixel index hides that index in whatever frame is shown.
 */
import { isHex64, type Hex64 } from "@pl/shared";

/** Grid side (sprite pixels). */
export const GRID = 16;
/** Cells in a grid. */
export const CELLS = GRID * GRID;

/** Cell kinds of a composed frame. */
export const Cell = Object.freeze({ Empty: 0, Body: 1, Gold: 2, Scar: 3 });
/** A cell kind value. */
export type CellKind = (typeof Cell)[keyof typeof Cell];

/** Largest enclosed hole (in cells) that gets a paper back-plate: eyes and mouths (art bible §2 "Holes / eyes"). */
export const MAX_EYE_HOLE = 4;

/** Decodes a `Hex64` into a 256-byte 0/1 grid (index = y * 16 + x). Throws `RangeError` on a malformed mask. */
export function maskToGrid(m: Hex64, out: Uint8Array = new Uint8Array(CELLS)): Uint8Array {
  if (!isHex64(m)) throw new RangeError("Invalid Hex64 mask.");
  for (let k = 0; k < 64; k++) {
    const nibble = Number.parseInt(m.charAt(63 - k), 16);
    const i = k * 4;
    out[i] = nibble & 1;
    out[i + 1] = (nibble >> 1) & 1;
    out[i + 2] = (nibble >> 2) & 1;
    out[i + 3] = (nibble >> 3) & 1;
  }
  return out;
}

/** Encodes a 0/1 grid back into a `Hex64` (inverse of `maskToGrid`). */
export function gridToMask(g: Uint8Array): Hex64 {
  let s = "";
  for (let k = 63; k >= 0; k--) {
    const i = k * 4;
    const nibble = (g[i] ? 1 : 0) | (g[i + 1] ? 2 : 0) | (g[i + 2] ? 4 : 0) | (g[i + 3] ? 8 : 0);
    s += nibble.toString(16);
  }
  return s;
}

/** A composed frame, ready for the mesher. All grids are 256 cells, row-major from the top-left. */
export interface FriendLayers {
  /** `Cell` kind per cell. Scar = in the frame but lost (drawn as a paper plate, counted as body by the halo). */
  cells: Uint8Array;
  /** 1 where a Mend stitch decal is drawn (present cells only). */
  stitch: Uint8Array;
  /** 1 on empty cells that belong to a small enclosed hole (≤ `MAX_EYE_HOLE`): paper back-plate. */
  eyes: Uint8Array;
  /** Glow-crack stage drawn on every gold cell: 0 none, 1 hairline, 2 split, 3 dull. */
  crack: 0 | 1 | 2 | 3;
  /** Optional: 1 where a pixel has detached from its slot (venue only); the slot shows the loose-slot plate. */
  loose?: Uint8Array;
}

/** Inputs of `composeLayers`: every mask is a pixel-index set; only indices inside `frame` matter. */
export interface LayerInput {
  frame: Hex64;
  lost: Hex64;
  gold: Hex64;
  stitched: Hex64;
  crack: number;
}

/** Clamps a glow-crack count to the 0..3 stage the renderer draws. */
export function crackStage(glowCracks: number): 0 | 1 | 2 | 3 {
  const n = Math.floor(Number.isFinite(glowCracks) ? glowCracks : 0);
  return n <= 0 ? 0 : n >= 3 ? 3 : (n as 1 | 2);
}

const scratch = { lost: new Uint8Array(CELLS), gold: new Uint8Array(CELLS), stitch: new Uint8Array(CELLS) };

/**
 * Composes the layers of one frame. Guarantees: every set pixel of `frame` is exactly one of Body/Gold/Scar; Gold and
 * stitches never sit on a scar; cells outside `frame` are Empty; eyes are only set on Empty cells.
 */
export function composeLayers(input: LayerInput): FriendLayers {
  const frame = maskToGrid(input.frame);
  const lost = maskToGrid(input.lost, scratch.lost);
  const gold = maskToGrid(input.gold, scratch.gold);
  const st = maskToGrid(input.stitched, scratch.stitch);
  const cells = new Uint8Array(CELLS);
  const stitch = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    if (!frame[i]) continue;
    if (lost[i]) {
      cells[i] = Cell.Scar;
      continue;
    }
    cells[i] = gold[i] ? Cell.Gold : Cell.Body;
    if (st[i]) stitch[i] = 1;
  }
  return { cells, stitch, eyes: smallHoles(frame, MAX_EYE_HOLE), crack: crackStage(input.crack) };
}

/**
 * Empty cells enclosed by `filled` (not 4-connected to the grid border) whose 4-connected component has at most
 * `maxSize` cells. Scars count as filled because callers pass the frame mask, so a scar never opens an eye.
 */
export function smallHoles(filled: Uint8Array, maxSize: number): Uint8Array {
  const outside = new Uint8Array(CELLS);
  const stack: number[] = [];
  for (let k = 0; k < GRID; k++) stack.push(k, (GRID - 1) * GRID + k, k * GRID, k * GRID + GRID - 1);
  while (stack.length > 0) {
    const i = stack.pop() as number; // Invariant: length > 0 was checked.
    if (outside[i] || filled[i]) continue;
    outside[i] = 1;
    const x = i % GRID;
    const y = i >> 4;
    if (x > 0) stack.push(i - 1);
    if (x < GRID - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - GRID);
    if (y < GRID - 1) stack.push(i + GRID);
  }
  const eyes = new Uint8Array(CELLS);
  const seen = new Uint8Array(CELLS);
  for (let start = 0; start < CELLS; start++) {
    if (filled[start] || outside[start] || seen[start]) continue;
    const comp: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number; // Invariant: length > 0 was checked.
      comp.push(i);
      const x = i % GRID;
      const y = i >> 4;
      const visit = (j: number): void => {
        if (!filled[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < GRID - 1) visit(i + 1);
      if (y > 0) visit(i - GRID);
      if (y < GRID - 1) visit(i + GRID);
    }
    if (comp.length <= maxSize) for (const i of comp) eyes[i] = 1;
  }
  return eyes;
}

/** Where a Friend stands: `cx` is the horizontal centre of the front mask in sprite px, `bottom` the row below its feet. */
export interface FriendAnchor {
  cx: number;
  bottom: number;
}

/**
 * The model origin, computed once from the front mask so every frame shares it (walk bobbing baked into the SDK frames
 * stays visible instead of being re-centred away). An empty mask anchors at the grid centre.
 */
export function friendAnchor(front: Hex64): FriendAnchor {
  const g = maskToGrid(front);
  let minX = GRID;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < CELLS; i++) {
    if (!g[i]) continue;
    const x = i % GRID;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, i >> 4);
  }
  if (maxX < 0) return { cx: GRID / 2, bottom: GRID };
  return { cx: (minX + maxX + 1) / 2, bottom: maxY + 1 };
}
