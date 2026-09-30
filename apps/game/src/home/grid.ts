import { decorItem, footprint, HOME_GRID, type Placement } from "@pl/shared";

/**
 * Pure geometry of a home isle: where each terrace floats, how grid cells map to island-local world units, and how
 * a screen ray picks a tile. Grid cell = 1 world unit (GDD §12.3); +X right, +Z toward the default camera.
 */

/** World units per grid cell. */
export const TILE = 1;
/** Island radius in world-kit cells (0.24 u): big enough that the noisy rim never cuts into the 12×12 grid. */
export const TERRACE_RADIUS_CELLS = 46;
/** World size of one world-kit cell. */
export const ISLAND_CELL = 0.24;
/** Centre-to-centre spacing between terraces (≥ 2 island radii, so slabs never overlap). */
export const TERRACE_SPACING = 24;
/** Each terrace step floats this much higher (art bible §4: "each 1 row higher"). */
export const TERRACE_RISE = 1.2;

/** A point in island-local world units. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// Terrace k ≥ 1 sits on a widening arc behind the main terrace (the camera looks from +Z), like a stepped hillside.
const SLOTS: readonly [number, number][] = [
  [0, 0],
  [0, -1],
  [-1, -0.5],
  [1, -0.5],
  [-1, -1.5],
  [1, -1.5],
  [0, -2],
  [-2, -1],
  [2, -1],
  [-2, -2],
  [2, -2],
  [0, -3],
];

/** Centre of terrace `k`'s grid (its walking surface), island-local. Terrace 0 is the origin. */
export function terraceOrigin(k: number): Vec3 {
  // Beyond the table (never reached: at most 6 generation terraces + 5 plots) keep stepping back in a column.
  const slot = SLOTS[k] ?? [0, -k];
  const ring = Math.max(Math.abs(slot[0]), Math.abs(slot[1]));
  return { x: slot[0] * TERRACE_SPACING, y: ring * TERRACE_RISE, z: slot[1] * TERRACE_SPACING };
}

/** Island-local centre of grid cell (x, z) on terrace t. */
export function cellCenter(t: number, x: number, z: number): Vec3 {
  const o = terraceOrigin(t);
  return { x: o.x + (x - HOME_GRID / 2 + 0.5) * TILE, y: o.y, z: o.z + (z - HOME_GRID / 2 + 0.5) * TILE };
}

/** Island-local centre of a placement's footprint (the pivot its model rotates about), or null for non-decor. */
export function placementCenter(p: Placement): Vec3 | null {
  const item = decorItem(p.item);
  if (!item) return null;
  const { w, d } = footprint(item, p.r);
  const o = terraceOrigin(p.t);
  return { x: o.x + (p.x + w / 2 - HOME_GRID / 2) * TILE, y: o.y, z: o.z + (p.z + d / 2 - HOME_GRID / 2) * TILE };
}

/** A grid tile. */
export interface Tile {
  readonly t: number;
  readonly x: number;
  readonly z: number;
}

/**
 * The tile a ray (island-local origin + direction) hits first among `terraces` terrace planes, or null if it hits no
 * grid. Terraces are flat planes at their origin height; the nearest hit along the ray wins.
 */
export function pickTile(origin: Vec3, dir: Vec3, terraces: number): Tile | null {
  let best: Tile | null = null;
  let bestT = Infinity;
  if (Math.abs(dir.y) < 1e-9) return null;
  for (let k = 0; k < terraces; k++) {
    const o = terraceOrigin(k);
    const s = (o.y - origin.y) / dir.y;
    if (s <= 0 || s >= bestT) continue;
    const gx = Math.floor((origin.x + dir.x * s - o.x) / TILE + HOME_GRID / 2);
    const gz = Math.floor((origin.z + dir.z * s - o.z) / TILE + HOME_GRID / 2);
    if (gx < 0 || gz < 0 || gx >= HOME_GRID || gz >= HOME_GRID) continue;
    best = { t: k, x: gx, z: gz };
    bestT = s;
  }
  return best;
}
