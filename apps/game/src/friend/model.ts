/**
 * `buildFriendModel` (architecture §2.1): the static voxel Friend used in the hub, greedy-meshed per frame and cached per
 * (frame, lost, gold, stitches, cracks, lod, halo) content, so Friends sharing a state share GPU buffers and repeated
 * SDK frames (idle holds) cost nothing extra.
 *
 * Coordinates: the model's origin is under its feet, centred on the front mask; +x right, +y up, the front plane at
 * z = 0 facing +z, depth toward −z. The caller orients it (art bible §2: front face ≤ 20° off the view vector).
 */
import * as THREE from "three";
import { and, goldSlots, EMPTY_MASK, frontMask, type Facing, type FriendAppearance, type Hex64 } from "@pl/shared";
import { composeLayers, friendAnchor, maskToGrid, type FriendAnchor, type FriendLayers } from "./layers.js";
import { meshFriend, triangleCount, type HaloSpec } from "./mesher.js";
import { FRIEND_COLORS } from "./palette.js";
import { IMPOSTOR_SCALE, impostorPixels } from "./pixels.js";
import { resolvePose } from "./pose.js";
import { friendMaterial, pixelTexture, RefCache, threeColor, toGeometry } from "./resources.js";

/** Level of detail: 0 full (in-run, near hub), 1 hub (no back faces, no bevel, thin halo), 2 billboard impostor. */
export type FriendLod = 0 | 1 | 2;

/** Default world size of one sprite pixel (art bible §3.1: hub Friends at 0.15 u per pixel). */
export const DEFAULT_PIXEL_SIZE = 0.15;
/** Extrusion depth in sprite pixels (art bible §2). */
export const FRIEND_DEPTH = 1.5;
/** Glow strength by crack stage (art bible §2.1: bloom 100 → 60 → 0 %). */
export const CRACK_GLOW = [1, 1, 0.6, 0] as const;

/** Halo overrides; widths in sprite pixels. */
export interface FriendHaloOptions {
  color?: number;
  width?: number;
  keyline?: number;
  /** Ring plane depth as a fraction of the extrusion depth (default 0.5: splits the parallax between front and back). */
  depthFraction?: number;
}

/** Options of `buildFriendModel`. Only `gold` and `lod` are required (architecture §2.1). */
export interface FriendModelOptions {
  /** Gold Pixels held (at most `MAX_VISIBLE_GOLD` are drawn, at `goldSlots`). */
  gold: number;
  lod: FriendLod;
  /** Pixels showing Mend stitches (`visibleStitches`). */
  stitched?: Hex64;
  /** Glow cracks on the worn gold (0..3 stages). */
  glowCracks?: number;
  /** World units per sprite pixel. Default `DEFAULT_PIXEL_SIZE`. */
  pixelSize?: number;
  /**
   * Geometry halo (paper ring + ink keyline). `false` when the stage draws the screen-space halo from the mask pass
   * (the group's `userData.halo` carries the tier colour either way).
   */
  halo?: FriendHaloOptions | false;
}

/** The public model handle (architecture §2.1), plus the state setters the hub needs. */
export interface FriendModel {
  object: THREE.Object3D;
  setPose(facing: Facing, walking: boolean, frame: number): void;
  setLost(lost: Hex64): void;
  dispose(): void;
  setLod(lod: FriendLod): void;
  setGold(gold: number): void;
  setStitched(stitched: Hex64): void;
  setGlowCracks(n: number): void;
  setHaloColor(color: number): void;
  /** Eye-glow event on/off (blinks, crits, streak 30+, Dusk). Off by default: a constant glow smears the face. */
  setEyeGlow(on: boolean): void;
  /** Triangles currently drawn (LOD2 = 2). */
  readonly triangles: number;
  /** SDK frame index currently drawn. */
  readonly frameIndex: number;
  readonly lod: FriendLod;
  /** Height of the tallest front-mask column in world units (for tags and emote anchors). */
  readonly height: number;
}

interface MeshEntry {
  main: THREE.BufferGeometry;
  gold: THREE.BufferGeometry | null;
  triangles: number;
}

interface ImpostorEntry {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial;
}

const meshCache = new RefCache<MeshEntry>((e) => {
  e.main.dispose();
  e.gold?.dispose();
});

const impostorCache = new RefCache<ImpostorEntry>((e) => {
  e.geometry.dispose();
  e.material.map?.dispose();
  e.material.dispose();
});

/** Cache statistics (leak checks in tests and the gallery). */
export function friendCacheStats(): {
  meshes: ReturnType<RefCache<MeshEntry>["stats"]>;
  impostors: ReturnType<RefCache<ImpostorEntry>["stats"]>;
} {
  return { meshes: meshCache.stats(), impostors: impostorCache.stats() };
}

/** Disposes every cached frame that no live model references. */
export function clearFriendCaches(): void {
  meshCache.clearIdle();
  impostorCache.clearIdle();
}

const DEFAULT_HALO: Record<FriendLod, { width: number; keyline: number }> = {
  0: { width: 0.6, keyline: 0.3 },
  1: { width: 0.35, keyline: 0.3 },
  2: { width: 0.5, keyline: 0.25 },
};

function haloSpec(opt: FriendHaloOptions | false | undefined, lod: FriendLod, color: number): HaloSpec | null {
  if (opt === false) return null;
  const d = DEFAULT_HALO[lod];
  return {
    width: opt?.width ?? d.width,
    keyline: opt?.keyline ?? d.keyline,
    color,
    depthFraction: opt?.depthFraction ?? 0.5,
  };
}

function buildMesh(
  layers: FriendLayers,
  lod: 0 | 1,
  s: number,
  anchor: FriendAnchor,
  halo: HaloSpec | null,
  eye: number,
): MeshEntry {
  const data = meshFriend(layers, {
    pixelSize: s,
    depth: FRIEND_DEPTH,
    anchor,
    lod,
    halo,
    eyeColor: eye,
    convert: threeColor,
  });
  return {
    main: toGeometry(data.main, data.bounds),
    gold: data.gold ? toGeometry(data.gold, data.bounds) : null,
    triangles: triangleCount(data),
  };
}

function buildImpostor(layers: FriendLayers, s: number, anchor: FriendAnchor, halo: HaloSpec | null): ImpostorEntry {
  const k = IMPOSTOR_SCALE;
  const px = impostorPixels(
    layers,
    halo
      ? { width: Math.round(halo.width * k), keyline: Math.max(1, Math.round(halo.keyline * k)), color: halo.color }
      : null,
  );
  const side = px.width / k; // sprite px
  const geometry = new THREE.PlaneGeometry(side * s, side * s);
  // Plane centre = centre of the (margin-padded) 16×16 grid, in anchor coordinates.
  geometry.translate((8 - anchor.cx) * s, (anchor.bottom - 8) * s, 0);
  const material = new THREE.MeshBasicMaterial({ map: pixelTexture(px), alphaTest: 0.5 });
  return { geometry, material };
}

/**
 * Builds a Friend model showing idle-down frame 0 (Colossus: idle-right), with `lost` scars, gold and stitch layers.
 * Every setter rebuilds only on a cache miss; a miss costs one greedy mesh of 16×16 cells.
 */
export function buildFriendModel(a: FriendAppearance, lost: Hex64, opts: FriendModelOptions): FriendModel {
  const front = frontMask(a);
  const anchor = friendAnchor(front);
  const s = opts.pixelSize ?? DEFAULT_PIXEL_SIZE;
  const group = new THREE.Group();
  group.name = `friend:${a.tokenId}`;
  const main = new THREE.Mesh(undefined, friendMaterial());
  const gold = new THREE.Mesh(undefined, friendMaterial());
  const impostor = new THREE.Mesh();
  for (const m of [main, gold, impostor]) {
    m.userData.friend = true;
    m.visible = false;
    group.add(m);
  }
  main.name = "friend-body";
  gold.name = "friend-gold";
  impostor.name = "friend-impostor";

  const state = {
    lod: opts.lod,
    lost,
    gold: opts.gold,
    stitched: opts.stitched ?? EMPTY_MASK,
    cracks: opts.glowCracks ?? 0,
    haloColor: (opts.halo ? opts.halo.color : undefined) ?? FRIEND_COLORS.halo,
    eyeGlow: false,
    facing: "down" as Facing,
    walking: false,
    frame: 0,
    side: "right" as "left" | "right",
    index: 0,
    goldMask: EMPTY_MASK,
    key: "",
    kind: "mesh" as "mesh" | "impostor",
    triangles: 0,
  };
  let disposed = false;

  const recomputeGold = (): void => {
    state.goldMask = goldSlots(front, state.lost, a.tokenId, state.gold);
  };

  const release = (): void => {
    if (!state.key) return;
    (state.kind === "mesh" ? meshCache : impostorCache).release(state.key);
    state.key = "";
  };

  const refresh = (): void => {
    if (disposed) return;
    const pose = resolvePose(a, state.facing, state.walking, state.frame, state.side);
    state.index = pose.index;
    const frame = a.frames[pose.index] ?? front;
    const halo = haloSpec(opts.halo, state.lod, state.haloColor);
    const input = {
      frame,
      lost: and(state.lost, frame),
      gold: and(state.goldMask, frame),
      stitched: and(state.stitched, frame),
      crack: state.cracks,
    };
    const eye = state.eyeGlow ? FRIEND_COLORS.eyeGlow : FRIEND_COLORS.eye;
    const haloKey = halo ? `${halo.width},${halo.keyline},${halo.color},${halo.depthFraction}` : "-";
    const kind = state.lod === 2 ? "impostor" : "mesh";
    const key = [
      state.lod,
      s,
      anchor.cx,
      anchor.bottom,
      input.frame,
      input.lost,
      input.gold,
      input.stitched,
      input.crack,
      haloKey,
      kind === "mesh" ? eye : "",
    ].join("|");
    if (key === state.key) return;
    const layers = (): FriendLayers => composeLayers(input);
    const lod = state.lod;
    if (lod !== 2) {
      const e = meshCache.acquire(key, () => buildMesh(layers(), lod, s, anchor, halo, eye));
      release();
      main.geometry = e.main;
      main.visible = true;
      if (e.gold) gold.geometry = e.gold;
      gold.visible = e.gold !== null;
      impostor.visible = false;
      state.triangles = e.triangles;
    } else {
      const e = impostorCache.acquire(key, () => buildImpostor(layers(), s, anchor, halo));
      release();
      impostor.geometry = e.geometry;
      impostor.material = e.material;
      impostor.visible = true;
      main.visible = false;
      gold.visible = false;
      state.triangles = 2;
    }
    state.key = key;
    state.kind = kind;
    // Stage passes read these (style frames' convention): halo tier colour, gold bloom colour and strength.
    group.userData.halo = state.haloColor;
    gold.userData.glow = FRIEND_COLORS.goldBloom;
    gold.userData.glowStrength = CRACK_GLOW[Math.min(3, Math.max(0, Math.floor(state.cracks)))];
    main.userData.eyeGlow = state.eyeGlow ? FRIEND_COLORS.eyeGlowBloom : null;
  };

  group.userData.isFriend = true;
  group.userData.tokenId = a.tokenId;
  recomputeGold();
  refresh();

  const frontGrid = maskToGrid(front);
  let topRow = anchor.bottom;
  for (let i = 0; i < 256; i++) if (frontGrid[i]) topRow = Math.min(topRow, i >> 4);
  const height = (anchor.bottom - topRow) * s;

  return {
    object: group,
    setPose(facing, walking, frame) {
      if (facing === "left" || facing === "right") state.side = facing;
      state.facing = facing;
      state.walking = walking;
      state.frame = frame;
      refresh();
    },
    setLost(next) {
      state.lost = next;
      recomputeGold();
      refresh();
    },
    setLod(lod) {
      state.lod = lod;
      refresh();
    },
    setGold(n) {
      state.gold = n;
      recomputeGold();
      refresh();
    },
    setStitched(m) {
      state.stitched = m;
      refresh();
    },
    setGlowCracks(n) {
      state.cracks = n;
      refresh();
    },
    setHaloColor(color) {
      state.haloColor = color;
      refresh();
    },
    setEyeGlow(on) {
      state.eyeGlow = on;
      refresh();
    },
    dispose() {
      if (disposed) return;
      release();
      disposed = true;
      group.removeFromParent();
      group.clear();
    },
    get triangles() {
      return state.triangles;
    },
    get frameIndex() {
      return state.index;
    },
    get lod() {
      return state.lod;
    },
    get height() {
      return height;
    },
  };
}
