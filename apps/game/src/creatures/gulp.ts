/**
 * Old Gulp (GDD §3.8, bible §5): a cloud whale of paper voxels that rises at the rim, bites a wedge out of the island,
 * rests its chin on the new rim with three square teeth that light up one at a time, then burps or inhales and sinks.
 *
 * Local frame: the mouth faces −x and its floor sits 2 voxels above y = 0 (place the origin on the rim, on the island's
 * top surface, and yaw the object so −x points at the island centre). The body trails toward +x into the cloud sea.
 */
import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from "three";
import { createBandMaterial } from "../post/band-material";
import { tagGlow } from "../post/tags";
import { PALETTE } from "../stage/palette";
import { VoxelMesher } from "../world/voxel-mesher";
import { BURP_S, GULP_MOOD_STYLE, burpOverlay, gulpPose, starCrumb, toothPop, type GulpPose } from "./gulp-anim";
import { CREATURE_STYLE, creatureMaterial } from "./mesh";
import { SPEECH_SECONDS, type SpeechLine, type SpeechListener } from "./speech";
import type { GulpMood, GulpPhase } from "./states";

/** Default Gulp voxel (world units): 48 voxels ≈ 9.6 u long, bigger than a play island's radius. */
export const GULP_VOXEL = 0.2;
/** Body length / height in voxels (bible §5: 48×20). */
export const GULP_SIZE = { length: 48, height: 20 } as const;

const MOUTH_FLOOR = 3; // j of the first carved row
const MOUTH_TOP = 8; // j of the last carved row at the lips
const MOUTH_DEPTH = 14; // carved columns (i)
const BODY_Y = -1; // voxels: puts the mouth floor 2 voxels above the rim
const EYE = { i0: 16, j0: 12 } as const; // 3×3 eye block on both flanks
/** Tooth sockets: z centres (voxels) across the mouth, hanging from the upper jaw at the lips. */
const TOOTH_Z = [-4, 0, 4] as const;
const TOOTH = { w: 3, h: 4, d: 2 } as const;

const CLOUD = PALETTE.cloud;
const BELLY = PALETTE.tile;

/** Half height (y) of the body cross-section at column i (0 = snout tip). */
function halfHeight(i: number): number {
  if (i < 4) return 9 * Math.sqrt(1 - ((4 - i) / 7) ** 2);
  if (i <= 26) return 9;
  if (i <= 41) return 9 - ((i - 26) / 15) * 6.5;
  return 0;
}

/** Cloud lumps: a checker of 1-voxel bumps over the upper half only, so the flanks stay clean planes. */
const lump = (i: number, y: number, hy: number, k: number): number =>
  y > hy * 0.35 && (Math.floor(i / 5) + Math.floor((k + 20) / 4)) % 2 === 0 ? 1 : 0;

/** Voxel colour of Gulp's body at lattice (i, j, k) or null; `open` carves the maw. Pure; exported for tests. */
export function gulpCell(i: number, j: number, k: number, open: boolean, mood: GulpMood): number | null {
  const cy = 9.5;
  let hy: number;
  let hz: number;
  let y = j - cy;
  if (i <= 41) {
    hy = halfHeight(i);
    hz = hy * 0.8;
  } else if (i <= 47) {
    // Horizontal fluke, swept up: wide in z, 2 voxels thick.
    const f = i - 41;
    y = j - (cy + 1 + f * 0.8);
    if (Math.abs(y) > 1.2) return null;
    return Math.abs(k) <= 1 + f * 1.3 ? CLOUD : null;
  } else return null;
  if (hy <= 0) return null;
  const r = Math.hypot(y / hy, k / hz);
  const edge = 1 + lump(i, y, hy, k) / Math.max(hy, 1);
  if (r > edge) return null;
  const outer = r > edge - 1.3 / Math.max(hz, 1);
  // The maw: carve inside the cheeks; line it with ink, the floor is lilac tongue.
  const mouthTop = MOUTH_TOP - Math.floor(i / 3);
  if (open && i < MOUTH_DEPTH && j >= MOUTH_FLOOR && j <= mouthTop && Math.abs(k) < hz - 0.6) {
    return null;
  }
  if (open && i <= MOUTH_DEPTH && j >= MOUTH_FLOOR - 1 && j <= mouthTop + 1 && Math.abs(k) < hz - 0.6) {
    return j === MOUTH_FLOOR - 1 ? PALETTE.lilac : PALETTE.ink;
  }
  if (!open && outer && i < MOUTH_DEPTH && j === 5 + (i > 11 ? 1 : 0)) return PALETTE.ink; // closed lip line
  if (!open && i === 0 && j === 5) return PALETTE.ink;
  // Eyes on both flanks (3×3 ink), Grumpy adds a brow sloping down toward the snout.
  if (outer && i >= EYE.i0 && i < EYE.i0 + 3 && j >= EYE.j0 && j < EYE.j0 + 3) return PALETTE.ink;
  if (
    outer &&
    GULP_MOOD_STYLE[mood].brow &&
    ((j === EYE.j0 + 4 && i >= 17 && i <= 19) || (j === EYE.j0 + 3 && i === 15))
  )
    return PALETTE.ink;
  // Belly pleats.
  if (outer && j <= 3 && i >= 3 && i <= 30 && j % 2 === 1) return BELLY;
  return CLOUD;
}

/** Outermost occupied k of the closed body at (i, j): where the flank surface is, for the eye lids. */
function flankK(i: number, j: number): number {
  for (let k = 9; k > 0; k--) if (gulpCell(i, j, k, false, "hungry") !== null) return k;
  return 0;
}

/** Builds Gulp's body geometry (cached per mouth state and mood). */
function buildBody(open: boolean, mood: GulpMood, voxel: number): { geometry: BufferGeometry; triangles: number } {
  const mesher = new VoxelMesher();
  const grid = mesher.grid(voxel, [voxel / 2, voxel / 2 + BODY_Y * voxel, 0]);
  for (let i = 0; i < GULP_SIZE.length; i++)
    for (let j = 0; j < GULP_SIZE.height; j++)
      for (let k = -9; k <= 9; k++) {
        const c = gulpCell(i, j, k, open, mood);
        if (c !== null) grid.set(i, j, k, c, CREATURE_STYLE);
      }
  const b = mesher.build();
  return { geometry: b.geometry, triangles: b.triangles };
}

function buildTooth(voxel: number, color: number): BufferGeometry {
  const mesher = new VoxelMesher();
  const grid = mesher.grid(voxel, [voxel / 2, -voxel / 2, -voxel]);
  for (let i = 0; i < TOOTH.d; i++)
    for (let j = 0; j < TOOTH.h; j++) for (let k = 0; k < TOOTH.w; k++) grid.set(i, -j, k, color, CREATURE_STYLE);
  return mesher.build().geometry;
}

/** Tongue slope: a lilac ramp from the mouth floor down across the island (toward −x), 7 voxels wide. */
function buildTongue(voxel: number): BufferGeometry {
  const mesher = new VoxelMesher();
  const grid = mesher.grid(voxel, [voxel / 2, voxel / 2 + BODY_Y * voxel, 0]);
  for (let i = -16; i < 2; i++) {
    const top = MOUTH_FLOOR - 1 - Math.max(0, Math.floor((-i + 2) / 5));
    for (let k = -3; k <= 3; k++) {
      const c = k === 0 && i < 0 ? PALETTE.lilacDark : PALETTE.lilac;
      grid.set(i, top, k, c, CREATURE_STYLE);
    }
  }
  return mesher.build().geometry;
}

const cache = new Map<string, { geometry: BufferGeometry; triangles: number }>();
const bodyGeometry = (
  open: boolean,
  mood: GulpMood,
  voxel: number,
): { geometry: BufferGeometry; triangles: number } => {
  const key = `body|${open}|${mood}|${voxel}`;
  let g = cache.get(key);
  if (!g) cache.set(key, (g = buildBody(open, mood, voxel)));
  return g;
};
const partGeometry = (name: string, voxel: number, make: () => BufferGeometry): BufferGeometry => {
  const key = `${name}|${voxel}`;
  let g = cache.get(key);
  if (!g) cache.set(key, (g = { geometry: make(), triangles: 0 }));
  return g.geometry;
};

/** Frees Gulp's cached geometry (stage teardown). */
export function disposeGulpCache(): void {
  for (const g of cache.values()) g.geometry.dispose();
  cache.clear();
}

/** Options for createGulpView. */
export interface GulpViewOptions {
  readonly voxel?: number;
  readonly mood?: GulpMood;
}

/** The Old Gulp event view. */
export interface GulpView {
  /** Root: place on the rim at the mouth, yawed so local −x points into the island. */
  readonly object: Group;
  readonly phase: GulpPhase;
  readonly mood: GulpMood;
  /** Where speech bubbles attach. */
  readonly speechAnchor: Object3D;
  /** Triangles of the body currently shown. */
  readonly triangles: number;
  setMood(mood: GulpMood): void;
  /** Switches phase; `t` = seconds already in it. The teeth phase opens with the 0.5 s bite leap. */
  setState(phase: GulpPhase, t?: number): void;
  /** Which tooth glows (−1 none) and which are already knocked out. */
  setTeeth(lit: number, hit: readonly boolean[]): void;
  update(dt: number): void;
  /** Replays the bite leap (the teeth phase does this on entry). */
  playBite(): void;
  /** Tooth `i` pops out as a stepped arc + 6 star crumbs, then stays gone. */
  playToothHit(i: number): void;
  /** "GULP BURPED": paper rings from the mouth and a squash. */
  playBurp(): void;
  /** Local position of tooth `i`'s socket (for aligning sim tooth hits), written to `out`. */
  toothAnchor(i: number, out: Vector3): Vector3;
  /** Local position of the mouth centre. */
  mouthAnchor(out: Vector3): Vector3;
  onSpeak(cb: SpeechListener): () => void;
  dispose(): void;
}

const RING_DOTS = 16;
const CRUMBS = 6;

/** Creates Old Gulp. One body mesh (merged, swapped between closed/open), 3 tooth meshes, tongue, and FX instances. */
export function createGulpView(opts: GulpViewOptions = {}): GulpView {
  const voxel = opts.voxel ?? GULP_VOXEL;
  let mood: GulpMood = opts.mood ?? "hungry";
  const object = new Group();
  object.name = "old-gulp";
  const rig = new Group(); // lift/shift/pitch about the chin
  object.add(rig);
  const body = new Mesh(bodyGeometry(false, mood, voxel).geometry, creatureMaterial());
  body.name = "gulp-body";
  rig.add(body);

  const toothPaper = partGeometry("tooth-paper", voxel, () => buildTooth(voxel, PALETTE.paperWarm));
  const toothSun = partGeometry("tooth-sun", voxel, () => buildTooth(voxel, PALETTE.sun));
  const sockets = TOOTH_Z.map((z) => new Vector3(voxel * 0.5, (MOUTH_TOP + 1 + BODY_Y) * voxel, z * voxel));
  const teeth = sockets.map((p, i) => {
    const m = new Mesh(toothPaper, creatureMaterial());
    m.name = `gulp-tooth-${i}`;
    m.position.copy(p);
    rig.add(m);
    return m;
  });
  const tongue = new Mesh(
    partGeometry("tongue", voxel, () => buildTongue(voxel)),
    creatureMaterial(),
  );
  tongue.name = "gulp-tongue";
  rig.add(tongue);

  // Lids: paper plates over each flank eye, grown row by row for blinks.
  const lidMat = new MeshBasicMaterial({ color: CLOUD });
  const unit = new BoxGeometry(1, 1, 1);
  const lids = [1, -1].map((side) => {
    const m = new Mesh(unit, lidMat);
    m.name = "gulp-lid";
    m.userData["side"] = side;
    rig.add(m);
    return m;
  });

  const fxMat = createBandMaterial({ color: 0xffffff });
  const rings = new InstancedMesh(unit, fxMat, RING_DOTS * 3);
  rings.name = "gulp-rings";
  rings.frustumCulled = false;
  const paper = new Color(PALETTE.paperWarm);
  for (let i = 0; i < RING_DOTS * 3; i++) rings.setColorAt(i, paper);
  rings.count = 0;
  object.add(rings);
  const crumbs = new InstancedMesh(unit, new MeshBasicMaterial({ color: PALETTE.sun }), CRUMBS * 3);
  crumbs.name = "gulp-crumbs";
  crumbs.frustumCulled = false;
  crumbs.count = 0;
  tagGlow(crumbs, "gold");
  object.add(crumbs);

  const speechAnchor = new Group();
  speechAnchor.position.set(voxel * 8, voxel * 22, 0);
  object.add(speechAnchor);

  let phase: GulpPhase = "hidden";
  let phaseT = 0;
  let lit = -1;
  const hit = [false, false, false];
  const popT = [-1, -1, -1];
  let burpT = -1;
  let biteReplay = -1;
  let current = bodyGeometry(false, mood, voxel);
  const listeners = new Set<SpeechListener>();
  const m4 = new Matrix4();
  const q = new Quaternion();
  const v = new Vector3();
  const s = new Vector3();
  const axis = new Vector3(0, 0, 1);

  const emit = (text: string): void => {
    const line: SpeechLine = { text, duration: SPEECH_SECONDS, anchor: speechAnchor };
    for (const l of listeners) l(line);
  };

  const applyRings = (radii: readonly number[], outward: boolean): void => {
    let n = 0;
    const mouth = new Vector3(-voxel * 2, (MOUTH_FLOOR + 3 + BODY_Y) * voxel, 0);
    for (const r of radii.slice(0, 3)) {
      for (let d = 0; d < RING_DOTS; d++) {
        const a = (d / RING_DOTS) * Math.PI * 2;
        // Rings stand in the y/z plane in front of the mouth, drifting out (burp) or in (inhale) along −x.
        v.set(
          mouth.x - (outward ? r * 0.6 : r * 0.35) * voxel,
          mouth.y + Math.sin(a) * r * 0.5 * voxel,
          Math.cos(a) * r * 0.5 * voxel,
        );
        v.set(Math.round(v.x / voxel) * voxel, Math.round(v.y / voxel) * voxel, Math.round(v.z / voxel) * voxel);
        s.setScalar(voxel);
        rings.setMatrixAt(n++, m4.compose(v, q.identity(), s));
      }
    }
    rings.count = n;
    rings.instanceMatrix.needsUpdate = true;
  };

  const apply = (): void => {
    const pose: GulpPose = biteReplay >= 0 ? gulpPose("teeth", biteReplay, mood) : gulpPose(phase, phaseT, mood);
    const burp = burpOverlay(burpT);
    object.visible = pose.visible || burp !== null || popT.some((t) => t >= 0);
    rig.visible = pose.visible;
    const open = pose.mouthOpen || burp !== null;
    current = bodyGeometry(open, mood, voxel);
    body.geometry = current.geometry;
    rig.position.set(pose.shift * voxel, pose.lift * voxel, 0);
    rig.rotation.set(0, 0, -pose.pitch);
    rig.scale.set(pose.sx, pose.sy * (burp?.sy ?? 1), pose.sx);
    tongue.visible = pose.tongue;
    // Teeth: out only while the mouth is open; lit tooth goes sun + dot bloom; hit teeth pop then vanish.
    teeth.forEach((t, i) => {
      const socket = sockets[i] ?? v;
      const pop = toothPop(popT[i] ?? -1);
      if (pop) {
        t.visible = true;
        t.position.set(socket.x + pop.x * voxel, socket.y + pop.y * voxel, socket.z);
        t.rotation.set(0, 0, pop.spin);
        return;
      }
      t.position.copy(socket);
      t.rotation.set(0, 0, 0);
      t.visible = open && !hit[i];
      const isLit = lit === i && !hit[i];
      t.geometry = isLit ? toothSun : toothPaper;
      if (isLit) tagGlow(t, "gold");
      else t.userData["plPost"] = undefined;
    });
    // Eye lids (rows grow down from the top of the eye).
    const eyeZ = voxel * (flankK(EYE.i0 + 1, EYE.j0 + 1) + 0.8);
    for (const lid of lids) {
      lid.visible = pose.lid > 0;
      const side = lid.userData["side"] as number;
      lid.scale.set(voxel * 3.2, voxel * pose.lid, voxel * 0.6);
      lid.position.set(voxel * (EYE.i0 + 1.5), voxel * (EYE.j0 + 3 + BODY_Y - pose.lid / 2), side * eyeZ);
    }
    // Rings: inhale pulls in, burp pushes out.
    if (burp) applyRings(burp.rings, true);
    else if (pose.rings.length) applyRings(pose.rings, false);
    else rings.count = 0;
    // Star crumbs from popped teeth.
    let n = 0;
    popT.forEach((pt, ti) => {
      const socket = sockets[ti];
      if (pt < 0 || !socket) return;
      for (let c = 0; c < CRUMBS; c++) {
        const p = starCrumb(c, pt);
        if (!p) continue;
        v.set(socket.x + p.x * voxel, socket.y + p.y * voxel + rig.position.y, socket.z + p.z * voxel);
        q.setFromAxisAngle(axis, Math.PI / 4);
        s.setScalar(voxel * 0.8);
        crumbs.setMatrixAt(n++, m4.compose(v, q, s));
      }
    });
    crumbs.count = n;
    crumbs.instanceMatrix.needsUpdate = true;
  };

  const view: GulpView = {
    object,
    speechAnchor,
    get phase() {
      return phase;
    },
    get mood() {
      return mood;
    },
    get triangles() {
      return current.triangles;
    },
    setMood(m) {
      mood = m;
      apply();
    },
    setState(next, t = 0) {
      if (next === phase) return;
      phase = next;
      phaseT = Math.max(0, t);
      if (t === 0) {
        if (next === "teeth") emit("GULP!");
        if (next === "inhale") emit("sluuurp!");
        if (next === "rising" && mood === "sleepy") emit("*yawn*");
      }
      apply();
    },
    setTeeth(l, h) {
      lit = l;
      for (let i = 0; i < 3; i++) hit[i] = h[i] ?? false;
      apply();
    },
    update(dt) {
      const d = Math.max(0, dt);
      phaseT += d;
      if (burpT >= 0) burpT = burpOverlay(burpT + d) ? burpT + d : -1;
      if (biteReplay >= 0) biteReplay = biteReplay + d < 0.5 ? biteReplay + d : -1;
      for (let i = 0; i < 3; i++) {
        const pt = popT[i] ?? -1;
        if (pt >= 0) popT[i] = toothPop(pt + d) || starCrumb(0, pt + d) ? pt + d : -1;
      }
      apply();
    },
    playBite() {
      biteReplay = 0;
      apply();
    },
    playToothHit(i) {
      if (i < 0 || i > 2) return;
      hit[i] = true;
      popT[i] = 0;
      apply();
    },
    playBurp() {
      burpT = 0;
      emit("BURP!");
      apply();
    },
    toothAnchor(i, out) {
      out.copy(sockets[i] ?? sockets[1] ?? v);
      out.y -= voxel * 2;
      return out;
    },
    mouthAnchor(out) {
      return out.set(-voxel, (MOUTH_FLOOR + 3 + BODY_Y) * voxel, 0);
    },
    onSpeak(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      object.removeFromParent();
      rings.dispose();
      crumbs.dispose();
      (crumbs.material as MeshBasicMaterial).dispose();
      fxMat.dispose();
      lidMat.dispose();
      unit.dispose();
      listeners.clear();
    },
  };
  apply();
  return view;
}

/** Seconds a burp lasts (re-exported for hosts timing the sink). */
export const GULP_BURP_SECONDS = BURP_S;
