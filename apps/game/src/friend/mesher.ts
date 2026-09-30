/**
 * Greedy mesher for the voxel Friend: front-face extrusion of one composed 16×16 frame (art bible §2).
 *
 * Every present pixel is a `1 × 1 × depth` box with its front face at z = 0. Front and back faces are greedy rectangles,
 * side faces are merged runs along each exposed edge, and the bevel, decals, eye back-plates and the paper halo + ink
 * keyline are extra quads. Colours are flat band colours per face (no lighting, no gradients), so the output reads the
 * same under any scene lights. Pure: no three.js, output is typed arrays.
 */
import { BODY_BANDS, FRIEND_COLORS, GOLD_BANDS, type FaceBands } from "./palette.js";
import { Cell, CELLS, GRID, type FriendAnchor, type FriendLayers } from "./layers.js";

/** Atlas tiles (16×16 each, one row): see `atlas.ts`. */
export const Tile = Object.freeze({ White: 0, Scar: 1, Fresh: 2, Stitch: 3, Crack1: 4, Crack2: 5, Crack3: 6 });
/** Number of tiles in the decal atlas row. */
export const ATLAS_TILES = 8;

/** A rectangle of cells: top-left `(x, y)`, size `w × h`. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Greedy rectangles covering exactly the cells where `pick(i)` is true: disjoint, row-major deterministic, each maximal
 * in width first, then in height.
 */
export function greedyRects(pick: (i: number) => boolean): Rect[] {
  const used = new Uint8Array(CELLS);
  const out: Rect[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const i = y * GRID + x;
      if (used[i] || !pick(i)) continue;
      let w = 1;
      while (x + w < GRID && !used[i + w] && pick(i + w)) w++;
      let h = 1;
      grow: while (y + h < GRID) {
        const row = (y + h) * GRID + x;
        for (let k = 0; k < w; k++) if (used[row + k] || !pick(row + k)) break grow;
        h++;
      }
      for (let dy = 0; dy < h; dy++) used.fill(1, (y + dy) * GRID + x, (y + dy) * GRID + x + w);
      out.push({ x, y, w, h });
    }
  }
  return out;
}

/** Converts an sRGB hex colour to the three floats written in the colour attribute. */
export type ColorConvert = (hex: number) => readonly [number, number, number];

/** Default conversion: sRGB bytes / 255 (used by tests; the three layer passes a colour-managed converter). */
export const srgbFloats: ColorConvert = (hex) => [
  ((hex >> 16) & 0xff) / 255,
  ((hex >> 8) & 0xff) / 255,
  (hex & 0xff) / 255,
];

/** Halo layer settings, in sprite pixels. */
export interface HaloSpec {
  /** Paper ring width (sprite px). */
  width: number;
  /** Ink keyline width outside the ring (sprite px). */
  keyline: number;
  /** Ring colour (streak tier). */
  color: number;
  /** Ring plane depth as a fraction of the extrusion depth (0 = front plane, 1 = back plane). */
  depthFraction: number;
}

/** Mesher settings. */
export interface MeshOptions {
  /** World units per sprite pixel. */
  pixelSize: number;
  /** Extrusion depth in sprite pixels (art bible: 1.5). */
  depth: number;
  anchor: FriendAnchor;
  /** 0 = full detail (back faces + bevel); 1 = hub detail (no back faces, no bevel). */
  lod: 0 | 1;
  halo: HaloSpec | null;
  /** Eye back-plate colour (paper `#F3EAD0`; `#FFF1C2` during an eye-glow event). */
  eyeColor: number;
  /** When false only the halo, eye plates and decals are emitted (the instanced venue Friend draws its own voxels). */
  voxels?: boolean;
  convert?: ColorConvert;
}

/** One vertex stream (main or gold), indexed triangles. */
export interface QuadData {
  positions: Float32Array;
  normals: Int8Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  quads: number;
}

/** Mesher output: the ink/decal/halo stream, the gold stream (glow pass), and where the eye plates sit. */
export interface FriendMeshData {
  main: QuadData;
  gold: QuadData | null;
  /** Vertex range `[start, count]` of the eye back-plates in `main` (recoloured for eye-glow events). */
  eyes: readonly [number, number];
  /** Local bounds `[minX, minY, minZ, maxX, maxY, maxZ]`. */
  bounds: readonly [number, number, number, number, number, number];
}

const Z_BEVEL_TOP = 0.015;
const Z_BEVEL_LEFT = 0.01;
const Z_DECAL = 0.02;
const Z_KEYLINE = 0.03;
const Z_EYE = 0.01;
const BEVEL_TOP = 0.22;
const BEVEL_LEFT = 0.16;

class QuadWriter {
  private pos = new Float32Array(64 * 12);
  private nrm = new Int8Array(64 * 12);
  private col = new Float32Array(64 * 12);
  private uv = new Float32Array(64 * 8);
  quads = 0;
  private readonly cache = new Map<number, readonly [number, number, number]>();

  constructor(private readonly convert: ColorConvert) {}

  private rgb(hex: number): readonly [number, number, number] {
    let c = this.cache.get(hex);
    if (!c) {
      c = this.convert(hex);
      this.cache.set(hex, c);
    }
    return c;
  }

  private reserve(): void {
    if ((this.quads + 1) * 12 <= this.pos.length) return;
    const grow = <T extends Float32Array | Int8Array>(a: T, make: (n: number) => T): T => {
      const b = make(a.length * 2);
      b.set(a);
      return b;
    };
    this.pos = grow(this.pos, (n) => new Float32Array(n));
    this.nrm = grow(this.nrm, (n) => new Int8Array(n));
    this.col = grow(this.col, (n) => new Float32Array(n));
    this.uv = grow(this.uv, (n) => new Float32Array(n));
  }

  /** Quad p0, p0+du, p0+du+dv, p0+dv; `du × dv` must point along the outward normal `n`. */
  quad(
    px: number,
    py: number,
    pz: number,
    ux: number,
    uy: number,
    uz: number,
    vx: number,
    vy: number,
    vz: number,
    n: readonly [number, number, number],
    color: number,
    tile: number,
  ): void {
    this.reserve();
    const q = this.quads++;
    const p = this.pos;
    const o = q * 12;
    p[o] = px;
    p[o + 1] = py;
    p[o + 2] = pz;
    p[o + 3] = px + ux;
    p[o + 4] = py + uy;
    p[o + 5] = pz + uz;
    p[o + 6] = px + ux + vx;
    p[o + 7] = py + uy + vy;
    p[o + 8] = pz + uz + vz;
    p[o + 9] = px + vx;
    p[o + 10] = py + vy;
    p[o + 11] = pz + vz;
    const [r, g, b] = this.rgb(color);
    for (let k = 0; k < 4; k++) {
      this.nrm[o + k * 3] = n[0] * 127;
      this.nrm[o + k * 3 + 1] = n[1] * 127;
      this.nrm[o + k * 3 + 2] = n[2] * 127;
      this.col[o + k * 3] = r;
      this.col[o + k * 3 + 1] = g;
      this.col[o + k * 3 + 2] = b;
    }
    const u = q * 8;
    if (tile === Tile.White) {
      // Centre of the white tile: plain faces sample one opaque white texel, so vertex colour is the face colour.
      const c = 0.5 / ATLAS_TILES;
      for (let k = 0; k < 4; k++) {
        this.uv[u + k * 2] = c;
        this.uv[u + k * 2 + 1] = 0.5;
      }
    } else {
      const u0 = tile / ATLAS_TILES;
      const u1 = (tile + 1) / ATLAS_TILES;
      this.uv.set([u0, 0, u1, 0, u1, 1, u0, 1], u);
    }
  }

  /** Recolours `count` vertices from `start` (used for eye-glow events). */
  static recolor(colors: Float32Array, start: number, count: number, rgb: readonly [number, number, number]): void {
    for (let v = start; v < start + count; v++) colors.set(rgb, v * 3);
  }

  finish(): QuadData {
    const n = this.quads;
    const indices = new Uint16Array(n * 6);
    for (let q = 0; q < n; q++) {
      const v = q * 4;
      indices.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
    }
    return {
      positions: this.pos.slice(0, n * 12),
      normals: this.nrm.slice(0, n * 12),
      colors: this.col.slice(0, n * 12),
      uvs: this.uv.slice(0, n * 8),
      indices,
      quads: n,
    };
  }
}

/** Recolours a vertex range of a colour attribute array in place. */
export const recolorVertices = QuadWriter.recolor;

const N_FRONT = [0, 0, 1] as const;
const N_BACK = [0, 0, -1] as const;
const N_UP = [0, 1, 0] as const;
const N_DOWN = [0, -1, 0] as const;
const N_LEFT = [-1, 0, 0] as const;
const N_RIGHT = [1, 0, 0] as const;

/**
 * Meshes one composed frame. Guarantees (tested): front quads cover exactly the present cells of each stream with no
 * overlap; a side face exists exactly on edges between a present cell and an empty (not scar) cell; quad count never
 * exceeds the naive per-voxel count plus overlays.
 */
export function meshFriend(layers: FriendLayers, opts: MeshOptions): FriendMeshData {
  const s = opts.pixelSize;
  const D = opts.depth * s;
  const { cx, bottom } = opts.anchor;
  const X = (x: number): number => (x - cx) * s;
  const Y = (y: number): number => (bottom - y) * s; // top edge of row y
  const cells = layers.cells;
  const inFrame = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < GRID && y < GRID && cells[y * GRID + x] !== Cell.Empty;
  const solid = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return false;
    const c = cells[y * GRID + x];
    return c === Cell.Body || c === Cell.Gold;
  };
  const convert = opts.convert ?? srgbFloats;
  const main = new QuadWriter(convert);
  const gold = new QuadWriter(convert);

  const streams: readonly [QuadWriter, number, FaceBands][] = [
    [main, Cell.Body, BODY_BANDS],
    [gold, Cell.Gold, GOLD_BANDS],
  ];

  // Halo first (furthest back), so overlays drawn later win ties in painter order on equal depth.
  if (opts.halo) {
    const hz = -D * Math.min(1, Math.max(0, opts.halo.depthFraction));
    const shape = greedyRects((i) => cells[i] !== Cell.Empty);
    const ring = (grow: number, z: number, color: number): void => {
      for (const r of shape) {
        const l = X(r.x) - grow * s;
        const rt = X(r.x + r.w) + grow * s;
        const t = Y(r.y) + grow * s;
        const b = Y(r.y + r.h) - grow * s;
        main.quad(l, b, z, rt - l, 0, 0, 0, t - b, 0, N_FRONT, color, Tile.White);
      }
    };
    if (opts.halo.keyline > 0) ring(opts.halo.width + opts.halo.keyline, hz - Z_KEYLINE * s, FRIEND_COLORS.ink);
    if (opts.halo.width > 0) ring(opts.halo.width, hz, opts.halo.color);
  }

  // Eye back-plates: just in front of the halo plane so they read as paper through the hole.
  const eyeStart = main.quads * 4;
  const eyeZ = opts.halo ? -D * Math.min(1, Math.max(0, opts.halo.depthFraction)) + Z_EYE * s : -D + Z_EYE * s;
  for (const r of greedyRects((i) => layers.eyes[i] === 1)) {
    main.quad(X(r.x), Y(r.y + r.h), eyeZ, r.w * s, 0, 0, 0, r.h * s, 0, N_FRONT, opts.eyeColor, Tile.White);
  }
  const eyeCount = main.quads * 4 - eyeStart;

  for (const [w, kind, bands] of opts.voxels === false ? [] : streams) {
    const mine = (x: number, y: number): boolean => cells[y * GRID + x] === kind;
    // Front and back faces.
    const rects = greedyRects((i) => cells[i] === kind);
    for (const r of rects) {
      const l = X(r.x);
      const rt = X(r.x + r.w);
      const t = Y(r.y);
      const b = Y(r.y + r.h);
      w.quad(l, b, 0, rt - l, 0, 0, 0, t - b, 0, N_FRONT, bands.front, Tile.White);
      if (opts.lod === 0) w.quad(rt, b, -D, l - rt, 0, 0, 0, t - b, 0, N_BACK, bands.back, Tile.White);
    }
    // Side faces: merged runs along each row / column edge, only where the neighbour is outside the frame.
    for (let y = 0; y < GRID; y++) {
      for (const [dy, n] of [
        [-1, N_UP],
        [1, N_DOWN],
      ] as const) {
        let x = 0;
        while (x < GRID) {
          if (!(mine(x, y) && !inFrame(x, y + dy))) {
            x++;
            continue;
          }
          const x0 = x;
          while (x < GRID && mine(x, y) && !inFrame(x, y + dy)) x++;
          const l = X(x0);
          const rt = X(x);
          if (dy < 0) w.quad(l, Y(y), 0, rt - l, 0, 0, 0, 0, -D, n, bands.top, Tile.White);
          else w.quad(l, Y(y + 1), -D, rt - l, 0, 0, 0, 0, D, n, bands.bottom, Tile.White);
        }
      }
    }
    for (let x = 0; x < GRID; x++) {
      for (const [dx, n] of [
        [-1, N_LEFT],
        [1, N_RIGHT],
      ] as const) {
        let y = 0;
        while (y < GRID) {
          if (!(mine(x, y) && !inFrame(x + dx, y))) {
            y++;
            continue;
          }
          const y0 = y;
          while (y < GRID && mine(x, y) && !inFrame(x + dx, y)) y++;
          const t = Y(y0);
          const b = Y(y);
          if (dx < 0) w.quad(X(x), b, -D, 0, 0, D, 0, t - b, 0, n, bands.left, Tile.White);
          else w.quad(X(x + 1), b, 0, 0, 0, -D, 0, t - b, 0, n, bands.right, Tile.White);
        }
      }
    }
    if (opts.lod !== 0) continue;
    // Bevel: a light strip on the top edge of every exposed-top voxel, half strength on exposed-left edges.
    for (let y = 0; y < GRID; y++) {
      let x = 0;
      while (x < GRID) {
        if (!(mine(x, y) && !solid(x, y - 1))) {
          x++;
          continue;
        }
        const x0 = x;
        while (x < GRID && mine(x, y) && !solid(x, y - 1)) x++;
        const t = Y(y);
        const h = BEVEL_TOP * s;
        w.quad(X(x0), t - h, Z_BEVEL_TOP * s, X(x) - X(x0), 0, 0, 0, h, 0, N_FRONT, bands.bevelTop, Tile.White);
      }
    }
    for (let x = 0; x < GRID; x++) {
      let y = 0;
      while (y < GRID) {
        if (!(mine(x, y) && !solid(x - 1, y))) {
          y++;
          continue;
        }
        const y0 = y;
        while (y < GRID && mine(x, y) && !solid(x - 1, y)) y++;
        const b = Y(y);
        w.quad(X(x), b, Z_BEVEL_LEFT * s, BEVEL_LEFT * s, 0, 0, 0, Y(y0) - b, 0, N_FRONT, bands.bevelLeft, Tile.White);
      }
    }
  }

  // Per-pixel decals: scar plates flush with the front plane, stitches and glow cracks just in front of it.
  const crackTile = layers.crack === 0 ? -1 : Tile.Crack1 + layers.crack - 1;
  for (let i = 0; i < CELLS; i++) {
    const c = cells[i];
    if (c === Cell.Empty) continue;
    const x = i % GRID;
    const y = i >> 4;
    const l = X(x);
    const b = Y(y + 1);
    if (layers.loose?.[i]) {
      main.quad(l, b, 0, s, 0, 0, 0, s, 0, N_FRONT, 0xffffff, Tile.Fresh);
      continue;
    }
    if (c === Cell.Scar) {
      main.quad(l, b, 0, s, 0, 0, 0, s, 0, N_FRONT, 0xffffff, Tile.Scar);
      continue;
    }
    const w = c === Cell.Gold ? gold : main;
    if (layers.stitch[i]) w.quad(l, b, Z_DECAL * s, s, 0, 0, 0, s, 0, N_FRONT, 0xffffff, Tile.Stitch);
    if (c === Cell.Gold && crackTile >= 0) w.quad(l, b, Z_DECAL * s, s, 0, 0, 0, s, 0, N_FRONT, 0xffffff, crackTile);
  }

  const grow = opts.halo ? opts.halo.width + opts.halo.keyline : 0;
  return {
    main: main.finish(),
    gold: gold.quads > 0 ? gold.finish() : null,
    eyes: [eyeStart, eyeCount],
    bounds: [X(0) - grow * s, Y(GRID) - grow * s, -D - Z_KEYLINE * s, X(GRID) + grow * s, Y(0) + grow * s, Z_DECAL * s],
  };
}

/** Triangles in a mesher output. */
export function triangleCount(m: FriendMeshData): number {
  return (m.main.quads + (m.gold?.quads ?? 0)) * 2;
}
