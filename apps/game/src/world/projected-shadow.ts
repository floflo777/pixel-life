import {
  CustomBlending,
  InstancedMesh,
  Mesh,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  ShaderMaterial,
  SrcColorFactor,
  Vector3,
  ZeroFactor,
  type Object3D,
} from "three";
import { untagged } from "../post/tags";
import { SUN_DIRECTION } from "../stage/lights";
import { SHADE_MUL } from "../stage/palette";

/** Options for projected shadows. */
export interface ProjectedShadowOptions {
  /** World-space height of the receiving plane (the island top). */
  readonly groundY?: number;
  /** Direction toward the sun. */
  readonly sun?: Vector3;
}

/** Shared material state so every shadow re-uses one program. */
function shadowMaterial(groundY: number, sun: Vector3): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uSun: { value: sun.clone().normalize() },
      uGround: { value: groundY },
      uShade: { value: new Vector3(...SHADE_MUL) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <batching_pars_vertex>
      uniform vec3 uSun;
      uniform float uGround;
      void main() {
        #include <batching_vertex>
        #include <begin_vertex>
        vec4 p = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          p = batchingMatrix * p;
        #endif
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        vec4 wp = modelMatrix * p;
        float t = (wp.y - uGround) / max(uSun.y, 0.05);
        wp.xyz -= uSun * t;
        wp.y = uGround + 0.004;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uShade;
      void main() { gl_FragColor = vec4(uShade, 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: ZeroFactor,
    blendDst: SrcColorFactor,
    // Stencil: each pixel is darkened once even where voxels (or two Friends) overlap.
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: NotEqualStencilFunc,
    stencilZPass: ReplaceStencilOp,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/** Handle for the shadows attached to one object. */
export interface ProjectedShadow {
  /** Moves the receiving plane (e.g. a Friend standing on a different island). */
  setGround(y: number): void;
  /** Removes the shadow meshes and frees the material. */
  dispose(): void;
}

/**
 * Hard projected shadow (architecture §3: no shadow maps). Every mesh under `root` gets a child that
 * re-draws its geometry flattened onto `groundY` along the sun, multiplying what's underneath by the
 * shade band: lilac, hard-edged, never black. Shares geometry and instance buffers (no copies).
 * Children are untagged so they never enter the halo mask.
 */
export function attachProjectedShadow(root: Object3D, opts: ProjectedShadowOptions = {}): ProjectedShadow {
  const material = shadowMaterial(opts.groundY ?? 0, opts.sun ?? SUN_DIRECTION.clone());
  const added: Mesh[] = [];
  const targets: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh && !o.userData["plShadow"]) targets.push(o as Mesh);
  });
  for (const m of targets) {
    let s: Mesh;
    if ((m as InstancedMesh).isInstancedMesh) {
      const im = m as InstancedMesh;
      const si = new InstancedMesh(im.geometry, material, im.count);
      si.instanceMatrix = im.instanceMatrix;
      // Follow the source's live count (pixels detaching, Friends joining a batched hub mesh).
      si.onBeforeRender = () => {
        si.count = im.count;
      };
      s = si;
    } else {
      s = new Mesh(m.geometry, material);
    }
    s.name = `${m.name || "mesh"}-shadow`;
    s.userData["plShadow"] = true;
    s.frustumCulled = false;
    s.renderOrder = -1;
    untagged(s);
    m.add(s);
    added.push(s);
  }
  return {
    setGround(y) {
      const u = material.uniforms["uGround"];
      if (u) u.value = y;
    },
    dispose() {
      for (const s of added) s.removeFromParent();
      material.dispose();
    },
  };
}
