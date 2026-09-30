import { Mesh, type BufferGeometry, type Material } from "three";
import { createBandMaterial } from "../post/band-material";
import { PALETTE } from "../stage/palette";
import { valueNoise } from "./noise";
import { VoxelMesher, type VoxelStyle } from "./voxel-mesher";

/** One paper cloud slab (art bible §4: 1–3 cells high, below/behind islands, never over play). */
export interface CloudSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Half-width in world units. */
  readonly width: number;
  readonly seed: number;
  readonly cell?: number;
}

const CLOUD: VoxelStyle = { dither: 0.22, lightMix: 0.5, caster: false, receiver: false };

/** Voxel footprint of a cloud: (i, j, height) triples. Pure; exported for tests. */
export function cloudColumns(width: number, seed: number, cell: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = Math.max(1, Math.ceil(width / cell));
  const m = Math.ceil(n * 0.5);
  for (let i = -n; i <= n; i++)
    for (let j = -m; j <= m; j++) {
      const d = Math.hypot(i / n, j / (n * 0.5)) + (valueNoise(i * 0.5, j * 0.5, seed) - 0.5) * 0.5;
      if (d >= 1) continue;
      const h = Math.min(3, 1 + Math.floor((1 - d) * 3 * valueNoise(i * 0.3, j * 0.3, seed + 2) + 0.4));
      out.push([i, j, h]);
    }
  return out;
}

/** Merges every cloud into one mesh (one draw call), unshadowed, soft-dithered. */
export function buildClouds(specs: readonly CloudSpec[]): { mesh: Mesh; triangles: number; dispose(): void } {
  const mesher = new VoxelMesher();
  for (const s of specs) {
    const cell = s.cell ?? 0.3;
    const g = mesher.grid(cell, [s.x, s.y, s.z]);
    for (const [i, j, h] of cloudColumns(s.width, s.seed, cell))
      for (let k = 0; k < h; k++) g.set(i, k, j, PALETTE.cloud, CLOUD);
  }
  const built = mesher.build();
  const material: Material = createBandMaterial({ vertexColors: true, bandAttribute: true });
  const mesh = new Mesh(built.geometry, material);
  mesh.name = "clouds";
  const geometry: BufferGeometry = built.geometry;
  return {
    mesh,
    triangles: built.triangles,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
