/**
 * Far-LOD crowd: every far Friend is drawn as flat sprite pixels in ONE InstancedMesh (one instance per pixel), so
 * 40+ distant Friends cost one draw call, one shadow call and one mask call (art bible §10: "40 Friends as one
 * InstancedMesh per material"). Geometry is exact per pixel, so the screen-space halo hugs the real silhouette.
 */
import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  type Material,
} from "three";
import { toIndices, type Hex64 } from "@pl/shared";
import { tagHalo } from "../post/tags";
import { PALETTE } from "../stage/palette";

/** Sprite pixels of one mask pair, prepared for fast instancing. */
export interface SpritePixels {
  /** Packed [col, row, lost(0|1)] triples. */
  readonly cells: Int16Array;
  readonly count: number;
  /** Centre column and bottom row of the frame (the model origin under the feet). */
  readonly cx: number;
  readonly bottom: number;
  /** Tallest column height in pixels. */
  readonly height: number;
}

const pixelCache = new Map<string, SpritePixels>();

/**
 * Pixels of `frame`, marking those in `lost` (paper scar slots). Cached by content (bounded), so a crowd of walkers
 * sharing frames decodes each mask once.
 */
export function spritePixels(frame: Hex64, lost: Hex64): SpritePixels {
  const key = `${frame}|${lost}`;
  const hit = pixelCache.get(key);
  if (hit) return hit;
  const on = toIndices(frame);
  const lostSet = new Set(toIndices(lost));
  const cells = new Int16Array(on.length * 3);
  let minC = 16;
  let maxC = -1;
  let minR = 16;
  let maxR = -1;
  on.forEach((i, n) => {
    const c = i % 16;
    const r = i >> 4;
    cells[n * 3] = c;
    cells[n * 3 + 1] = r;
    cells[n * 3 + 2] = lostSet.has(i) ? 1 : 0;
    minC = Math.min(minC, c);
    maxC = Math.max(maxC, c);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
  });
  const out: SpritePixels = {
    cells,
    count: on.length,
    cx: maxC >= 0 ? (minC + maxC) / 2 : 7.5,
    bottom: maxR >= 0 ? maxR : 15,
    height: maxR >= 0 ? maxR - minR + 1 : 0,
  };
  if (pixelCache.size > 2048) pixelCache.clear();
  pixelCache.set(key, out);
  return out;
}

const BODY = new Color(PALETTE.body);
const SCAR = new Color(PALETTE.paper);

/** The far crowd: call `begin`, `add` per far Friend, then `end` once per frame. */
export class ImpostorCrowd {
  readonly mesh: InstancedMesh;
  readonly #material: Material;
  #n = 0;
  readonly #m = new Matrix4();
  readonly #basis = new Matrix4();
  readonly #colors: Float32Array;

  /** Pre-allocates `capacity` pixel instances (60 Friends × ~100 px by default). */
  constructor(readonly capacity = 6144) {
    const geo = new PlaneGeometry(1, 1);
    // Unlit: the Friend front face is the flat `body` band (art bible §2); lit planes dithered into a checker.
    this.#material = new MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new InstancedMesh(geo, this.#material, capacity);
    this.mesh.name = "hub-impostor-crowd";
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, BODY);
    this.#colors = (this.mesh.instanceColor as { array: Float32Array }).array;
    tagHalo(this.mesh, "halo");
  }

  /** Instances written this frame. */
  get count(): number {
    return this.#n;
  }

  /** Starts a frame. */
  begin(): void {
    this.#n = 0;
  }

  /**
   * Adds one Friend: pixels on a plate at (x, y, z) turned by `yaw`, pitched back by `pitch`, scaled by `sx`/`sy`
   * (emotes), `pixel` world units per sprite pixel. Returns false when the crowd is full.
   */
  add(
    px: SpritePixels,
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    pixel: number,
    sx = 1,
    sy = 1,
  ): boolean {
    if (this.#n + px.count > this.capacity) return false;
    this.#basis.makeRotationY(yaw).multiply(this.#m.makeRotationX(-pitch));
    const e = this.#basis.elements;
    // Columns of the basis, scaled: right (x) and up (y) and normal (z).
    const rx = e[0] * pixel * sx;
    const ry = e[1] * pixel * sx;
    const rz = e[2] * pixel * sx;
    const ux = e[4] * pixel * sy;
    const uy = e[5] * pixel * sy;
    const uz = e[6] * pixel * sy;
    const nx = e[8] * pixel;
    const ny = e[9] * pixel;
    const nz = e[10] * pixel;
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    const col = this.#colors;
    const cells = px.cells;
    for (let k = 0; k < px.count; k++) {
      const lx = cells[k * 3] as number;
      const ly = cells[k * 3 + 1] as number;
      const lost = cells[k * 3 + 2] === 1;
      const ox = lx - px.cx;
      const oy = px.bottom - ly + 0.5;
      const i = this.#n++;
      const o = i * 16;
      arr[o] = rx;
      arr[o + 1] = ry;
      arr[o + 2] = rz;
      arr[o + 3] = 0;
      arr[o + 4] = ux;
      arr[o + 5] = uy;
      arr[o + 6] = uz;
      arr[o + 7] = 0;
      arr[o + 8] = nx;
      arr[o + 9] = ny;
      arr[o + 10] = nz;
      arr[o + 11] = 0;
      arr[o + 12] = x + rx * ox + ux * oy;
      arr[o + 13] = y + ry * ox + uy * oy;
      arr[o + 14] = z + rz * ox + uz * oy;
      arr[o + 15] = 1;
      const c = lost ? SCAR : BODY;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    return true;
  }

  /** Uploads this frame's instances. */
  end(): void {
    this.mesh.count = this.#n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Frees GPU resources. */
  dispose(): void {
    this.mesh.geometry.dispose();
    this.#material.dispose();
    this.mesh.removeFromParent();
  }
}
