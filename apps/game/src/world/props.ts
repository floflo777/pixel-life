import { Euler, Vector3 } from "three";
import type { GlowTint } from "../post/tags";
import { PALETTE } from "../stage/palette";
import { hash3 } from "./noise";
import { DECOR, SOFT, TERRAIN, type VoxelMesher, type VoxelStyle } from "./voxel-mesher";

/** Quarter turns about +Y (0 = facing +Z, toward the default camera). */
export type Facing = 0 | 1 | 2 | 3;

interface Placed {
  /** Local position on the island top (y = 0 is the walking surface), world units. */
  readonly x: number;
  readonly z: number;
  readonly facing?: Facing;
}

/** Tree canopy colours (one per island side, art bible §4). */
export type CanopyColor = "paper" | "meadow" | "sun";

/** Every prop the kit can build. */
export type PropSpec =
  | (Placed & {
      readonly kind: "tree";
      readonly canopy: CanopyColor;
      readonly trunk?: number;
      readonly radius?: number;
      readonly seed?: number;
    })
  | (Placed & { readonly kind: "lamp" })
  | (Placed & { readonly kind: "bench" })
  | (Placed & { readonly kind: "rock"; readonly radius?: number; readonly seed?: number })
  | (Placed & {
      readonly kind: "venue";
      readonly name: string;
      /** 16 rows of '#'/'.' for the extruded 16×16 sign icon. */
      readonly icon?: readonly string[];
      /** [row, col] of the icon pixel that pops out (the lime glow). */
      readonly popPixel?: readonly [number, number];
      readonly roof?: number;
      readonly roofDark?: number;
    })
  | (Placed & { readonly kind: "board"; readonly name: string })
  | (Placed & { readonly kind: "kiosk"; readonly name: string })
  | (Placed & { readonly kind: "signpost"; readonly name: string; readonly color?: number })
  | (Placed & { readonly kind: "door"; readonly name: string })
  | (Placed & { readonly kind: "bridge"; readonly planks: number });

/** A named point on a prop (island-local), e.g. where a DOM marquee or door pill goes. */
export interface PropAnchor {
  readonly name: string;
  readonly prop: PropSpec["kind"];
  readonly position: Vector3;
}

/** Where a prop writes its voxels. */
export interface PropContext {
  readonly mesher: VoxelMesher;
  readonly glow: (tint: GlowTint) => VoxelMesher;
  readonly cell: number;
}

/** What building a prop yields besides voxels. */
export interface PropOutput {
  readonly anchors: PropAnchor[];
  /** Blocking area on the ground (island-local), or null for walkable props (bridges). */
  readonly footprint: Footprint | null;
}

/** A blocking circle or axis-aligned rectangle on the island top (island-local units). */
export type Footprint =
  | { readonly x: number; readonly z: number; readonly r: number }
  | { readonly x: number; readonly z: number; readonly hx: number; readonly hz: number };

/** True if (x, z) lies inside the footprint grown by `pad`. */
export function inFootprint(f: Footprint, x: number, z: number, pad = 0): boolean {
  if ("r" in f) return Math.hypot(x - f.x, z - f.z) < f.r + pad;
  return Math.abs(x - f.x) < f.hx + pad && Math.abs(z - f.z) < f.hz + pad;
}

interface Built {
  readonly anchors: PropAnchor[];
  /** Blocking radius around the prop origin, [halfX, halfZ] in prop-local axes, or null when walkable. */
  readonly radius: number | readonly [number, number] | null;
}

/** Writes voxels in a prop's local frame (rotated by quarter turns, translated to x/z). */
class Local {
  constructor(
    private readonly ctx: PropContext,
    private readonly x: number,
    private readonly z: number,
    private readonly q: Facing,
  ) {}

  /** Island-local position of a prop-local offset. */
  at(lx: number, ly: number, lz: number): Vector3 {
    const [rx, rz] = this.rot(lx, lz);
    return new Vector3(this.x + rx, ly, this.z + rz);
  }

  private rot(lx: number, lz: number): [number, number] {
    switch (this.q) {
      case 1:
        return [lz, -lx];
      case 2:
        return [-lx, -lz];
      case 3:
        return [-lz, lx];
      default:
        return [lx, lz];
    }
  }

  box(
    l: readonly [number, number, number],
    s: readonly [number, number, number],
    color: number,
    style: VoxelStyle = TERRAIN,
    opts: { rotation?: Euler; glow?: GlowTint } = {},
  ): void {
    const p = this.at(l[0], l[1], l[2]);
    const size: [number, number, number] = this.q % 2 === 1 ? [s[2], s[1], s[0]] : [s[0], s[1], s[2]];
    const target = opts.glow ? this.ctx.glow(opts.glow) : this.ctx.mesher;
    const o: { rotation?: Euler } = {};
    if (opts.rotation)
      o.rotation = new Euler(opts.rotation.x, opts.rotation.y + (this.q * Math.PI) / 2, opts.rotation.z);
    target.box([p.x, p.y, p.z], size, color, style, o);
  }

  /** A culled lattice in local space; (i, j, k) are local cell indices (x, y, z). */
  grid(
    cell: number,
    origin: readonly [number, number, number],
  ): (i: number, j: number, k: number, c: number, s?: VoxelStyle) => void {
    const o = this.at(origin[0], origin[1], origin[2]);
    const g = this.ctx.mesher.grid(cell, [o.x, o.y, o.z]);
    return (i, j, k, c, s = TERRAIN) => {
      const [ri, rk] = this.rot(i, k);
      g.set(Math.round(ri), j, Math.round(rk), c, s);
    };
  }
}

const CANOPY: Readonly<Record<CanopyColor, number>> = {
  paper: PALETTE.treePaper,
  meadow: PALETTE.meadowDrip,
  sun: PALETTE.sun,
};

/** A generic 16×16 sign glyph (a play triangle) used when a venue passes no icon. */
export const DEFAULT_ICON: readonly string[] = [
  "................",
  "................",
  "...##...........",
  "...####.........",
  "...######.......",
  "...########.....",
  "...##########...",
  "...###########..",
  "...###########..",
  "...##########...",
  "...########.....",
  "...######.......",
  "...####.........",
  "...##...........",
  "................",
  "................",
];

function tree(p: Extract<PropSpec, { kind: "tree" }>, L: Local, cell: number): Built {
  const h = p.trunk ?? 5;
  const r = p.radius ?? 0.75;
  const seed = p.seed ?? 1;
  L.box([0, (h * cell) / 2, 0], [cell * 0.7, h * cell, cell * 0.7], PALETTE.trunk);
  const c = cell * 0.6;
  const cy = h * cell + r * 0.5;
  const set = L.grid(c, [0, cy, 0]);
  const n = Math.ceil(r / c);
  const col = CANOPY[p.canopy];
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++)
      for (let k = -n; k <= n; k++) {
        const d = Math.hypot(i * c, (j * c) / 0.9, k * c) / r + (hash3(i, j, k + seed) - 0.5) * 0.18;
        if (d >= 1) continue;
        const speck = ((i + j + k) & 1) === 1 && hash3(i, k, j + seed) > 0.7;
        set(i, j, k, speck ? 0xf7f4ea : col, SOFT);
      }
  return { anchors: [], radius: 0.3 };
}

function lamp(L: Local): Built {
  L.box([0, 0.42, 0], [0.08, 0.84, 0.08], PALETTE.ink);
  L.box([0, 0.92, 0], [0.18, 0.18, 0.18], PALETTE.lampBulb, SOFT, { glow: "lamp" });
  return { anchors: [{ name: "lamp", prop: "lamp", position: L.at(0, 1.05, 0) }], radius: 0.15 };
}

function bench(L: Local): Built {
  for (let i = -3; i <= 3; i++) {
    L.box([i * 0.12, 0.25, 0], [0.12, 0.06, 0.3], PALETTE.coral);
    L.box([i * 0.12, 0.45, -0.14], [0.12, 0.3, 0.05], PALETTE.coral);
  }
  for (const i of [-3, 3]) L.box([i * 0.12, 0.11, 0], [0.08, 0.22, 0.26], PALETTE.ink);
  return { anchors: [], radius: 0.45 };
}

function rock(p: Extract<PropSpec, { kind: "rock" }>, L: Local): Built {
  const r = p.radius ?? 0.3;
  const c = 0.12;
  const set = L.grid(c, [0, c / 2, 0]);
  const n = Math.ceil(r / c);
  for (let i = -n; i <= n; i++)
    for (let j = 0; j <= n; j++)
      for (let k = -n; k <= n; k++)
        if (Math.hypot(i, j * 1.3, k) * c < r * (0.85 + hash3(i, j, k + (p.seed ?? 4)) * 0.3))
          set(i, j, k, PALETTE.stone);
  return { anchors: [], radius: r };
}

function venue(p: Extract<PropSpec, { kind: "venue" }>, L: Local): Built {
  const vc = 0.2;
  const wW = 19;
  const wD = 8;
  const wH = 12;
  const roof = p.roof ?? PALETTE.coral;
  const roofDark = p.roofDark ?? PALETTE.coralDark;
  const set = L.grid(vc, [-((wW - 1) / 2) * vc, vc / 2, -((wD - 1) / 2) * vc]);
  for (let i = 0; i < wW; i++)
    for (let k = 0; k < wH; k++)
      for (let j = 0; j < wD; j++) {
        const edge = i === 0 || i === wW - 1 || j === 0 || j === wD - 1;
        if (!edge) continue;
        const front = j === wD - 1;
        if (front && Math.abs(i - (wW - 1) / 2) <= 2.5 && k < 7) continue;
        let c: number = PALETTE.paper;
        if (k === 0) c = PALETTE.ink;
        if (k === wH - 1) c = roof;
        if ((i === 0 || i === wW - 1) && front) c = roofDark;
        if (front && Math.abs(i - (wW - 1) / 2) === 3.5 && k < 8) c = PALETTE.ink;
        set(i, k, j, c);
      }
  for (let l = 0; l < 3; l++)
    for (let i = -1 + l; i <= wW - l; i++)
      for (let j = -1 + l; j <= wD - l; j++) set(i, wH + l, j, l === 2 ? roofDark : roof);
  // Dark doorway interior: the door reads as an opening from across the plaza.
  L.box([0, 3.5 * vc, (wD / 2 - 1.6) * vc], [6 * vc, 7 * vc, vc], PALETTE.doorway);
  // Sign board with the extruded 16×16 icon.
  const signY = (wH + 3) * vc;
  const s = 0.13;
  L.box([0, signY + 1.0, -0.02], [2.5, 2.1, 0.12], PALETTE.paper);
  const icon = p.icon ?? DEFAULT_ICON;
  let minR = 16;
  let maxR = -1;
  let minC = 16;
  let maxC = -1;
  icon.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch !== "#") return;
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minC = Math.min(minC, c);
      maxC = Math.max(maxC, c);
    }),
  );
  const cx = (minC + maxC) / 2;
  const iconBase = signY + 1.0 - ((maxR - minR + 1) * s) / 2;
  const iconSet = L.grid(s, [-cx * s, iconBase + s / 2, 0.06 + (1.4 * s) / 2]);
  icon.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch !== "#") return;
      if (p.popPixel && p.popPixel[0] === r && p.popPixel[1] === c) return;
      iconSet(c, maxR - r, 0, PALETTE.body);
    }),
  );
  if (p.popPixel) {
    const [r, c] = p.popPixel;
    L.box([(c - cx) * s + 0.2, iconBase + (maxR - r) * s + 0.35, 0.45], [s, s, 0.18], PALETTE.body, TERRAIN, {
      rotation: new Euler(0.4, 0.6, 0.3),
      glow: "signal",
    });
  }
  // The lime doormat: the only lime floor in the world ("walk here to enter").
  L.box([0, 0.015, (wD / 2) * vc + 0.35], [1.0, 0.03, 0.45], PALETTE.signal, DECOR);
  const front = (wD / 2) * vc;
  return {
    anchors: [
      { name: `${p.name}:door`, prop: "venue", position: L.at(0, 0, front + 0.35) },
      { name: `${p.name}:pill`, prop: "venue", position: L.at(0, 7 * vc + 0.25, front + 0.1) },
      { name: `${p.name}:marquee`, prop: "venue", position: L.at(0, signY + 2.2, 0) },
    ],
    radius: [(wW * vc) / 2 + 0.1, (wD * vc) / 2 + 0.1],
  };
}

function board(p: Extract<PropSpec, { kind: "board" }>, L: Local): Built {
  const vc = 0.2;
  for (let i = 0; i < 9; i++)
    for (let k = 0; k < 6; k++) {
      const frame = k === 0 || k === 5 || i === 0 || i === 8;
      L.box([(i - 4) * vc, (k + 3) * vc, 0], [vc, vc, 0.08], frame ? PALETTE.ink : PALETTE.paper);
    }
  for (const i of [-4, 4]) L.box([i * vc, 1.5 * vc, 0], [vc, 3 * vc, vc], PALETTE.ink);
  const bars: readonly [number, number][] = [
    [5, PALETTE.sun],
    [4, PALETTE.lilac],
    [3, PALETTE.coral],
  ];
  bars.forEach(([len, c], r) => {
    for (let i = 0; i < len; i++)
      L.box([(i - 3) * vc, (4.1 + (2 - r) * 0.9) * vc + 0.02, 0.06], [vc * 0.8, vc * 0.5, 0.04], c);
  });
  return {
    anchors: [{ name: `${p.name}:label`, prop: "board", position: L.at(0, 9 * vc, 0) }],
    radius: 0.9,
  };
}

function kiosk(p: Extract<PropSpec, { kind: "kiosk" }>, L: Local): Built {
  const vc = 0.2;
  // Lattice origin = cell (0, 0, 0) centre; the booth is 5×4 cells centred on the prop.
  const set = L.grid(vc, [-2 * vc, vc / 2, -1.5 * vc]);
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++) {
        if (i > 0 && i < 4 && j > 0 && j < 3 && k < 3) continue;
        set(i, k, j, k === 3 ? PALETTE.sun : k === 0 ? PALETTE.ink : PALETTE.paper);
      }
  for (let i = -1; i < 6; i++) for (let j = -1; j < 5; j++) set(i, 6, j, (i + j) & 1 ? PALETTE.sun : PALETTE.paper);
  for (const [i, j] of [
    [-1, -1],
    [5, -1],
    [-1, 4],
    [5, 4],
  ] as const)
    for (let k = 4; k < 6; k++) set(i, k, j, PALETTE.ink);
  L.box([0, 2.0, 0], [0.26, 0.26, 0.26], PALETTE.gold, SOFT, { glow: "gold" });
  return {
    anchors: [{ name: `${p.name}:label`, prop: "kiosk", position: L.at(0, 2.4, 0) }],
    radius: 0.75,
  };
}

function signpost(p: Extract<PropSpec, { kind: "signpost" }>, L: Local): Built {
  L.box([0, 0.45, 0], [0.08, 0.9, 0.08], PALETTE.ink);
  L.box([0, 1.0, 0.05], [0.9, 0.42, 0.08], PALETTE.ink);
  L.box([0, 1.0, 0.1], [0.8, 0.32, 0.04], PALETTE.paper);
  L.box([-0.28, 1.0, 0.13], [0.16, 0.16, 0.03], p.color ?? PALETTE.coral);
  return {
    anchors: [{ name: `${p.name}:label`, prop: "signpost", position: L.at(0, 1.3, 0.1) }],
    radius: 0.2,
  };
}

function door(p: Extract<PropSpec, { kind: "door" }>, L: Local): Built {
  const vc = 0.2;
  for (let k = 0; k < 7; k++)
    for (const i of [-2, 2]) L.box([i * vc, k * vc + vc / 2, 0], [vc, vc, vc], k === 0 ? PALETTE.ink : PALETTE.paper);
  for (let i = -2; i <= 2; i++) L.box([i * vc, 7 * vc + vc / 2, 0], [vc, vc, vc], PALETTE.coral);
  L.box([0, 3.5 * vc, -0.02], [3 * vc, 7 * vc, 0.06], PALETTE.doorway);
  L.box([0, 0.015, 0.4], [0.8, 0.03, 0.4], PALETTE.signal, DECOR);
  return {
    anchors: [
      { name: `${p.name}:door`, prop: "door", position: L.at(0, 0, 0.4) },
      { name: `${p.name}:pill`, prop: "door", position: L.at(0, 8 * vc + 0.2, 0) },
    ],
    radius: 0.35,
  };
}

function bridge(p: Extract<PropSpec, { kind: "bridge" }>, L: Local): Built {
  const n = Math.max(2, p.planks);
  const sag = (i: number): number => Math.sin((i / (n - 1)) * Math.PI) * 0.18;
  for (let i = 0; i < n; i++)
    L.box([i * 0.24, -0.1 - sag(i), 0], [0.22, 0.08, 0.7], i % 2 ? PALETTE.coral : PALETTE.coralDark);
  for (let i = 0; i < n; i += 3)
    for (const dz of [-0.36, 0.36]) L.box([i * 0.24, 0.12 - sag(i), dz], [0.06, 0.4, 0.06], PALETTE.ink);
  return {
    anchors: [{ name: "bridge:end", prop: "bridge", position: L.at((n - 1) * 0.24, 0, 0) }],
    radius: null,
  };
}

/** Builds one prop into the context's meshers (static voxels + glow voxels). */
export function buildProp(p: PropSpec, ctx: PropContext): PropOutput {
  const L = new Local(ctx, p.x, p.z, p.facing ?? 0);
  const out = ((): Built => {
    switch (p.kind) {
      case "tree":
        return tree(p, L, ctx.cell);
      case "lamp":
        return lamp(L);
      case "bench":
        return bench(L);
      case "rock":
        return rock(p, L);
      case "venue":
        return venue(p, L);
      case "board":
        return board(p, L);
      case "kiosk":
        return kiosk(p, L);
      case "signpost":
        return signpost(p, L);
      case "door":
        return door(p, L);
      case "bridge":
        return bridge(p, L);
    }
  })();
  const r = out.radius;
  if (r === null) return { anchors: out.anchors, footprint: null };
  if (typeof r === "number") return { anchors: out.anchors, footprint: { x: p.x, z: p.z, r } };
  const odd = (p.facing ?? 0) % 2 === 1;
  return { anchors: out.anchors, footprint: { x: p.x, z: p.z, hx: odd ? r[1] : r[0], hz: odd ? r[0] : r[1] } };
}
