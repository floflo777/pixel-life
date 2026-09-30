/**
 * Pixel data for the Friend's textures, generated in code (no image assets): the 16×16 decal atlas (scar, loose slot,
 * stitch, glow cracks) and the far-LOD billboard impostor. Pure: returns RGBA bytes, bottom row first (WebGL order).
 */
import { FRIEND_COLORS } from "./palette.js";
import { Cell, CELLS, GRID, type FriendLayers } from "./layers.js";
import { ATLAS_TILES, Tile } from "./mesher.js";

/** Tile side in texels. */
export const TILE = 16;

type Paint = (x: number, y: number, w: number, h: number, rgb: number, a?: number) => void;

function canvas(width: number, height: number): { data: Uint8Array; paint: Paint } {
  const data = new Uint8Array(width * height * 4);
  // Authoring is top-down (like the style frames' canvas code); storage is bottom-up for WebGL.
  const paint: Paint = (x, y, w, h, rgb, a = 255) => {
    for (let j = y; j < y + h; j++) {
      if (j < 0 || j >= height) continue;
      for (let i = x; i < x + w; i++) {
        if (i < 0 || i >= width) continue;
        const o = ((height - 1 - j) * width + i) * 4;
        data[o] = (rgb >> 16) & 0xff;
        data[o + 1] = (rgb >> 8) & 0xff;
        data[o + 2] = rgb & 0xff;
        data[o + 3] = a;
      }
    }
  };
  return { data, paint };
}

/**
 * Coral (or lime) dashes around a tile's rim: the "dotted" scar outline of the art bible. Dashes are 4 texels long
 * and 3 thick (≈ 1 render px at the 3–6 render px per sprite pixel the Friend is drawn at), alternating with paper, so
 * they survive nearest sampling instead of aliasing into specks.
 */
function dashedRim(paint: Paint, ox: number, rgb: number): void {
  for (let i = 0; i < TILE; i += 8) {
    paint(ox + i, 0, 4, 3, rgb);
    paint(ox + i + 4, 13, 4, 3, rgb);
    paint(ox, i + 4, 3, 4, rgb);
    paint(ox + 13, i, 3, 4, rgb);
  }
}

/** The decal atlas: `ATLAS_TILES` tiles of 16×16 in one row, RGBA, bottom row first. Transparent texels have alpha 0. */
export function atlasPixels(stitchColor: number = FRIEND_COLORS.coral): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const width = TILE * ATLAS_TILES;
  const { data, paint } = canvas(width, TILE);
  const at = (t: number): number => t * TILE;
  paint(at(Tile.White), 0, TILE, TILE, 0xffffff);
  // Scar: flush paper plate with a coral dashed rim (never black).
  paint(at(Tile.Scar), 0, TILE, TILE, FRIEND_COLORS.paper);
  dashedRim(paint, at(Tile.Scar), FRIEND_COLORS.coral);
  // Loose slot (pixel detached, still grabbable): ink frame, paper centre, lime dashes = "act now".
  paint(at(Tile.Fresh), 0, TILE, TILE, FRIEND_COLORS.ink);
  paint(at(Tile.Fresh) + 3, 3, 10, 10, FRIEND_COLORS.paper);
  dashedRim(paint, at(Tile.Fresh), FRIEND_COLORS.signal);
  // Stitch: cross-stitch X, 4 ticks crossing into the neighbours, paper centre knot.
  const st = at(Tile.Stitch);
  for (let i = 2; i < 13; i++) {
    paint(st + i, i, 2, 2, stitchColor);
    paint(st + 14 - i, i, 2, 2, stitchColor);
  }
  paint(st, 7, 2, 2, stitchColor);
  paint(st + 14, 7, 2, 2, stitchColor);
  paint(st + 7, 0, 2, 2, stitchColor);
  paint(st + 7, 14, 2, 2, stitchColor);
  paint(st + 6, 6, 4, 4, stitchColor);
  paint(st + 7, 7, 2, 2, FRIEND_COLORS.paper);
  // Glow cracks: stage 1 hairline, 2 split (2 px), 3 dull (split + branch).
  const zig = [
    [3, 1],
    [4, 3],
    [5, 5],
    [7, 6],
    [8, 8],
    [7, 10],
    [9, 12],
    [11, 14],
  ] as const;
  for (const [x, y] of zig) {
    paint(at(Tile.Crack1) + x, y, 1, 2, FRIEND_COLORS.ink);
    paint(at(Tile.Crack2) + x, y, 2, 2, FRIEND_COLORS.ink);
    paint(at(Tile.Crack3) + x, y, 2, 2, FRIEND_COLORS.ink);
  }
  paint(at(Tile.Crack2) + 8, 8, 4, 1, FRIEND_COLORS.ink);
  paint(at(Tile.Crack3) + 8, 8, 5, 2, FRIEND_COLORS.ink);
  paint(at(Tile.Crack3) + 12, 5, 2, 4, FRIEND_COLORS.ink);
  paint(at(Tile.Crack3) + 2, 9, 5, 1, FRIEND_COLORS.ink);
  return { width, height: TILE, data };
}

/** Impostor texels per sprite pixel. */
export const IMPOSTOR_SCALE = 4;
/** Impostor margin around the 16×16 grid, in sprite pixels (room for the halo). */
export const IMPOSTOR_MARGIN = 1;

/** Settings for the impostor bitmap's screen-space-like halo, in texels. */
export interface ImpostorHalo {
  width: number;
  keyline: number;
  color: number;
}

/**
 * The far-LOD billboard: the composed frame drawn flat at `IMPOSTOR_SCALE` texels per sprite pixel, with scars as
 * paper + coral dots, gold, paper eyes, and a halo + keyline dilated in texel space. RGBA, bottom row first.
 */
export function impostorPixels(
  layers: FriendLayers,
  halo: ImpostorHalo | null,
): { width: number; height: number; data: Uint8Array } {
  const k = IMPOSTOR_SCALE;
  const m = IMPOSTOR_MARGIN * k;
  const size = GRID * k + 2 * m;
  const { data, paint } = canvas(size, size);
  const filled = new Uint8Array(size * size);
  for (let i = 0; i < CELLS; i++) {
    const c = layers.cells[i];
    if (c === Cell.Empty) continue;
    const x = m + (i % GRID) * k;
    const y = m + (i >> 4) * k;
    for (let j = 0; j < k; j++) filled.fill(1, (y + j) * size + x, (y + j) * size + x + k);
  }
  if (halo) {
    const reach = halo.width + halo.keyline;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (filled[y * size + x]) continue;
        let d = Infinity;
        for (let dy = -reach; dy <= reach && d > 0; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size || !filled[ny * size + nx]) continue;
            d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)));
          }
        }
        if (d <= halo.width) paint(x, y, 1, 1, halo.color);
        else if (d <= reach) paint(x, y, 1, 1, FRIEND_COLORS.ink);
      }
    }
  }
  for (let i = 0; i < CELLS; i++) {
    const x = m + (i % GRID) * k;
    const y = m + (i >> 4) * k;
    const c = layers.cells[i];
    if (layers.eyes[i]) paint(x, y, k, k, FRIEND_COLORS.eye);
    if (c === Cell.Body) paint(x, y, k, k, layers.stitch[i] ? FRIEND_COLORS.coral : FRIEND_COLORS.body);
    if (c === Cell.Body && layers.stitch[i]) paint(x + 1, y + 1, k - 2, k - 2, FRIEND_COLORS.body);
    if (c === Cell.Gold) paint(x, y, k, k, FRIEND_COLORS.gold);
    if (c === Cell.Scar) {
      paint(x, y, k, k, FRIEND_COLORS.paper);
      paint(x, y, 1, 1, FRIEND_COLORS.coral);
      paint(x + k - 1, y + k - 1, 1, 1, FRIEND_COLORS.coral);
    }
  }
  return { width: size, height: size, data };
}
