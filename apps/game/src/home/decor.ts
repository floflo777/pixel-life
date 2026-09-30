import { decorItem, type DecorModel } from "@pl/shared";
import type { BufferGeometry } from "three";
import { Group, Mesh, type Material } from "three";
import { createBandMaterial } from "../post/band-material";
import { tagGlow, type GlowTint } from "../post/tags";
import { PALETTE } from "../stage/palette";
import { hash3 } from "../world/noise";
import { buildProp, type PropSpec } from "../world/props";
import { DECOR, SOFT, TERRAIN, VoxelMesher, type VoxelStyle } from "../world/voxel-mesher";

/**
 * Voxel models for home-island decor. World-kit props (trees, bench, lamp, rock, signpost) come from `buildProp`,
 * scaled up to home scale; the home-only pieces are built here from the same palette and voxel styles. Every model is
 * built once per `DecorModel`, centred on its footprint at rotation 0, and shared by all placements.
 */

/** Kit props are hub-sized; on a 1 u home grid they read better a bit larger (a 2×1 bench spans ~1.5 u). */
const KIT_SCALE = 1.8;

type Box = (
  c: readonly [number, number, number],
  s: readonly [number, number, number],
  color: number,
  style?: VoxelStyle,
  glow?: GlowTint,
) => void;

interface Builder {
  /** Kit prop to build (at the origin, facing +Z), scaled by `KIT_SCALE`. */
  readonly kit?: PropSpec;
  /** Kit scale override (default `KIT_SCALE`). */
  readonly scale?: number;
  /** Home-only voxels in tile units. */
  readonly build?: (box: Box) => void;
}

const kit = (spec: PropSpec, scale = KIT_SCALE): Builder => ({ kit: spec, scale });

function plush(color: number, accent: number): Builder {
  return {
    build: (box) => {
      box([0, 0.22, 0], [0.5, 0.36, 0.42], color, SOFT);
      box([0, 0.44, 0], [0.4, 0.1, 0.34], color, SOFT);
      for (const x of [-0.1, 0.1]) {
        box([x, 0.3, 0.22], [0.09, 0.09, 0.03], PALETTE.paper, DECOR);
        box([x, 0.3, 0.235], [0.045, 0.045, 0.02], PALETTE.ink, DECOR);
      }
      box([0, 0.16, 0.22], [0.16, 0.04, 0.03], accent, DECOR);
      for (const x of [-0.14, 0.14]) box([x, 0.02, 0.08], [0.1, 0.04, 0.12], PALETTE.ink, DECOR);
    },
  };
}

function goldBench(): Builder {
  return {
    build: (box) => {
      for (let i = -5; i <= 5; i++) {
        box([i * 0.14, 0.42, 0], [0.14, 0.08, 0.5], i % 2 ? PALETTE.gold : PALETTE.sun);
        box([i * 0.14, 0.72, -0.23], [0.14, 0.44, 0.07], PALETTE.sun);
      }
      box([0, 0.97, -0.23], [1.6, 0.06, 0.09], PALETTE.goldSpec, SOFT, "gold");
      for (const x of [-0.7, 0.7]) box([x, 0.19, 0], [0.12, 0.38, 0.44], PALETTE.ink);
    },
  };
}

const BUILDERS: Readonly<Record<DecorModel, Builder>> = {
  "tree-paper": kit({ kind: "tree", canopy: "paper", x: 0, z: 0, trunk: 5, radius: 0.6, seed: 3 }),
  "tree-meadow": kit({ kind: "tree", canopy: "meadow", x: 0, z: 0, trunk: 4, radius: 0.65, seed: 5 }),
  "tree-sun": kit({ kind: "tree", canopy: "sun", x: 0, z: 0, trunk: 6, radius: 0.55, seed: 8 }),
  rock: kit({ kind: "rock", x: 0, z: 0, radius: 0.24, seed: 6 }),
  bench: kit({ kind: "bench", x: 0, z: 0 }),
  lamp: kit({ kind: "lamp", x: 0, z: 0 }),
  signpost: kit({ kind: "signpost", name: "home", x: 0, z: 0, color: PALETTE.meadowDrip }, 1.2),
  flowerbed: {
    build: (box) => {
      box([0, 0.06, 0], [0.8, 0.12, 0.8], PALETTE.trunk);
      box([0, 0.13, 0], [0.7, 0.03, 0.7], PALETTE.meadowDrip, DECOR);
      const colors = [PALETTE.coral, PALETTE.lilac, PALETTE.sun, PALETTE.paperWarm];
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          const h = 0.18 + hash3(i, j, 11) * 0.12;
          box([(i - 1) * 0.22, 0.14 + h / 2, (j - 1) * 0.22], [0.03, h, 0.03], PALETTE.meadowTuft, DECOR);
          box(
            [(i - 1) * 0.22, 0.16 + h, (j - 1) * 0.22],
            [0.1, 0.08, 0.1],
            colors[(i + j * 3) % 4] ?? PALETTE.coral,
            SOFT,
          );
        }
    },
  },
  reeds: {
    build: (box) => {
      for (let i = 0; i < 7; i++) {
        const x = (hash3(i, 1, 3) - 0.5) * 0.6;
        const z = (hash3(i, 2, 3) - 0.5) * 0.6;
        const h = 0.4 + hash3(i, 3, 3) * 0.5;
        box([x, h / 2, z], [0.05, h, 0.05], i % 2 ? PALETTE.meadowDrip : PALETTE.meadowTuft, SOFT);
        if (i % 3 === 0) box([x, h + 0.06, z], [0.07, 0.14, 0.07], PALETTE.trunk, SOFT);
      }
      box([0, 0.02, 0], [0.7, 0.04, 0.7], PALETTE.pond, DECOR);
    },
  },
  planter: {
    build: (box) => {
      box([0, 0.18, 0], [0.5, 0.36, 0.5], PALETTE.coral);
      box([0, 0.37, 0], [0.56, 0.06, 0.56], PALETTE.coralDark);
      box([0, 0.39, 0], [0.42, 0.02, 0.42], PALETTE.trunk, DECOR);
      for (const [x, z, h] of [
        [0, 0, 0.3],
        [-0.12, 0.08, 0.2],
        [0.12, -0.06, 0.24],
      ] as const) {
        box([x, 0.4 + h / 2, z], [0.04, h, 0.04], PALETTE.meadowTuft, SOFT);
        box([x + 0.05, 0.4 + h, z], [0.1, 0.05, 0.06], PALETTE.meadowDrip, SOFT);
      }
    },
  },
  crate: {
    build: (box) => {
      box([0, 0.3, 0], [0.6, 0.6, 0.6], PALETTE.tile);
      for (const y of [0.03, 0.57]) box([0, y, 0], [0.64, 0.06, 0.64], PALETTE.trunk);
      for (const x of [-0.29, 0.29]) for (const z of [-0.29, 0.29]) box([x, 0.3, z], [0.06, 0.6, 0.06], PALETTE.trunk);
      box([0, 0.3, 0.305], [0.5, 0.06, 0.02], PALETTE.trunk, DECOR);
    },
  },
  crystal: {
    build: (box) => {
      box([0, 0.06, 0], [0.5, 0.12, 0.5], PALETTE.stone);
      box([0, 0.45, 0], [0.22, 0.7, 0.22], PALETTE.lilac, SOFT, "cream");
      box([0.14, 0.3, 0.06], [0.14, 0.4, 0.14], PALETTE.lilacDark, SOFT);
      box([-0.12, 0.26, -0.08], [0.12, 0.3, 0.12], PALETTE.lilac, SOFT);
      box([0, 0.84, 0], [0.12, 0.1, 0.12], PALETTE.paperWarm, SOFT, "cream");
    },
  },
  fountain: {
    build: (box) => {
      for (let a = 0; a < 12; a++) {
        const t = (a / 12) * Math.PI * 2;
        box([Math.cos(t) * 0.78, 0.14, Math.sin(t) * 0.78], [0.36, 0.28, 0.36], a % 2 ? PALETTE.stone : PALETTE.tile);
      }
      box([0, 0.12, 0], [1.2, 0.08, 1.2], PALETTE.pond, DECOR);
      box([0, 0.4, 0], [0.26, 0.6, 0.26], PALETTE.stone);
      box([0, 0.74, 0], [0.56, 0.08, 0.56], PALETTE.tile);
      box([0, 0.92, 0], [0.14, 0.28, 0.14], PALETTE.pondLight, SOFT);
      box([0, 1.1, 0], [0.1, 0.1, 0.1], PALETTE.pondGlint, SOFT, "cream");
    },
  },
  "plush-nib": plush(PALETTE.coral, PALETTE.paper),
  "plush-pogo": plush(PALETTE.sun, PALETTE.ink),
  "plush-clank": plush(PALETTE.lilac, PALETTE.pond),
  "gulp-tooth": {
    build: (box) => {
      box([0, 0.1, 0], [0.5, 0.2, 0.5], PALETTE.sun);
      box([0, 0.22, 0], [0.56, 0.04, 0.56], PALETTE.gold, SOFT, "gold");
      box([0, 0.46, 0], [0.24, 0.44, 0.18], PALETTE.paperWarm, SOFT);
      box([0, 0.74, 0], [0.16, 0.14, 0.14], PALETTE.paperWarm, SOFT);
      box([0, 0.85, 0], [0.08, 0.1, 0.1], PALETTE.paper, SOFT);
    },
  },
  "dojo-mat": {
    build: (box) => {
      box([0, 0.03, 0], [1.8, 0.06, 1.8], PALETTE.coral, TERRAIN);
      box([0, 0.065, 0], [1.56, 0.03, 1.56], PALETTE.paperWarm, DECOR);
      box([0, 0.085, 0], [0.5, 0.02, 0.5], PALETTE.coral, DECOR);
    },
  },
  "sun-lantern": {
    build: (box) => {
      box([0, 0.5, 0], [0.08, 1, 0.08], PALETTE.ink);
      box([0.18, 0.98, 0], [0.4, 0.06, 0.06], PALETTE.ink);
      box([0.34, 0.8, 0], [0.24, 0.28, 0.24], PALETTE.sun, SOFT, "gold");
      box([0.34, 0.97, 0], [0.28, 0.05, 0.28], PALETTE.gold, SOFT, "gold");
    },
  },
  "gilded-bench": goldBench(),
  "gold-arch": {
    build: (box) => {
      const c = 0.2;
      for (let k = 0; k < 9; k++)
        for (const x of [-1.2, 1.2])
          box([x, k * c + c / 2, 0], [c * 1.5, c, c * 1.5], k % 3 ? PALETTE.sun : PALETTE.gold);
      for (let i = -6; i <= 6; i++) {
        const y = 9 * c + Math.round(Math.cos((i / 6) * (Math.PI / 2)) * 3) * c;
        box([i * c, y, 0], [c, c, c * 1.5], PALETTE.gold, SOFT, "gold");
      }
      box([0, 0.02, 0.3], [1.8, 0.04, 0.3], PALETTE.goldSpec, DECOR);
    },
  },
  "cloud-falls": {
    build: (box) => {
      for (let i = 0; i < 9; i++) {
        const x = ((i % 3) - 1) * 0.5;
        const z = (Math.floor(i / 3) - 1) * 0.5;
        const h = 0.3 + hash3(i, 7, 1) * 0.3 + (z < 0 ? 0.9 : 0);
        box([x, h / 2, z], [0.52, h, 0.52], i % 2 ? PALETTE.cloud : PALETTE.treePaper, SOFT);
      }
      for (let k = 0; k < 6; k++)
        box(
          [0, 1.2 - k * 0.2, 0.05 + k * 0.03],
          [0.3, 0.2, 0.08],
          k % 2 ? PALETTE.pondLight : PALETTE.pond,
          SOFT,
          "cream",
        );
      box([0, 0.08, 0.5], [0.8, 0.06, 0.5], PALETTE.pond, DECOR);
      box([0, 0.12, 0.52], [0.2, 0.04, 0.2], PALETTE.pondGlint, DECOR);
    },
  },
};

/** A shared, built decor model: one mesh per style bucket, centred on its footprint. */
export interface DecorModelMesh {
  readonly geometries: readonly { readonly geometry: BufferGeometry; readonly glow: GlowTint | null }[];
  readonly triangles: number;
}

/** Builds the geometry of one decor model (pure over three.js buffers; no GPU). */
export function buildDecorGeometry(model: DecorModel): DecorModelMesh {
  const main = new VoxelMesher();
  const glows = new Map<GlowTint, VoxelMesher>();
  const glowFor = (t: GlowTint): VoxelMesher => {
    let m = glows.get(t);
    if (!m) glows.set(t, (m = new VoxelMesher()));
    return m;
  };
  const b = BUILDERS[model];
  if (b.kit) {
    // Kit props are built at hub scale; their geometry is scaled up after meshing.
    buildProp(b.kit, { mesher: main, glow: glowFor, cell: 0.24 });
  }
  const box: Box = (c, s, color, style = TERRAIN, glow) =>
    (glow ? glowFor(glow) : main).box(c, s, color, style, { skipBottom: c[1] - s[1] / 2 <= 0.001 });
  b.build?.(box);
  const out: { geometry: BufferGeometry; glow: GlowTint | null }[] = [];
  let triangles = 0;
  const push = (m: VoxelMesher, glow: GlowTint | null): void => {
    if (m.empty) return;
    const built = m.build();
    if (b.kit) {
      const k = b.scale ?? KIT_SCALE;
      built.geometry.scale(k, k, k);
    }
    out.push({ geometry: built.geometry, glow });
    triangles += built.triangles;
  };
  push(main, null);
  for (const [tint, m] of glows) push(m, tint);
  return { geometries: out, triangles };
}

/** Caches decor geometry per model and hands out placement meshes that share it. */
export class DecorLibrary {
  private readonly cache = new Map<DecorModel, DecorModelMesh>();
  private readonly material: Material = createBandMaterial({ vertexColors: true, bandAttribute: true });

  /** A new object for one placement of `itemId` (rotate/position it yourself), or null for non-decor ids. */
  instance(itemId: string): Group | null {
    const item = decorItem(itemId);
    if (!item) return null;
    let model = this.cache.get(item.model);
    if (!model) this.cache.set(item.model, (model = buildDecorGeometry(item.model)));
    const g = new Group();
    g.name = `decor:${itemId}`;
    for (const part of model.geometries) {
      const mesh = new Mesh(part.geometry, this.material);
      if (part.glow) tagGlow(mesh, part.glow);
      g.add(mesh);
    }
    return g;
  }

  /** Frees every cached geometry and the shared material. */
  dispose(): void {
    for (const m of this.cache.values()) for (const p of m.geometries) p.geometry.dispose();
    this.cache.clear();
    this.material.dispose();
  }
}
