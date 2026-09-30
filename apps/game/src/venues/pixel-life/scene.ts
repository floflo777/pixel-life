/**
 * The venue's three.js scene: the arena island (art bible frame 1), the detachable voxel Friend, creatures (through an
 * injectable factory until `apps/game/src/creatures` lands), loose pixels, Old Gulp, bumpers and presentation particles.
 * It only reads sim views: interpolation between the last two fixed steps happens here, gameplay never does.
 */
import type { Object3D } from "three";
import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
  type Material,
} from "three";
import {
  SIM_HZ,
  SimTuning,
  EMPTY_MASK,
  fromIndices,
  type FriendAppearance,
  type Hex64,
  type SimBodyView as BodyView,
  type SimCreatureView as CreatureView,
  type SimDebrisView as DebrisView,
  type SimView as FullSimView,
} from "@pl/shared";
import { buildDetachableFriend, type DetachableFriend } from "../../friend";
import { createBandMaterial } from "../../post/band-material";
import { tagHalo, untagged } from "../../post/tags";
import { PALETTE } from "../../stage/palette";
import { buildClouds } from "../../world/clouds";
import { buildIsland, type IslandModel } from "../../world/island";
import { attachProjectedShadow, type ProjectedShadow } from "../../world/projected-shadow";
import {
  createGulpView,
  createGulpWedge,
  gulpMoodFromSim,
  gulpPhaseFromSim,
  type GulpView,
  type GulpWedge,
} from "../../creatures";
import { createRealCreatureFactory } from "./creature-adapter";
import { fitIsland } from "./island-fit";
import { impactSquash, stretchFor } from "./juice";
import { KIND, PX } from "./sim-module";

/** World units per sim unit (1 u = 1 sprite pixel = the Friend's voxel size). */
export const U = 0.15;
/**
 * Old Gulp's voxel edge in the run scene: big enough to loom over the island (≈ 6.7 world units long), small enough that
 * the whole whale fits the dollied-out frame. The sim's teeth are marked by ground rings (the gameplay truth) under its jaw.
 */
export const GULP_RUN_VOXEL = 0.14;
/** In-run camera pitch (art bible: 32°); the Friend plate is pitched back by it so its face meets the camera. */
export const RUN_PITCH_DEG = 32;
const DEG = Math.PI / 180;

/**
 * A creature's renderer. `update` receives the interpolated sim creature and scaled time (0 during hit-stop); the
 * optional hooks let a richer renderer react to events (the real Munchies do; the placeholder ignores them).
 */
export interface CreatureVisual {
  readonly object: Object3D;
  update(c: CreatureView, t: { readonly dt: number; readonly time: number; readonly reducedMotion: boolean }): void;
  /** Advances presentation only (a smashed creature is gone from the sim but its shatter still plays). */
  tick?(dt: number): void;
  /** Non-lethal hit reaction (plate bonk, parry, Slurp sulk). */
  hit?(): void;
  /** Lethal: plays the shatter; the scene keeps the visual until `finished`. */
  smash?(): void;
  /** One-shot attack (Slurp's tongue yank) toward a world point. */
  attack?(target: Vector3 | null): void;
  /** True once a smash has fully played. */
  readonly finished?: boolean;
  /** True when the visual emits its own speech lines (the venue then skips its generic bubbles). */
  readonly speaks?: boolean;
  /** Subscribes to speech lines ("MINE!"); returns an unsubscribe. */
  onSpeak?(cb: (text: string, seconds: number) => void): () => void;
  dispose(): void;
}

/** Builds a creature visual for a kind (0 Nib … 5 Fizz); `id` is the sim creature id (a stable per-creature seed). */
export type CreatureFactory = (kind: number, id?: number) => CreatureVisual;

/** Options of the scene. */
export interface RunSceneOptions {
  readonly appearance: FriendAppearance;
  readonly startLost: Hex64;
  readonly goldHeld: number;
  readonly arena: { readonly a: number; readonly b: number; readonly name: string };
  readonly seed: number;
  readonly creatureFactory?: CreatureFactory;
  readonly reducedMotion: boolean;
  /** Speech line from a creature visual (sim id, text, seconds). */
  readonly onCreatureSpeak?: (id: number, text: string, seconds: number) => void;
  /** Speech line from Old Gulp. */
  readonly onGulpSpeak?: (text: string, seconds: number) => void;
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

/** Distance from the island centre to the rim ellipse along the unit direction (ux, uz) — the sim's `rimRadius`. */
export function rimRadius(a: number, b: number, ux: number, uz: number): number {
  const qa = ux / a;
  const qb = uz / b;
  return 1 / Math.sqrt(qa * qa + qb * qb);
}

/**
 * The sim's wedge sector (polar angle `dir` ± `half`, sim angle units) between `inner` and `outer` shares of the rim
 * radius, laid on the ground plane in world units. Matches `Island.inWedgeSector`, so what looks bitten is bitten.
 */
export function wedgeGeometry(
  a: number,
  b: number,
  dir: number,
  half: number,
  inner = 0.4,
  outer = 1.12,
): ShapeGeometry {
  const shape = new Shape();
  const steps = 24;
  const t0 = ((dir - half) / 4096) * Math.PI * 2;
  const t1 = ((dir + half) / 4096) * Math.PI * 2;
  const pt = (t: number, k: number): [number, number] => {
    const ux = Math.cos(t);
    const uz = Math.sin(t);
    const r = rimRadius(a, b, ux, uz) * k * U;
    return [ux * r, uz * r];
  };
  shape.moveTo(...pt(t0, inner));
  for (let i = 0; i <= steps; i++) shape.lineTo(...pt(lerp(t0, t1, i / steps), outer));
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
  /** Smashed creatures whose shatter is still playing (gone from the sim already). */
  private readonly dying: CreatureVisual[] = [];
  private readonly creatureShadows = new Map<Object3D, ProjectedShadow>();
  private readonly speechOff = new Map<number, () => void>();
  private readonly factory: CreatureFactory;
  private readonly onCreatureSpeak: ((id: number, text: string, seconds: number) => void) | undefined;
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
  private readonly gulp: GulpView;
  private readonly gulpSpeechOff: () => void;
  private shadow: GulpWedge | null = null;
  private shadowKey = "";
  private readonly toothRings: Mesh[] = [];
  private readonly toothRingGeo = new RingGeometry(0.34, 0.5, 16);
  private readonly toothLitMat = new MeshBasicMaterial({ color: PALETTE.sun, side: DoubleSide });
  private readonly toothMat = new MeshBasicMaterial({ color: PALETTE.ink, side: DoubleSide });
  private gulpPhase = -1;
  private teethKey = "";
  private readonly ripples: { mesh: Mesh; t: number }[] = [];
  private readonly rippleGeo = new RingGeometry(0.5, 0.62, 20);
  private readonly rippleMat = new MeshBasicMaterial({ color: PALETTE.ink, side: DoubleSide });
  reducedMotion: boolean;

  constructor(opts: RunSceneOptions) {
    this.reducedMotion = opts.reducedMotion;
    this.factory = opts.creatureFactory ?? createRealCreatureFactory();
    this.onCreatureSpeak = opts.onCreatureSpeak;
    const { a, b } = opts.arena;
    const cell = 0.24;
    const fit = fitIsland(a, b, U, cell, opts.seed % 1000);
    this.island = buildIsland({
      radius: fit.radius,
      cell,
      seed: fit.seed,
      squash: fit.squash,
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

    // Old Gulp (creatures module) and the ground rings that mark the sim's teeth (the gameplay truth).
    this.gulp = createGulpView({ voxel: GULP_RUN_VOXEL });
    this.gulp.object.visible = false;
    this.gulpSpeechOff = this.gulp.onSpeak((line) => opts.onGulpSpeak?.(line.text, line.duration));
    this.root.add(this.gulp.object);
    for (let i = 0; i < 3; i++) {
      const ring = new Mesh(this.toothRingGeo, this.toothMat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.name = `gulp-tooth-ring-${i}`;
      untagged(ring);
      this.toothRings.push(ring);
      this.root.add(ring);
    }
  }

  /** Starts the visual hop (parabola, apex 3 u) for flings with p ≥ 0.4. */
  hop(time: number, power: number): void {
    if (power < 0.4) return;
    this.hopStart = time;
    this.hopHeight = 3 * U * power;
  }

  /** A non-lethal hit on creature `id` (paper flash + squash). */
  hitCreature(id: number): void {
    this.creatures.get(id)?.hit?.();
  }

  /** Creature `id` was smashed: its visual shatters in place and leaves when the shatter has played. */
  smashCreature(id: number): void {
    const v = this.creatures.get(id);
    if (!v?.smash) return;
    v.smash();
    this.creatures.delete(id);
    this.speechOff.get(id)?.();
    this.speechOff.delete(id);
    this.dying.push(v);
  }

  /** Creature `id` attacks toward the Friend (Slurp's tongue yank). */
  attackCreature(id: number): void {
    this.creatures.get(id)?.attack?.(this.friendRoot.getWorldPosition(new Vector3()).setY(0.3));
  }

  /** Old Gulp beats that are not phase changes. */
  gulpBeat(beat: "bite" | "burp" | "tooth", tooth = 0): void {
    if (beat === "bite") this.gulp.playBite();
    else if (beat === "burp") this.gulp.playBurp();
    else this.gulp.playToothHit(tooth);
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
        v = this.factory(c.kind, c.id);
        this.creatures.set(c.id, v);
        this.root.add(v.object);
        this.creatureShadows.set(v.object, attachProjectedShadow(v.object, { groundY: 0 }));
        const speak = this.onCreatureSpeak;
        const id = c.id;
        if (v.onSpeak && speak)
          this.speechOff.set(
            id,
            v.onSpeak((text, sec) => speak(id, text, sec)),
          );
      }
      const p = prevBy.get(c.id) ?? c;
      const ic: CreatureView = { ...c, x: lerp(p.x, c.x, alpha), y: lerp(p.y, c.y, alpha), z: lerp(p.z, c.z, alpha) };
      v.object.position.set(ic.x * U, ic.y * U, ic.z * U);
      v.update(ic, t);
    }
    for (const [id, v] of this.creatures) {
      if (live.has(id)) continue;
      // Fled, eaten or carried off: gone at once (smashes were moved to `dying` by the event).
      this.creatures.delete(id);
      this.speechOff.get(id)?.();
      this.speechOff.delete(id);
      this.dropVisual(v);
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const v = this.dying[i];
      if (!v) continue;
      v.tick?.(t.dt);
      if (v.finished !== false) {
        this.dying.splice(i, 1);
        this.dropVisual(v);
      }
    }
  }

  private dropVisual(v: CreatureVisual): void {
    this.creatureShadows.get(v.object)?.dispose();
    this.creatureShadows.delete(v.object);
    this.root.remove(v.object);
    v.dispose();
  }

  private syncGulp(cur: FullSimView, time: number, simDt: number): void {
    const g = cur.gulp;
    const { a, b } = cur.arena;
    const key = `${g.wedgeDir}:${g.wedgeHalf}`;
    // The bitten wedge: those island voxels are gone, so the cloud sea (fog) shows through.
    if ((g.shadow || g.wedgeOn) && key !== this.wedgeKey) {
      this.wedgeKey = key;
      if (this.wedge) {
        this.root.remove(this.wedge);
        this.wedge.geometry.dispose();
      }
      this.wedge = new Mesh(wedgeGeometry(a, b, g.wedgeDir, g.wedgeHalf, SimTuning.GULP_WEDGE_INNER), this.wedgeMat);
      this.wedge.position.y = 0.012;
      this.wedge.renderOrder = 2;
      untagged(this.wedge);
      this.root.add(this.wedge);
      // The telegraph: the creatures module's Bayer shadow, on the same sector the sim will bite.
      this.shadow ??= createGulpWedge({ radius: 1, halfAngle: Math.PI / 4 });
      this.shadow.object.geometry.dispose();
      this.shadow.object.geometry = wedgeGeometry(a, b, g.wedgeDir, g.wedgeHalf, SimTuning.GULP_WEDGE_INNER, 1.02);
      this.root.add(this.shadow.object);
      this.shadowKey = key;
    }
    if (this.wedge) {
      this.wedge.visible = g.wedgeOn;
      this.wedgeMat.color.setHex(PALETTE.fog);
      this.wedgeMat.opacity = 1;
    }
    if (this.shadow) {
      const since = (cur.tick - SimTuning.GULP_RUMBLE) / SIM_HZ;
      this.shadow.setTime(g.shadow && !g.wedgeOn && this.shadowKey === key ? since : -1);
    }
    // Old Gulp: rises at the outer rim during the telegraph, then rests its chin on the new rim, teeth on the sim's.
    const view = this.gulp;
    const mood = gulpMoodFromSim(g.mood);
    if (view.mood !== mood) view.setMood(mood);
    if (g.phase !== this.gulpPhase) {
      this.gulpPhase = g.phase;
      view.setState(gulpPhaseFromSim(g.phase));
    }
    const lit = g.teeth.findIndex((t) => t.lit && !t.hit);
    const teethKey = `${lit}:${g.teeth.map((t) => (t.hit ? 1 : 0)).join("")}`;
    if (teethKey !== this.teethKey) {
      this.teethKey = teethKey;
      view.setTeeth(
        lit,
        g.teeth.map((t) => t.hit),
      );
    }
    const t = (g.wedgeDir / 4096) * Math.PI * 2;
    const ux = Math.cos(t);
    const uz = Math.sin(t);
    const share = g.phase <= 1 ? 1.02 : SimTuning.GULP_WEDGE_INNER;
    const r = rimRadius(a, b, ux, uz) * share * U;
    view.object.position.set(ux * r, 0, uz * r);
    // Local −x points at the island centre.
    view.object.rotation.y = Math.atan2(-uz, ux);
    view.object.visible = g.phase >= 1 && g.phase <= 4;
    view.update(simDt);
    // Ground rings on the sim's teeth: the lit one glows sun (the only one that scores), the others are ink.
    for (const [i, th] of g.teeth.entries()) {
      const m = this.toothRings[i];
      if (!m) continue;
      m.visible = g.phase === 2 && !th.hit;
      m.position.set(th.x * U, 0.02, th.z * U);
      const blink = !this.reducedMotion && Math.floor(time * 4) % 2 === 1;
      m.material = th.lit ? this.toothLitMat : this.toothMat;
      m.scale.setScalar(th.lit ? (blink ? 1.15 : 1.35) : 0.9);
    }
  }

  /** Frees every GPU resource the scene created and detaches it from its parent. */
  dispose(): void {
    this.root.removeFromParent();
    for (const s of this.shadows) s.dispose();
    for (const off of this.speechOff.values()) off();
    this.speechOff.clear();
    for (const v of this.creatures.values()) v.dispose();
    this.creatures.clear();
    for (const v of this.dying) v.dispose();
    this.dying.length = 0;
    for (const sh of this.creatureShadows.values()) sh.dispose();
    this.creatureShadows.clear();
    this.friend.dispose();
    this.island.dispose();
    this.clouds.dispose();
    this.shards.mesh.dispose();
    this.shardMaterial.dispose();
    this.bumperGeo.dispose();
    this.bumperMat.dispose();
    this.wedge?.geometry.dispose();
    this.wedgeMat.dispose();
    this.gulpSpeechOff();
    this.gulp.dispose();
    this.shadow?.object.geometry.dispose();
    this.shadow?.dispose();
    this.toothRingGeo.dispose();
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
