import { AmbientLight, DirectionalLight, Group, Vector3 } from "three";

/** Sun direction (toward the light) used by the band ramp, the shadow bake and projected shadows. */
export const SUN_DIRECTION: Readonly<Vector3> = new Vector3(-4, 8, 3.5).normalize();
/** Ambient 0.44 white, sun 0.72 white (art bible §3.1): tint lives in the ramps, not the lights. */
export const LIGHT_LEVELS = { ambient: 0.44, sun: 0.72 } as const;

/** The stage's two lights in a group. No shadow maps (architecture §3): shadows are baked or projected. */
export function createStageLights(): Group {
  const g = new Group();
  g.name = "pl-lights";
  g.add(new AmbientLight(0xffffff, LIGHT_LEVELS.ambient));
  const sun = new DirectionalLight(0xffffff, LIGHT_LEVELS.sun);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(30);
  sun.castShadow = false;
  g.add(sun, sun.target);
  return g;
}
