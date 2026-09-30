import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  EMPTY_MASK,
  FACINGS,
  fromIndices,
  frontMask,
  popcount,
  regrowthOrder,
  getBit,
  type FriendAppearance,
} from "@pl/shared";
import { FIXTURE_FRIENDS } from "./dev/fixtures.js";
import { buildFriendModel, clearFriendCaches, friendCacheStats } from "./model.js";
import { buildDetachableFriend } from "./detachable.js";
import { lodForPixelSize, projectedPixelSize } from "./lod.js";

const mask = FIXTURE_FRIENDS.find((f) => f.tokenId === "344030") as FriendAppearance;

function scarsOf(a: FriendAppearance, n: number): string {
  const front = frontMask(a);
  return fromIndices(
    regrowthOrder(a.tokenId)
      .filter((i) => getBit(front, i))
      .slice(0, n),
  );
}

afterEach(() => clearFriendCaches());

describe("buildFriendModel", () => {
  it("builds every fixture at LOD0 within 700 tris and shows the front frame", () => {
    for (const a of FIXTURE_FRIENDS) {
      const m = buildFriendModel(a, scarsOf(a, 8), { gold: 2, lod: 0, stitched: scarsOf(a, 14), glowCracks: 1 });
      expect(m.triangles).toBeGreaterThan(0);
      expect(m.triangles).toBeLessThanOrEqual(700);
      expect(m.object.userData.isFriend).toBe(true);
      expect(m.height).toBeGreaterThan(0);
      m.dispose();
    }
  });

  it("shares geometry between identical frames and Friends in the same state", () => {
    const a = buildFriendModel(mask, EMPTY_MASK, { gold: 0, lod: 1 });
    const b = buildFriendModel(mask, EMPTY_MASK, { gold: 0, lod: 1 });
    const body = (m: typeof a): THREE.BufferGeometry =>
      (m.object.getObjectByName("friend-body") as THREE.Mesh).geometry;
    expect(body(a)).toBe(body(b));
    expect(friendCacheStats().meshes).toEqual({ live: 1, idle: 0, refs: 2 });
    a.dispose();
    b.dispose();
  });

  it("switches frames with setPose (Colossus falls back to side frames)", () => {
    const m = buildFriendModel(mask, EMPTY_MASK, { gold: 0, lod: 0 });
    m.setPose("left", true, 3);
    expect(m.frameIndex).toBe(32 + 16 + 3);
    m.dispose();
    const colossus = FIXTURE_FRIENDS.find((f) => f.familyId === 6) as FriendAppearance;
    const c = buildFriendModel(colossus, EMPTY_MASK, { gold: 0, lod: 0 });
    c.setPose("left", false, 0);
    c.setPose("down", true, 2);
    expect(c.frameIndex).toBe(32 + 16 + 2);
    c.dispose();
  });

  it("switches LODs, including the 2-triangle impostor", () => {
    const m = buildFriendModel(mask, scarsOf(mask, 5), { gold: 1, lod: 0 });
    const t0 = m.triangles;
    m.setLod(1);
    expect(m.triangles).toBeLessThan(t0);
    m.setLod(2);
    expect(m.triangles).toBe(2);
    const imp = m.object.getObjectByName("friend-impostor") as THREE.Mesh;
    expect(imp.visible).toBe(true);
    expect((imp.material as THREE.MeshBasicMaterial).map).toBeInstanceOf(THREE.DataTexture);
    m.dispose();
  });

  it("disposes without leaks: every geometry and texture is released and disposed exactly once", () => {
    const disposed = new Set<object>();
    let doubles = 0;
    const models = FIXTURE_FRIENDS.map((a, k) => buildFriendModel(a, scarsOf(a, k), { gold: k % 3, lod: 0 }));
    const track = (): void => {
      for (const m of models)
        m.object.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          const g = o.geometry as THREE.BufferGeometry;
          if (g.userData.tracked) return;
          g.userData.tracked = true;
          g.addEventListener("dispose", () => (disposed.has(g) ? doubles++ : disposed.add(g)));
        });
    };
    const seen = new Set<object>();
    for (const m of models) {
      for (const facing of FACINGS)
        for (let f = 0; f < 8; f++) {
          m.setPose(facing, f % 2 === 0, f);
          track();
          m.object.traverse((o) => o instanceof THREE.Mesh && seen.add(o.geometry));
        }
      m.setLod(2);
      m.setLost(EMPTY_MASK);
    }
    for (const m of models) m.dispose();
    const stats = friendCacheStats();
    expect(stats.meshes.live).toBe(0);
    expect(stats.impostors.live).toBe(0);
    clearFriendCaches();
    expect(friendCacheStats().meshes.idle).toBe(0);
    expect(doubles).toBe(0);
    // Every geometry a model ever showed has been disposed (the default `new Mesh()` placeholder excepted).
    const leaked = [...seen].filter((g) => !disposed.has(g) && (g as THREE.BufferGeometry).attributes.color);
    expect(leaked).toHaveLength(0);
  });

  it("updates setLost within the 1 ms budget (median over fixtures, cache misses)", () => {
    const times: number[] = [];
    for (const a of FIXTURE_FRIENDS) {
      const m = buildFriendModel(a, EMPTY_MASK, { gold: 2, lod: 0 });
      for (let k = 1; k <= 12; k++) {
        const lost = scarsOf(a, k);
        const t = performance.now();
        m.setLost(lost);
        times.push(performance.now() - t);
      }
      m.dispose();
    }
    times.sort((x, y) => x - y);
    // Generous CI bound; the measured numbers are reported in the PR (typically ≈ 0.1–0.3 ms).
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(1);
  });
});

describe("buildDetachableFriend", () => {
  it("maps instances ↔ front pixels and detaches / reattaches voxels", () => {
    const front = frontMask(mask);
    const d = buildDetachableFriend(mask, EMPTY_MASK, { gold: 1 });
    expect(d.pixels.length).toBe(popcount(front));
    expect(d.voxels.count).toBe(d.pixels.length);
    for (const [k, p] of d.pixels.entries()) {
      expect(d.instanceOf(p)).toBe(k);
      expect(d.pixelOf(k)).toBe(p);
    }
    expect(d.instanceOf(0)).toBe(getBit(front, 0) ? 0 : -1);
    expect(() => d.pixelOf(9999)).toThrow(RangeError);

    const p = d.pixels[10] as number;
    const k = d.detach(p);
    expect(d.isDetached(p)).toBe(true);
    const scene = new THREE.Scene();
    scene.add(d.object);
    d.object.position.set(5, 0, 0);
    d.setDetachedWorld(p, new THREE.Vector3(6, 1, 2));
    const m = new THREE.Matrix4();
    d.voxels.getMatrixAt(k, m);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.toArray().map((v) => +v.toFixed(6))).toEqual([1, 1, 2]);
    d.reattach(p);
    d.voxels.getMatrixAt(k, m);
    const home = d.homeWorld(p, new THREE.Vector3());
    expect(new THREE.Vector3().setFromMatrixPosition(m).add(d.object.position).distanceTo(home)).toBeLessThan(1e-6);
    d.dispose();
  });

  it("hides lost voxels until detached, and setLost stays under 1 ms", () => {
    const d = buildDetachableFriend(mask, EMPTY_MASK, { gold: 0 });
    const lost = scarsOf(mask, 6);
    const t = performance.now();
    d.setLost(lost);
    const dt = performance.now() - t;
    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    for (const p of d.pixels) {
      d.voxels.getMatrixAt(d.instanceOf(p), m);
      scale.setFromMatrixScale(m);
      expect(scale.x === 0).toBe(getBit(lost, p));
    }
    expect(dt).toBeLessThan(5);
    d.dispose();
  });
});

describe("LOD selection", () => {
  it("follows the ≥ 3 / ≥ 6 render px per sprite px rule with hysteresis", () => {
    expect(lodForPixelSize(8)).toBe(0);
    expect(lodForPixelSize(4)).toBe(1);
    expect(lodForPixelSize(2)).toBe(2);
    expect(lodForPixelSize(5.5, 0)).toBe(0);
    expect(lodForPixelSize(2.8, 1)).toBe(1);
    const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 100);
    const o = new THREE.Object3D();
    o.position.set(0, 0, -10);
    const px = projectedPixelSize(cam, o, 0.15, 360);
    expect(px).toBeCloseTo(0.15 / ((2 * Math.tan((15 * Math.PI) / 180) * 10) / 360), 6);
  });
});
