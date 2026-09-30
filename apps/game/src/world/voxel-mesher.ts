import type { Euler } from "three";
import { BufferAttribute, BufferGeometry, Quaternion, Vector3 } from "three";
import { hexToRgb } from "../stage/palette";

/** Per-voxel surface style carried into the band material's `aBand` attribute. */
export interface VoxelStyle {
  /** Bayer dither amplitude (0.12 terrain, 0.22 soft canopies/clouds). */
  readonly dither?: number;
  /** Light-band mix (only bevels/gold reach the light band). */
  readonly lightMix?: number;
  /** Blocks sunlight in the shadow bake. */
  readonly caster?: boolean;
  /** Receives baked shadow on its sun-facing faces. */
  readonly receiver?: boolean;
}

/** Style of hard terrain. */
export const TERRAIN: VoxelStyle = { dither: 0.12, lightMix: 0.34, caster: true, receiver: true };
/** Terrain below the top layer: can't shadow the play surface, so it isn't a caster (bake speed). */
export const STRATA: VoxelStyle = { dither: 0.12, lightMix: 0.34, caster: false, receiver: false };
/** Soft materials: canopies, clouds, flowers (bible: ditherAmp 0.22, lightMix 0.5). */
export const SOFT: VoxelStyle = { dither: 0.22, lightMix: 0.5, caster: true, receiver: true };
/** Small decoration that neither casts nor receives. */
export const DECOR: VoxelStyle = { dither: 0.22, lightMix: 0.5, caster: false, receiver: false };

interface Cell {
  readonly color: number;
  readonly style: VoxelStyle;
}

const FACES: readonly { n: [number, number, number]; c: [number, number, number][] }[] = [
  {
    n: [1, 0, 0],
    c: [
      [1, -1, 1],
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
    ],
  },
  {
    n: [-1, 0, 0],
    c: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
    ],
  },
  {
    n: [0, 1, 0],
    c: [
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
      [-1, 1, -1],
    ],
  },
  {
    n: [0, -1, 0],
    c: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ],
  },
  {
    n: [0, 0, 1],
    c: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  },
  {
    n: [0, 0, -1],
    c: [
      [1, -1, -1],
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
    ],
  },
];

/** In-plane overlap of greedy quads, in cells. */
const SEAM = 0.004;

const key = (i: number, j: number, k: number): number => ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024);

/** A regular voxel lattice: cells share faces, so hidden faces between neighbours are culled. */
export class VoxelGrid {
  readonly cells = new Map<number, Cell & { i: number; j: number; k: number }>();
  constructor(
    readonly cell: number,
    readonly origin: readonly [number, number, number] = [0, 0, 0],
  ) {}

  /** Places (or replaces) the voxel whose centre is origin + (i, j, k) × cell. */
  set(i: number, j: number, k: number, color: number, style: VoxelStyle = TERRAIN): void {
    this.cells.set(key(i, j, k), { i, j, k, color, style });
  }

  /** True if a voxel occupies (i, j, k). */
  has(i: number, j: number, k: number): boolean {
    return this.cells.has(key(i, j, k));
  }

  /** Number of voxels. */
  get size(): number {
    return this.cells.size;
  }
}

interface FreeBox {
  readonly center: Vector3;
  readonly size: Vector3;
  readonly rotation: Quaternion | null;
  readonly color: number;
  readonly style: VoxelStyle;
  readonly skipBottom: boolean;
}

/** Options for the static shadow bake. */
export interface BakeOptions {
  /** Direction toward the sun (normalised). */
  readonly sun: Vector3;
  /** Occupancy resolution in world units (default 0.12 = one sprite pixel pair). */
  readonly resolution?: number;
  /** Longest shadow ray (world units). */
  readonly maxDistance?: number;
}

/** Output of VoxelMesher.build. */
export interface MeshedVoxels {
  readonly geometry: BufferGeometry;
  readonly triangles: number;
  /** Faces that ended up in baked shadow (for tests/debug). */
  readonly shadowedFaces: number;
}

/**
 * Collects voxels on one or more lattices plus free boxes and merges them into one indexed
 * BufferGeometry (position, normal, color, aBand) for a single draw call. Lattice faces hidden by a
 * neighbour are dropped. Optionally bakes hard sun shadows per face (architecture §3: no shadow maps).
 */
export class VoxelMesher {
  private readonly grids: VoxelGrid[] = [];
  private readonly boxes: FreeBox[] = [];

  /** Creates a lattice owned by this mesher. */
  grid(cell: number, origin: readonly [number, number, number] = [0, 0, 0]): VoxelGrid {
    const g = new VoxelGrid(cell, origin);
    this.grids.push(g);
    return g;
  }

  /** Adds a free (unculled) box, optionally rotated about its centre. */
  box(
    center: readonly [number, number, number],
    size: readonly [number, number, number],
    color: number,
    style: VoxelStyle = TERRAIN,
    opts: { rotation?: Euler; skipBottom?: boolean } = {},
  ): void {
    this.boxes.push({
      center: new Vector3(...center),
      size: new Vector3(...size),
      rotation: opts.rotation ? new Quaternion().setFromEuler(opts.rotation) : null,
      color,
      style,
      skipBottom: opts.skipBottom ?? false,
    });
  }

  /** True when nothing has been added. */
  get empty(): boolean {
    return this.boxes.length === 0 && this.grids.every((g) => g.size === 0);
  }

  /** Merges everything into one geometry. */
  build(bake?: BakeOptions): MeshedVoxels {
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const band: number[] = [];
    const idx: number[] = [];
    const occ = bake ? this.occupancy(bake.resolution ?? 0.12) : null;
    let shadowed = 0;
    const tmp = new Vector3();
    const n = new Vector3();

    const bakeShade = (corners: readonly Vector3[], normal: Vector3, style: VoxelStyle): number => {
      if (!occ || !bake || style.receiver === false || normal.dot(bake.sun) <= 0.05) return 0;
      const c = tmp.set(0, 0, 0);
      for (const p of corners) c.add(p);
      c.multiplyScalar(1 / corners.length);
      if (!occ.shadowed(c, normal, bake.sun, bake.maxDistance ?? 8)) return 0;
      shadowed++;
      return 1;
    };
    const push = (
      corners: readonly Vector3[],
      normal: Vector3,
      color: number,
      shade: number,
      style: VoxelStyle,
    ): void => {
      const base = pos.length / 3;
      const [r, g, b] = hexToRgb(color);
      for (const p of corners) {
        pos.push(p.x, p.y, p.z);
        nrm.push(normal.x, normal.y, normal.z);
        col.push(r, g, b);
        band.push(shade, style.dither ?? 0.12, style.lightMix ?? 0.34);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const emit = (corners: Vector3[], normal: Vector3, color: number, style: VoxelStyle): void =>
      push(corners, normal, color, bakeShade(corners, normal, style), style);

    for (const g of this.grids) this.greedy(g, bakeShade, push);
    for (const b of this.boxes) {
      for (const f of FACES) {
        if (b.skipBottom && f.n[1] === -1) continue;
        const corners = f.c.map(([x, y, z]) => {
          const p = new Vector3((x * b.size.x) / 2, (y * b.size.y) / 2, (z * b.size.z) / 2);
          if (b.rotation) p.applyQuaternion(b.rotation);
          return p.add(b.center);
        });
        const normal = n.set(...f.n);
        if (b.rotation) normal.applyQuaternion(b.rotation);
        const [c0, c1, , c3] = corners as [Vector3, Vector3, Vector3, Vector3];
        const tile = bake?.resolution ?? 0.12;
        const lu = c0.distanceTo(c1);
        const lv = c0.distanceTo(c3);
        const split =
          occ !== null &&
          bake !== undefined &&
          b.style.receiver !== false &&
          normal.dot(bake.sun) > 0.05 &&
          Math.max(lu, lv) > 0.3;
        const nu = split ? Math.max(1, Math.ceil(lu / tile - 0.01)) : 1;
        const nv = split ? Math.max(1, Math.ceil(lv / tile - 0.01)) : 1;
        if (nu === 1 && nv === 1) {
          emit(corners, normal.clone(), b.color, b.style);
          continue;
        }
        // Large receiver faces are split into bake-resolution tiles so shadows keep a hard pixel edge.
        const u = new Vector3().subVectors(c1, c0);
        const v = new Vector3().subVectors(c3, c0);
        const at = (a: number, c: number): Vector3 =>
          c0
            .clone()
            .addScaledVector(u, a / nu)
            .addScaledVector(v, c / nv);
        for (let a = 0; a < nu; a++)
          for (let c = 0; c < nv; c++)
            emit([at(a, c), at(a + 1, c), at(a + 1, c + 1), at(a, c + 1)], normal.clone(), b.color, b.style);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    geometry.setAttribute("aBand", new BufferAttribute(new Float32Array(band), 3));
    const vertexCount = pos.length / 3;
    geometry.setIndex(new BufferAttribute(vertexCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, triangles: idx.length / 3, shadowedFaces: shadowed };
  }

  /**
   * Greedy-meshes one lattice: visible faces are baked individually, then coplanar faces with the
   * same colour and band values merge into rectangles (per-face shadows stay exact).
   */
  private greedy(
    g: VoxelGrid,
    bakeShade: (corners: readonly Vector3[], normal: Vector3, style: VoxelStyle) => number,
    push: (corners: readonly Vector3[], normal: Vector3, color: number, shade: number, style: VoxelStyle) => void,
  ): void {
    const h = g.cell / 2;
    const normal = new Vector3();
    FACES.forEach((f, fi) => {
      const axis = f.n[0] !== 0 ? 0 : f.n[1] !== 0 ? 1 : 2;
      const ua = axis === 0 ? 1 : 0;
      const va = axis === 2 ? 1 : 2;
      normal.set(...f.n);
      // slice → (u, v) → face
      const slices = new Map<
        number,
        Map<number, { u: number; v: number; key: string; color: number; shade: number; style: VoxelStyle }>
      >();
      for (const c of g.cells.values()) {
        if (g.has(c.i + f.n[0], c.j + f.n[1], c.k + f.n[2])) continue;
        const idx3 = [c.i, c.j, c.k] as const;
        const cx = g.origin[0] + c.i * g.cell;
        const cy = g.origin[1] + c.j * g.cell;
        const cz = g.origin[2] + c.k * g.cell;
        const corners = f.c.map(([x, y, z]) => new Vector3(cx + x * h, cy + y * h, cz + z * h));
        const shade = bakeShade(corners, normal, c.style);
        const style = c.style;
        const key = `${c.color}|${shade}|${style.dither ?? 0.12}|${style.lightMix ?? 0.34}`;
        const slice = idx3[axis];
        let m = slices.get(slice);
        if (!m) slices.set(slice, (m = new Map()));
        const u = idx3[ua];
        const v = idx3[va];
        m.set(u * 4096 + v, { u, v, key, color: c.color, shade, style });
      }
      for (const [slice, m] of slices) {
        const cellsSorted = [...m.values()].sort((a, b) => a.v - b.v || a.u - b.u);
        const done = new Set<number>();
        for (const start of cellsSorted) {
          const k0 = start.u * 4096 + start.v;
          if (done.has(k0)) continue;
          const same = (u: number, v: number): boolean => {
            const k = u * 4096 + v;
            return !done.has(k) && m.get(k)?.key === start.key;
          };
          let u1 = start.u;
          while (same(u1 + 1, start.v)) u1++;
          let v1 = start.v;
          for (;;) {
            let row = true;
            for (let u = start.u; u <= u1 && row; u++) row = same(u, v1 + 1);
            if (!row) break;
            v1++;
          }
          for (let v = start.v; v <= v1; v++) for (let u = start.u; u <= u1; u++) done.add(u * 4096 + v);
          const corners = FACES[fi]?.c.map((c) => {
            const idx = [0, 0, 0];
            idx[axis] = slice + c[axis] * 0.5;
            // A hair of in-plane overlap seals T-junction cracks between merged quads of different sizes.
            idx[ua] = c[ua] < 0 ? start.u - 0.5 - SEAM : u1 + 0.5 + SEAM;
            idx[va] = c[va] < 0 ? start.v - 0.5 - SEAM : v1 + 0.5 + SEAM;
            return new Vector3(
              g.origin[0] + (idx[0] ?? 0) * g.cell,
              g.origin[1] + (idx[1] ?? 0) * g.cell,
              g.origin[2] + (idx[2] ?? 0) * g.cell,
            );
          });
          if (corners) push(corners, normal, start.color, start.shade, start.style);
        }
      }
    });
  }

  private occupancy(res: number): Occupancy {
    const occ = new Occupancy(res);
    for (const g of this.grids) {
      const h = g.cell / 2;
      for (const v of g.cells.values()) {
        if (v.style.caster === false) continue;
        const cx = g.origin[0] + v.i * g.cell;
        const cy = g.origin[1] + v.j * g.cell;
        const cz = g.origin[2] + v.k * g.cell;
        occ.fill(cx - h, cy - h, cz - h, cx + h, cy + h, cz + h);
      }
    }
    for (const b of this.boxes) {
      if (b.style.caster === false) continue;
      // Rotated boxes are small props: their axis-aligned bounds are close enough for a hard shadow.
      const e = b.rotation ? Math.max(b.size.x, b.size.y, b.size.z) / 2 : 0;
      const hx = e || b.size.x / 2;
      const hy = e || b.size.y / 2;
      const hz = e || b.size.z / 2;
      occ.fill(b.center.x - hx, b.center.y - hy, b.center.z - hz, b.center.x + hx, b.center.y + hy, b.center.z + hz);
    }
    return occ;
  }
}

/** Sparse occupancy lattice used only by the shadow bake. */
export class Occupancy {
  private readonly set = new Set<number>();
  private maxY = Number.NEGATIVE_INFINITY;
  constructor(readonly res: number) {}

  /** Marks every cell whose centre lies inside the AABB. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const r = this.res;
    const a = (v: number): number => Math.ceil(v / r - 0.5);
    const b = (v: number): number => Math.floor(v / r - 0.5);
    for (let i = a(x0); i <= b(x1); i++)
      for (let j = a(y0); j <= b(y1); j++) for (let k = a(z0); k <= b(z1); k++) this.set.add(key(i, j, k));
    if (y1 > this.maxY) this.maxY = y1;
  }

  /** True if the cell containing p is occupied. */
  at(p: Vector3): boolean {
    const r = this.res;
    return this.set.has(key(Math.floor(p.x / r), Math.floor(p.y / r), Math.floor(p.z / r)));
  }

  /** Marches from a face centre toward the sun; true if anything blocks it within maxDistance. */
  shadowed(center: Vector3, normal: Vector3, sun: Vector3, maxDistance: number): boolean {
    const step = this.res * 0.5;
    const p = new Vector3()
      .copy(center)
      .addScaledVector(normal, this.res * 0.5)
      .addScaledVector(sun, this.res);
    for (let t = 0; t < maxDistance; t += step) {
      if (p.y > this.maxY) return false;
      if (this.at(p)) return true;
      p.addScaledVector(sun, step);
    }
    return false;
  }
}
