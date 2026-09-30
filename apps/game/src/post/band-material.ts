import { Color, MeshLambertMaterial, Vector3, type MeshLambertMaterialParameters } from "three";
import { LIGHT_TARGET, SHADE_MUL } from "../stage/palette";
import { BAYER_GLSL } from "./glsl";

/** Band thresholds on irradiance (art bible §3.1). */
export const BANDS = { deep: 0.3, shade: 0.52, light: 1.22 } as const;

/** Options for a banded material. */
export interface BandMaterialOptions {
  /** Base colour when no vertex/instance colour is used. */
  readonly color?: number;
  /** Use the geometry's `color` attribute (merged world meshes). */
  readonly vertexColors?: boolean;
  /**
   * Read `aBand` (vec3: baked shadow 0..1, dither amplitude, light mix) per vertex. World meshes
   * use this so terrain, canopies and flowers share one material and one draw call.
   */
  readonly bandAttribute?: boolean;
  /** Bevel strips from a per-instance `aEdge` (top, right, bottom, left exposed), for unit-box voxels. */
  readonly bevel?: boolean;
  /** Light-band mix toward #FFF8E4 (0.26 body, 0.75 gold). */
  readonly lightMix?: number;
  /** Bayer dither amplitude added before quantising (0.12 terrain, 0.22 soft). */
  readonly ditherAmp?: number;
}

const shadeMul = new Vector3(...SHADE_MUL);
const lightColor = new Color(LIGHT_TARGET);

/**
 * A MeshLambertMaterial patched into the brand's banded ramp: irradiance → Bayer dither →
 * {deep, shade, base, light}. Flat lit tops land exactly on their palette hex; shadows are the base
 * pushed toward lilac, never grey. Works with InstancedMesh (instance colours) and merged geometry.
 */
export function createBandMaterial(opts: BandMaterialOptions = {}): MeshLambertMaterial {
  const params: MeshLambertMaterialParameters = { color: opts.color ?? 0xffffff };
  if (opts.vertexColors) params.vertexColors = true;
  const m = new MeshLambertMaterial(params);
  const bevel = opts.bevel === true;
  const attr = opts.bandAttribute === true;
  const lightMix = (opts.lightMix ?? 0.34).toFixed(3);
  const ditherAmp = (opts.ditherAmp ?? 0.12).toFixed(3);
  m.onBeforeCompile = (sh) => {
    sh.uniforms["uShadeMul"] = { value: shadeMul };
    sh.uniforms["uLight"] = { value: lightColor };
    const vDecl = [
      bevel ? "attribute vec4 aEdge; varying vec4 vEdge; varying vec3 vBP; varying vec3 vBN;" : "",
      attr ? "attribute vec3 aBand; varying vec3 vBand;" : "",
    ].join("\n");
    const vBody = [bevel ? "vEdge = aEdge; vBP = position; vBN = normal;" : "", attr ? "vBand = aBand;" : ""].join(
      "\n",
    );
    sh.vertexShader = `${vDecl}\n${sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\n${vBody}`)}`;
    const fDecl = [
      "uniform vec3 uShadeMul; uniform vec3 uLight;",
      bevel ? "varying vec4 vEdge; varying vec3 vBP; varying vec3 vBN;" : "",
      attr ? "varying vec3 vBand;" : "",
      BAYER_GLSL,
    ].join("\n");
    const shadow = attr ? "(1.0 - vBand.x)" : "1.0";
    const amp = attr ? "vBand.y" : ditherAmp;
    const mix = attr ? "vBand.z" : lightMix;
    const bevelCode = bevel
      ? `if (vBN.z > 0.5) { if (vEdge.x > 0.5 && vBP.y > 0.30) bv = 0.7; if (vEdge.w > 0.5 && vBP.x < -0.34) bv = max(bv, 0.5); }`
      : "";
    sh.fragmentShader = `${fDecl}\n${sh.fragmentShader.replace(
      "#include <opaque_fragment>",
      /* glsl */ `
      vec3 plAlb = max(diffuseColor.rgb * RECIPROCAL_PI, vec3(1e-4));
      vec3 plIrr = (reflectedLight.directDiffuse * ${shadow} + reflectedLight.indirectDiffuse) / plAlb;
      float plLum = dot(plIrr, vec3(0.3333));
      float bv = 0.0;
      ${bevelCode}
      float plT = plLum + bv + (plBayer4(gl_FragCoord.xy) - 0.5) * ${amp};
      vec3 plBase = diffuseColor.rgb;
      vec3 plC = plBase;
      if (plT < ${BANDS.deep.toFixed(2)}) plC = plBase * uShadeMul * 0.74;
      else if (plT < ${BANDS.shade.toFixed(2)}) plC = plBase * uShadeMul;
      else if (plT > ${BANDS.light.toFixed(2)}) plC = mix(plBase, uLight, ${mix});
      gl_FragColor = vec4(plC, 1.0);`,
    )}`;
  };
  m.customProgramCacheKey = () => `pl-band:${bevel}:${attr}:${lightMix}:${ditherAmp}`;
  return m;
}
