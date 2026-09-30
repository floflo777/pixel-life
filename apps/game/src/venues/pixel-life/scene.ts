/**
 * The venue's three.js scene: the arena island (art bible frame 1), the detachable voxel Friend, creatures (through an
 * injectable factory until `apps/game/src/creatures` lands), loose pixels, Old Gulp, bumpers and presentation particles.
 * It only reads sim views: interpolation between the last two fixed steps happens here, gameplay never does.
 */
import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
  type Material,
} from "three";
import { EMPTY_MASK, fromIndices, type FriendAppearance, type Hex64 } from "@pl/shared";
import { buildDetachableFriend, type DetachableFriend } from "../../friend";
import { createBandMaterial } from "../../post/band-material";
import { tagGlow, tagHalo, untagged } from "../../post/tags";
import { PALETTE } from "../../stage/palette";
import { buildClouds } from "../../world/clouds";
import { buildIsland, type IslandModel } from "../../world/island";
import { attachProjectedShadow, type ProjectedShadow } from "../../world/projected-shadow";
import { impactSquash, stretchFor } from "./juice";
import { KIND, PX, type BodyView, type CreatureView, type DebrisView, type FullSimView } from "./sim-view";

/** World units per sim unit (1 u = 1 sprite pixel = the Friend's voxel size). */
export const U = 0.15;
/** In-run camera pitch (art bible: 32°); the Friend plate is pitched back by it so its face meets the camera. */
export const RUN_PITCH_DEG = 32;
const DEG = Math.PI / 180;

/** A creature's renderer. `update` receives the interpolated creature and time; stepped animation is its business. */
export interface CreatureVisual {
  readonly object: Object3D;
  update(c: CreatureView, t: { readonly dt: number; readonly time: number; readonly reducedMotion: boolean }): void;
  dispose(): void;
}

/** Builds a creature visual for a kind (0 Nib … 5 Fizz). The creatures module plugs in here. */
export type CreatureFactory = (kind: number) => CreatureVisual;

/** Options of the scene. */
export interface RunSceneOptions {
  readonly appearance: FriendAppearance;
  readonly startLost: Hex64;
  readonly goldHeld: number;
  readonly arena: { readonly a: number; readonly b: number; readonly name: string };
  readonly seed: number;
  readonly creatureFactory?: CreatureFactory;
  readonly reducedMotion: boolean;
}

// ── Placeholder creatures (until apps/game/src/creatures lands) ─────────────────────────────────────────────────────

/** Tiny 1-bit-ish sprites per kind: `#` ink, `a` accent, `p` paper, `.` empty. Row 0 is the top. */
const PLACEHOLDER_SPRITES: readonly (readonly string[])[] = [
  [".aaa.", "apapa", "aaaaa", "#.#.#"],
  ["..#..", ".aaa.", "apapa", ".aaa.", "#...#", "#...#"],
  ["..aaaa..", ".aaaaaa.", "#pa##ap#", "########", "#.#..#.#"],
  ["aa.....aa", ".aaa#aaa.", "..#p#p#..", "...###...", "....#...."],
  ["..aaaaaa..", ".apaaaap.", "aaaaaaaaaa", "a########a", "#.#....#.#"],
  ["#.a.#", ".aaa.", "apapa", ".aaa.", "#...#"],
];
/** Accent per kind (GDD §3.1). */
const ACCENTS = [PALETTE.coral, PALETTE.sun, PALETTE.pond, PALETTE.lilac, PALETTE.lilac, PALETTE.sun] as const;

let placeholderMaterial: Material | null = null;
const placeholderBox = new BoxGeometry(1, 1, 1);

/** The default factory: voxel sprites from the table above, pastel with ink details (not final art). */
export function placeholderCreature(kind: number): CreatureVisual {
  const rows = PLACEHOLDER_SPRITES[kind] ?? PLACEHOLDER_SPRITES[0] ?? [];
  const cells: { x: number; y: number; c: number }[] = [];
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx];
      if (ch === "." || ch === undefined) continue;
      const c = ch === "#" ? PALETTE.ink : ch === "p" ? PALETTE.paper : (ACCENTS[kind] ?? PALETTE.coral);
      cells.push({ x: rx - w / 2 + 0.5, y: h - ry - 0.5, c });
    }
  });
  placeholderMaterial ??= createBandMaterial({ lightMix: 0.3 });
  const mesh = new InstancedMesh(placeholderBox, placeholderMaterial, cells.length);
  const m = new Matrix4();
  const col = new Color();
  const s = U * 1.15;
  cells.forEach((cell, i) => {
    m.makeScale(s, s, s * 1.6).setPosition(cell.x * s, cell.y * s, 0);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.setHex(cell.c));
  });
  mesh.name = `creature-placeholder-${kind}`;
  const inner = new Group();
  inner.rotation.x = -RUN_PITCH_DEG * DEG * 0.8;
  inner.add(mesh);
  const object = new Group();
  object.add(inner);
  return {
    object,
    update(c, t) {
      // Face left/right like a sprite; stepped wobble at 6 fps; crouch while telegraphing; fuse blink for Fizz.
      const left = Math.cos((c.facing / 4096) * 2 * Math.PI) < 0;
      const frame = Math.floor(t.time * 6) % 2;
      const tele = c.telegraph ? (kind === KIND.fizz ? (Math.floor(t.time * 10) % 2 ? 1.25 : 1) : 0.8) : 1;
      const spawn = c.spawning > 0 ? Math.min(1, Math.ceil((1 - c.spawning / 36) * 3) / 3) : 1;
      inner.scale.set((left ? -1 : 1) * spawn, tele * spawn * (frame && !t.reducedMotion ? 0.94 : 1), spawn);
      object.visible = c.stun <= 0 || Math.floor(t.time * 8) % 2 === 0;
    },
    dispose() {
      mesh.dispose();
    },
  };
}

// ── Particles ───────────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_SHARDS = 192;

interface Shard {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
}

/** Presentation-only voxel shards (pops, dust, crumbles). Uses sim-scaled time so they freeze during hit-stop. */
class Shards {
  readonly mesh: InstancedMesh;
  private readonly items: (Shard | null)[] = Array.from({ length: MAX_SHARDS }, () => null);
  private next = 0;
  private readonly m = new Matrix4();
  private readonly col = new Color();
  private seed = 1;

  constructor(material: Material) {
    this.mesh = new InstancedMesh(placeholderBox, material, MAX_SHARDS);
    this.mesh.frustumCulled = false;
    this.mesh.name = "venue-shards";
    for (let i = 0; i < MAX_SHARDS; i++) {
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, this.col.setHex(PALETTE.paper));
    }
  }

  private rand(): number {
    // Cosmetic LCG: shards never touch gameplay.
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  burst(x: number, y: number, z: number, colors: readonly number[], n: number, speed = 5, size = 0.09): void {
    for (let k = 0; k < n; k++) {
      const a = this.rand() * Math.PI * 2;
      const s = speed * (0.5 + this.rand() * 0.8);
      const i = this.next;
      this.next = (this.next + 1) % MAX_SHARDS;
      this.items[i] = {
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: 2 + this.rand() * speed,
        vz: Math.sin(a) * s * 0.6,
        life: 0.5 + this.rand() * 0.35,
        size,
      };
      this.mesh.setColorAt(i, this.col.setHex(colors[k % colors.length] ?? PALETTE.paper));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_SHARDS; i++) {
      const s = this.items[i];
      if (!s) continue;
      s.life -= dt;
      if (s.life <= 0) {
        this.items[i] = null;
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      s.vy -= 18 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (s.y < 0.02) {
        s.y = 0.02;
        s.vy = -s.vy * 0.3;
        s.vx *= 0.6;
        s.vz *= 0.6;
      }
      // Pixel-grid feel: shrink in 2 steps near the end.
      const k = s.life < 0.15 ? 0.5 : 1;
      this.mesh.setMatrixAt(i, this.m.makeScale(s.size * k, s.size * k, s.size * k).setPosition(s.x, s.y, s.z));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ── The scene ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface Snap {
  pid: number;
  from: Vector3;
  t: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Lost pixels (new scars, safety stitches and pre-run scars) as a mask. */
function lostMaskOf(pixels: Uint8Array): Hex64 {
  const idx: number[] = [];
  for (let i = 0; i < 256; i++) {
    const s = pixels[i];
    if (s === PX.lost || s === PX.safety || s === PX.oldScar) idx.push(i);
  }
  return idx.length ? fromIndices(idx) : EMPTY_MASK;
}

/** Sector of the island ellipse from angle `dir` ± `half` (sim angle units), beyond the inner radius share. */
function wedgeGeometry(a: number, b: number, dir: number, half: number, inner = 0.4): ShapeGeometry {
  const shape = new Shape();
  const steps = 24;
  const t0 = ((dir - half) / 4096) * Math.PI * 2;
  const t1 = ((dir + half) / 4096) * Math.PI * 2;
  const pt = (t: number, k: number): [number, number] => [Math.cos(t) * a * k * U, Math.sin(t) * b * k * U];
  shape.moveTo(...pt(t0, inner));
  for (let i = 0; i <= steps; i++) shape.lineTo(...pt(lerp(t0, t1, i / steps), 1.12));
  for (let i = steps; i >= 0; i--) shape.lineTo(...pt(lerp(t0, t1, i / steps), inner));
  const g = new ShapeGeometry(shape);
  // Shape lives in XY; lay it on the ground with +Y → +Z (sim z points toward the camera).
  g.rotateX(Math.PI / 2);
  return g;
}

/** The venue scene. */
export class RunScene {
  readonly root = new Group();
  readonly island: IslandModel;
  readonly friend: DetachableFriend;
  readonly friendPos = new Vector3();
  private readonly friendRoot = new Group();
  private readonly shadows: ProjectedShadow[] = [];
  private readonly creatures = new Map<number, CreatureVisual>();
  private readonly factory: CreatureFactory;
  private readonly shards: Shards;
  private readonly shardMaterial: Material;
  private readonly clouds: { mesh: Mesh; dispose(): void };
  private readonly bumpers: Mesh[] = [];
  private readonly bumperGeo: BoxGeometry;
  private readonly bumperMat: Material;
  private lostKey = "";
  private readonly detached = new Set<number>();
  private snaps: Snap[] = [];
  private readonly tmpV = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly axis = new Vector3(1, 0.4, 0.2).normalize();
  private hopStart = -1;
  private hopHeight = 0;
  private squashAt = -1;
  private wedge: Mesh | null = null;
  private wedgeKey = "";
  private readonly wedgeMat = new MeshBasicMaterial({ color: PALETTE.lilacDark, transparent: true, opacity: 0 });
  private readonly gulp: Group;
  private readonly gulpMats: Material[] = [];
  private readonly gulpGeos: BoxGeometry[] = [];
  private readonly teeth: Mesh[] = [];
  private readonly toothLitMat: Material;
  private readonly toothMat: Material;
  private gulpY = -8;
  private readonly ripples: { mesh: Mesh; t: number }[] = [];
  private readonly rippleGeo = new RingGeometry(0.5, 0.62, 20);
  private readonly rippleMat = new MeshBasicMaterial({ color: PALETTE.ink, side: DoubleSide });
  reducedMotion: boolean;

  constructor(opts: RunSceneOptions) {
    this.reducedMotion = opts.reducedMotion;
    this.factory = opts.creatureFactory ?? placeholderCreature;
    const { a, b } = opts.arena;
    const cell = 0.24;
    this.island = buildIsland({
      radius: Math.round((a * U) / cell) + 1,
      cell,
      seed: opts.seed % 1000,
      squash: b / a,
      underside: 11,
      scatter: { tufts: 70, flowers: 60 },
    });
    this.root.add(this.island.object);

    this.clouds = buildClouds([
      { x: -9.5, y: -2.4, z: 1, width: 3.2, seed: 11 },
      { x: 9.8, y: -3.2, z: 2, width: 2.8, seed: 12 },
      { x: -4, y: 2.4, z: -12, width: 2.6, seed: 13 },
      { x: 7, y: 3.6, z: -14, width: 3, seed: 14 },
    ]);
    this.root.add(this.clouds.mesh);

    this.bumperGeo = new BoxGeometry(0.3, 0.18, 0.3).translate(0, 0.09, 0);
    this.bumperMat = createBandMaterial({ color: PALETTE.stone });

    // The Friend: pitched back so its front plate meets the camera; yaw locked; roll-only tumble.
    this.friend = buildDetachableFriend(opts.appearance, opts.startLost, { gold: opts.goldHeld });
    this.friend.object.rotation.x = -RUN_PITCH_DEG * DEG;
    tagHalo(this.friend.object, "halo");
    this.friendRoot.add(this.friend.object);
    this.root.add(this.friendRoot);
    this.shadows.push(attachProjectedShadow(this.friendRoot, { groundY: 0 }));

    this.shardMaterial = createBandMaterial({ lightMix: 0.3 });
    this.shards = new Shards(this.shardMaterial);
    untagged(this.shards.mesh);
    this.root.add(this.shards.mesh);

    // Old Gulp placeholder: a paper cloud whale with an ink eye and three teeth.
    this.gulp = new Group();
    this.gulp.name = "old-gulp";
    const paper = createBandMaterial({ color: PALETTE.cloud, lightMix: 0.2 });
    const ink = createBandMaterial({ color: PALETTE.ink });
    const tongue = createBandMaterial({ color: PALETTE.lilac });
    this.gulpMats.push(paper, ink, tongue);
    const box = (w: number, h: number, d: number, m: Material, x: number, y: number, z: number): Mesh => {
      const g = new BoxGeometry(w, h, d);
      this.gulpGeos.push(g);
      const mesh = new Mesh(g, m);
      mesh.position.set(x, y, z);
      this.gulp.add(mesh);
      return mesh;
    };
    box(7.2, 2.6, 2.4, paper, 0, 1.3, -0.6);
    box(6.2, 0.9, 2.2, paper, 0.3, 3, -0.8);
    box(0.45, 0.45, 0.1, ink, -2.2, 2.2, 0.65);
    box(4.6, 0.25, 0.6, ink, 0.2, 0.55, 0.62);
    box(3.6, 0.12, 2.2, tongue, 0.2, 0.2, 1.2);
    this.gulp.visible = false;
    this.root.add(this.gulp);
    this.toothMat = createBandMaterial({ color: PALETTE.paper });
    this.toothLitMat = createBandMaterial({ color: PALETTE.sun, lightMix: 0.6 });
    const toothGeo = new BoxGeometry(0.42, 0.5, 0.42).translate(0, 0.25, 0);
    this.gulpGeos.push(toothGeo);
    for (let i = 0; i < 3; i++) {
      const t = new Mesh(toothGeo, this.toothMat);
      t.visible = false;
      t.name = `gulp-tooth-${i}`;
      this.teeth.push(t);
      this.root.add(t);
    }
    tagGlow(this.teeth[0] ?? new Object3D(), "lamp");
  }

  /** Starts the visual hop (parabola, apex 3 u) for flings with p ≥ 0.4. */
  hop(time: number, power: number): void {
    if (power < 0.4) return;
    this.hopStart = time;
    this.hopHeight = 3 * U * power;
  }

  /** Triggers the stepped impact squash. */
  squash(time: number): void {
    this.squashAt = time;
  }

  /** Voxel shard burst at a sim-space point (y in u above ground). */
  burst(x: number, z: number, colors: readonly number[], n = 6, y = 1, speed = 5): void {
    this.shards.burst(x * U, y * U, z * U, colors, n, speed * U * 7);
  }

  /** A spawn ripple (0.6 s dither ring) at a sim point. */
  ripple(x: number, z: number): void {
    let r = this.ripples.find((q) => q.t >= 0.6);
    if (!r) {
      const mesh = new Mesh(this.rippleGeo, this.rippleMat);
      mesh.rotation.x = -Math.PI / 2;
      untagged(mesh);
      this.root.add(mesh);
      r = { mesh, t: 0.6 };
      this.ripples.push(r);
    }
    r.t = 0;
    r.mesh.position.set(x * U, 0.02, z * U);
    r.mesh.visible = true;
  }

  /** World position (y at `h` u) of a sim point. */
  world(x: number, z: number, h = 0, out = this.tmpV): Vector3 {
    return out.set(x * U, h * U, z * U);
  }

  /**
   * Draws the interpolated state between `prev` and `cur`. `time` is real seconds (stepped presentation animation),
   * `simDt` the scaled seconds this frame (particles freeze in hit-stop).
   */
  sync(prev: FullSimView, cur: FullSimView, alpha: number, time: number, simDt: number): void {
    const t = { dt: simDt, time, reducedMotion: this.reducedMotion };
    this.syncFriend(prev, cur, alpha, time);
    this.syncDebris(prev, cur, alpha, time);
    this.syncCreatures(prev, cur, alpha, t);
    this.syncGulp(cur, time, simDt);
    for (const [i, bu] of cur.arena.bumpers.entries()) {
      let m = this.bumpers[i];
      if (!m) {
        m = new Mesh(this.bumperGeo, this.bumperMat);
        this.bumpers.push(m);
        this.root.add(m);
      }
      m.position.set(bu.x * U, 0, bu.z * U);
      m.scale.setScalar(bu.r / 2.2);
      m.visible = bu.active;
    }
    for (const r of this.ripples) {
      if (r.t >= 0.6) {
        r.mesh.visible = false;
        continue;
      }
      r.t += simDt;
      // Stepped: 3 rings, growing.
      const k = Math.min(3, Math.floor((r.t / 0.6) * 3) + 1);
      r.mesh.scale.setScalar(k * 0.5);
    }
    this.shards.update(simDt);
  }

  private syncFriend(prev: FullSimView, cur: FullSimView, alpha: number, time: number): void {
    const pb: BodyView | undefined = prev.friend.bodies[0];
    const cb: BodyView | undefined = cur.friend.bodies[0];
    if (!cb) return;
    const p = pb ?? cb;
    const x = lerp(p.x, cb.x, alpha);
    const z = lerp(p.z, cb.z, alpha);
    const f = cur.friend;
    let y = 0;
    if (this.hopStart >= 0) {
      const u = (time - this.hopStart) / 0.25;
      if (u >= 1) this.hopStart = -1;
      else y = this.hopHeight * 4 * u * (1 - u);
    }
    let roll = 0;
    if (f.ringout === 1) {
      const u = f.ringTicks / 21;
      y = -u * u * 3;
      // Stepped tumble: 4 keys over the fall.
      roll = (Math.floor(u * 4) / 4) * 25 * DEG * Math.sign(cb.x || 1);
    }
    this.friendRoot.visible = f.ringout !== 2 && !(f.invulnerable && Math.floor(time * 12) % 2 === 1);
    this.friendRoot.position.set(x * U, y, z * U);
    this.friendPos.set(x * U, y, z * U);
    this.friend.object.rotation.z = roll;
    const vx = lerp(p.vx, cb.vx, alpha);
    const vz = lerp(p.vz, cb.vz, alpha);
    const sp = Math.hypot(vx, vz);
    const st = this.reducedMotion ? { along: 1, across: 1 } : stretchFor(sp);
    const ux = sp > 0 ? Math.abs(vx / sp) : 0;
    const uz = sp > 0 ? Math.abs(vz / sp) : 0;
    const sq = this.squashAt >= 0 ? impactSquash((time - this.squashAt) * 1000) : 1;
    // Idle bob: stepped at 12 fps, 0.15 u at 1.6 Hz (whole plate: rows stay pixel-exact).
    const bob =
      sp < 1 && !this.reducedMotion ? Math.sin((Math.floor(time * 12) / 12) * 1.6 * Math.PI * 2) * 0.15 * U : 0;
    this.friend.object.position.y = bob;
    this.friendRoot.scale.set(
      st.across + (st.along - st.across) * ux,
      (st.across + (st.along - st.across) * uz) * sq,
      1,
    );
    const key = lostMaskOf(f.pixels);
    if (key !== this.lostKey) {
      this.lostKey = key;
      this.friend.setLost(key);
    }
  }

  private syncDebris(prev: FullSimView, cur: FullSimView, alpha: number, time: number): void {
    const prevBy = new Map<number, DebrisView>();
    for (const d of prev.debris) prevBy.set(d.pid, d);
    const live = new Set<number>();
    for (const d of cur.debris) {
      live.add(d.pid);
      if (!this.detached.has(d.pid)) {
        if (this.friend.instanceOf(d.pid) < 0) continue;
        this.friend.detach(d.pid);
        this.detached.add(d.pid);
      }
      const p = prevBy.get(d.pid) ?? d;
      const pos = this.tmpV.set(
        lerp(p.x, d.x, alpha) * U,
        (lerp(p.y, d.y, alpha) + 0.5) * U,
        lerp(p.z, d.z, alpha) * U,
      );
      // Tumble while moving; rest flat once it stops.
      const moving = Math.abs(d.vx) + Math.abs(d.vz) + Math.abs(d.vy) > 0.5;
      const ang = moving && !this.reducedMotion ? Math.floor(time * 12) * 0.7 + d.pid : 0;
      this.tmpQ.setFromAxisAngle(this.axis, ang);
      this.friend.setDetachedWorld(d.pid, pos, this.tmpQ, 1);
    }
    // Pixels that stopped being loose: grab-backs snap home in 3 steps (180 ms), losses hide.
    for (const pid of [...this.detached]) {
      if (live.has(pid)) continue;
      this.detached.delete(pid);
      const state = cur.friend.pixels[pid];
      if (state === PX.body) {
        const pd = prevBy.get(pid);
        const from = pd ? new Vector3(pd.x * U, (pd.y + 0.5) * U, pd.z * U) : this.friendPos.clone();
        this.snaps.push({ pid, from, t: time });
      } else {
        const pd = prevBy.get(pid);
        if (pd)
          this.shards.burst(pd.x * U, Math.max(0.05, pd.y * U), pd.z * U, [PALETTE.paper, PALETTE.halo], 4, 1.2, 0.05);
        this.friend.reattach(pid);
      }
    }
    const home = new Vector3();
    this.snaps = this.snaps.filter((s) => {
      const k = Math.floor(((time - s.t) / 0.18) * 3);
      if (k >= 3) {
        this.friend.reattach(s.pid);
        return false;
      }
      this.friend.homeWorld(s.pid, home);
      this.tmpV.copy(s.from).lerp(home, (k + 1) / 3);
      this.friend.setDetachedWorld(s.pid, this.tmpV, undefined, 1);
      return true;
    });
  }

  private syncCreatures(
    prev: FullSimView,
    cur: FullSimView,
    alpha: number,
    t: { dt: number; time: number; reducedMotion: boolean },
  ): void {
    const prevBy = new Map<number, CreatureView>();
    for (const c of prev.creatures) prevBy.set(c.id, c);
    const live = new Set<number>();
    for (const c of cur.creatures) {
      live.add(c.id);
      let v = this.creatures.get(c.id);
      if (!v) {
        v = this.factory(c.kind);
        this.creatures.set(c.id, v);
        this.root.add(v.object);
        this.shadows.push(attachProjectedShadow(v.object, { groundY: 0 }));
      }
      const p = prevBy.get(c.id) ?? c;
      const ic: CreatureView = { ...c, x: lerp(p.x, c.x, alpha), y: lerp(p.y, c.y, alpha), z: lerp(p.z, c.z, alpha) };
      v.object.position.set(ic.x * U, ic.y * U, ic.z * U);
      v.update(ic, t);
    }
    for (const [id, v] of this.creatures) {
      if (live.has(id)) continue;
      this.creatures.delete(id);
      this.root.remove(v.object);
      v.dispose();
    }
  }

  private syncGulp(cur: FullSimView, time: number, simDt: number): void {
    const g = cur.gulp;
    const a = cur.arena.a;
    const b = cur.arena.b;
    // Shadow wedge (dither steps 25 → 75 % over 2 s in 4 steps) and the bitten-out wedge.
    const show = g.shadow || g.wedgeOn;
    const key = `${g.wedgeDir}:${g.wedgeHalf}`;
    if (show && key !== this.wedgeKey) {
      this.wedgeKey = key;
      if (this.wedge) {
        this.root.remove(this.wedge);
        this.wedge.geometry.dispose();
      }
      this.wedge = new Mesh(wedgeGeometry(a, b, g.wedgeDir, g.wedgeHalf), this.wedgeMat);
      this.wedge.position.y = 0.012;
      this.wedge.renderOrder = 2;
      untagged(this.wedge);
      this.root.add(this.wedge);
    }
    if (this.wedge) {
      this.wedge.visible = show;
      if (g.wedgeOn) {
        this.wedgeMat.color.setHex(PALETTE.fog);
        this.wedgeMat.opacity = 1;
      } else if (g.shadow) {
        this.wedgeMat.color.setHex(PALETTE.lilacDark);
        const since = (cur.tick - 2400) / 120;
        this.wedgeMat.opacity = [0.25, 0.4, 0.55, 0.7][Math.max(0, Math.min(3, Math.floor(since * 4)))] ?? 0.7;
      }
    }
    // Gulp body: rises at the rim on the wedge side.
    const target = g.phase === 1 ? -3.2 : g.phase === 2 || g.phase === 3 ? -0.9 : -9;
    this.gulpY += (target - this.gulpY) * Math.min(1, simDt * 3);
    this.gulp.visible = g.phase >= 1 && g.phase <= 4 && this.gulpY > -8.5;
    const dir = (g.wedgeDir / 4096) * Math.PI * 2;
    const rim = Math.hypot(Math.cos(dir) * a, Math.sin(dir) * b) * U;
    this.gulp.position.set(Math.cos(dir) * (rim + 1.4), this.gulpY, Math.sin(dir) * (rim + 1.4));
    // Face the island centre on screen: turn so its mouth side points inward.
    this.gulp.rotation.y = -dir - Math.PI / 2;
    if (g.phase === 3 && !this.reducedMotion) this.gulp.scale.setScalar(1 + (Math.floor(time * 8) % 2) * 0.04);
    else this.gulp.scale.setScalar(1);
    for (const [i, th] of g.teeth.entries()) {
      const m = this.teeth[i];
      if (!m) continue;
      m.visible = g.phase === 2 && !th.hit;
      m.position.set(th.x * U, 0, th.z * U);
      m.material =
        th.lit && Math.floor(time * 4) % 2 === 0 ? this.toothLitMat : th.lit ? this.toothLitMat : this.toothMat;
      m.scale.setScalar(th.lit ? 1.25 : 1);
    }
  }

  /** Frees every GPU resource the scene created and detaches it from its parent. */
  dispose(): void {
    this.root.removeFromParent();
    for (const s of this.shadows) s.dispose();
    for (const v of this.creatures.values()) v.dispose();
    this.creatures.clear();
    this.friend.dispose();
    this.island.dispose();
    this.clouds.dispose();
    this.shards.mesh.dispose();
    this.shardMaterial.dispose();
    this.bumperGeo.dispose();
    this.bumperMat.dispose();
    this.wedge?.geometry.dispose();
    this.wedgeMat.dispose();
    for (const g of this.gulpGeos) g.dispose();
    for (const m of this.gulpMats) m.dispose();
    this.toothMat.dispose();
    this.toothLitMat.dispose();
    this.rippleGeo.dispose();
    this.rippleMat.dispose();
  }
}

/** Frees the shared placeholder creature material (call when the venue unmounts). */
export function disposePlaceholderCreatures(): void {
  placeholderMaterial?.dispose();
  placeholderMaterial = null;
}
