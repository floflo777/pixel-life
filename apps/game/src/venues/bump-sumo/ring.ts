/**
 * The dohyo: a round floating voxel ring (clay top, straw rim, lilac underside) whose outer cells crumble away as the
 * sim shrinks the ring, plus the straw rope drawn at the live ring-out radius. Presentation only: the sim's `ringR` is
 * the rule, this just shows it (crumbling is stepped, like every motion in the art bible).
 */
import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, Quaternion, Vector3, type Material } from "three";
import { createBandMaterial } from "../../post/band-material";
import { PALETTE, deepOf, shadeOf } from "../../stage/palette";

/** World units per ring cell (art bible: 0.24 = 2 sprite pixels). */
export const RING_CELL = 0.24;
const ROPE_SEGMENTS = 84;
/** Seconds a crumbling cell takes to fall out of sight. */
const FALL_S = 0.5;

interface Cell {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly depth: number;
  /** Time the cell started falling (−1 = standing). */
  fallAt: number;
  gone: boolean;
}

function hash2(i: number, j: number, seed: number): number {
  let h = Math.imul((i * 73856093) ^ (j * 19349663) ^ seed, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 1000) / 1000;
}

/** The ring model. `update` each frame with the live radius (world units). */
export class Dohyo {
  readonly object = new Group();
  private readonly cells: Cell[] = [];
  private readonly top: InstancedMesh;
  private readonly lip: InstancedMesh;
  private readonly under: InstancedMesh;
  private readonly rope: InstancedMesh;
  private readonly geo = new BoxGeometry(1, 1, 1);
  private readonly mat: Material;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly col = new Color();
  private ropeR = -1;
  private ropeHot = -1;
  private readonly r0: number;

  /** Builds a ring of radius `r0` world units. */
  constructor(r0: number, seed = 7) {
    this.r0 = r0;
    this.object.name = "bump-sumo-dohyo";
    this.mat = createBandMaterial({ lightMix: 0.3 });
    const n = Math.ceil(r0 / RING_CELL) + 1;
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const x = i * RING_CELL;
        const z = j * RING_CELL;
        const r = Math.hypot(x, z);
        if (r > r0 + RING_CELL * 0.35) continue;
        // Floating-island underside: deep in the middle, a thin lip at the rim, a little noise.
        const k = 1 - r / (r0 + RING_CELL);
        const depth = 1 + Math.floor(k * k * 9 + hash2(i, j, seed) * 2.2);
        this.cells.push({ x, z, r, depth, fallAt: -1, gone: false });
      }
    }
    const count = this.cells.length;
    this.top = new InstancedMesh(this.geo, this.mat, count);
    this.lip = new InstancedMesh(this.geo, this.mat, count);
    this.under = new InstancedMesh(this.geo, this.mat, count);
    this.top.name = "dohyo-top";
    this.lip.name = "dohyo-lip";
    this.under.name = "dohyo-under";
    const rimR = r0 - RING_CELL * 1.2;
    this.cells.forEach((c, k) => {
      const i = Math.round(c.x / RING_CELL);
      const j = Math.round(c.z / RING_CELL);
      let top: number = (i + j) & 1 ? PALETTE.tile : PALETTE.paperWarm;
      if (c.r >= rimR) top = (i + j) & 1 ? PALETTE.sun : PALETTE.gold;
      // Shikiri-sen: the two white start lines either side of the centre.
      if (Math.abs(j) <= 1 && (i === 3 || i === -3)) top = PALETTE.paper;
      this.top.setColorAt(k, this.col.setHex(top));
      this.lip.setColorAt(k, this.col.setHex(c.r >= rimR ? PALETTE.coralDark : PALETTE.meadowDrip));
      this.under.setColorAt(k, this.col.setHex(hash2(j, i, seed) > 0.5 ? PALETTE.lilac : shadeOf(PALETTE.lilac)));
      this.place(k, 0, 0);
    });
    this.rope = new InstancedMesh(this.geo, this.mat, ROPE_SEGMENTS);
    this.rope.name = "dohyo-rope";
    this.rope.frustumCulled = false;
    this.object.add(this.under, this.lip, this.top, this.rope);
    this.setRope(r0, false);
  }

  /** Writes the three instances of cell `k`, dropped by `dy` and spun by `spin` (radians). */
  private place(k: number, dy: number, spin: number): void {
    const c = this.cells[k];
    if (!c) return;
    const h = RING_CELL;
    this.q.setFromAxisAngle(this.v.set(0.3, 0, 1).normalize(), spin);
    const shrink = c.gone ? 0 : 1;
    this.m.compose(this.v.set(c.x, -h / 2 + dy, c.z), this.q, this.s.set(h * shrink, h * shrink, h * shrink));
    this.top.setMatrixAt(k, this.m);
    this.m.compose(this.v.set(c.x, -h * 1.5 + dy, c.z), this.q, this.s.set(h * shrink, h * shrink, h * shrink));
    this.lip.setMatrixAt(k, this.m);
    // A crumbling cell drops only its top block and lip; its underside column vanishes at once, so the island's
    // silhouette shrinks cleanly with the ring instead of trailing a curtain of columns.
    const dh = c.depth * h;
    const col = c.fallAt >= 0 ? 0 : shrink;
    this.m.compose(this.v.set(c.x, -h * 2 - dh / 2, c.z), this.q.identity(), this.s.set(h * col, dh * col, h * col));
    this.under.setMatrixAt(k, this.m);
  }

  /** Lays the rope on radius `r` (world); `hot` tints it coral (the ring is closing in). */
  private setRope(r: number, hot: boolean): void {
    if (Math.abs(r - this.ropeR) < 1e-4 && (hot ? 1 : 0) === this.ropeHot) return;
    this.ropeR = r;
    this.ropeHot = hot ? 1 : 0;
    const seg = (2 * Math.PI * r) / ROPE_SEGMENTS;
    for (let k = 0; k < ROPE_SEGMENTS; k++) {
      const a = (k / ROPE_SEGMENTS) * Math.PI * 2;
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), -a);
      this.m.compose(this.v.set(Math.cos(a) * r, 0.05, Math.sin(a) * r), this.q, this.s.set(0.12, 0.1, seg * 0.9));
      this.rope.setMatrixAt(k, this.m);
      const c = hot ? (k & 1 ? PALETTE.coral : PALETTE.coralDark) : k & 1 ? PALETTE.sun : deepOf(PALETTE.sun);
      this.rope.setColorAt(k, this.col.setHex(c));
    }
    this.rope.instanceMatrix.needsUpdate = true;
    if (this.rope.instanceColor) this.rope.instanceColor.needsUpdate = true;
  }

  /**
   * Shows radius `r` (world units) at real time `time` (s): cells beyond it crumble (stepped fall), a bigger radius
   * (new round) restores them. `hot` blinks the rope while the ring is closing; `reducedMotion` drops cells instantly.
   */
  update(r: number, time: number, hot: boolean, reducedMotion: boolean): void {
    let dirty = false;
    const grow = r > this.r0 - 1e-3;
    this.cells.forEach((c, k) => {
      const out = c.r > r + RING_CELL * 0.5;
      if (!out && (c.fallAt >= 0 || c.gone) && grow) {
        c.fallAt = -1;
        c.gone = false;
        this.place(k, 0, 0);
        dirty = true;
        return;
      }
      if (out && c.fallAt < 0 && !c.gone) {
        c.fallAt = time;
        if (reducedMotion) c.gone = true;
        dirty = true;
      }
      if (c.fallAt >= 0 && !c.gone) {
        const u = (time - c.fallAt) / FALL_S;
        if (u >= 1) c.gone = true;
        // Stepped: a 60 ms shiver, then 6 fall steps with a quarter-turn wobble.
        const step = Math.floor(Math.max(0, u) * 6) / 6;
        const shiver = u < 0.07 ? (Math.floor(time * 30) % 2 ? 0.02 : -0.02) : 0;
        this.place(k, shiver - step * step * 2.5, step * 0.8);
        dirty = true;
      }
    });
    if (dirty) {
      this.top.instanceMatrix.needsUpdate = true;
      this.lip.instanceMatrix.needsUpdate = true;
      this.under.instanceMatrix.needsUpdate = true;
    }
    const blink = hot && (reducedMotion || Math.floor(time * 4) % 2 === 0);
    this.setRope(Math.max(0.2, r), blink);
  }

  /** Frees GPU resources. */
  dispose(): void {
    this.object.removeFromParent();
    this.top.dispose();
    this.lip.dispose();
    this.under.dispose();
    this.rope.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}
