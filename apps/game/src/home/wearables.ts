import { beltDef, catalogItem, getBit, pixelIndex, SPRITE_SIZE, type Hex64, type HatModel } from "@pl/shared";
import { Group, Mesh } from "three";
import { createBandMaterial } from "../post/band-material";
import { tagGlow } from "../post/tags";
import { friendAnchor } from "../friend/layers";
import { DEFAULT_PIXEL_SIZE, FRIEND_DEPTH } from "../friend/model";
import { PALETTE } from "../stage/palette";
import { DECOR, SOFT, VoxelMesher } from "../world/voxel-mesher";

/**
 * Worn voxels on a Friend: hats (GDD §12.3: attached outside the canonical silhouette, never covering a canonical
 * pixel) and the Fling Belt band on the waist row (GDD §12.4). Placement is pure and computed from the front mask
 * (idle-down frame 0), the pose the home scene shows.
 */

/** Hat art in sprite pixels, top row first. Letters index `HAT_COLORS`; '.' is empty. */
export const HAT_ART: Readonly<Record<HatModel, readonly string[]>> = {
  cap: [".ppppp..", "pppppkkk"],
  beanie: ["..w..", ".ccc.", "ccccc", "ddddd"],
  "flower-crown": ["f.g.f.g", "mmmmmmm"],
  party: ["..w..", "..l..", ".lsl.", ".sls.", "lslsl"],
  "sun-crown": ["s.s.s", "sssss", "GGGGG"],
};

/** Colours of the hat art letters (uppercase = glowing gold). */
export const HAT_COLORS: Readonly<Record<string, number>> = {
  p: PALETTE.paper,
  k: PALETTE.ink,
  w: PALETTE.paperWarm,
  c: PALETTE.coral,
  d: PALETTE.coralDark,
  f: PALETTE.coral,
  g: PALETTE.sun,
  m: PALETTE.meadowDrip,
  l: PALETTE.lilac,
  s: PALETTE.sun,
  G: PALETTE.gold,
};

/** One hat voxel in sprite-grid coordinates (rows may be negative: above the 16×16 grid). */
export interface HatVoxel {
  readonly x: number;
  readonly y: number;
  readonly color: number;
  readonly glow: boolean;
}

/** Topmost set row of column x in the mask, or `SPRITE_SIZE` for an empty column. */
function columnTop(front: Hex64, x: number): number {
  if (x < 0 || x >= SPRITE_SIZE) return SPRITE_SIZE;
  for (let y = 0; y < SPRITE_SIZE; y++) if (getBit(front, pixelIndex(x, y))) return y;
  return SPRITE_SIZE;
}

/**
 * Hat voxels for `art` on a Friend with this front mask: centred on the head (the top two rows), resting on the highest
 * pixel under the hat's span. Every voxel lies strictly above its column's top pixel, so no canonical pixel is covered.
 */
export function hatVoxels(front: Hex64, art: readonly string[]): HatVoxel[] {
  let top = SPRITE_SIZE;
  for (let x = 0; x < SPRITE_SIZE; x++) top = Math.min(top, columnTop(front, x));
  if (top === SPRITE_SIZE) return [];
  let minX = SPRITE_SIZE;
  let maxX = -1;
  for (let y = top; y < Math.min(SPRITE_SIZE, top + 2); y++)
    for (let x = 0; x < SPRITE_SIZE; x++)
      if (getBit(front, pixelIndex(x, y))) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
  const width = Math.max(0, ...art.map((r) => r.length));
  const x0 = Math.round((minX + maxX + 1) / 2 - width / 2);
  let base = SPRITE_SIZE;
  for (let x = x0; x < x0 + width; x++) base = Math.min(base, columnTop(front, x));
  const out: HatVoxel[] = [];
  art.forEach((row, r) => {
    const y = base - art.length + r;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i] ?? ".";
      const color = HAT_COLORS[ch];
      if (color === undefined) continue;
      out.push({ x: x0 + i, y, color, glow: ch === ch.toUpperCase() });
    }
  });
  return out;
}

/** The waist row a belt band wraps (60 % of the way down the silhouette) and its x span, or null for an empty mask. */
export function beltRow(front: Hex64): { y: number; minX: number; maxX: number } | null {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < SPRITE_SIZE; y++)
    for (let x = 0; x < SPRITE_SIZE; x++)
      if (getBit(front, pixelIndex(x, y))) {
        if (top < 0) top = y;
        bottom = y;
      }
  if (top < 0) return null;
  const y = top + Math.round((bottom - top) * 0.6);
  let minX = SPRITE_SIZE;
  let maxX = -1;
  for (let x = 0; x < SPRITE_SIZE; x++)
    if (getBit(front, pixelIndex(x, y))) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  return maxX < 0 ? null : { y, minX, maxX };
}

/** A worn-voxel mesh group; `dispose` frees its geometry and material. */
export interface Wearable {
  readonly object: Group;
  dispose(): void;
}

function meshes(name: string, main: VoxelMesher, glow: VoxelMesher | null): Wearable {
  const group = new Group();
  group.name = name;
  const material = createBandMaterial({ vertexColors: true, bandAttribute: true });
  const built: { dispose(): void }[] = [material];
  for (const [m, glowing] of [
    [main, false],
    [glow, true],
  ] as const) {
    if (!m || m.empty) continue;
    const g = m.build().geometry;
    built.push(g);
    const mesh = new Mesh(g, material);
    if (glowing) tagGlow(mesh, "gold");
    group.add(mesh);
  }
  return {
    object: group,
    dispose() {
      for (const b of built) b.dispose();
    },
  };
}

/**
 * Builds a hat for a catalog hat id in the Friend model's local frame (origin at the feet centre, front face at z = 0),
 * or null for an unknown id or empty mask. Add the result to the Friend model's object.
 */
export function buildHat(hatId: string, front: Hex64, pixelSize = DEFAULT_PIXEL_SIZE): Wearable | null {
  const item = catalogItem(hatId);
  if (!item || item.kind !== "hat") return null;
  const voxels = hatVoxels(front, HAT_ART[item.model]);
  if (voxels.length === 0) return null;
  const { cx, bottom } = friendAnchor(front);
  const s = pixelSize;
  const D = FRIEND_DEPTH * s;
  const main = new VoxelMesher();
  const glow = new VoxelMesher();
  for (const v of voxels) {
    (v.glow ? glow : main).box(
      [(v.x + 0.5 - cx) * s, (bottom - v.y - 0.5) * s, -D / 2],
      [s, s, D + 0.2 * s],
      v.color,
      SOFT,
    );
  }
  return meshes(`hat:${hatId}`, main, glow);
}

/** Builds the Fling Belt band (half a row tall, wrapping the waist row), or null for an unknown belt or empty mask. */
export function buildBelt(beltId: string, front: Hex64, pixelSize = DEFAULT_PIXEL_SIZE): Wearable | null {
  const def = beltDef(beltId);
  const row = beltRow(front);
  if (!def || !row) return null;
  const { cx, bottom } = friendAnchor(front);
  const s = pixelSize;
  const D = FRIEND_DEPTH * s;
  const m = new VoxelMesher();
  const w = (row.maxX - row.minX + 1) * s + 0.16 * s;
  const x = ((row.minX + row.maxX + 1) / 2 - cx) * s;
  m.box([x, (bottom - row.y - 0.75) * s, -D / 2], [w, 0.5 * s, D + 0.16 * s], def.color, DECOR);
  // Gulp Masters get a paper-cloud trim (GDD §12.4).
  if (def.id === "gulp_master")
    m.box([x, (bottom - row.y - 0.4) * s, -D / 2], [w * 0.6, 0.2 * s, D + 0.2 * s], PALETTE.cloud, DECOR);
  return meshes(`belt:${beltId}`, m, null);
}
