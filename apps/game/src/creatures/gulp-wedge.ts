import { CircleGeometry, CustomBlending, Mesh, ShaderMaterial, SrcColorFactor, Vector3, ZeroFactor } from "three";
import { BAYER_GLSL } from "../post/glsl";
import { untagged } from "../post/tags";
import { SHADE_MUL } from "../stage/palette";
import { wedgeCoverage } from "./gulp-anim";

/** Options for the shadow wedge overlay. */
export interface GulpWedgeOptions {
  /** Island radius (world units) the wedge covers. */
  readonly radius: number;
  /** Half angle (radians): 45° Hungry/Grumpy, 27° Sleepy (sim GULP_MOODS). */
  readonly halfAngle: number;
  /** Height of the island top. */
  readonly groundY?: number;
}

/** The dithered shadow wedge Gulp casts before the bite (bible §8.13). */
export interface GulpWedge {
  /** Sector mesh on the island top, centred on local +x; yaw the mesh to the sim wedge direction. */
  readonly object: Mesh;
  /** Sets darkness from seconds into the shadow phase (25 → 75 % Bayer in 4 steps over 2 s). */
  setTime(t: number): void;
  dispose(): void;
}

/**
 * A flat sector that multiplies the island by the shade band through a Bayer mask: the wedge "dithers darker" in four
 * hard steps, lilac-tinted and never black (same blending as projected shadows).
 */
export function createGulpWedge(opts: GulpWedgeOptions): GulpWedge {
  const geo = new CircleGeometry(opts.radius, 24, -opts.halfAngle, opts.halfAngle * 2);
  geo.rotateX(-Math.PI / 2);
  const material = new ShaderMaterial({
    uniforms: { uCover: { value: 0 }, uShade: { value: new Vector3(...SHADE_MUL) } },
    vertexShader: /* glsl */ `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uCover; uniform vec3 uShade;
      ${BAYER_GLSL}
      void main() {
        if (plBayer4(gl_FragCoord.xy) >= uCover) discard;
        gl_FragColor = vec4(uShade, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: ZeroFactor,
    blendDst: SrcColorFactor,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const object = new Mesh(geo, material);
  object.name = "gulp-wedge";
  object.position.y = (opts.groundY ?? 0) + 0.006;
  object.renderOrder = -1;
  untagged(object);
  return {
    object,
    setTime(t) {
      const u = material.uniforms["uCover"];
      if (u) u.value = wedgeCoverage(t);
      object.visible = t >= 0;
    },
    dispose() {
      object.removeFromParent();
      geo.dispose();
      material.dispose();
    },
  };
}
