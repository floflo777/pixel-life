/**
 * Bump Sumo's three.js scene: the dohyo, clouds and far islets, four detachable voxel Friends (every knocked-off pixel
 * is a real voxel of its owner that flies, lands and snaps back), ground markers (slot colour ring, facing chevron,
 * stepped charge arc), the Sparkling trail and presentation shards. It only reads sim views and interpolates between
 * the last two fixed steps; gameplay never happens here.
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
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
  type Material,
} from "three";
import {
  EMPTY_MASK,
  fromIndices,
  SumoFighterState,
  SumoPx,
  SumoTuning,
  type FriendAppearance,
  type Hex64,
  type SumoFighterView,
  type SumoView,
} from "@pl/shared";
import { buildDetachableFriend, type DetachableFriend } from "../../friend";
import { createBandMaterial } from "../../post/band-material";
import { tagHalo, untagged } from "../../post/tags";
import { PALETTE } from "../../stage/palette";
import { buildClouds } from "../../world/clouds";
import { buildIsland, type IslandModel } from "../../world/island";
import { attachProjectedShadow, type ProjectedShadow } from "../../world/projected-shadow";
import { impactSquash, stretchFor } from "../pixel-life/juice";
import { FIGHTER_COLORS } from "./format";
import { Dohyo } from "./ring";

/** World units per sim unit (1 u = one sprite pixel = the Friend's voxel). */
export const U = 0.15;
/** Camera pitch; Friends are pitched back by it so their front plate meets the camera. */
export const SUMO_PITCH_DEG = 50;
const DEG = Math.PI / 180;
const CHARGE_STEPS = SumoTuning.CHARGE_BLOCKS;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Scars + pixels gone for the bout, as the mask the voxel Friend shows as holes. */
export function holesOf(pixels: Uint8Array): Hex64 {
  const idx: number[] = [];
  for (let i = 0; i < 256; i++) if (pixels[i] === SumoPx.Gone || pixels[i] === SumoPx.Scar) idx.push(i);
  return idx.length ? fromIndices(idx) : EMPTY_MASK;
}

// ── Shards ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_SHARDS = 160;

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

/** Presentation-only voxel shards (hits, clashes, stomps). Uses sim-scaled time so they freeze in hit-stop. */
class Shards {
  readonly mesh: InstancedMesh;
  private readonly items: (Shard | null)[] = Array.from({ length: MAX_SHARDS }, () => null);
  private next = 0;
  private readonly m = new Matrix4();
  private readonly col = new Color();
  private seed = 7;

  constructor(geo: BoxGeometry, material: Material) {
    this.mesh = new InstancedMesh(geo, material, MAX_SHARDS);
    this.mesh.frustumCulled = false;
    this.mesh.name = "sumo-shards";
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

  burst(x: number, y: number, z: number, colors: readonly number[], n: number, speed: number, size = 0.08): void {
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
        vy: 1.5 + this.rand() * speed,
        vz: Math.sin(a) * s * 0.7,
        life: 0.45 + this.rand() * 0.35,
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
      s.vy -= 16 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (s.y < 0.02 && Math.hypot(s.x, s.z) < 5) {
        s.y = 0.02;
        s.vy = -s.vy * 0.3;
        s.vx *= 0.6;
        s.vz *= 0.6;
      }
      const k = s.life < 0.15 ? 0.5 : 1;
      this.mesh.setMatrixAt(i, this.m.makeScale(s.size * k, s.size * k, s.size * k).setPosition(s.x, s.y, s.z));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ── Fighters ─────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Snap {
  pid: number;
  from: Vector3;
  t: number;
}

/** One Friend on the ring with its ground markers. */
class FighterVisual {
  readonly root = new Group();
  readonly body = new Group();
  readonly friend: DetachableFriend;
  readonly shadow: ProjectedShadow;
  readonly marker: Mesh;
  readonly chevron: Mesh;
  readonly arc: Mesh;
  readonly pos = new Vector3();
  lostKey = "";
  arcStep = -1;
  squashAt = -1;
  readonly detached = new Set<number>();
  snaps: Snap[] = [];

  constructor(
    readonly slot: number,
    appearance: FriendAppearance,
    startLost: Hex64,
    radiusU: number,
    private readonly shared: { markerMat: Material; chevronGeo: ShapeGeometry; arcGeos: RingGeometry[] },
  ) {
    this.friend = buildDetachableFriend(appearance, startLost, { gold: 0 });
    this.friend.object.rotation.x = -SUMO_PITCH_DEG * DEG;
    tagHalo(this.friend.object, "halo");
    this.body.add(this.friend.object);
    this.shadow = attachProjectedShadow(this.body, { groundY: 0 });
    const color = FIGHTER_COLORS[slot] ?? PALETTE.paper;
    const ringGeo = new RingGeometry(radiusU * U * 0.95, radiusU * U * 0.95 + 0.07, 28);
    ringGeo.rotateX(-Math.PI / 2);
    this.marker = new Mesh(ringGeo, new MeshBasicMaterial({ color, side: DoubleSide }));
    this.marker.position.y = 0.012;
    this.marker.renderOrder = 1;
    const chevMat = new MeshBasicMaterial({ color: slot === 0 ? PALETTE.signal : color, side: DoubleSide });
    this.chevron = new Mesh(shared.chevronGeo, chevMat);
    this.chevron.position.y = 0.014;
    this.chevron.renderOrder = 1;
    this.arc = new Mesh(shared.arcGeos[0], shared.markerMat);
    this.arc.position.y = 0.016;
    this.arc.renderOrder = 2;
    this.arc.visible = false;
    for (const m of [this.marker, this.chevron, this.arc]) untagged(m);
    this.root.add(this.marker, this.chevron, this.arc, this.body);
    this.root.name = `sumo-fighter-${slot}`;
    this.chevronRadius = radiusU * U + 0.16;
  }

  private readonly chevronRadius: number;

  /** Draws this fighter interpolated between `p` and `c`. */
  sync(p: SumoFighterView, c: SumoFighterView, alpha: number, time: number, reduced: boolean): void {
    const x = lerp(p.x, c.x, alpha) * U;
    const z = lerp(p.z, c.z, alpha) * U;
    let y = 0;
    let roll = 0;
    const out = c.state === SumoFighterState.Out;
    if (c.state === SumoFighterState.Falling || out) {
      const u = Math.min(1, c.fallTicks / SumoTuning.FALL_TICKS);
      y = -u * u * 4.5;
      roll = (Math.floor(u * 5) / 5) * 70 * DEG * Math.sign(c.x || 1);
    } else if (c.state === SumoFighterState.Hover) {
      // Hover: a stepped flutter above the void.
      y = 0.08 + (reduced ? 0 : (Math.floor(time * 10) % 2) * 0.05);
    }
    this.root.visible = !out || c.fallTicks < SumoTuning.FALL_TICKS;
    this.root.position.set(x, 0, z);
    this.body.position.y = y;
    this.pos.set(x, y, z);
    this.shadow.setGround(y < -0.05 ? -50 : 0);
    const onRing = c.state === SumoFighterState.Ring || c.state === SumoFighterState.Hover;
    this.marker.visible = onRing;
    this.chevron.visible = onRing && c.stun === 0;
    // Stun tumble: stepped wobble; charge: squat in 6 steps and shiver when full.
    let tilt = roll;
    if (c.stun > 0 && !reduced) tilt += (Math.floor(time * 14) % 2 ? 1 : -1) * 9 * DEG;
    this.friend.object.rotation.z = tilt;
    const step = Math.round(c.charge * CHARGE_STEPS);
    const squat = 1 - step * 0.035;
    const shiver = step >= CHARGE_STEPS && !reduced ? (Math.floor(time * 30) % 2 ? 0.02 : -0.02) : 0;
    const vx = lerp(p.vx, c.vx, alpha);
    const vz = lerp(p.vz, c.vz, alpha);
    const sp = Math.hypot(vx, vz);
    const st = reduced ? { along: 1, across: 1 } : stretchFor(c.armed ? sp * 1.4 : sp);
    const ux = sp > 0 ? Math.abs(vx / sp) : 0;
    const sq = this.squashAt >= 0 ? impactSquash((time - this.squashAt) * 1000) : 1;
    this.body.scale.set((st.across + (st.along - st.across) * ux) * (2 - squat), squat * sq, 1);
    this.body.position.x = shiver;
    // Dodge: flatten to a blink so the side-step reads.
    if (c.dodging && !reduced) this.body.scale.y *= 0.85;
    // Facing chevron and the stepped charge arc.
    const a = (c.facing / 4096) * Math.PI * 2;
    this.chevron.position.set(Math.cos(a) * this.chevronRadius, 0.014, Math.sin(a) * this.chevronRadius);
    this.chevron.rotation.y = -a;
    if (step !== this.arcStep) {
      this.arcStep = step;
      const g = this.shared.arcGeos[Math.max(0, step - 1)];
      if (g) this.arc.geometry = g;
      this.arc.visible = step > 0;
    }
    if (this.arc.visible) this.arc.rotation.y = -a + Math.PI;
    const key = holesOf(c.pixels);
    if (key !== this.lostKey) {
      this.lostKey = key;
      this.friend.setLost(key);
    }
  }

  dispose(): void {
    this.shadow.dispose();
    this.friend.dispose();
    this.marker.geometry.dispose();
    (this.marker.material as Material).dispose();
    (this.chevron.material as Material).dispose();
  }
}

/** The whole Bump Sumo scene. */
export class SumoScene {
  readonly root = new Group();
  readonly dohyo: Dohyo;
  private readonly fighters: FighterVisual[] = [];
  private readonly clouds: { mesh: Mesh; dispose(): void };
  private readonly islets: IslandModel[] = [];
  private readonly shards: Shards;
  private readonly boxGeo = new BoxGeometry(1, 1, 1);
  private readonly shardMat: Material;
  private readonly markerMat = new MeshBasicMaterial({ color: PALETTE.signal, side: DoubleSide });
  private readonly chevronGeo: ShapeGeometry;
  private readonly arcGeos: RingGeometry[] = [];
  private readonly trail: InstancedMesh;
  private readonly tmpV = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly axis = new Vector3(1, 0.4, 0.2).normalize();
  private readonly m = new Matrix4();
  reducedMotion: boolean;

  constructor(opts: {
    readonly appearances: readonly FriendAppearance[];
    readonly startLost: readonly Hex64[];
    readonly radii: readonly number[];
    readonly reducedMotion: boolean;
  }) {
    this.reducedMotion = opts.reducedMotion;
    this.root.name = "bump-sumo";
    this.dohyo = new Dohyo(SumoTuning.RING_R0 * U);
    this.root.add(this.dohyo.object);
    this.clouds = buildClouds([
      { x: -11.5, y: -7, z: 1, width: 2.4, seed: 21 },
      { x: 11.8, y: -7.6, z: 2, width: 2.2, seed: 22 },
      { x: -6, y: 1.2, z: -16, width: 2.4, seed: 23 },
      { x: 7.5, y: 2.2, z: -18, width: 2.8, seed: 24 },
    ]);
    this.root.add(this.clouds.mesh);
    // Two far islets for depth (background, no shadows baked).
    for (const [i, spec] of [
      { x: -9.5, y: -1.6, z: -6.5, r: 6, seed: 31 },
      { x: 10.5, y: -2.2, z: -4.5, r: 5, seed: 32 },
    ].entries()) {
      const isl = buildIsland({
        radius: spec.r,
        seed: spec.seed,
        underside: 5,
        bakeShadows: false,
        scatter: { tufts: 8 },
      });
      isl.object.position.set(spec.x, spec.y, spec.z);
      isl.object.name = `sumo-islet-${i}`;
      this.islets.push(isl);
      this.root.add(isl.object);
    }
    // Shared marker geometry: a 3-voxel chevron and 6 stepped charge arcs.
    const chev = new Shape();
    chev.moveTo(0.16, 0);
    chev.lineTo(-0.02, 0.12);
    chev.lineTo(-0.02, -0.12);
    chev.lineTo(0.16, 0);
    this.chevronGeo = new ShapeGeometry(chev);
    this.chevronGeo.rotateX(Math.PI / 2);
    for (let k = 1; k <= CHARGE_STEPS; k++) {
      const len = (k / CHARGE_STEPS) * Math.PI * 2;
      const g = new RingGeometry(0.62, 0.74, 6 * k, 1, -len / 2, len);
      g.rotateX(-Math.PI / 2);
      this.arcGeos.push(g);
    }
    opts.appearances.forEach((a, slot) => {
      const v = new FighterVisual(slot, a, opts.startLost[slot] ?? EMPTY_MASK, opts.radii[slot] ?? 5, {
        markerMat: this.markerMat,
        chevronGeo: this.chevronGeo,
        arcGeos: this.arcGeos,
      });
      // Charge arcs sit just outside the collider.
      v.arc.scale.setScalar(((opts.radii[slot] ?? 5) * U + 0.2) / 0.68);
      this.fighters.push(v);
      this.root.add(v.root);
    });
    this.shardMat = createBandMaterial({ lightMix: 0.3 });
    this.shards = new Shards(this.boxGeo, this.shardMat);
    untagged(this.shards.mesh);
    this.root.add(this.shards.mesh);
    this.trail = new InstancedMesh(this.boxGeo, createBandMaterial({ color: PALETTE.sun, lightMix: 0.7 }), 96);
    this.trail.frustumCulled = false;
    this.trail.count = 0;
    untagged(this.trail);
    this.root.add(this.trail);
  }

  /** World position (feet) of fighter `slot`. */
  fighterPos(slot: number): Vector3 | null {
    return this.fighters[slot]?.pos ?? null;
  }

  /** World position of a sim point at height `h` (u). */
  world(x: number, z: number, h = 0, out = this.tmpV): Vector3 {
    return out.set(x * U, h * U, z * U);
  }

  /** Stepped impact squash on a fighter. */
  squash(slot: number, time: number): void {
    const f = this.fighters[slot];
    if (f) f.squashAt = time;
  }

  /** Voxel shards at a sim point. */
  burst(x: number, z: number, colors: readonly number[], n: number, y = 4, speed = 3.5): void {
    this.shards.burst(x * U, y * U, z * U, colors, this.reducedMotion ? Math.ceil(n / 2) : n, speed);
  }

  /** Draws the interpolated state; `simDt` = scaled seconds this frame (shards freeze during hit-stop). */
  sync(prev: SumoView, cur: SumoView, alpha: number, time: number, simDt: number, hotRing: boolean): void {
    this.dohyo.update(lerp(prev.ringR, cur.ringR, alpha) * U, time, hotRing, this.reducedMotion);
    cur.fighters.forEach((c, i) => {
      const p = prev.fighters[i] ?? c;
      this.fighters[i]?.sync(p, c, alpha, time, this.reducedMotion);
    });
    this.syncDebris(prev, cur, alpha, time);
    let n = 0;
    for (const t of cur.trail) {
      if (n >= 96) break;
      const s = t.left < 20 ? 0.05 : 0.09;
      const blink = !this.reducedMotion && Math.floor(time * 12 + t.x) % 3 === 0 ? 0.6 : 1;
      this.m.makeScale(s * blink, s * blink, s * blink).setPosition(t.x * U, 0.06, t.z * U);
      this.trail.setMatrixAt(n++, this.m);
    }
    this.trail.count = n;
    this.trail.instanceMatrix.needsUpdate = true;
    this.shards.update(simDt);
  }

  private syncDebris(prev: SumoView, cur: SumoView, alpha: number, time: number): void {
    const prevBy = new Map<number, (typeof prev.debris)[number]>();
    for (const d of prev.debris) prevBy.set(d.owner * 256 + d.pid, d);
    const live = new Set<number>();
    for (const d of cur.debris) {
      const key = d.owner * 256 + d.pid;
      const f = this.fighters[d.owner];
      if (!f) continue;
      live.add(key);
      if (!f.detached.has(d.pid)) {
        if (f.friend.instanceOf(d.pid) < 0) continue;
        // Knocked off again mid snap-back: the flight wins over the snap.
        f.snaps = f.snaps.filter((s) => s.pid !== d.pid);
        if (!f.friend.isDetached(d.pid)) f.friend.detach(d.pid);
        f.detached.add(d.pid);
      }
      const p = prevBy.get(key) ?? d;
      const pos = this.tmpV.set(
        lerp(p.x, d.x, alpha) * U,
        (lerp(p.y, d.y, alpha) + 0.5) * U,
        lerp(p.z, d.z, alpha) * U,
      );
      const moving = d.falling || d.y > 0.05 || Math.abs(d.vx) + Math.abs(d.vz) > 0.5;
      const ang = moving && !this.reducedMotion ? Math.floor(time * 12) * 0.7 + d.pid : 0;
      this.tmpQ.setFromAxisAngle(this.axis, ang);
      // A pixel about to fizzle blinks (stepped).
      const blinkOff = d.left < 45 && !this.reducedMotion && Math.floor(time * 8) % 2 === 1;
      f.friend.setDetachedWorld(d.pid, pos, this.tmpQ, blinkOff ? 0.4 : 1);
    }
    for (const f of this.fighters) {
      for (const pid of [...f.detached]) {
        if (live.has(f.slot * 256 + pid)) continue;
        f.detached.delete(pid);
        const state = cur.fighters[f.slot]?.pixels[pid];
        const pd = prevBy.get(f.slot * 256 + pid);
        if (state === SumoPx.Body && pd) {
          f.snaps.push({ pid, from: new Vector3(pd.x * U, (pd.y + 0.5) * U, pd.z * U), t: time });
        } else {
          if (pd && state === SumoPx.Gone && !pd.falling)
            this.shards.burst(pd.x * U, 0.05, pd.z * U, [PALETTE.paper, PALETTE.halo], 3, 1.2, 0.05);
          f.friend.reattach(pid);
        }
      }
      const home = new Vector3();
      f.snaps = f.snaps.filter((s) => {
        const k = Math.floor(((time - s.t) / 0.18) * 3);
        if (!f.friend.isDetached(s.pid)) return false;
        if (k >= 3) {
          f.friend.reattach(s.pid);
          return false;
        }
        f.friend.homeWorld(s.pid, home);
        this.tmpV.copy(s.from).lerp(home, (k + 1) / 3);
        f.friend.setDetachedWorld(s.pid, this.tmpV, undefined, 1);
        return true;
      });
    }
  }

  /** Frees every GPU resource the scene created. */
  dispose(): void {
    this.root.removeFromParent();
    for (const f of this.fighters) f.dispose();
    this.dohyo.dispose();
    this.clouds.dispose();
    for (const i of this.islets) i.dispose();
    this.shards.mesh.dispose();
    this.shardMat.dispose();
    this.boxGeo.dispose();
    this.markerMat.dispose();
    this.chevronGeo.dispose();
    for (const g of this.arcGeos) g.dispose();
    this.trail.dispose();
    (this.trail.material as Material).dispose();
  }
}
