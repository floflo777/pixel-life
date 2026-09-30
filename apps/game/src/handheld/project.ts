/**
 * World → LCD projection for the run screen (GDD §7 top-down 3/4 view, fitted to frame 3): x at 1.5 px/u, z squashed to
 * 0.9 px/u, height at 1.5 px/u, island centred at (64, 84). Only sprites scale up (the Friend at 2×); positions don't.
 */

/** Screen px per world unit along x (and height). */
export const PX_PER_U = 1.5;
/** Screen px per world unit along z (the 3/4 squash). */
export const PZ_PER_U = 0.9;
/** Island centre on screen. */
export const ISLAND_CX = 64;
/** See `ISLAND_CX`. */
export const ISLAND_CY = 84;

/** Screen point (integer px) of world (x, y, z); y is height above the ground. */
export function toScreen(x: number, z: number, y = 0): { sx: number; sy: number } {
  return { sx: Math.round(ISLAND_CX + x * PX_PER_U), sy: Math.round(ISLAND_CY + z * PZ_PER_U - y * PX_PER_U) };
}

/** Island ellipse semi-axes on screen for world semi-axes (a, b). */
export function islandRadii(a: number, b: number): { rx: number; ry: number } {
  return { rx: Math.round(a * PX_PER_U), ry: Math.round(b * PZ_PER_U) };
}
