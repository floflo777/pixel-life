/**
 * LOD selection from the readability rule (art bible §2 "Minimum size"): a sprite pixel must cover ≥ 3 render px. Full
 * detail (bevel, back faces) only pays off from about 6 render px per sprite pixel; below 3 the extrusion cannot read
 * and a flat billboard impostor is used.
 */
import * as THREE from "three";
import type { FriendLod } from "./model.js";

/** Render px per sprite px at which LOD0 (full) is used. */
export const LOD0_MIN_PX = 6;
/** Render px per sprite px at which LOD1 (hub) is used; below it LOD2 (impostor). */
export const LOD1_MIN_PX = 3;

const tmp = new THREE.Vector3();

/**
 * Render pixels covered by one sprite pixel of size `pixelSize` (world units) at `object`'s world position, for a
 * viewport `viewportHeight` render px tall. Orthographic cameras ignore distance.
 */
export function projectedPixelSize(
  camera: THREE.Camera,
  object: THREE.Object3D,
  pixelSize: number,
  viewportHeight: number,
): number {
  object.getWorldPosition(tmp);
  if (camera instanceof THREE.PerspectiveCamera) {
    const dist = tmp.distanceTo(camera.getWorldPosition(new THREE.Vector3()));
    const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.max(dist, 1e-6)) / viewportHeight;
    return pixelSize / worldPerPx;
  }
  if (camera instanceof THREE.OrthographicCamera) {
    return (pixelSize * viewportHeight * camera.zoom) / (camera.top - camera.bottom);
  }
  return Infinity;
}

/**
 * The LOD for a projected pixel size, with 15 % hysteresis around the thresholds when `current` is given so a Friend
 * walking along a boundary does not flicker between meshes.
 */
export function lodForPixelSize(px: number, current?: FriendLod): FriendLod {
  const band = (lod: FriendLod, lo: number): boolean => (current === lod ? px >= lo * 0.85 : px >= lo);
  if (band(0, LOD0_MIN_PX)) return 0;
  if (band(1, LOD1_MIN_PX)) return 1;
  return 2;
}
