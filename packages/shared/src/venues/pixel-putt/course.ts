/**
 * Pixel Putt courses: a library of hand-made hole templates (three tiers) and the seeded course generator. A course is
 * pure data (pads, rails, obstacles) built once per seed; the sim and the renderer both read it, so what you see is what
 * you collide with. Geometry is snapped to the `PUTT.cell` lattice: pads are rasterised into surface cells and rails are
 * the merged cell edges between a surface cell and the void (except where a hole marks an opening over a gap).
 */
import { Rng } from "../../sim/rng.js";
import { PUTT } from "./tuning.js";

/** A point on the ground plane (x right, z toward the camera). */
export interface PuttPoint {
  readonly x: number;
  readonly z: number;
}

/** An axis-aligned rectangle, `x0 < x1`, `z0 < z1`. */
export interface PuttRect {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** Back-and-forth motion: offset = (dx, dz) · wave(t), wave an eased triangle in [−1, 1] of `period` ticks. */
export interface PuttMotion {
  readonly dx: number;
  readonly dz: number;
  readonly period: number;
  readonly phase: number;
}

/** A static pad of the course surface. */
export type PuttPad =
  | ({ readonly kind: "rect" } & PuttRect)
  | { readonly kind: "disc"; readonly x: number; readonly z: number; readonly r: number };

/** A moving platform (always a rectangle at its centre position). */
export interface PuttMover extends PuttRect {
  readonly move: PuttMotion;
}

/** A round pinball bumper (kicks the ball back). */
export interface PuttBumper {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

/** A windmill: `blades` arms of length `len` spinning `speed` angle steps (of 4096) per tick. */
export interface PuttWindmill {
  readonly x: number;
  readonly z: number;
  readonly len: number;
  readonly blades: number;
  readonly speed: number;
  readonly phase: number;
}

/** A slope zone: constant acceleration (u/s²) while rolling inside it. */
export interface PuttSlope extends PuttRect {
  readonly ax: number;
  readonly az: number;
}

/** A Nib hazard patrolling around (x, z): touching it during a shot costs a stroke, never pixels. */
export interface PuttNib {
  readonly x: number;
  readonly z: number;
  readonly move?: PuttMotion;
}

/** A rail: a straight wall segment along cell edges. */
export interface PuttRail {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
}

/** Difficulty tier of a hole template. */
export type PuttTier = 1 | 2 | 3;

/** Designer description of one hole (before rasterisation). */
export interface PuttHoleSpec {
  readonly name: string;
  readonly par: number;
  readonly tier: PuttTier;
  readonly tee: PuttPoint;
  readonly cup: PuttPoint;
  readonly pads: readonly PuttPad[];
  /** Rails are suppressed on cell edges whose midpoint lies inside one of these (gap mouths, platform docks). */
  readonly openings?: readonly PuttRect[];
  readonly movers?: readonly PuttMover[];
  readonly bumpers?: readonly PuttBumper[];
  readonly windmills?: readonly PuttWindmill[];
  readonly slopes?: readonly PuttSlope[];
  readonly nibs?: readonly PuttNib[];
  /** A designer path from tee to cup (waypoints, cup excluded): bot hints and camera framing. */
  readonly route: readonly PuttPoint[];
}

/** A built hole: the spec plus its rasterised surface, merged rails and framing bounds. */
export interface PuttHole extends PuttHoleSpec {
  /** 1-based hole number on the course. */
  readonly number: number;
  /** Surface cell keys (`cellKey`), sorted ascending; the renderer builds the island top from them. */
  readonly cells: readonly number[];
  readonly rails: readonly PuttRail[];
  /** Bounds of everything on the hole (surface, movers' sweep), for camera framing. */
  readonly bounds: PuttRect;
}

/** A whole course: 9 holes from one seed. */
export interface PuttCourse {
  readonly seed: number;
  readonly holes: readonly PuttHole[];
  /** Sum of pars. */
  readonly par: number;
}

const CELL_OFFSET = 512;
const CELL_SPAN = 1024;

/** Integer key of the lattice cell (i, j) (cell i covers x ∈ [i·cell, (i+1)·cell)). */
export function cellKey(i: number, j: number): number {
  return (i + CELL_OFFSET) * CELL_SPAN + (j + CELL_OFFSET);
}

/** Inverse of `cellKey`. */
export function cellOf(key: number): { i: number; j: number } {
  const i = Math.floor(key / CELL_SPAN) - CELL_OFFSET;
  return { i, j: key - (i + CELL_OFFSET) * CELL_SPAN - CELL_OFFSET };
}

/** Lattice index of a coordinate. */
export function cellIndex(v: number): number {
  return Math.floor(v / PUTT.cell);
}

/** True if (x, z) lies inside the rectangle (closed). */
export function inRect(r: PuttRect, x: number, z: number): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

function padCovers(p: PuttPad, x: number, z: number): boolean {
  if (p.kind === "rect") return x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1;
  const dx = x - p.x;
  const dz = z - p.z;
  return dx * dx + dz * dz < p.r * p.r;
}

/** Eased triangle wave in [−1, 1] (zero slope at both ends) for motion `m` at tick `t`. Pure arithmetic. */
export function wave(m: PuttMotion, t: number): number {
  const p = m.period > 0 ? m.period : 1;
  const k = (((t + m.phase) % p) + p) % p;
  const u = k / p;
  const tri = u < 0.5 ? 4 * u - 1 : 3 - 4 * u;
  return tri * (1.5 - 0.5 * tri * tri);
}

/** Offset of a motion at tick `t` (hole-local ticks). */
export function motionOffset(m: PuttMotion | undefined, t: number): PuttPoint {
  if (!m) return { x: 0, z: 0 };
  const w = wave(m, t);
  return { x: m.dx * w, z: m.dz * w };
}

function mergeRuns(edges: Map<number, number[]>, horizontal: boolean): PuttRail[] {
  const out: PuttRail[] = [];
  const lines = [...edges.keys()].sort((a, b) => a - b);
  const c = PUTT.cell;
  for (const line of lines) {
    const runs = (edges.get(line) ?? []).sort((a, b) => a - b);
    let start: number | null = null;
    let prev = 0;
    for (const s of runs) {
      if (start !== null && s === prev + 1) {
        prev = s;
        continue;
      }
      if (start !== null) out.push(rail(horizontal, line, start, prev + 1, c));
      start = s;
      prev = s;
    }
    if (start !== null) out.push(rail(horizontal, line, start, prev + 1, c));
  }
  return out;
}

function rail(horizontal: boolean, line: number, from: number, to: number, c: number): PuttRail {
  return horizontal
    ? { ax: from * c, az: line * c, bx: to * c, bz: line * c }
    : { ax: line * c, az: from * c, bx: line * c, bz: to * c };
}

/** Rasterises a hole spec: surface cells, merged rails around the void, and bounds. Pure and deterministic. */
export function buildHole(spec: PuttHoleSpec, number: number): PuttHole {
  const c = PUTT.cell;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  const grow = (ax: number, az: number, bx: number, bz: number): void => {
    x0 = Math.min(x0, ax);
    z0 = Math.min(z0, az);
    x1 = Math.max(x1, bx);
    z1 = Math.max(z1, bz);
  };
  for (const p of spec.pads) {
    if (p.kind === "rect") grow(p.x0, p.z0, p.x1, p.z1);
    else grow(p.x - p.r, p.z - p.r, p.x + p.r, p.z + p.r);
  }
  const cells = new Set<number>();
  for (let i = cellIndex(x0) - 1; i <= cellIndex(x1) + 1; i++)
    for (let j = cellIndex(z0) - 1; j <= cellIndex(z1) + 1; j++) {
      const cx = (i + 0.5) * c;
      const cz = (j + 0.5) * c;
      if (spec.pads.some((p) => padCovers(p, cx, cz))) cells.add(cellKey(i, j));
    }
  const open = (x: number, z: number): boolean => (spec.openings ?? []).some((r) => inRect(r, x, z));
  const hEdges = new Map<number, number[]>();
  const vEdges = new Map<number, number[]>();
  const push = (m: Map<number, number[]>, line: number, s: number): void => {
    const a = m.get(line);
    if (a) a.push(s);
    else m.set(line, [s]);
  };
  for (const key of cells) {
    const { i, j } = cellOf(key);
    // Horizontal edges (constant z) above and below; vertical edges (constant x) left and right.
    if (!cells.has(cellKey(i, j - 1)) && !open((i + 0.5) * c, j * c)) push(hEdges, j, i);
    if (!cells.has(cellKey(i, j + 1)) && !open((i + 0.5) * c, (j + 1) * c)) push(hEdges, j + 1, i);
    if (!cells.has(cellKey(i - 1, j)) && !open(i * c, (j + 0.5) * c)) push(vEdges, i, j);
    if (!cells.has(cellKey(i + 1, j)) && !open((i + 1) * c, (j + 0.5) * c)) push(vEdges, i + 1, j);
  }
  const rails = [...mergeRuns(hEdges, true), ...mergeRuns(vEdges, false)];
  for (const m of spec.movers ?? []) {
    grow(
      m.x0 - Math.abs(m.move.dx),
      m.z0 - Math.abs(m.move.dz),
      m.x1 + Math.abs(m.move.dx),
      m.z1 + Math.abs(m.move.dz),
    );
  }
  return {
    ...spec,
    number,
    cells: [...cells].sort((a, b) => a - b),
    rails,
    bounds: { x0, z0, x1, z1 },
  };
}

// ── Hole templates ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Seeded knobs a template may read (all pre-drawn so every template consumes the same stream length). */
interface Knobs {
  /** Uniform floats in [0, 1). */
  readonly f: readonly number[];
}

const rect = (x0: number, z0: number, x1: number, z1: number): PuttPad => ({ kind: "rect", x0, z0, x1, z1 });
const pick = <T>(xs: readonly T[], u: number): T => {
  const v = xs[Math.min(xs.length - 1, Math.floor(u * xs.length))];
  if (v === undefined) throw new RangeError("pick() from an empty list");
  return v;
};
const snap = (v: number): number => Math.round(v * 2) / 2;
const k = (kn: Knobs, i: number): number => kn.f[i] ?? 0.5;

/** A named template: builds a spec from seeded knobs. */
interface Template {
  readonly name: string;
  readonly tier: PuttTier;
  readonly build: (kn: Knobs) => Omit<PuttHoleSpec, "name" | "tier">;
}

/** The hole library. Ids are stable: the course generator picks by index, so reordering changes daily courses. */
const TEMPLATES: readonly Template[] = [
  {
    name: "first hop",
    tier: 1,
    build: (kn) => ({
      par: 2,
      tee: { x: -8, z: 0 },
      cup: { x: 8, z: snap((k(kn, 0) - 0.5) * 3) },
      pads: [rect(-10, -3, 10, 3)],
      bumpers: [{ x: 1, z: snap((k(kn, 1) - 0.5) * 3), r: 0.8 }],
      route: [],
    }),
  },
  {
    name: "bumper alley",
    tier: 1,
    build: (kn) => ({
      par: 2,
      tee: { x: -9, z: 0 },
      cup: { x: 8.5, z: 0 },
      pads: [rect(-11, -3.5, 11, 3.5)],
      bumpers: [
        { x: -2, z: 0, r: 0.8 },
        { x: 2.5, z: -2, r: 0.7 },
        { x: 2.5, z: 2, r: 0.7 },
        { x: 6, z: snap((k(kn, 0) - 0.5) * 2), r: 0.6 },
      ],
      route: [{ x: 0, z: -1.8 }],
    }),
  },
  {
    name: "dogleg",
    tier: 1,
    build: (kn) => ({
      par: 3,
      tee: { x: -9, z: 0 },
      cup: { x: -1, z: -8 + snap(k(kn, 0) * 2) },
      pads: [rect(-11, -2.5, 1.5, 2.5), rect(-3.5, -10.5, 1.5, 2.5)],
      bumpers: [{ x: 0.8, z: 1.8, r: 0.8 }],
      route: [{ x: -1, z: 0 }],
    }),
  },
  {
    name: "the hill",
    tier: 1,
    build: (kn) => ({
      par: 2,
      tee: { x: -8.5, z: 1 },
      cup: { x: 8, z: -1.5 },
      pads: [rect(-10.5, -3, 10.5, 3)],
      slopes: [{ x0: -3, z0: -3, x1: 3, z1: 3, ax: 0, az: 4 + k(kn, 0) * 2 }],
      route: [{ x: 0, z: -2 }],
    }),
  },
  {
    name: "windmill",
    tier: 2,
    build: (kn) => ({
      par: 3,
      tee: { x: -9, z: 0 },
      cup: { x: 9, z: 0 },
      pads: [rect(-11, -3, 11, 3)],
      windmills: [
        { x: 1.5, z: 0, len: 2.6, blades: 4, speed: pick([9, 11, 13], k(kn, 0)), phase: Math.floor(k(kn, 1) * 1024) },
      ],
      route: [{ x: -2, z: 0 }],
    }),
  },
  {
    name: "the gap",
    tier: 2,
    build: (kn) => ({
      par: 3,
      tee: { x: -5.5, z: 0 },
      cup: { x: 7.5, z: snap((k(kn, 0) - 0.5) * 3) },
      pads: [rect(-9, -3, -2, 3), rect(1, -3.5, 10.5, 3.5)],
      openings: [{ x0: -2.1, z0: -3.6, x1: 1.1, z1: 3.6 }],
      route: [{ x: 3, z: 0 }],
    }),
  },
  {
    name: "sliding bridge",
    tier: 2,
    build: (kn) => ({
      par: 3,
      tee: { x: -8, z: 0 },
      cup: { x: 8, z: 0 },
      pads: [rect(-10.5, -3, -4, 3), rect(4, -3, 10.5, 3)],
      openings: [{ x0: -4.1, z0: -3.1, x1: 4.1, z1: 3.1 }],
      movers: [
        {
          x0: -4,
          z0: -1.25,
          x1: 4,
          z1: 1.25,
          move: { dx: 0, dz: 3, period: pick([200, 240, 280], k(kn, 0)), phase: Math.floor(k(kn, 1) * 200) },
        },
      ],
      route: [{ x: -4.5, z: 0 }],
    }),
  },
  {
    name: "pinball",
    tier: 2,
    build: (kn) => ({
      par: 3,
      tee: { x: -7, z: 0 },
      cup: { x: 4.5, z: snap(-2 - k(kn, 0) * 2) },
      pads: [{ kind: "disc", x: 0, z: 0, r: 9 }],
      bumpers: [
        { x: 0, z: 0, r: 1.1 },
        { x: 2, z: 3.5, r: 0.8 },
        { x: -2, z: -3.5, r: 0.8 },
        { x: 3.5, z: -0.5, r: 0.7 },
        { x: -3, z: 3, r: 0.7 },
      ],
      route: [{ x: 0, z: -5.5 }],
    }),
  },
  {
    name: "island hop",
    tier: 3,
    build: (kn) => ({
      par: 4,
      tee: { x: -9.5, z: 0 },
      cup: { x: 9.5, z: snap((k(kn, 0) - 0.5) * 2) },
      pads: [rect(-12, -2.5, -6, 2.5), { kind: "disc", x: 0, z: 0, r: 3.2 }, rect(6, -2.5, 12, 2.5)],
      openings: [
        { x0: -6.1, z0: -2.6, x1: -2.9, z1: 2.6 },
        { x0: 2.9, z0: -2.6, x1: 6.1, z1: 2.6 },
      ],
      route: [
        { x: -7.5, z: 0 },
        { x: 0, z: 0 },
        { x: 7.5, z: 0 },
      ],
    }),
  },
  {
    name: "uphill windmill",
    tier: 3,
    build: (kn) => ({
      par: 3,
      tee: { x: -9, z: 1.5 },
      cup: { x: 9, z: 2 },
      pads: [rect(-11, -3.5, 11, 3.5)],
      slopes: [{ x0: -6, z0: -3.5, x1: -1, z1: 3.5, ax: -3, az: -3 }],
      windmills: [
        { x: 4.5, z: 0, len: 3, blades: 3, speed: -pick([8, 10], k(kn, 0)), phase: Math.floor(k(kn, 1) * 1365) },
      ],
      route: [{ x: 1, z: 0 }],
    }),
  },
  {
    name: "nib patrol",
    tier: 3,
    build: (kn) => ({
      par: 3,
      tee: { x: -9, z: 0 },
      cup: { x: 9, z: 0 },
      pads: [rect(-11, -3, 11, 3)],
      nibs: [
        { x: -2, z: 0, move: { dx: 0, dz: 2, period: 150, phase: Math.floor(k(kn, 0) * 150) } },
        { x: 3.5, z: 0, move: { dx: 0, dz: 2, period: 190, phase: Math.floor(k(kn, 1) * 190) } },
      ],
      bumpers: [{ x: 6.5, z: snap((k(kn, 2) - 0.5) * 3), r: 0.6 }],
      route: [{ x: 0.5, z: 0 }],
    }),
  },
  {
    name: "the ferry",
    tier: 3,
    build: (kn) => ({
      par: 4,
      tee: { x: -9, z: 0 },
      cup: { x: 9, z: snap((k(kn, 0) - 0.5) * 2) },
      pads: [rect(-11.5, -3, -4.5, 3), rect(4.5, -3, 11.5, 3)],
      openings: [{ x0: -4.6, z0: -3.1, x1: 4.6, z1: 3.1 }],
      movers: [
        {
          x0: -1.5,
          z0: -1.5,
          x1: 1.5,
          z1: 1.5,
          move: { dx: 3, dz: 0, period: pick([300, 360], k(kn, 1)), phase: Math.floor(k(kn, 2) * 300) },
        },
      ],
      nibs: [{ x: 7, z: 0, move: { dx: 0, dz: 1.8, period: 170, phase: Math.floor(k(kn, 3) * 170) } }],
      route: [
        { x: -5.5, z: 0 },
        { x: 5.5, z: 0 },
      ],
    }),
  },
];

/** Number of hole templates in the library. */
export const TEMPLATE_COUNT = TEMPLATES.length;

/** Knobs drawn per template (every template consumes exactly this many, so streams never shift). */
const KNOBS = 4;

function mirrorPoint(p: PuttPoint): PuttPoint {
  return { x: p.x, z: -p.z };
}
function mirrorRect<T extends PuttRect>(r: T): T {
  return { ...r, z0: -r.z1, z1: -r.z0 };
}
function mirrorMotion(m: PuttMotion): PuttMotion {
  return { ...m, dz: -m.dz };
}

/** Mirrors a hole spec across the x axis (z → −z); windmills spin the other way so it is a true mirror image. */
export function mirrorSpec(s: PuttHoleSpec): PuttHoleSpec {
  return {
    ...s,
    tee: mirrorPoint(s.tee),
    cup: mirrorPoint(s.cup),
    pads: s.pads.map((p) => (p.kind === "rect" ? mirrorRect(p) : { ...p, z: -p.z })),
    openings: (s.openings ?? []).map(mirrorRect),
    movers: (s.movers ?? []).map((m) => ({ ...mirrorRect(m), move: mirrorMotion(m.move) })),
    bumpers: (s.bumpers ?? []).map((b) => ({ ...b, z: -b.z })),
    windmills: (s.windmills ?? []).map((w) => ({ ...w, z: -w.z, speed: -w.speed, phase: -w.phase })),
    slopes: (s.slopes ?? []).map((sl) => ({ ...mirrorRect(sl), az: -sl.az })),
    nibs: (s.nibs ?? []).map((n) => ({ x: n.x, z: -n.z, ...(n.move ? { move: mirrorMotion(n.move) } : {}) })),
    route: s.route.map(mirrorPoint),
  };
}

/** The spec of template `index` with seeded knobs (u in [0, 1)) and an optional mirror. Exposed for tests/dev. */
export function templateSpec(index: number, knobs: readonly number[], mirror = false): PuttHoleSpec {
  const t = TEMPLATES[index];
  if (!t) throw new RangeError(`No hole template ${index}`);
  const spec: PuttHoleSpec = { name: t.name, tier: t.tier, ...t.build({ f: knobs }) };
  return mirror ? mirrorSpec(spec) : spec;
}

/**
 * The course for `seed`: three holes from each tier (easy → hard), each with seeded knobs and a coin-flip mirror.
 * Deterministic: equal seeds give equal courses on every engine (sfc32 stream 71 of the seed).
 */
export function generateCourse(seed: number): PuttCourse {
  const rng = new Rng(seed | 0, 71);
  const holes: PuttHole[] = [];
  for (const tier of [1, 2, 3] as const) {
    const pool = TEMPLATES.map((t, i) => ({ t, i })).filter((x) => x.t.tier === tier);
    // Partial Fisher–Yates: the first three of a shuffled tier pool.
    for (let n = 0; n < 3 && pool.length > 0; n++) {
      const j = n + rng.int(pool.length - n);
      const a = pool[n];
      const b = pool[j];
      if (!a || !b) break;
      pool[n] = b;
      pool[j] = a;
      const knobs: number[] = [];
      for (let q = 0; q < KNOBS; q++) knobs.push(rng.float());
      const mirror = rng.int(2) === 1;
      holes.push(buildHole(templateSpec(b.i, knobs, mirror), holes.length + 1));
    }
  }
  return { seed: seed | 0, holes, par: holes.reduce((s, h) => s + h.par, 0) };
}
