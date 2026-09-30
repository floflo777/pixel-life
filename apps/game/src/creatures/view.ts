import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type MeshLambertMaterial,
} from "three";
import { createBandMaterial } from "../post/band-material";
import { tagGlow } from "../post/tags";
import { PALETTE } from "../stage/palette";
import {
  SHATTER_S,
  creaturePose,
  hitOverlay,
  shardCount,
  shardSample,
  tongueExtension,
  type CreaturePose,
} from "./animation";
import { creatureMaterial, meshSprite, type CreatureFrameMesh } from "./mesh";
import { SPEECH_SECONDS, speechFor, type SpeechLine, type SpeechListener } from "./speech";
import { CREATURE_SPRITES, type CreatureKind } from "./sprites";
import type { CreatureState } from "./states";

/** Default creature voxel edge in world units (style frame 1 uses 0.10–0.11). */
export const CREATURE_VOXEL = 0.1;

/** Colours a smashed creature breaks into: its pastels + paper (bible §5: no gore, no dark). */
export const SHARD_COLORS: Readonly<Record<CreatureKind, readonly number[]>> = {
  nib: [PALETTE.coral, PALETTE.coralDark, PALETTE.paperWarm],
  pogo: [PALETTE.sun, 0xd9a444, PALETTE.paperWarm],
  clank: [PALETTE.lilac, PALETTE.pond, PALETTE.paperWarm],
  snatch: [PALETTE.lilac, PALETTE.lilacDark, PALETTE.coral],
  slurp: [PALETTE.pond, 0x5f95bf, PALETTE.lilac],
  fizz: [PALETTE.paperWarm, PALETTE.sun, PALETTE.paper],
};

/** How a kind turns toward its heading: Clank must show its plate direction; wide/winged kinds keep facing the camera. */
const FACING: Readonly<Record<CreatureKind, { readonly clampDeg: number }>> = {
  nib: { clampDeg: 180 },
  pogo: { clampDeg: 180 },
  clank: { clampDeg: 180 },
  snatch: { clampDeg: 35 },
  slurp: { clampDeg: 35 },
  fizz: { clampDeg: 180 },
};
/** Facing is stepped too: 22.5° increments. */
const YAW_STEP = Math.PI / 8;

const frameCache = new Map<string, CreatureFrameMesh>();

/** The meshed geometry of one sprite frame, shared by every view of that kind and voxel size. */
export function creatureFrame(kind: CreatureKind, frame: string, voxel = CREATURE_VOXEL): CreatureFrameMesh {
  const key = `${kind}|${frame}|${voxel}`;
  let m = frameCache.get(key);
  if (!m) {
    const set = CREATURE_SPRITES[kind];
    const rows = set.frames[frame] ?? set.frames["idle0"] ?? Object.values(set.frames)[0];
    if (!rows) throw new Error(`No sprite frames for ${kind}`);
    m = meshSprite(rows, set.skin, set.maxD, voxel);
    frameCache.set(key, m);
  }
  return m;
}

let flashMat: MeshBasicMaterial | null = null;
let fxMat: MeshLambertMaterial | null = null;
let sparkMat: MeshBasicMaterial | null = null;
let unitBox: BoxGeometry | null = null;
const sharedFx = (): {
  flash: MeshBasicMaterial;
  fx: MeshLambertMaterial;
  spark: MeshBasicMaterial;
  box: BoxGeometry;
} => {
  flashMat ??= new MeshBasicMaterial({ color: PALETTE.paper });
  fxMat ??= createBandMaterial({ color: 0xffffff });
  sparkMat ??= new MeshBasicMaterial({ color: PALETTE.lampBulb });
  unitBox ??= new BoxGeometry(1, 1, 1);
  return { flash: flashMat, fx: fxMat, spark: sparkMat, box: unitBox };
};

/** Frees every cached creature geometry and shared material (stage teardown; views must be disposed first). */
export function disposeCreatureCache(): void {
  for (const m of frameCache.values()) m.geometry.dispose();
  frameCache.clear();
  flashMat?.dispose();
  fxMat?.dispose();
  sparkMat?.dispose();
  unitBox?.dispose();
  flashMat = null;
  fxMat = null;
  sparkMat = null;
  unitBox = null;
}

/** Options for createCreatureView. */
export interface CreatureViewOptions {
  /** Voxel edge in world units (default CREATURE_VOXEL). */
  readonly voxel?: number;
  /** Stable per-creature seed (sim id): desyncs idle loops and picks the shatter pattern. */
  readonly seed?: number;
}

/** A renderable Munchie driven by sim state. */
export interface CreatureView {
  readonly kind: CreatureKind;
  /** Root to position at the creature's ground point (sim x, y, z); never scaled or rotated by the view. */
  readonly object: Group;
  /** Where a carried pixel hangs (Snatch's beak/claws). */
  readonly carryAnchor: Object3D;
  /** Where speech bubbles attach (above the head). */
  readonly speechAnchor: Object3D;
  readonly state: CreatureState;
  /** Triangles of the body frame currently shown. */
  readonly triangles: number;
  /** True once a smash has fully played (the host may dispose the view). */
  readonly finished: boolean;
  /** Switches state; `t` = seconds already spent in it (join mid-state). Re-setting the same state is a no-op. */
  setState(state: CreatureState, t?: number): void;
  /** Heading on the ground plane (parent space). Stepped to 22.5°. */
  setFacing(dx: number, dz: number): void;
  /** World-space target for Slurp's tongue (null = straight ahead). */
  setTarget(world: Vector3 | null): void;
  /** Advances presentation time (real seconds; pass 0 during hit-stop to hold the frame). */
  update(dt: number): void;
  /** Hit reaction: 2-frame paper flash + squash/stretch (0.25 s). */
  playHit(): void;
  /** Voxel shatter: 6–10 pastel shards, stepped fall, gone in 0.5 s. */
  playSmash(): void;
  /** One-shot attack not tied to a state (Slurp's tongue yank at the end of the puff). */
  playAttack(): void;
  /** Subscribes to speech lines ("MINE!"); returns an unsubscribe. */
  onSpeak(cb: SpeechListener): () => void;
  /** Says a custom line. */
  say(text: string, duration?: number): void;
  /** Removes the view and frees its own resources (shared geometry stays cached). */
  dispose(): void;
}

const TONGUE_VOXELS = 12;
const RIPPLE_DOTS = 12;
const MAX_SHARDS = 10;

/** Creates the view for one Munchie. All geometry is merged per sprite frame and shared across views. */
export function createCreatureView(kind: CreatureKind, opts: CreatureViewOptions = {}): CreatureView {
  const voxel = opts.voxel ?? CREATURE_VOXEL;
  const seed = opts.seed ?? 0;
  const phase = ((seed % 4) + 4) % 4;
  const fx = sharedFx();
  const base = creatureFrame(kind, "idle0", voxel);
  const halfH = (base.h * voxel) / 2;

  const object = new Group();
  object.name = `creature-${kind}`;
  const yawGroup = new Group();
  const tilt = new Group(); // pitch about the feet
  const roll = new Group(); // roll about the body centre
  roll.position.y = halfH;
  const body = new Mesh<BufferGeometry, Material>(base.geometry, creatureMaterial());
  body.name = `${kind}-body`;
  body.position.y = -halfH;
  object.add(yawGroup);
  yawGroup.add(tilt);
  tilt.add(roll);
  roll.add(body);

  const carryAnchor = new Object3D();
  carryAnchor.name = `${kind}-carry`;
  carryAnchor.position.set(0, -voxel * 1.5, voxel);
  body.add(carryAnchor);
  const speechAnchor = new Object3D();
  speechAnchor.name = `${kind}-speech`;
  speechAnchor.position.set(0, base.h * voxel + voxel * 4, 0);
  object.add(speechAnchor);

  // Fizz: the fuse spark is its own tiny glowing voxel (dot bloom), blinking with the fuse.
  let spark: Mesh | null = null;
  if (kind === "fizz") {
    spark = new Mesh(fx.box, fx.spark);
    spark.name = "fizz-spark";
    spark.scale.setScalar(voxel * 1.2);
    spark.position.set(voxel * 0.5, base.h * voxel + voxel * 0.6, 0);
    tagGlow(spark, "gold");
    body.add(spark);
  }

  // Slurp: the tongue is a lilac voxel ribbon arcing to its target.
  let tongue: InstancedMesh | null = null;
  if (kind === "slurp") {
    tongue = new InstancedMesh(fx.box, fx.fx, TONGUE_VOXELS);
    tongue.name = "slurp-tongue";
    const lilac = new Color(PALETTE.lilac);
    for (let i = 0; i < TONGUE_VOXELS; i++) tongue.setColorAt(i, lilac);
    tongue.count = 0;
    tongue.frustumCulled = false;
    yawGroup.add(tongue);
  }

  let ripple: InstancedMesh | null = null;
  let shards: InstancedMesh | null = null;

  let state: CreatureState = "idle";
  let stateT = 0;
  let hitT = -1;
  let smashT = -1;
  let tongueT = -1;
  let speakT = 0;
  let yaw = 0;
  let current = base;
  const target = new Vector3();
  let hasTarget = false;
  const listeners = new Set<SpeechListener>();
  const m4 = new Matrix4();
  const q = new Quaternion();
  const v = new Vector3();
  const s = new Vector3();
  const tLocal = new Vector3();

  const emit = (text: string, duration = SPEECH_SECONDS): void => {
    const line: SpeechLine = { text, duration, anchor: speechAnchor };
    for (const l of listeners) l(line);
  };

  const setGeometry = (g: BufferGeometry): void => {
    if (body.geometry === g) return;
    body.geometry = g;
    // Projected shadows (attachProjectedShadow) re-draw the body's geometry: keep them on the current frame.
    for (const c of body.children) if (c.userData["plShadow"]) (c as Mesh).geometry = g;
  };

  const ensureRipple = (): InstancedMesh => {
    if (!ripple) {
      ripple = new InstancedMesh(fx.box, fx.fx, RIPPLE_DOTS);
      ripple.name = `${kind}-ripple`;
      const paper = new Color(PALETTE.paperWarm);
      for (let i = 0; i < RIPPLE_DOTS; i++) ripple.setColorAt(i, paper);
      ripple.frustumCulled = false;
      object.add(ripple);
    }
    return ripple;
  };

  const ensureShards = (): InstancedMesh => {
    if (!shards) {
      shards = new InstancedMesh(fx.box, fx.fx, MAX_SHARDS);
      shards.name = `${kind}-shards`;
      const cols = SHARD_COLORS[kind];
      const c = new Color();
      for (let i = 0; i < MAX_SHARDS; i++) shards.setColorAt(i, c.set(cols[i % cols.length] ?? PALETTE.paper));
      shards.frustumCulled = false;
      object.add(shards);
    }
    return shards;
  };

  const applyRipple = (): void => {
    const show = state === "spawn" && stateT < 0.6;
    if (!show) {
      if (ripple) ripple.count = 0;
      return;
    }
    const r = ensureRipple();
    // A dotted ring stepping outward in 4 steps over the 0.6 s spawn ripple.
    const step = Math.min(3, Math.floor(stateT / 0.15));
    const radius = (base.w * 0.25 + step * base.w * 0.15) * voxel;
    for (let i = 0; i < RIPPLE_DOTS; i++) {
      const a = (i / RIPPLE_DOTS) * Math.PI * 2;
      v.set(Math.cos(a) * radius, voxel * 0.3, Math.sin(a) * radius);
      s.setScalar(voxel * (step === 3 ? 0.6 : 0.9));
      r.setMatrixAt(i, m4.compose(v, q.identity(), s));
    }
    r.count = RIPPLE_DOTS;
    r.instanceMatrix.needsUpdate = true;
  };

  const applyShards = (): void => {
    if (smashT < 0) return;
    const sh = ensureShards();
    const n = Math.min(MAX_SHARDS, shardCount(seed + kind.length * 131));
    let shown = 0;
    for (let i = 0; i < n; i++) {
      const p = shardSample(seed * 7 + kind.length, i, smashT, base.w / 2, base.h / 2);
      if (!p) continue;
      v.set(p.x * voxel, p.y * voxel, p.z * voxel);
      q.setFromAxisAngle(tLocal.set(0.6, 0.8, 0).normalize(), p.spin);
      s.setScalar(voxel * 1.6 * p.size);
      sh.setMatrixAt(shown++, m4.compose(v, q, s));
    }
    sh.count = shown;
    sh.instanceMatrix.needsUpdate = true;
  };

  const applyTongue = (pose: CreaturePose): void => {
    if (!tongue) return;
    const ext =
      state === "attack" ? Math.max(tongueExtension(stateT), tongueExtension(tongueT)) : tongueExtension(tongueT);
    if (ext <= 0 || !pose.visible) {
      tongue.count = 0;
      return;
    }
    // Mouth: front centre of the sprite, 3.5 voxels up (the lilac tongue row).
    const mouth = v.set(0, voxel * 3 * pose.sy, voxel * 2.2);
    if (hasTarget) {
      object.updateWorldMatrix(true, false);
      tLocal.copy(target);
      yawGroup.worldToLocal(tLocal);
    } else tLocal.set(0, 0, voxel * 30);
    const end = tLocal.sub(mouth).multiplyScalar(ext).add(mouth);
    const n = Math.max(3, Math.min(TONGUE_VOXELS, Math.round(end.distanceTo(mouth) / (voxel * 1.1))));
    const arc = end.distanceTo(mouth) * 0.18;
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 1 : i / (n - 1);
      s.set(voxel * 1.3, voxel * 0.8, voxel * 1.3);
      const p = new Vector3().lerpVectors(mouth, end, f);
      p.y += Math.sin(f * Math.PI) * arc;
      // Snap the ribbon to the voxel grid so it steps instead of sliding.
      p.set(Math.round(p.x / voxel) * voxel, Math.round(p.y / voxel) * voxel, Math.round(p.z / voxel) * voxel);
      tongue.setMatrixAt(i, m4.compose(p, q.identity(), s));
    }
    tongue.count = n;
    tongue.instanceMatrix.needsUpdate = true;
  };

  const apply = (): void => {
    const pose = creaturePose(kind, state, stateT, phase);
    let frame = pose.frame;
    if (kind === "slurp" && tongueT >= 0 && tongueExtension(tongueT) > 0) frame = "open";
    current = creatureFrame(kind, frame, voxel);
    setGeometry(current.geometry);
    const hit = hitOverlay(hitT);
    const sx = pose.sx * (hit?.sx ?? 1);
    const sy = pose.sy * (hit?.sy ?? 1);
    body.material = hit?.flash ? fx.flash : creatureMaterial();
    body.visible = pose.visible && smashT < 0;
    tilt.scale.set(sx * pose.scale, sy * pose.scale, sx * pose.scale);
    tilt.position.set(pose.shift * voxel, pose.lift * voxel, 0);
    tilt.rotation.set(pose.pitch, 0, 0);
    roll.rotation.set(0, 0, pose.roll);
    if (spark) spark.visible = pose.spark && body.visible;
    yawGroup.rotation.y = yaw;
    speechAnchor.position.y = (current.h + 4 + pose.lift) * voxel;
    applyRipple();
    applyShards();
    applyTongue(pose);
  };

  const view: CreatureView = {
    kind,
    object,
    carryAnchor,
    speechAnchor,
    get state() {
      return state;
    },
    get triangles() {
      return current.triangles;
    },
    get finished() {
      return smashT >= SHATTER_S;
    },
    setState(next, t = 0) {
      if (next === state) return;
      state = next;
      stateT = Math.max(0, t);
      speakT = 0;
      if (next === "smashed" && smashT < 0) smashT = stateT;
      const line = speechFor(kind, next);
      if (line && t === 0) emit(line);
      apply();
    },
    setFacing(dx, dz) {
      if (dx === 0 && dz === 0) return;
      const clamp = (FACING[kind].clampDeg * Math.PI) / 180;
      const a = Math.max(-clamp, Math.min(clamp, Math.atan2(dx, dz)));
      yaw = Math.round(a / YAW_STEP) * YAW_STEP;
      yawGroup.rotation.y = yaw;
    },
    setTarget(world) {
      hasTarget = world !== null;
      if (world) target.copy(world);
    },
    update(dt) {
      const d = Math.max(0, dt);
      stateT += d;
      if (hitT >= 0) hitT = hitOverlay(hitT + d) ? hitT + d : -1;
      if (smashT >= 0) smashT += d;
      if (tongueT >= 0) tongueT = tongueExtension(tongueT + d) > 0 ? tongueT + d : -1;
      // Slurp snores every 2 s.
      if (kind === "slurp" && state === "sleep") {
        speakT += d;
        if (speakT >= 2) {
          speakT -= 2;
          emit("zzz");
        }
      }
      apply();
    },
    playHit() {
      hitT = 0;
      apply();
    },
    playSmash() {
      if (smashT < 0) smashT = 0;
      state = "smashed";
      stateT = 0;
      hitT = -1;
      apply();
    },
    playAttack() {
      if (kind === "slurp") tongueT = 0;
      else {
        state = "idle";
        view.setState("attack", 0);
      }
      apply();
    },
    onSpeak(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    say(text, duration) {
      emit(text, duration);
    },
    dispose() {
      object.removeFromParent();
      ripple?.dispose();
      shards?.dispose();
      tongue?.dispose();
      listeners.clear();
    },
  };
  apply();
  return view;
}
