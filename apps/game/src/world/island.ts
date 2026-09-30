import { Group, Mesh, Vector3, type BufferGeometry, type Material } from "three";
import { createBandMaterial } from "../post/band-material";
import { tagGlow, type GlowTint } from "../post/tags";
import { PALETTE } from "../stage/palette";
import { SUN_DIRECTION } from "../stage/lights";
import { hash3, mulberry32, valueNoise } from "./noise";
import { buildProp, inFootprint, type Footprint, type PropAnchor, type PropSpec } from "./props";
import { DECOR, STRATA, TERRAIN, VoxelMesher, type VoxelGrid } from "./voxel-mesher";

/** Island palette (art bible §4 biome deltas). */
export interface IslandBiome {
  readonly top: number;
  readonly topChecker: number;
  readonly drip: number;
  readonly tuft: number;
  readonly cliff: readonly [number, number];
  readonly under: number;
  readonly underDeep: number;
  readonly flowers: readonly number[];
}

/** The default meadow biome. */
export const MEADOW: IslandBiome = {
  top: PALETTE.meadow,
  topChecker: PALETTE.meadowLight,
  drip: PALETTE.meadowDrip,
  tuft: PALETTE.meadowTuft,
  cliff: [PALETTE.coral, PALETTE.coralDark],
  under: PALETTE.lilac,
  underDeep: PALETTE.lilacDark,
  flowers: [PALETTE.coral, PALETTE.lilac, PALETTE.paperWarm, PALETTE.sun],
};

/** Snow biome: paper top, pond-light strata. */
export const SNOW: IslandBiome = {
  top: PALETTE.paper,
  topChecker: 0xf7f7f2,
  drip: 0xdfe6ea,
  tuft: 0xdfe6ea,
  cliff: [PALETTE.pondLight, PALETTE.pond],
  under: PALETTE.lilac,
  underDeep: PALETTE.lilacDark,
  flowers: [PALETTE.pondLight, PALETTE.lilac],
};

/** A round checker plaza (art bible §4.1). Radius in cells. */
export interface PlazaSpec {
  readonly radius: number;
  /** One-cell sun rim (default true). */
  readonly rim?: boolean;
  /** Straight checker paths from the centre toward the island edge. */
  readonly paths?: readonly { readonly toward: "+x" | "-x" | "+z" | "-z"; readonly halfWidth: number }[];
}

/** Everything buildIsland needs. Distances in cells unless noted; positions of props in world units. */
export interface IslandSpec {
  /** Radius in cells (R 4–9 background, 12–28 play/hub). */
  readonly radius: number;
  /** World units per cell (bible: 0.24 = 2 sprite pixels). */
  readonly cell?: number;
  readonly seed: number;
  /** Stretch along z (1 = round). */
  readonly squash?: number;
  /** Max underside rows. */
  readonly underside?: number;
  /** Chance of a meadow drip on a rim cell. */
  readonly rimDrip?: number;
  readonly biome?: IslandBiome;
  readonly pond?: { readonly i: number; readonly j: number; readonly r: number };
  readonly plaza?: PlazaSpec;
  /** Grass tufts and single-voxel flowers scattered on the meadow (not on the plaza). */
  readonly scatter?: { readonly tufts?: number; readonly flowers?: number };
  readonly props?: readonly PropSpec[];
  /** Bake hard sun shadows into the top (default true; background islands can skip it). */
  readonly bakeShadows?: boolean;
}

/** What a surface cell is made of. */
export type SurfaceKind = "meadow" | "plaza" | "path" | "rim" | "pond";

/** A built island: one static mesh + one per glow tint, plus queries for gameplay/UI. */
export interface IslandModel {
  readonly object: Group;
  readonly spec: Readonly<IslandSpec>;
  /** Surface kind at a local (x, z) in world units, or null off the island. */
  surfaceAt(x: number, z: number): SurfaceKind | null;
  /** True where a Friend can stand (on the island, not in the pond, not inside a prop footprint). */
  isWalkable(x: number, z: number): boolean;
  /** Named points on props (door, sign, marquee...) in island-local space, for DOM overlays. */
  readonly anchors: readonly PropAnchor[];
  /** Triangles and draw calls this island costs (perf budget). */
  readonly stats: { readonly triangles: number; readonly drawCalls: number; readonly voxels: number };
  dispose(): void;
}

interface CellInfo {
  readonly i: number;
  readonly j: number;
  edge: number;
  kind: SurfaceKind;
}

/** Island footprint: noisy ellipse cells with their BFS distance to the rim. Pure; exported for tests. */
export function islandCells(spec: Pick<IslandSpec, "radius" | "seed" | "squash">): Map<string, CellInfo> {
  const R = spec.radius;
  const sq = spec.squash ?? 1;
  const N = Math.ceil(R * 1.3);
  const cells = new Map<string, CellInfo>();
  for (let i = -N; i <= N; i++)
    for (let j = -N; j <= N; j++) {
      const d =
        Math.hypot(i, j * sq) / R +
        (valueNoise(i * 0.22, j * 0.22, spec.seed) - 0.5) * 0.34 +
        (valueNoise(i * 0.6, j * 0.6, spec.seed + 7) - 0.5) * 0.08;
      if (d < 1) cells.set(`${i},${j}`, { i, j, edge: -1, kind: "meadow" });
    }
  // Keep the centre cell even for tiny noisy islands so every island has a surface.
  if (!cells.has("0,0")) cells.set("0,0", { i: 0, j: 0, edge: -1, kind: "meadow" });
  const N4: readonly [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let frontier: CellInfo[] = [];
  for (const c of cells.values())
    if (N4.some(([a, b]) => !cells.has(`${c.i + a},${c.j + b}`))) {
      c.edge = 0;
      frontier.push(c);
    }
  let d = 0;
  while (frontier.length) {
    d++;
    const next: CellInfo[] = [];
    for (const c of frontier)
      for (const [a, b] of N4) {
        const n = cells.get(`${c.i + a},${c.j + b}`);
        if (n && n.edge < 0) {
          n.edge = d;
          next.push(n);
        }
      }
    frontier = next;
  }
  return cells;
}

/** Underside depth (rows) for a cell: `2 + 0.9·edge + noise`, capped (art bible §4). Pure. */
export function undersideRows(i: number, j: number, edge: number, seed: number, cap: number): number {
  return Math.min(
    cap,
    2 +
      Math.floor(edge * 0.9 + valueNoise(i * 0.3, j * 0.3, seed + 4) * 3 + (edge > 3 ? hash3(i, j, seed + 2) * 2 : 0)),
  );
}

/** Stratum colour for underside row k (1-based) of `rows`. Pure. */
export function stratumColor(k: number, rows: number, drip: boolean, b: IslandBiome): number {
  if (k === 1 && drip) return b.drip;
  if (k === 1) return b.cliff[0];
  if (k === 2) return b.cliff[1];
  if (k > rows - 2) return b.underDeep;
  return b.under;
}

function checker(i: number, j: number): boolean {
  return ((Math.floor(i / 2) + Math.floor(j / 2)) & 1) === 1;
}

/**
 * Builds a floating voxel island: meadow (or plaza) top, coral strata, lilac stalactite underside,
 * optional pond, scattered tufts/flowers and props, all merged into one mesh with baked hard
 * shadows; glowing props get one extra mesh per glow tint (for the dot-bloom tag).
 */
export function buildIsland(spec: IslandSpec): IslandModel {
  const cell = spec.cell ?? 0.24;
  const biome = spec.biome ?? MEADOW;
  const cap = spec.underside ?? 9;
  const rimDrip = spec.rimDrip ?? 0.45;
  const cells = islandCells(spec);
  const plaza = spec.plaza;

  for (const c of cells.values()) {
    const { i, j } = c;
    if (plaza) {
      const r = Math.hypot(i, j * 1.05);
      if (r < plaza.radius) c.kind = plaza.rim !== false && Math.abs(r - plaza.radius + 0.6) < 0.6 ? "rim" : "plaza";
      else
        for (const p of plaza.paths ?? []) {
          const along = p.toward === "+x" ? i : p.toward === "-x" ? -i : p.toward === "+z" ? j : -j;
          const across = p.toward === "+x" || p.toward === "-x" ? j : i;
          if (along > 0 && Math.abs(across) <= p.halfWidth) c.kind = "path";
        }
    }
    if (spec.pond && c.kind === "meadow" && c.edge > 1) {
      const { i: pi, j: pj, r } = spec.pond;
      const pd =
        Math.hypot((i - pi) / r, (j - pj) / (r * 0.7)) + (valueNoise(i * 0.4, j * 0.4, spec.seed + 9) - 0.5) * 0.3;
      if (pd < 1) c.kind = "pond";
    }
  }

  const mesher = new VoxelMesher();
  const grid: VoxelGrid = mesher.grid(cell, [0, -cell / 2, 0]);
  let voxels = 0;
  for (const c of cells.values()) {
    const { i, j } = c;
    let top = biome.top;
    if (c.kind === "plaza" || c.kind === "path") top = checker(i, j) ? PALETTE.paper : PALETTE.tile;
    else if (c.kind === "rim") top = PALETTE.sun;
    else if (checker(i, j) && valueNoise(i * 0.15, j * 0.15, spec.seed + 3) > 0.62) top = biome.topChecker;
    if (c.kind === "pond") {
      const glint = hash3(i, j, 5) > 0.9;
      mesher.box(
        [i * cell, -cell / 2 - cell * 0.45, j * cell],
        [cell, cell, cell],
        glint ? PALETTE.pondGlint : PALETTE.pond,
        TERRAIN,
        {
          skipBottom: true,
        },
      );
    } else {
      grid.set(i, 0, j, top, TERRAIN);
    }
    voxels++;
    const drip = c.edge === 0 && hash3(i, j, spec.seed + 1) < rimDrip;
    const rows = undersideRows(i, j, c.edge, spec.seed, cap);
    for (let k = 1; k <= rows; k++) {
      grid.set(i, -k, j, stratumColor(k, rows, drip, biome), STRATA);
      voxels++;
    }
  }

  const has = (x: number, z: number): CellInfo | undefined =>
    cells.get(`${Math.round(x / cell)},${Math.round(z / cell)}`);

  // Props first, so scatter can avoid their footprints.
  const glowMeshers = new Map<GlowTint, VoxelMesher>();
  const glowFor = (t: GlowTint): VoxelMesher => {
    let m = glowMeshers.get(t);
    if (!m) glowMeshers.set(t, (m = new VoxelMesher()));
    return m;
  };
  const anchors: PropAnchor[] = [];
  const footprints: Footprint[] = [];
  for (const p of spec.props ?? []) {
    const out = buildProp(p, { mesher, glow: glowFor, cell });
    anchors.push(...out.anchors);
    if (out.footprint) footprints.push(out.footprint);
  }
  const blocked = (x: number, z: number, pad = 0): boolean => footprints.some((f) => inFootprint(f, x, z, pad));

  const rnd = mulberry32(spec.seed * 7919 + 13);
  const scatter = spec.scatter ?? {};
  const all = [...cells.values()];
  const meadowSpot = (): [number, number] | null => {
    for (let tries = 0; tries < 12; tries++) {
      const c = all[Math.floor(rnd() * all.length)];
      if (!c || c.kind !== "meadow" || c.edge < 1) continue;
      const x = (c.i + rnd() - 0.5) * cell;
      const z = (c.j + rnd() - 0.5) * cell;
      if (blocked(x, z, 0.1)) continue;
      return [x, z];
    }
    return null;
  };
  for (let n = 0; n < (scatter.tufts ?? 0); n++) {
    const s = meadowSpot();
    if (!s) continue;
    const h = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < h; k++)
      mesher.box(
        [s[0] + (k === 1 ? 0.04 : 0), 0.035 + k * 0.07, s[1]],
        [0.045, 0.07, 0.045],
        k ? biome.drip : biome.tuft,
        DECOR,
        { skipBottom: k === 0 },
      );
  }
  for (let n = 0; n < (scatter.flowers ?? 0); n++) {
    const s = meadowSpot();
    if (!s) continue;
    mesher.box(
      [s[0], 0.04, s[1]],
      [0.08, 0.08, 0.08],
      biome.flowers[n % biome.flowers.length] ?? PALETTE.coral,
      DECOR,
      {
        skipBottom: true,
      },
    );
  }

  const bake = spec.bakeShadows === false ? undefined : { sun: SUN_DIRECTION.clone(), maxDistance: 8 };
  const material = createBandMaterial({ vertexColors: true, bandAttribute: true });
  const built = mesher.build(bake);
  const group = new Group();
  group.name = `island-${spec.seed}`;
  const main = new Mesh(built.geometry, material);
  main.name = "island-static";
  group.add(main);
  let triangles = built.triangles;
  const geometries: BufferGeometry[] = [built.geometry];
  const materials: Material[] = [material];
  for (const [tint, m] of glowMeshers) {
    if (m.empty) continue;
    const g = m.build();
    const mesh = new Mesh(g.geometry, material);
    mesh.name = `island-glow-${tint}`;
    tagGlow(mesh, tint);
    group.add(mesh);
    triangles += g.triangles;
    geometries.push(g.geometry);
  }

  const surfaceAt = (x: number, z: number): SurfaceKind | null => has(x, z)?.kind ?? null;
  return {
    object: group,
    spec,
    anchors,
    surfaceAt,
    isWalkable: (x, z) => {
      const k = surfaceAt(x, z);
      return k !== null && k !== "pond" && !blocked(x, z);
    },
    stats: { triangles, drawCalls: group.children.length, voxels },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/** World-space position of an anchor on a placed island. */
export function anchorWorld(island: IslandModel, name: string, out = new Vector3()): Vector3 | null {
  const a = island.anchors.find((x) => x.name === name);
  if (!a) return null;
  island.object.updateWorldMatrix(true, false);
  return out.copy(a.position).applyMatrix4(island.object.matrixWorld);
}
