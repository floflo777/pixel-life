/**
 * Pixel Putt's three.js scene: one floating hole island at a time (built from the sim's own surface cells and rails, so
 * what you see is what you hit), animated windmills, cloud ferries and Nib patrols, the flag, and the curled-up voxel
 * Friend that tumbles while it rolls and stands up to face you when it rests. It only reads sim views; interpolation
 * between the last two fixed steps happens here. 1 putt unit = 1 world unit.
 */
import {
  BoxGeometry,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { PixelPutt, type FriendAppearance, type Hex64 } from "@pl/shared";
import { createCreatureView, type CreatureView } from "../../creatures";
import { buildFriendModel, type FriendModel } from "../../friend";
import { createBandMaterial } from "../../post/band-material";
import { untagged } from "../../post/tags";
import { SUN_DIRECTION } from "../../stage/lights";
import { PALETTE } from "../../stage/palette";
import { buildClouds } from "../../world/clouds";
import { hash3 } from "../../world/noise";
import { attachProjectedShadow, type ProjectedShadow } from "../../world/projected-shadow";
import { DECOR, SOFT, STRATA, TERRAIN, VoxelMesher } from "../../world/voxel-mesher";

type PuttHole = PixelPutt.PuttHole;
type PuttView = PixelPutt.PuttView;

/** Terrain voxel edge (two per sim lattice cell). */
const VOX = 0.25;
/** World units per Friend sprite pixel: 16 px ≈ 1.6 u, a little wider than the 0.9 u collision ball (it reads). */
const FRIEND_PX = 0.1;
const TAU = Math.PI * 2;

/** Options of the scene. */
export interface PuttSceneOptions {
  readonly appearance: FriendAppearance;
  readonly lost: Hex64;
  readonly gold: number;
  readonly reducedMotion: boolean;
}

/** A tiny stepped particle system (paper dust, confetti): instanced unit boxes with gravity. */
class Particles {
  readonly mesh: InstancedMesh;
  private readonly p: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    s: number;
  }[] = [];
  private readonly m = new Matrix4();
  private readonly geo = new BoxGeometry(1, 1, 1);
  private readonly mat: Material = createBandMaterial({ color: 0xffffff, lightMix: 0.5 });
  private next = 0;

  constructor(private readonly cap = 160) {
    this.mesh = new InstancedMesh(this.geo, this.mat, cap);
    this.mesh.count = 0;
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.mesh.frustumCulled = false;
    this.mesh.name = "putt-particles";
    untagged(this.mesh);
    for (let i = 0; i < cap; i++) this.p.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, s: 0 });
  }

  /** Spawns `n` voxels at (x, y, z) in the given colours, flung outward/upward at up to `speed` u/s. */
  burst(x: number, y: number, z: number, colors: readonly number[], n: number, speed: number, size: number): void {
    for (let k = 0; k < n; k++) {
      const q = this.p[this.next];
      const i = this.next;
      this.next = (this.next + 1) % this.cap;
      if (!q) continue;
      const a = hash3(k, i, 3) * TAU;
      const up = 0.4 + hash3(k, i, 5) * 0.8;
      const v = speed * (0.4 + hash3(i, k, 7) * 0.6);
      Object.assign(q, {
        x,
        y,
        z,
        vx: Math.cos(a) * v,
        vy: up * speed,
        vz: Math.sin(a) * v,
        life: 0.6 + up * 0.5,
        s: size,
      });
      this.color(i, colors[k % colors.length] ?? PALETTE.paper);
    }
  }

  private color(i: number, hex: number): void {
    const c = { r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 };
    const arr = this.mesh.instanceColor;
    if (arr) {
      arr.setXYZ(i, c.r, c.g, c.b);
      arr.needsUpdate = true;
    }
  }

  /** Advances every live voxel (positions snap to a 1/32 u grid so motion stays pixel-stepped). */
  update(dt: number): void {
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      const q = this.p[i];
      if (!q) continue;
      if (q.life > 0) {
        q.life -= dt;
        q.vy -= 18 * dt;
        q.x += q.vx * dt;
        q.y = Math.max(0.03, q.y + q.vy * dt);
        q.z += q.vz * dt;
        live = i + 1;
      }
      const s = q.life > 0 ? q.s : 0;
      const g = (v: number): number => Math.round(v * 32) / 32;
      this.m.makeScale(s, s, s).setPosition(g(q.x), g(q.y), g(q.z));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = live;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}

interface HoleVisual {
  readonly group: Group;
  readonly blades: { readonly w: PixelPutt.PuttWindmill; readonly obj: Object3D; readonly sail: Object3D }[];
  readonly movers: { readonly m: PixelPutt.PuttMover; readonly obj: Object3D }[];
  readonly nibs: { readonly n: PixelPutt.PuttNib; readonly view: CreatureView; readonly tilt: Group }[];
  readonly bumpers: { readonly b: PixelPutt.PuttBumper; readonly obj: Object3D; hit: number }[];
  readonly flag: Object3D;
  readonly geometries: BufferGeometry[];
}

/** Lattice distance to the void for every surface cell (BFS), for the stalactite underside depth. */
function edgeDistance(cells: ReadonlySet<number>): Map<number, number> {
  const dist = new Map<number, number>();
  let frontier: number[] = [];
  for (const key of cells) {
    const { i, j } = PixelPutt.cellOf(key);
    const n4 = [
      PixelPutt.cellKey(i + 1, j),
      PixelPutt.cellKey(i - 1, j),
      PixelPutt.cellKey(i, j + 1),
      PixelPutt.cellKey(i, j - 1),
    ];
    if (n4.some((k) => !cells.has(k))) {
      dist.set(key, 0);
      frontier.push(key);
    }
  }
  let d = 0;
  while (frontier.length) {
    d++;
    const next: number[] = [];
    for (const key of frontier) {
      const { i, j } = PixelPutt.cellOf(key);
      for (const k of [
        PixelPutt.cellKey(i + 1, j),
        PixelPutt.cellKey(i - 1, j),
        PixelPutt.cellKey(i, j + 1),
        PixelPutt.cellKey(i, j - 1),
      ]) {
        if (cells.has(k) && !dist.has(k)) {
          dist.set(k, d);
          next.push(k);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

function strata(k: number, rows: number, drip: boolean): number {
  if (k === 1) return drip ? PALETTE.meadowDrip : PALETTE.coral;
  if (k === 2) return PALETTE.coralDark;
  if (k > rows - 2) return PALETTE.lilacDark;
  return PALETTE.lilac;
}

/** The venue scene. */
export class PuttScene {
  readonly root = new Group();
  readonly friendRoot = new Group();
  private readonly spin = new Group();
  private readonly friend: FriendModel;
  private readonly shadow: ProjectedShadow;
  private readonly particles = new Particles();
  private readonly material: Material = createBandMaterial({ vertexColors: true, bandAttribute: true });
  private readonly sky: { dispose(): void }[] = [];
  private hole: HoleVisual | null = null;
  private readonly q = new Quaternion();
  private readonly axis = new Vector3();
  private squashT = 0;
  private restT = 0;
  private sunkT = 0;
  private readonly restQ = new Quaternion();
  private tilt = (52 * Math.PI) / 180;
  private yawRad = 0;
  private time = 0;

  constructor(private readonly opts: PuttSceneOptions) {
    this.root.name = "pixel-putt";
    this.friend = buildFriendModel(opts.appearance, opts.lost, { gold: opts.gold, lod: 0, pixelSize: FRIEND_PX });
    // Pivot at the body centre so the tumble spins in place instead of cartwheeling around the feet.
    this.friend.object.position.y = -this.friend.height / 2;
    this.spin.add(this.friend.object);
    this.friendRoot.add(this.spin);
    this.spin.position.y = this.friend.height / 2;
    this.root.add(this.friendRoot, this.particles.mesh);
    this.shadow = attachProjectedShadow(this.friendRoot, { groundY: 0.01, sun: SUN_DIRECTION.clone() });
    this.buildSky();
  }

  /** Height of the standing Friend (u), for callout anchors. */
  get friendHeight(): number {
    return this.friend.height;
  }

  /**
   * Camera yaw and pitch (degrees): the resting Friend turns to the camera and its plate leans back by most of the
   * pitch so the face, not the top edge, meets a high golf camera (the same trick Loose Pixels uses at 32°).
   */
  setView(yawDeg: number, pitchDeg: number): void {
    this.tilt = (pitchDeg * Math.PI) / 180;
    this.yawRad = (yawDeg * Math.PI) / 180;
    for (const n of this.hole?.nibs ?? []) this.leanToCamera(n.tilt);
    this.restQ.setFromEuler(new Euler((-pitchDeg * 0.85 * Math.PI) / 180, (yawDeg * Math.PI) / 180, 0, "YXZ"));
  }

  private buildSky(): void {
    const clouds = buildClouds([
      { x: -18, y: -9, z: 9, width: 4, seed: 3 },
      { x: 17, y: -10, z: 11, width: 5, seed: 5 },
      { x: 2, y: -12, z: 15, width: 6, seed: 8 },
    ]);
    this.root.add(clouds.mesh);
    this.sky.push(clouds);
  }

  /** Replaces the hole on display. */
  setHole(hole: PuttHole): void {
    this.disposeHole();
    const group = new Group();
    group.name = `putt-hole-${hole.number}`;
    const geometries: BufferGeometry[] = [];
    const mesher = new VoxelMesher();
    const grid = mesher.grid(VOX, [VOX / 2, -VOX / 2, VOX / 2]);
    const cells = new Set(hole.cells);
    const edge = edgeDistance(cells);
    const cup = hole.cup;
    const tee = hole.tee;
    const inSlope = (x: number, z: number): PixelPutt.PuttSlope | undefined =>
      (hole.slopes ?? []).find((s) => PixelPutt.inRect(s, x, z));
    for (const key of hole.cells) {
      const { i, j } = PixelPutt.cellOf(key);
      const e = edge.get(key) ?? 0;
      const rows = Math.min(9, 2 + Math.floor(e * 0.9 + hash3(i, j, hole.number) * 2.5));
      for (let a = 0; a < 2; a++)
        for (let b = 0; b < 2; b++) {
          const vi = i * 2 + a;
          const vj = j * 2 + b;
          const x = (vi + 0.5) * VOX;
          const z = (vj + 0.5) * VOX;
          const dc = Math.hypot(x - cup.x, z - cup.z);
          if (dc < PixelPutt.PUTT.cupR * 0.85) continue; // the cup is a hole in the top
          const dt = Math.max(Math.abs(x - tee.x), Math.abs(z - tee.z));
          let top: number;
          if (dt < 0.75) top = ((vi + vj) & 1) === 0 ? PALETTE.paper : PALETTE.tile;
          else if (dc < PixelPutt.PUTT.cupR + 0.3) top = PALETTE.paper;
          else if (dc < 2.4) top = dc > 2.1 ? PALETTE.meadowDrip : PALETTE.meadowLight;
          else if (inSlope(x, z)) top = ((vi >> 1) + (vj >> 1)) & 1 ? PALETTE.meadowDrip : PALETTE.meadow;
          else top = (i >> 1) & 1 ? PALETTE.meadowLight : PALETTE.meadow;
          grid.set(vi, 0, vj, top, TERRAIN);
          const drip = e === 0 && hash3(vi, vj, 9) < 0.4;
          for (let k = 1; k <= rows; k++) grid.set(vi, -k, vj, strata(k, rows, drip), STRATA);
        }
    }
    // Cup: an ink well below the rim.
    mesher.box(
      [cup.x, -0.3, cup.z],
      [PixelPutt.PUTT.cupR * 1.7, 0.1, PixelPutt.PUTT.cupR * 1.7],
      PALETTE.doorway,
      DECOR,
    );
    // Flag pole at the back of the cup.
    mesher.box([cup.x, 1.1, cup.z - 0.05], [0.08, 2.2, 0.08], PALETTE.ink, DECOR);
    // Slope chevrons: a sun "V" of 5 voxels every 2 u, pointing downhill.
    for (const sl of hole.slopes ?? []) {
      const len = Math.hypot(sl.ax, sl.az) || 1;
      const ux = sl.ax / len;
      const uz = sl.az / len;
      for (let x = sl.x0 + 1; x < sl.x1; x += 2)
        for (let z = sl.z0 + 1; z < sl.z1; z += 2)
          for (let k = -2; k <= 2; k++) {
            const back = Math.abs(k) * 0.16;
            mesher.box(
              [x - ux * back - uz * k * 0.16, 0.03, z - uz * back + ux * k * 0.16],
              [0.16, 0.06, 0.16],
              PALETTE.sun,
              DECOR,
              {
                skipBottom: true,
              },
            );
          }
    }
    // Rails: paper blocks with ink posts, 1 u rhythm.
    for (const r of hole.rails) {
      const horizontal = r.az === r.bz;
      const len = horizontal ? r.bx - r.ax : r.bz - r.az;
      const n = Math.max(1, Math.round(len));
      for (let s = 0; s < n; s++) {
        const a = (s / n) * len;
        const b = ((s + 1) / n) * len;
        const mid = (a + b) / 2;
        const cx = horizontal ? r.ax + mid : r.ax;
        const cz = horizontal ? r.az : r.az + mid;
        const size: [number, number, number] = horizontal ? [b - a, 0.36, 0.22] : [0.22, 0.36, b - a];
        mesher.box([cx, 0.18, cz], size, s % 2 ? PALETTE.paperWarm : PALETTE.tile, TERRAIN, { skipBottom: true });
      }
      // Ink posts cap straight runs only: stair-stepped disc edges would bristle with them.
      if (len >= 2.5)
        for (const [px, pz] of [
          [r.ax, r.az],
          [r.bx, r.bz],
        ] as const)
          mesher.box([px, 0.24, pz], [0.28, 0.48, 0.28], PALETTE.ink, TERRAIN, { skipBottom: true });
    }
    // Windmill towers (static part).
    for (const w of hole.windmills ?? []) {
      mesher.box([w.x, 0.7, w.z], [0.9, 1.4, 0.9], PALETTE.paperWarm, TERRAIN, { skipBottom: true });
      mesher.box([w.x, 1.5, w.z], [1.1, 0.2, 1.1], PALETTE.coral, TERRAIN);
      mesher.box([w.x, 1.7, w.z], [0.7, 0.2, 0.7], PALETTE.coralDark, TERRAIN);
      mesher.box([w.x, 0.3, w.z + 0.46], [0.36, 0.5, 0.04], PALETTE.doorway, DECOR);
    }
    const built = mesher.build({ sun: SUN_DIRECTION.clone(), maxDistance: 6 });
    geometries.push(built.geometry);
    const main = new Mesh(built.geometry, this.material);
    main.name = "putt-hole-static";
    group.add(main);

    // Flag cloth (animated): coral with the hole number in paper dots.
    const fm = new VoxelMesher();
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 6 - Math.floor(y / 3); x++)
        fm.box(
          [0.06 + x * 0.12, -y * 0.12, 0],
          [0.12, 0.12, 0.05],
          (x + y) % 5 === 2 ? PALETTE.paper : PALETTE.coral,
          SOFT,
        );
    const fb = fm.build();
    geometries.push(fb.geometry);
    const flag = new Mesh(fb.geometry, this.material);
    flag.position.set(cup.x + 0.04, 2.1, cup.z - 0.05);
    group.add(flag);

    // Bumpers: coral drums with a paper cap, one mesh each (they squash on hits).
    const bumpers: HoleVisual["bumpers"] = [];
    for (const b of hole.bumpers ?? []) {
      const bm = new VoxelMesher();
      const g = bm.grid(0.125, [0, 0.0625, 0]);
      const n = Math.ceil(b.r / 0.125);
      for (let i = -n; i <= n; i++)
        for (let j = -n; j <= n; j++) {
          const d = Math.hypot(i * 0.125, j * 0.125);
          if (d > b.r) continue;
          const rim = d > b.r - 0.2;
          for (let k = 0; k < 4; k++)
            g.set(
              i,
              k,
              j,
              k === 3 ? (rim ? PALETTE.coralDark : PALETTE.paper) : rim ? PALETTE.coral : PALETTE.coralDark,
              TERRAIN,
            );
          if (d < b.r * 0.35) g.set(i, 4, j, PALETTE.sun, TERRAIN);
        }
      const out = bm.build();
      geometries.push(out.geometry);
      const obj = new Mesh(out.geometry, this.material);
      obj.position.set(b.x, 0, b.z);
      group.add(obj);
      bumpers.push({ b, obj, hit: 0 });
    }

    // Windmill arms (spin on the ground plane) and a little decorative sail on the roof.
    const blades: HoleVisual["blades"] = [];
    for (const w of hole.windmills ?? []) {
      const am = new VoxelMesher();
      for (let b = 0; b < w.blades; b++) {
        // Arm b points along sim angle b/n of a turn; the group's rotation.y = −(blade 0 angle) turns them all.
        const a = (b / w.blades) * TAU;
        for (let s = 0.55; s < w.len; s += 0.25) {
          const tip = s + 0.25 >= w.len;
          const c = tip ? PALETTE.paper : Math.floor(s * 4) % 2 ? PALETTE.lilac : PALETTE.lilacDark;
          am.box([Math.cos(a) * (s + 0.125), 0.2, Math.sin(a) * (s + 0.125)], [0.25, 0.34, 0.34], c, TERRAIN, {
            rotation: new Object3D().rotation.set(0, -a, 0),
          });
        }
      }
      const ab = am.build();
      geometries.push(ab.geometry);
      const obj = new Mesh(ab.geometry, this.material);
      obj.position.set(w.x, 0, w.z);
      group.add(obj);
      const sm = new VoxelMesher();
      for (let b = 0; b < 4; b++) {
        const a = (b / 4) * TAU;
        for (let s = 0.1; s < 0.9; s += 0.14)
          sm.box([Math.cos(a) * s, Math.sin(a) * s, 0], [0.14, 0.14, 0.04], b % 2 ? PALETTE.paper : PALETTE.sun, SOFT);
      }
      const sb = sm.build();
      geometries.push(sb.geometry);
      const sail = new Mesh(sb.geometry, this.material);
      sail.position.set(w.x, 1.25, w.z + 0.5);
      group.add(sail);
      blades.push({ w, obj, sail });
    }

    // Cloud ferries / sliding bridges.
    const movers: HoleVisual["movers"] = [];
    for (const m of hole.movers ?? []) {
      const mm = new VoxelMesher();
      const g = mm.grid(VOX, [m.x0 + VOX / 2, -VOX / 2, m.z0 + VOX / 2]);
      const ni = Math.round((m.x1 - m.x0) / VOX);
      const nj = Math.round((m.z1 - m.z0) / VOX);
      for (let i = 0; i < ni; i++)
        for (let j = 0; j < nj; j++) {
          const rim = i === 0 || j === 0 || i === ni - 1 || j === nj - 1;
          g.set(i, 0, j, rim ? PALETTE.cloud : (i + j) % 2 ? PALETTE.cloud : PALETTE.paper, SOFT);
          if (!rim || hash3(i, j, 4) < 0.5) g.set(i, -1, j, PALETTE.cloud, SOFT);
          if (!rim && hash3(i, j, 6) < 0.4) g.set(i, -2, j, PALETTE.pondLight, SOFT);
        }
      const out = mm.build();
      geometries.push(out.geometry);
      const obj = new Mesh(out.geometry, this.material);
      group.add(obj);
      movers.push({ m, obj });
    }

    // Nib hazards.
    const nibs: HoleVisual["nibs"] = [];
    (hole.nibs ?? []).forEach((n, i) => {
      const view = createCreatureView("nib", { voxel: 0.12, seed: i + 1 });
      view.setState("idle");
      view.setFacing(0, 1);
      // Lean the sprite back toward the high golf camera, like the Friend (the view itself is never rotated).
      const tilt = new Group();
      this.leanToCamera(tilt);
      tilt.add(view.object);
      group.add(tilt);
      nibs.push({ n, view, tilt });
    });

    this.root.add(group);
    this.hole = { group, blades, movers, nibs, bumpers, flag, geometries };
  }

  /** Turns a sprite holder to face the camera yaw and leans it back by most of the pitch. */
  private leanToCamera(o: Object3D): void {
    o.rotation.set(-this.tilt * 0.7, this.yawRad, 0, "YXZ");
  }

  /** Flashes/squashes the bumper nearest (x, z). */
  bumperHit(x: number, z: number): void {
    let best: HoleVisual["bumpers"][number] | null = null;
    let bd = Infinity;
    for (const b of this.hole?.bumpers ?? []) {
      const d = Math.hypot(b.b.x - x, b.b.z - z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best) best.hit = 0.2;
  }

  /** The Nib nearest (x, z) reacts (hit flash + a line). */
  nibHit(x: number, z: number, line: string): void {
    let best: CreatureView | null = null;
    let bd = Infinity;
    for (const n of this.hole?.nibs ?? []) {
      const p = n.tilt.position;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = n.view;
      }
    }
    best?.playHit();
    best?.say(line, 1);
  }

  /** Squash the Friend on an impact (2 frames 0.85 × 1.15, back in 2 steps: art bible §7). */
  squash(): void {
    this.squashT = 0.1;
  }

  /** Paper dust at a landing/bounce. */
  dust(x: number, z: number, n = 5): void {
    this.particles.burst(
      x,
      0.1,
      z,
      [PALETTE.paper, PALETTE.paperWarm, PALETTE.meadowLight],
      this.opts.reducedMotion ? 2 : n,
      2.2,
      0.08,
    );
  }

  /** Confetti from the cup: a big fountain for a hole in one. */
  confetti(x: number, z: number, big: boolean): void {
    const colors = [PALETTE.sun, PALETTE.coral, PALETTE.lilac, PALETTE.paper, PALETTE.pond, PALETTE.gold];
    const n = this.opts.reducedMotion ? (big ? 16 : 8) : big ? 70 : 26;
    this.particles.burst(x, 0.2, z, colors, n, big ? 7 : 4.5, big ? 0.12 : 0.1);
  }

  /** A splash of lilac voxels where the Friend dropped off the course. */
  splash(x: number, z: number): void {
    this.particles.burst(
      x,
      -0.8,
      z,
      [PALETTE.cloud, PALETTE.lilac, PALETTE.paper],
      this.opts.reducedMotion ? 4 : 12,
      3,
      0.1,
    );
  }

  /** World position of a sim point (identity mapping; `out` reused). */
  world(x: number, z: number, y: number, out: Vector3): Vector3 {
    return out.set(x, y, z);
  }

  /**
   * Places everything for a frame: `prev`/`cur` are the last two sim views, `alpha` the fixed-step blend,
   * `dt` real seconds (0 while hit-stopped).
   */
  sync(prev: PuttView, cur: PuttView, alpha: number, dt: number): void {
    this.time += dt;
    const a = prev.hole === cur.hole ? alpha : 1;
    const lerp = (p: number, c: number): number => p + (c - p) * a;
    const pb = prev.hole === cur.hole ? prev.ball : cur.ball;
    const b = cur.ball;
    const x = lerp(pb.x, b.x);
    const z = lerp(pb.z, b.z);
    const y = lerp(pb.y, b.y);
    const ht = prev.hole === cur.hole ? lerp(prev.holeTick, cur.holeTick) : cur.holeTick;
    const hole = this.hole;
    if (hole) {
      for (const bl of hole.blades) {
        const ang = PixelPutt.bladeAngle(bl.w, ht, 0, bl.w.blades);
        bl.obj.rotation.y = -(ang / 4096) * TAU;
        // The roof sail turns at a stepped 12 fps (presentation animation rule).
        bl.sail.rotation.z = Math.floor(this.time * 12) * 0.2 * Math.sign(bl.w.speed || 1);
      }
      for (const mv of hole.movers) {
        const o = PixelPutt.motionOffset(mv.m.move, ht);
        mv.obj.position.set(o.x, 0, o.z);
      }
      for (const nb of hole.nibs) {
        const o = PixelPutt.motionOffset(nb.n.move, ht);
        nb.tilt.position.set(nb.n.x + o.x, 0, nb.n.z + o.z);
        nb.view.update(dt);
      }
      for (const bu of hole.bumpers) {
        bu.hit = Math.max(0, bu.hit - dt);
        const s = bu.hit > 0.1 ? 1.25 : bu.hit > 0 ? 1.1 : 1;
        bu.obj.scale.set(s, bu.hit > 0.1 ? 0.8 : 1, s);
      }
      hole.flag.scale.x = Math.floor(this.time * 6) % 2 ? 0.9 : 1;
    }
    this.particles.update(dt);

    // The Friend: tumbling ball while moving, upright and facing the camera at rest, sinking into the cup.
    const moving = b.mode === "roll" || b.mode === "air" || b.mode === "fall";
    const sunk = b.mode === "sunk";
    // Dropping into the cup: 3 stepped moves down over 0.15 s, then gone until the next tee.
    this.sunkT = sunk ? this.sunkT + dt : 0;
    const drop = sunk ? Math.min(3, Math.floor(this.sunkT * 20)) * 0.45 : 0;
    this.friendRoot.position.set(x, y - drop, z);
    this.friendRoot.visible = !(sunk && this.sunkT > 0.2);
    const sp = Math.hypot(b.vx, b.vz);
    if (moving && sp > 0.01 && dt > 0) {
      this.restT = 0;
      this.axis.set(b.vz / sp, 0, -b.vx / sp);
      this.q.setFromAxisAngle(this.axis, (sp * dt) / 0.55);
      this.spin.quaternion.premultiply(this.q);
    } else if (!moving) {
      this.restT += dt;
      // Stand back up in 3 stepped moves, then face the camera.
      const k = Math.min(1, Math.floor(this.restT * 18) / 3);
      this.spin.quaternion.slerp(this.restQ, k);
    }
    const sq = this.squashT > 0.05 ? [1.15, 0.85] : this.squashT > 0 ? [1.07, 0.93] : [1, 1];
    this.squashT = Math.max(0, this.squashT - dt);
    const bob = !moving && !sunk && !this.opts.reducedMotion ? (Math.floor(this.time * 4) % 2) * 0.03 : 0;
    this.spin.position.y = this.friend.height / 2 + bob;
    this.spin.scale.set(sq[0] ?? 1, sq[1] ?? 1, sq[0] ?? 1);
    this.shadow.setGround(b.mode === "fall" ? -50 : 0.01);
  }

  private disposeHole(): void {
    const h = this.hole;
    if (!h) return;
    for (const n of h.nibs) n.view.dispose();
    for (const g of h.geometries) g.dispose();
    h.group.removeFromParent();
    this.hole = null;
  }

  /** Frees every resource the scene created. */
  dispose(): void {
    this.disposeHole();
    this.shadow.dispose();
    this.friend.dispose();
    this.particles.dispose();
    this.material.dispose();
    for (const s of this.sky) s.dispose();
    this.root.removeFromParent();
  }
}
