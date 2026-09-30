/**
 * Island geometry (GDD §2.3, §9.3): a convex polygon sampled from an ellipse at integer angles, rim bumper rocks, rim spawn
 * slots, an optional central pond, and Old Gulp's wedge (a sector with its apex at the island centre) that can be bitten
 * out and regrown. The ground is the plane y = 0; anything whose centre is off the polygon (or inside an active wedge) has
 * no ground under it.
 */
import { ANGLE_STEPS, cosA, sinA } from "./fixed-math.js";
import {
  ARENAS,
  type ArenaDef,
  BUMPER_RADIUS,
  BUMPER_RIM,
  GULP_WEDGE_INNER,
  ISLAND_VERTICES,
  SPAWN_SLOT_RADIUS,
  SPAWN_SLOTS,
} from "./tuning.js";
import type { V2 } from "./vec.js";

/** A round rock on the rim that bounces the Friend. `active` is false while it sits on a bitten wedge. */
export interface Bumper {
  x: number;
  z: number;
  r: number;
  active: boolean;
}

/** Point strictly inside the ellipse where edge distances need no polygon test (q = (x/a)² + (z/b)² below this). */
const DEEP_INSIDE_Q = 0.8;

/** Island for one run. Mutable only through `setWedge` / `clearWedge`. */
export class Island {
  /** Arena name as given in `SimConfig.arena`. */
  readonly name: string;
  /** Arena definition (tuning). */
  readonly def: ArenaDef;
  /** Ellipse semi-axes (u). */
  readonly a: number;
  /** See `a`. */
  readonly b: number;
  /** Polygon vertices (counter-clockwise in angle order). */
  readonly px: Float64Array;
  /** See `px`. */
  readonly pz: Float64Array;
  /** Outward unit normal of edge i (from vertex i to i + 1). */
  private readonly nx: Float64Array;
  private readonly nz: Float64Array;
  /** Rim bumper rocks. */
  readonly bumpers: Bumper[];
  /** Rim spawn slots. */
  readonly slots: readonly V2[];
  /** Gulp wedge: `wedgeOn` = bitten out (no ground); `wedgeShadow` = telegraphed only. */
  wedgeOn = false;
  /** See `wedgeOn`. */
  wedgeShadow = false;
  /** Wedge bisector (integer angle) and half-angle. */
  wedgeDir = 0;
  /** See `wedgeDir`. */
  wedgeHalf = 0;
  private wdx = 1;
  private wdz = 0;
  private wcos = 1;
  private e1x = 1;
  private e1z = 0;
  private e2x = 1;
  private e2z = 0;

  /** Builds island `name`; throws `RangeError` for an unknown arena. */
  constructor(name: string) {
    const def = Object.hasOwn(ARENAS, name) ? ARENAS[name] : undefined;
    if (!def) throw new RangeError(`Unknown arena "${name}". Known: ${Object.keys(ARENAS).join(", ")}.`);
    this.name = name;
    this.def = def;
    this.a = def.a;
    this.b = def.b;
    const n = ISLAND_VERTICES;
    this.px = new Float64Array(n);
    this.pz = new Float64Array(n);
    this.nx = new Float64Array(n);
    this.nz = new Float64Array(n);
    const step = ANGLE_STEPS / n;
    for (let i = 0; i < n; i++) {
      this.px[i] = this.a * cosA(i * step);
      this.pz[i] = this.b * sinA(i * step);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = (this.px[j] ?? 0) - (this.px[i] ?? 0);
      const ez = (this.pz[j] ?? 0) - (this.pz[i] ?? 0);
      const l = Math.sqrt(ex * ex + ez * ez);
      // Angles increase from +x toward +z, so (ez, −ex) points away from the centre.
      this.nx[i] = ez / l;
      this.nz[i] = -ex / l;
    }
    this.bumpers = [];
    for (let k = 0; k < def.bumpers; k++) {
      const ang = Math.round((k * ANGLE_STEPS) / def.bumpers + ANGLE_STEPS / (2 * def.bumpers));
      this.bumpers.push({
        x: this.a * BUMPER_RIM * cosA(ang),
        z: this.b * BUMPER_RIM * sinA(ang),
        r: BUMPER_RADIUS,
        active: true,
      });
    }
    const slots: V2[] = [];
    for (let k = 0; k < SPAWN_SLOTS; k++) {
      const ang = Math.round((k * ANGLE_STEPS) / SPAWN_SLOTS);
      slots.push({ x: this.a * SPAWN_SLOT_RADIUS * cosA(ang), z: this.b * SPAWN_SLOT_RADIUS * sinA(ang) });
    }
    this.slots = slots;
  }

  /** Distance from the centre to the rim along unit direction (ux, uz). */
  rimRadius(ux: number, uz: number): number {
    const qa = ux / this.a;
    const qb = uz / this.b;
    return 1 / Math.sqrt(qa * qa + qb * qb);
  }

  /**
   * Signed distance past the polygon rim (> 0 outside, ≤ 0 inside). Deep inside, where no caller needs precision, it
   * returns the cheap radial estimate −(1 − √q)·min(a, b) instead of testing all edges.
   */
  private polygonDistance(x: number, z: number): number {
    const qa = x / this.a;
    const qb = z / this.b;
    const q = qa * qa + qb * qb;
    if (q < DEEP_INSIDE_Q) return -(1 - Math.sqrt(q)) * (this.a < this.b ? this.a : this.b);
    let d = -Infinity;
    for (let i = 0; i < this.px.length; i++) {
      const s = (this.nx[i] ?? 0) * (x - (this.px[i] ?? 0)) + (this.nz[i] ?? 0) * (z - (this.pz[i] ?? 0));
      if (s > d) d = s;
    }
    return d;
  }

  /**
   * True iff (x, z) lies in the wedge (bitten or telegraphed geometry, regardless of state): the sector around the
   * bisector beyond GULP_WEDGE_INNER of the rim radius, so the island centre never goes.
   */
  inWedgeSector(x: number, z: number): boolean {
    const l = Math.sqrt(x * x + z * z);
    if (l === 0 || x * this.wdx + z * this.wdz <= l * this.wcos) return false;
    const qa = x / this.a;
    const qb = z / this.b;
    return qa * qa + qb * qb >= GULP_WEDGE_INNER * GULP_WEDGE_INNER;
  }

  /**
   * How far (x, z) is off the ground: > 0 means off the island by about that many units (outside the polygon or inside
   * a bitten wedge), ≤ 0 means on the ground.
   */
  edgeDistance(x: number, z: number): number {
    const d = this.polygonDistance(x, z);
    if (!this.wedgeOn || !this.inWedgeSector(x, z)) return d;
    const d1 = Math.abs(this.e1x * z - this.e1z * x);
    const d2 = Math.abs(this.e2x * z - this.e2z * x);
    const qa = x / this.a;
    const qb = z / this.b;
    const l = Math.sqrt(x * x + z * z);
    // Distance past the inner cut, measured radially (the inner edge is a scaled copy of the rim).
    const d3 = (Math.sqrt(qa * qa + qb * qb) - GULP_WEDGE_INNER) * this.rimRadius(x / l, z / l);
    let w = d1 < d2 ? d1 : d2;
    if (d3 < w) w = d3;
    return w > d ? w : d;
  }

  /** True iff there is ground under (x, z). */
  contains(x: number, z: number): boolean {
    return this.edgeDistance(x, z) <= 0;
  }

  /** True iff (x, z) is inside the island's central pond (Pond arena only). */
  inPond(x: number, z: number): boolean {
    if (this.def.pondA <= 0) return false;
    const qa = x / this.def.pondA;
    const qb = z / this.def.pondB;
    return qa * qa + qb * qb <= 1;
  }

  /** Writes into `out` the direction toward the nearest rim from (x, z) (ellipse gradient; +x from the centre). */
  outward(out: V2, x: number, z: number): void {
    let gx = x / (this.a * this.a);
    let gz = z / (this.b * this.b);
    if (gx === 0 && gz === 0) gx = 1;
    const l = Math.sqrt(gx * gx + gz * gz);
    gx /= l;
    gz /= l;
    if (this.wedgeOn && this.inWedgeSector(x, z)) {
      gx = this.wdx;
      gz = this.wdz;
    }
    out.x = gx;
    out.z = gz;
  }

  /** Telegraphs (shadow) a wedge with bisector `dir` and half-angle `half` (integer angles). */
  setWedge(dir: number, half: number): void {
    this.wedgeDir = dir & 4095;
    this.wedgeHalf = half;
    this.wdx = cosA(dir);
    this.wdz = sinA(dir);
    this.wcos = cosA(half);
    this.e1x = cosA(dir + half);
    this.e1z = sinA(dir + half);
    this.e2x = cosA(dir - half);
    this.e2z = sinA(dir - half);
    this.wedgeShadow = true;
  }

  /** Bites the telegraphed wedge out: no ground there; bumpers on it go inactive. */
  biteWedge(): void {
    this.wedgeShadow = false;
    this.wedgeOn = true;
    for (const b of this.bumpers) b.active = !this.inWedgeSector(b.x, b.z);
  }

  /** Regrows the wedge and its bumpers. */
  clearWedge(): void {
    this.wedgeOn = false;
    this.wedgeShadow = false;
    for (const b of this.bumpers) b.active = true;
  }

  /** Writes into `out` where a respawning Friend lands: the island centre (never part of the wedge). */
  respawnPoint(out: V2): void {
    out.x = 0;
    out.z = 0;
  }

  /** Unit bisector of the wedge. */
  wedgeAxis(out: V2): void {
    out.x = this.wdx;
    out.z = this.wdz;
  }
}
