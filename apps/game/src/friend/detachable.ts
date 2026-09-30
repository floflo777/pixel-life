/**
 * The venue's player Friend (architecture §3 "In Pixel Life the player's Friend is an InstancedMesh"): one box instance
 * per front-mask pixel, so any pixel can detach into a sim particle and snap back. Instance ids are stable for the
 * model's lifetime: instance k is the k-th set pixel of the front mask in ascending index order.
 *
 * Band colours and the bevel are computed in the shader from the box's object-space normal plus a per-instance exposed
 * edge vector (`aEdge`), exactly like the style frames, so a tumbling voxel keeps its flat banded look. The halo, eye
 * plates, scar / loose-slot plates and decals are one small static overlay mesh rebuilt on state changes.
 */
import * as THREE from "three";
import { goldSlots, EMPTY_MASK, frontMask, type FriendAppearance, type Hex64 } from "@pl/shared";
import { Cell, CELLS, composeLayers, friendAnchor, GRID, maskToGrid, type FriendLayers } from "./layers.js";
import { meshFriend } from "./mesher.js";
import { CRACK_GLOW, DEFAULT_PIXEL_SIZE, FRIEND_DEPTH, type FriendHaloOptions } from "./model.js";
import { BODY_BANDS, FRIEND_COLORS, GOLD_BANDS, type FaceBands } from "./palette.js";
import { friendMaterial, threeColor, toGeometry } from "./resources.js";

/** Options for the detachable Friend. */
export interface DetachableFriendOptions {
  gold: number;
  stitched?: Hex64;
  glowCracks?: number;
  pixelSize?: number;
  halo?: FriendHaloOptions | false;
}

/** The venue Friend handle: per-pixel voxels addressable by pixel index or instance id. */
export interface DetachableFriend {
  object: THREE.Group;
  /** All voxels; instance `k` ↔ pixel `pixelOf(k)`. `frustumCulled` is off because detached voxels roam. */
  readonly voxels: THREE.InstancedMesh;
  /** Pixel indices in instance order (the front mask's set pixels, ascending). */
  readonly pixels: readonly number[];
  /** Instance id of a pixel, or −1 if the pixel is not in the front mask. */
  instanceOf(pixel: number): number;
  /** Pixel index of an instance id (throws `RangeError` on an unknown id). */
  pixelOf(instance: number): number;
  isDetached(pixel: number): boolean;
  /** Detaches a present or lost pixel: its voxel becomes caller-driven and its slot shows the loose plate. Returns the instance id. */
  detach(pixel: number): number;
  /** Moves a detached voxel, in world space (converted through the group's current world matrix). */
  setDetachedWorld(pixel: number, position: THREE.Vector3, quaternion?: THREE.Quaternion, scale?: number): void;
  /** Hands the voxel back to the model: it snaps home (and hides if the pixel is lost). */
  reattach(pixel: number): void;
  /** World position of a pixel's home slot (front-face centre), for grab-back targets and particle spawns. */
  homeWorld(pixel: number, target: THREE.Vector3): THREE.Vector3;
  setLost(lost: Hex64): void;
  setGold(gold: number): void;
  setStitched(stitched: Hex64): void;
  setGlowCracks(n: number): void;
  dispose(): void;
}

const BAND_KEYS: readonly (keyof FaceBands)[] = [
  "front",
  "top",
  "bottom",
  "left",
  "right",
  "back",
  "bevelTop",
  "bevelLeft",
];

let voxelMaterial: THREE.MeshBasicMaterial | null = null;

/** The instanced voxel material: flat bands per face from uniforms, bevel from `aEdge`, gold via `aGold`. */
function detachableMaterial(): THREE.MeshBasicMaterial {
  if (voxelMaterial) return voxelMaterial;
  const bands = [...BAND_KEYS.map((k) => BODY_BANDS[k]), ...BAND_KEYS.map((k) => GOLD_BANDS[k])].map((hex) => {
    const [r, g, b] = threeColor(hex);
    return new THREE.Vector3(r, g, b);
  });
  const m = new THREE.MeshBasicMaterial();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBands = { value: bands };
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec4 aEdge;\nattribute float aGold;\nvarying vec3 vBoxP;\nvarying vec3 vBoxN;\nvarying vec4 vEdge;\nvarying float vGold;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvBoxP = position;\nvBoxN = normal;\nvEdge = aEdge;\nvGold = aGold;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uBands[16];\nvarying vec3 vBoxP;\nvarying vec3 vBoxN;\nvarying vec4 vEdge;\nvarying float vGold;",
      )
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `int o = vGold > 0.5 ? 8 : 0;
        vec3 band;
        if (vBoxN.z > 0.5) {
          band = uBands[o];
          if (vEdge.x > 0.5 && vBoxP.y > 0.28) band = uBands[o + 6];
          else if (vEdge.w > 0.5 && vBoxP.x < -0.34) band = uBands[o + 7];
        } else if (vBoxN.z < -0.5) band = uBands[o + 5];
        else if (vBoxN.y > 0.5) band = uBands[o + 1];
        else if (vBoxN.y < -0.5) band = uBands[o + 2];
        else if (vBoxN.x < -0.5) band = uBands[o + 3];
        else band = uBands[o + 4];
        vec4 diffuseColor = vec4( band, opacity );`,
      );
  };
  m.customProgramCacheKey = () => "pl-friend-voxel";
  voxelMaterial = m;
  return m;
}

/** Builds the venue Friend from its front mask (idle-down frame 0; Colossus idle-right) with `lost` scars. */
export function buildDetachableFriend(
  a: FriendAppearance,
  lost: Hex64,
  opts: DetachableFriendOptions,
): DetachableFriend {
  const front = frontMask(a);
  const anchor = friendAnchor(front);
  const s = opts.pixelSize ?? DEFAULT_PIXEL_SIZE;
  const D = FRIEND_DEPTH * s;
  const frontGrid = maskToGrid(front);
  const pixels: number[] = [];
  const instanceOfPixel = new Int16Array(CELLS).fill(-1);
  for (let i = 0; i < CELLS; i++) {
    if (!frontGrid[i]) continue;
    instanceOfPixel[i] = pixels.length;
    pixels.push(i);
  }
  const n = pixels.length;

  // Unit box with its front face at z = 0 (box spans z ∈ [−1, 0]); the instance scale gives (s, s, D).
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);
  const edges = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 4), 4);
  const goldAttr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n)), 1);
  box.setAttribute("aEdge", edges);
  box.setAttribute("aGold", goldAttr);
  const voxels = new THREE.InstancedMesh(box, detachableMaterial(), Math.max(1, n));
  voxels.count = n;
  voxels.frustumCulled = false;
  voxels.name = "friend-voxels";
  voxels.userData.friend = true;

  const overlay = new THREE.Mesh(undefined, friendMaterial());
  overlay.name = "friend-overlay";
  overlay.userData.friend = true;
  const group = new THREE.Group();
  group.name = `friend-venue:${a.tokenId}`;
  group.userData.isFriend = true;
  group.userData.tokenId = a.tokenId;
  group.add(overlay, voxels);

  const state = {
    lost,
    gold: opts.gold,
    stitched: opts.stitched ?? EMPTY_MASK,
    cracks: opts.glowCracks ?? 0,
    haloColor: (opts.halo ? opts.halo.color : undefined) ?? FRIEND_COLORS.halo,
  };
  const detached = new Uint8Array(CELLS);
  let layers: FriendLayers = composeLayers({ frame: front, lost, gold: EMPTY_MASK, stitched: EMPTY_MASK, crack: 0 });
  let disposed = false;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const homeLocal = (pixel: number, target: THREE.Vector3): THREE.Vector3 =>
    target.set(((pixel % GRID) - anchor.cx + 0.5) * s, (anchor.bottom - (pixel >> 4) - 0.5) * s, 0);

  const checkPixel = (pixel: number): number => {
    const k = Number.isInteger(pixel) && pixel >= 0 && pixel < CELLS ? (instanceOfPixel[pixel] ?? -1) : -1;
    if (k < 0) throw new RangeError(`Pixel ${pixel} is not part of this Friend.`);
    return k;
  };

  const solidAt = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return false;
    const i = y * GRID + x;
    const c = layers.cells[i];
    return (c === Cell.Body || c === Cell.Gold) && !detached[i];
  };

  /** Rewrites edges / gold flags / home matrices of every instance and rebuilds the overlay. */
  const sync = (): void => {
    const goldMask = goldSlots(front, state.lost, a.tokenId, state.gold);
    layers = composeLayers({
      frame: front,
      lost: state.lost,
      gold: goldMask,
      stitched: state.stitched,
      crack: state.cracks,
    });
    layers.loose = detached;
    const e = edges.array as Float32Array;
    const g = goldAttr.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const i = pixels[k] as number; // Invariant: k < n = pixels.length.
      const x = i % GRID;
      const y = i >> 4;
      const c = layers.cells[i];
      g[k] = c === Cell.Gold ? 1 : 0;
      if (detached[i]) {
        e.set([1, 1, 1, 1], k * 4);
        continue;
      }
      e[k * 4] = solidAt(x, y - 1) ? 0 : 1;
      e[k * 4 + 1] = solidAt(x + 1, y) ? 0 : 1;
      e[k * 4 + 2] = solidAt(x, y + 1) ? 0 : 1;
      e[k * 4 + 3] = solidAt(x - 1, y) ? 0 : 1;
      if (c === Cell.Scar) voxels.setMatrixAt(k, ZERO);
      else voxels.setMatrixAt(k, m4.compose(homeLocal(i, v), q.identity(), sc.set(s, s, D)));
    }
    edges.needsUpdate = true;
    goldAttr.needsUpdate = true;
    voxels.instanceMatrix.needsUpdate = true;
    const data = meshFriend(layers, {
      pixelSize: s,
      depth: FRIEND_DEPTH,
      anchor,
      lod: 0,
      halo: haloOf(opts.halo, state.haloColor),
      eyeColor: FRIEND_COLORS.eye,
      voxels: false,
      convert: threeColor,
    });
    overlay.geometry.dispose();
    overlay.geometry = toGeometry(data.main, data.bounds);
    voxels.userData.glow = FRIEND_COLORS.goldBloom;
    voxels.userData.glowStrength = CRACK_GLOW[Math.min(3, Math.max(0, Math.floor(state.cracks)))];
    group.userData.halo = state.haloColor;
  };

  sync();

  return {
    object: group,
    voxels,
    pixels,
    instanceOf(pixel) {
      if (!Number.isInteger(pixel) || pixel < 0 || pixel >= CELLS) return -1;
      return instanceOfPixel[pixel] ?? -1;
    },
    pixelOf(instance) {
      const p = pixels[instance];
      if (p === undefined) throw new RangeError(`Unknown instance ${instance}.`);
      return p;
    },
    isDetached(pixel) {
      return this.instanceOf(pixel) >= 0 && detached[pixel] === 1;
    },
    detach(pixel) {
      const k = checkPixel(pixel);
      if (detached[pixel]) return k;
      detached[pixel] = 1;
      // A lost pixel detaching (e.g. regrow VFX) starts at its home slot at full size.
      voxels.setMatrixAt(k, m4.compose(homeLocal(pixel, v), q.identity(), sc.set(s, s, D)));
      sync();
      return k;
    },
    setDetachedWorld(pixel, position, quaternion, scale = 1) {
      const k = checkPixel(pixel);
      if (!detached[pixel]) throw new Error(`Pixel ${pixel} is not detached.`);
      group.updateWorldMatrix(true, false);
      const world = m4.compose(position, quaternion ?? q.identity(), sc.set(s * scale, s * scale, D * scale));
      // Convert to the group's local space; instance matrices are local to the InstancedMesh (= group space).
      voxels.setMatrixAt(k, world.premultiply(inv.copy(group.matrixWorld).invert()));
      voxels.instanceMatrix.needsUpdate = true;
    },
    reattach(pixel) {
      checkPixel(pixel);
      if (!detached[pixel]) return;
      detached[pixel] = 0;
      sync();
    },
    homeWorld(pixel, target) {
      checkPixel(pixel);
      group.updateWorldMatrix(true, false);
      return homeLocal(pixel, target).applyMatrix4(group.matrixWorld);
    },
    setLost(next) {
      state.lost = next;
      sync();
    },
    setGold(gold) {
      state.gold = gold;
      sync();
    },
    setStitched(m) {
      state.stitched = m;
      sync();
    },
    setGlowCracks(nc) {
      state.cracks = nc;
      sync();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      overlay.geometry.dispose();
      box.dispose();
      voxels.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}

function haloOf(opt: FriendHaloOptions | false | undefined, color: number) {
  if (opt === false) return null;
  return {
    width: opt?.width ?? 0.6,
    keyline: opt?.keyline ?? 0.3,
    color,
    depthFraction: opt?.depthFraction ?? 0.5,
  };
}
