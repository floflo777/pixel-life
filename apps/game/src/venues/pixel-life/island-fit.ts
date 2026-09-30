/**
 * The island mesh is a noisy voxel ellipse (`world/island.ts`) while the sim's ground is an exact ellipse. Picking the
 * seed whose footprint best overlaps the sim's keeps "looks like ground" and "is ground" within a cell or two, so ring-
 * outs happen where the player sees the rim. Pure (the footprint function is pure); unit-tested.
 */
import { islandCells } from "../../world/island";

/** A footprint choice: the `buildIsland` seed, radius (cells) and squash that match the sim ellipse. */
export interface IslandFit {
  readonly seed: number;
  readonly radius: number;
  readonly squash: number;
  /** Intersection over union with the sim ellipse, 0..1. */
  readonly iou: number;
}

/**
 * Best of `tries` consecutive seeds from `seed` for an `a × b` (sim units) ellipse, at `unit` world units per sim unit
 * and `cell` world units per island cell. Deterministic: same inputs, same fit.
 */
export function fitIsland(a: number, b: number, unit: number, cell: number, seed: number, tries = 16): IslandFit {
  const radius = (a * unit) / cell + 0.5;
  // islandCells stretches z by 1/squash: a/b makes its z extent b.
  const squash = a / b;
  const k = cell / unit;
  let best: IslandFit = { seed, radius, squash, iou: -1 };
  for (let n = 0; n < tries; n++) {
    const s = (seed + n * 97) % 100_000;
    const cells = islandCells({ radius, seed: s, squash });
    let inter = 0;
    let ell = 0;
    const N = Math.ceil(radius * squash * 1.4);
    for (let i = -N; i <= N; i++)
      for (let j = -N; j <= N; j++) {
        const x = (i * k) / a;
        const z = (j * k) / b;
        const inE = x * x + z * z < 1;
        if (inE) ell++;
        if (inE && cells.has(`${i},${j}`)) inter++;
      }
    const iou = inter / Math.max(1, ell + cells.size - inter);
    if (iou > best.iou) best = { seed: s, radius, squash, iou };
  }
  return best;
}
