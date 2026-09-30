import type { BufferGeometry, MeshLambertMaterial } from "three";
import { createBandMaterial } from "../post/band-material";
import { VoxelMesher, type VoxelStyle } from "../world/voxel-mesher";
import { CELL_KINDS, spriteSize } from "./sprites";

/** Creature surfaces: terrain-like bands, no baked shadow (they move), not shadow-bake casters. */
export const CREATURE_STYLE: VoxelStyle = { dither: 0.12, lightMix: 0.34, caster: false, receiver: false };

/** One voxel in sprite space: column, row from the bottom, depth slice, colour. */
export interface SpriteVoxel {
  readonly i: number;
  readonly j: number;
  readonly k: number;
  readonly color: number;
}

/**
 * Distance of every filled cell to the sprite edge (4-neighbour, 1 on the rim). Cavity cells count as empty so lips
 * pillow down into mouths (unless `cavitySolid`, used to size the cavity itself); thin appendages (legs, wings) count as empty so they never thicken the body. Pure; exported
 * for tests.
 */
export function edgeDistance(rows: readonly string[], cavitySolid = false): number[][] {
  const { w, h } = spriteSize(rows);
  const solid = (r: number, c: number): boolean => {
    const ch = rows[r]?.[c];
    const role = ch === undefined ? undefined : CELL_KINDS[ch]?.role;
    return role !== undefined && role !== "thin" && (cavitySolid || role !== "cavity");
  };
  const d: number[][] = [];
  for (let r = 0; r < h; r++) d.push(Array.from({ length: w }, (_, c) => (solid(r, c) ? 999 : 0)));
  // Two sweeps (forward/backward) give the exact 4-neighbour (Manhattan) distance transform.
  const at = (r: number, c: number): number => (r < 0 || r >= h || c < 0 || c >= w ? 0 : (d[r]?.[c] ?? 0));
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const row = d[r];
      if (row && (row[c] ?? 0) > 0) row[c] = Math.min(row[c] ?? 0, at(r - 1, c) + 1, at(r, c - 1) + 1);
    }
  for (let r = h - 1; r >= 0; r--)
    for (let c = w - 1; c >= 0; c--) {
      const row = d[r];
      if (row && (row[c] ?? 0) > 0) row[c] = Math.min(row[c] ?? 0, at(r + 1, c) + 1, at(r, c + 1) + 1);
    }
  return d;
}

/**
 * Expands a sprite into pillowed voxels (bible §5): depth `1 + 2·(d − 1)` voxels (d capped at `maxD`), centred on
 * z = 0. Features sit on the front shell over the skin colour, raised cells stand one voxel proud, cavities are a
 * recessed ink back wall one voxel inside the surrounding shell, thin cells (wings) are one voxel deep. Rows are top-down; `j` counts up from the bottom row.
 */
export function pillowVoxels(rows: readonly string[], skin: string, maxD: number): SpriteVoxel[] {
  const { h } = spriteSize(rows);
  const dist = edgeDistance(rows);
  const cavityDist = edgeDistance(rows, true);
  const skinColor = CELL_KINDS[skin]?.color ?? 0xffffff;
  const out: SpriteVoxel[] = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c] ?? ".";
      const cell = CELL_KINDS[ch];
      if (!cell) continue;
      const j = h - 1 - r;
      if (cell.role === "cavity") {
        // The maw's back wall: as deep as the solid it was cut from, less one voxel on each side (a recessed hole).
        const half = Math.max(0, Math.min(cavityDist[r]?.[c] ?? 1, maxD) - 2);
        for (let k = -half; k <= half; k++) out.push({ i: c, j, k, color: cell.color });
        continue;
      }
      const dd = cell.role === "thin" ? 1 : Math.max(1, Math.min(dist[r]?.[c] ?? 1, maxD));
      const half = dd - 1; // depth 1 + 2·(d − 1) → k ∈ [−half, half]
      for (let k = -half; k <= half; k++) {
        const front = k === half;
        const color = cell.role === "body" ? cell.color : cell.role === "feature" && !front ? skinColor : cell.color;
        out.push({ i: c, j, k, color: cell.role === "raised" && k < half ? skinColor : color });
      }
      if (cell.role === "raised") out.push({ i: c, j, k: half + 1, color: cell.color });
    }
  });
  return out;
}

/** A meshed sprite frame. */
export interface CreatureFrameMesh {
  readonly geometry: BufferGeometry;
  readonly triangles: number;
  /** Sprite size in voxels. */
  readonly w: number;
  readonly h: number;
}

/** Greedy-meshes a sprite frame into one geometry: x centred, feet on y = 0, pillow centred on z = 0. */
export function meshSprite(rows: readonly string[], skin: string, maxD: number, voxel: number): CreatureFrameMesh {
  const { w, h } = spriteSize(rows);
  const mesher = new VoxelMesher();
  const grid = mesher.grid(voxel, [(-(w - 1) / 2) * voxel, voxel / 2, 0]);
  for (const v of pillowVoxels(rows, skin, maxD)) grid.set(v.i, v.j, v.k, v.color, CREATURE_STYLE);
  const built = mesher.build();
  return { geometry: built.geometry, triangles: built.triangles, w, h };
}

let sharedMaterial: MeshLambertMaterial | null = null;

/** The one banded material every creature voxel mesh shares (vertex colours + per-vertex band values). */
export function creatureMaterial(): MeshLambertMaterial {
  sharedMaterial ??= createBandMaterial({ vertexColors: true, bandAttribute: true });
  return sharedMaterial;
}

/** Frees the shared creature material (tests, stage teardown). */
export function disposeCreatureMaterial(): void {
  sharedMaterial?.dispose();
  sharedMaterial = null;
}
