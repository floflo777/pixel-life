/**
 * Shared three.js resources of the Friend renderer: the decal atlas, the flat vertex-colour material, the colour
 * converter, a ref-counted LRU cache for meshed frames, and the conversion from mesher output to `BufferGeometry`.
 */
import * as THREE from "three";
import { atlasPixels } from "./pixels.js";
import type { ColorConvert, FriendMeshData, QuadData } from "./mesher.js";

/** Converts palette hex through `THREE.Color`, so colours match the palette under the renderer's colour management. */
export const threeColor: ColorConvert = (() => {
  const c = new THREE.Color();
  return (hex: number) => {
    c.setHex(hex);
    return [c.r, c.g, c.b] as const;
  };
})();

/** Wraps RGBA bytes in a nearest-filtered sRGB `DataTexture` (pixel art: no mips, no filtering). */
export function pixelTexture(p: { width: number; height: number; data: Uint8Array }): THREE.DataTexture {
  const t = new THREE.DataTexture(p.data, p.width, p.height, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

let atlas: THREE.DataTexture | null = null;
let material: THREE.MeshBasicMaterial | null = null;

/** The shared decal atlas texture (created on first use). */
export function friendAtlas(): THREE.DataTexture {
  atlas ??= pixelTexture(atlasPixels());
  return atlas;
}

/**
 * The one material every static Friend mesh uses: unlit, vertex colours × atlas, alpha-tested decals. Band colours are
 * baked per face by the mesher, so there is no lighting gradient to fight the art (art bible §2 "Front face colour").
 */
export function friendMaterial(): THREE.MeshBasicMaterial {
  material ??= new THREE.MeshBasicMaterial({ vertexColors: true, map: friendAtlas(), alphaTest: 0.5 });
  return material;
}

/** Disposes the shared atlas and material (tests / full teardown only; live Friends would lose their material). */
export function disposeSharedFriendResources(): void {
  material?.dispose();
  atlas?.dispose();
  material = null;
  atlas = null;
}

/** Builds a `BufferGeometry` from one mesher stream, with bounds taken from the mesher (no per-vertex scan). */
export function toGeometry(q: QuadData, bounds: FriendMeshData["bounds"]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(q.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(q.normals, 3, true));
  g.setAttribute("color", new THREE.BufferAttribute(q.colors, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(q.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(q.indices, 1));
  const [x0, y0, z0, x1, y1, z1] = bounds;
  g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  return g;
}

/**
 * A ref-counted cache. `acquire` returns the value for a key (building it once) and adds a reference; `release`
 * drops one. Values with no references are kept in LRU order up to `maxIdle`, then disposed. Guarantees: a value is
 * disposed exactly once and never while referenced.
 */
export class RefCache<V> {
  private readonly live = new Map<string, { value: V; refs: number }>();
  /** Idle keys, oldest first (Map preserves insertion order). */
  private readonly idle = new Map<string, V>();

  constructor(
    private readonly disposeValue: (v: V) => void,
    public maxIdle = 256,
  ) {}

  /** Returns the cached value for `key`, building it with `make` on a miss, and takes a reference. */
  acquire(key: string, make: () => V): V {
    const hit = this.live.get(key);
    if (hit) {
      hit.refs++;
      return hit.value;
    }
    const idle = this.idle.get(key);
    const value = idle ?? make();
    if (idle !== undefined) this.idle.delete(key);
    this.live.set(key, { value, refs: 1 });
    return value;
  }

  /** Drops one reference; the value moves to the idle LRU when unreferenced. Unknown keys are ignored. */
  release(key: string): void {
    const hit = this.live.get(key);
    if (!hit) return;
    if (--hit.refs > 0) return;
    this.live.delete(key);
    this.idle.set(key, hit.value);
    this.trim();
  }

  private trim(): void {
    while (this.idle.size > this.maxIdle) {
      const oldest = this.idle.entries().next();
      if (oldest.done) return;
      this.idle.delete(oldest.value[0]);
      this.disposeValue(oldest.value[1]);
    }
  }

  /** Disposes every idle value (live ones stay until released). */
  clearIdle(): void {
    for (const v of this.idle.values()) this.disposeValue(v);
    this.idle.clear();
  }

  /** Counts for leak tests. */
  stats(): { live: number; idle: number; refs: number } {
    let refs = 0;
    for (const e of this.live.values()) refs += e.refs;
    return { live: this.live.size, idle: this.idle.size, refs };
  }
}
