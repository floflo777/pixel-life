/**
 * Hub ground markers and particles, two InstancedMeshes total: the path preview (3×3 ink dots with a paper centre,
 * art bible §8.14), your lime dot ellipse, dust/pixel shards (untagged) and glowing sparkles (Mend, pixel burst).
 * Every particle moves in 12 fps steps (art bible §7); reduced motion holds them still.
 */
import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, type Material } from "three";
import { createBandMaterial } from "../post/band-material";
import { tagGlow } from "../post/tags";
import { PALETTE } from "../stage/palette";
import type { GroundPoint } from "./coords";

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  color: Color;
  born: number;
  life: number;
  glow: boolean;
}

/** Kinds of one-shot effects. */
export type FxKind = "sparkle" | "dust" | "shards" | "heart";

const PAPER = new Color(PALETTE.paper);
const INK = new Color(PALETTE.ink);
const LIME = new Color(PALETTE.signal);
const SUN = new Color(PALETTE.sun);
const CORAL = new Color(PALETTE.coral);
const BODY = new Color(PALETTE.body);

/** Deterministic small hash → [0, 1) (effects never need Math.random, which keeps captures reproducible). */
function h01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Ground markers and particles. */
export class HubFx {
  readonly markers: InstancedMesh;
  readonly sparkles: InstancedMesh;
  readonly #mats: Material[];
  #path: GroundPoint[] = [];
  #you: GroundPoint | null = null;
  #particles: Particle[] = [];
  #seq = 1;
  readonly #mx = new Matrix4();

  /** Allocates both meshes. */
  constructor(
    readonly markerCapacity = 1024,
    readonly sparkleCapacity = 512,
  ) {
    const geo = new BoxGeometry(1, 1, 1);
    const m1 = createBandMaterial({ color: 0xffffff, ditherAmp: 0 });
    const m2 = createBandMaterial({ color: 0xffffff, ditherAmp: 0, lightMix: 0.6 });
    this.#mats = [m1, m2];
    this.markers = new InstancedMesh(geo, m1, markerCapacity);
    this.sparkles = new InstancedMesh(geo, m2, sparkleCapacity);
    for (const m of [this.markers, this.sparkles]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.setColorAt(0, PAPER);
    }
    this.markers.name = "hub-markers";
    this.sparkles.name = "hub-sparkles";
    tagGlow(this.sparkles, "cream");
  }

  /** The remaining click-to-move path (world), or empty to hide it. */
  setPath(points: readonly GroundPoint[]): void {
    this.#path = [...points];
  }

  /** Where your lime ellipse sits (null hides it). */
  setYou(p: GroundPoint | null): void {
    this.#you = p;
  }

  /** Live particle count (tests, stats). */
  get particles(): number {
    return this.#particles.length;
  }

  /** Spawns a one-shot effect at a Friend standing at (x, z) of height `h`. */
  burst(kind: FxKind, x: number, z: number, h: number, now: number): void {
    const add = (p: Omit<Particle, "born">): void => {
      if (this.#particles.length < this.sparkleCapacity + this.markerCapacity / 2)
        this.#particles.push({ ...p, born: now });
    };
    const s = this.#seq++ * 131;
    if (kind === "sparkle" || kind === "heart") {
      const n = kind === "heart" ? 8 : 14;
      for (let i = 0; i < n; i++) {
        const a = h01(s + i) * Math.PI * 2;
        const r = 0.3 + h01(s + i + 50) * 0.5;
        add({
          x: x + Math.cos(a) * r,
          y: 0.3 + h01(s + i + 99) * h,
          z: z + Math.sin(a) * r * 0.5 + 0.2,
          vx: 0,
          vy: 0.7 + h01(s + i + 7) * 0.6,
          vz: 0,
          size: i % 3 === 0 ? 0.1 : 0.06,
          color: kind === "heart" ? (i % 2 ? CORAL : PAPER) : ([PAPER, SUN, CORAL][i % 3] ?? PAPER),
          life: 1000,
          glow: true,
        });
      }
    } else if (kind === "dust") {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        add({
          x,
          y: 0.04,
          z,
          vx: Math.cos(a) * 1.4,
          vy: 0.3,
          vz: Math.sin(a) * 0.9,
          size: 0.07,
          color: PAPER,
          life: 500,
          glow: false,
        });
      }
    } else {
      for (let i = 0; i < 12; i++) {
        const a = h01(s + i) * Math.PI * 2;
        add({
          x,
          y: 0.3 + h01(s + i + 3) * h,
          z: z + 0.1,
          vx: Math.cos(a) * 1.6,
          vy: Math.sin(a) * 1.2,
          vz: 0,
          size: 0.13,
          color: BODY,
          life: 420,
          glow: false,
        });
      }
    }
  }

  /** Rewrites both meshes for `now`. */
  update(now: number, reducedMotion: boolean): void {
    let nm = 0;
    let ns = 0;
    const mk = this.markers;
    const sp = this.sparkles;
    const put = (
      mesh: InstancedMesh,
      i: number,
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
      c: Color,
    ): void => {
      this.#mx.makeScale(sx, sy, sz).setPosition(x, y, z);
      mesh.setMatrixAt(i, this.#mx);
      mesh.setColorAt(i, c);
    };
    // Path preview: ink dots with a paper centre every 0.45 u, and a dotted ring at the destination.
    const path = this.#path;
    if (path.length >= 2) {
      let next = 0.3;
      let acc = 0;
      for (let k = 0; k + 1 < path.length; k++) {
        const a = path[k] as GroundPoint;
        const b = path[k + 1] as GroundPoint;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        while (next <= acc + len && nm < this.markerCapacity - 40) {
          const t = len > 0 ? (next - acc) / len : 0;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          put(mk, nm++, x, 0.02, z, 0.13, 0.03, 0.13, INK);
          put(mk, nm++, x, 0.04, z, 0.05, 0.02, 0.05, PAPER);
          next += 0.45;
        }
        acc += len;
      }
      const end = path[path.length - 1] as GroundPoint;
      for (let i = 0; i < 10; i++) {
        const t = (i / 10) * Math.PI * 2;
        put(mk, nm++, end.x + Math.cos(t) * 0.36, 0.02, end.z + Math.sin(t) * 0.22, 0.1, 0.03, 0.1, INK);
      }
    }
    // Your lime ellipse of dots (art bible §4.1).
    if (this.#you) {
      const y = this.#you;
      for (let i = 0; i < 14; i++) {
        const t = (i / 14) * Math.PI * 2;
        put(mk, nm++, y.x + Math.cos(t) * 0.62, 0.02, y.z + Math.sin(t) * 0.3, 0.08, 0.03, 0.08, LIME);
      }
    }
    // Particles, stepped at 12 fps.
    const alive: Particle[] = [];
    for (const p of this.#particles) {
      const age = now - p.born;
      if (age >= p.life) continue;
      alive.push(p);
      const t = reducedMotion ? 0 : Math.floor((age / 1000) * 12) / 12;
      const x = p.x + p.vx * t;
      const y = p.y + p.vy * t - (p.glow ? 0 : 2.2 * t * t);
      const z = p.z + p.vz * t;
      if (p.glow) {
        if (ns < this.sparkleCapacity) put(sp, ns++, x, y, z, p.size, p.size, p.size, p.color);
      } else if (nm < this.markerCapacity) put(mk, nm++, x, Math.max(0.03, y), z, p.size, p.size, p.size, p.color);
    }
    this.#particles = alive;
    mk.count = nm;
    sp.count = ns;
    for (const m of [mk, sp]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Clears markers and particles (room change). */
  clear(): void {
    this.#path = [];
    this.#particles = [];
  }

  /** Frees GPU resources. */
  dispose(): void {
    this.markers.geometry.dispose();
    for (const m of this.#mats) m.dispose();
    this.markers.removeFromParent();
    this.sparkles.removeFromParent();
  }
}
