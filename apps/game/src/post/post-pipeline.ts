import {
  Color,
  DepthStencilFormat,
  DepthTexture,
  LessEqualDepth,
  Matrix4,
  Mesh,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  UnsignedInt248Type,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type Object3D,
  type PerspectiveCamera,
  type Side,
  type WebGLRenderer,
} from "three";
import { PALETTE } from "../stage/palette";
import type { QualitySettings } from "../stage/quality";
import { ImpactScheduler, type ImpactAccess } from "./impact";
import { BLIT_FRAGMENT, POST_FRAGMENT, POST_VERTEX, postDefines, type PostFeatures } from "./post-shader";
import { GLOW_COLORS, HALO_COLORS, MASK_LAYER, inheritTag, readTag, tagCode, type PostTag } from "./tags";

/** Sky + fog look for a scene (art bible §3 step 5, §1.2 biomes). */
export interface SkyStyle {
  /** Five colours, zenith first, horizon (paper) last. */
  readonly ramp: readonly [number, number, number, number, number];
  /** View-direction y at which the ramp starts (horizon) and ends (zenith). */
  readonly edges: readonly [number, number];
  readonly fogColor: number;
  /**
   * Fog start/end in world units *beyond the camera focus*, so framing changes (portrait pull-back,
   * dips) never fog the play area. Frame 2: focus 21 u, fog 26–48 → +5 / +27.
   */
  readonly fogStart: number;
  readonly fogEnd: number;
}

/** The daytime pond-to-paper sky from the style frames (hub framing). */
export const DAY_SKY: SkyStyle = {
  ramp: [PALETTE.pond, 0x9ec8e4, 0xc5deea, 0xe6eeee, PALETTE.paper],
  edges: [-0.62, -0.2],
  fogColor: PALETTE.fog,
  fogStart: 5,
  fogEnd: 27,
};

/** Dusk biome sky (art bible §1.2). */
export const DUSK_SKY: SkyStyle = {
  ramp: [0x2b2840, 0x4a4368, 0x7a6a9e, 0xb3a0d8, 0xc9bde4],
  edges: [-0.62, -0.2],
  fogColor: 0x8a7cae,
  fogStart: 5,
  fogEnd: 27,
};

/** Per-frame render statistics (for the perf budget: draw calls, triangles). */
export interface RenderStats {
  /** Draw calls of the scene colour pass. */
  sceneCalls: number;
  /** Triangles of the scene colour pass. */
  sceneTriangles: number;
  /** Draw calls of the mask/glow pass (tagged meshes only). */
  maskCalls: number;
  /** Every draw call this frame, including post and upscale. */
  totalCalls: number;
  internalWidth: number;
  internalHeight: number;
}

function featuresOf(q: QualitySettings): PostFeatures {
  return {
    halo: q.halo,
    bloom: q.bloom,
    crease: q.crease,
    outline: q.outline,
    dither: q.dither,
    fogSteps: q.fogSteps,
    bloomRadius: q.crease ? 5 : 3,
  };
}

function makeTarget(w: number, h: number, depth: DepthTexture | null): WebGLRenderTarget {
  const rt = new WebGLRenderTarget(w, h, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    depthBuffer: depth !== null,
    stencilBuffer: depth !== null,
  });
  if (depth) rt.depthTexture = depth;
  return rt;
}

const colorArray = (hexes: readonly number[]): Color[] => hexes.map((h) => new Color(h));

/**
 * Half-res colour pass → mask/glow pass (tagged meshes only, sharing the depth buffer so
 * occlusion is exact) → one post pass at internal res → nearest upscale to the canvas.
 * Colour management must be off (createStage does this) so palette hexes survive untouched.
 */
export class PostPipeline {
  readonly impacts: ImpactScheduler;
  readonly stats: RenderStats = {
    sceneCalls: 0,
    sceneTriangles: 0,
    maskCalls: 0,
    totalCalls: 0,
    internalWidth: 1,
    internalHeight: 1,
  };
  /** Halo width in render px: 2 in-run, 1 in the Hub at distance (art bible §2). */
  haloWidth = 2;
  /** Dot-bloom gain (1.6 in-run, 1.1 hub). */
  glowGain = 1.6;
  /** Camera-to-focus distance; fog is measured beyond it (the stage copies it from the rig). */
  focusDistance = 21;

  private width = 1;
  private height = 1;
  private depth: DepthTexture;
  private rtScene: WebGLRenderTarget;
  private rtMask: WebGLRenderTarget;
  private rtPost: WebGLRenderTarget;
  private readonly post: ShaderMaterial;
  private readonly blit: ShaderMaterial;
  private readonly quad: Mesh;
  private readonly quadScene = new Scene();
  private readonly quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly maskMats = new Map<string, ShaderMaterial>();
  private readonly swapped: { mesh: Mesh; material: Material | Material[] }[] = [];
  private readonly tmpV = new Vector3();
  private readonly tmpM = new Matrix4();
  private time = 0;
  private sky: SkyStyle = DAY_SKY;

  constructor(
    private readonly renderer: WebGLRenderer,
    quality: QualitySettings,
    access: ImpactAccess,
  ) {
    this.impacts = new ImpactScheduler(access);
    this.depth = this.makeDepth(1, 1);
    this.rtScene = makeTarget(1, 1, this.depth);
    this.rtMask = makeTarget(1, 1, this.depth);
    this.rtPost = makeTarget(1, 1, null);
    this.post = new ShaderMaterial({
      uniforms: {
        tColor: { value: this.rtScene.texture },
        tDepth: { value: this.depth },
        tMask: { value: this.rtMask.texture },
        res: { value: new Vector2(1, 1) },
        near: { value: 0.5 },
        far: { value: 120 },
        invViewProj: { value: new Matrix4() },
        invProj: { value: new Matrix4() },
        camPos: { value: new Vector3() },
        sky: { value: colorArray(DAY_SKY.ramp) },
        skyEdges: { value: new Vector2(...DAY_SKY.edges) },
        fogRange: { value: new Vector2() },
        fogColor: { value: new Color(DAY_SKY.fogColor) },
        ink: { value: new Color(PALETTE.ink) },
        paper: { value: new Color(PALETTE.paper) },
        haloWidth: { value: 2 },
        haloColors: { value: colorArray(HALO_COLORS) },
        glowColors: { value: colorArray(GLOW_COLORS) },
        glowGain: { value: 1.6 },
        time: { value: 0 },
        burst: { value: new Vector4() },
        fullFrame: { value: 0 },
        borderPx: { value: 0 },
      },
      defines: postDefines(featuresOf(quality)),
      vertexShader: POST_VERTEX,
      fragmentShader: POST_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    this.blit = new ShaderMaterial({
      uniforms: { tPost: { value: this.rtPost.texture } },
      vertexShader: POST_VERTEX,
      fragmentShader: BLIT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.post);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.setSky(DAY_SKY);
  }

  /** Current internal (render-pixel) size. */
  get internalSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Recompiles the post shader for a tier (rare: only when the adaptive tier changes). */
  setQuality(q: QualitySettings): void {
    this.post.defines = postDefines(featuresOf(q));
    this.post.needsUpdate = true;
  }

  /** Swaps the sky/fog style (biomes). */
  setSky(s: SkyStyle): void {
    this.sky = s;
    const u = this.post.uniforms;
    (u["sky"]?.value as Color[]).forEach((c, i) => c.setHex(s.ramp[i] ?? PALETTE.paper));
    (u["skyEdges"]?.value as Vector2).set(s.edges[0], s.edges[1]);
    (u["fogColor"]?.value as Color).setHex(s.fogColor);
  }

  /** The active sky style. */
  get skyStyle(): SkyStyle {
    return this.sky;
  }

  /** Resizes the internal targets. Recreates them rather than resizing so no stale attachment survives. */
  setInternalSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.rtScene.dispose();
    this.rtMask.dispose();
    this.rtPost.dispose();
    this.depth.dispose();
    this.depth = this.makeDepth(width, height);
    this.rtScene = makeTarget(width, height, this.depth);
    this.rtMask = makeTarget(width, height, this.depth);
    this.rtPost = makeTarget(width, height, null);
    const u = this.post.uniforms;
    if (u["tColor"]) u["tColor"].value = this.rtScene.texture;
    if (u["tDepth"]) u["tDepth"].value = this.depth;
    if (u["tMask"]) u["tMask"].value = this.rtMask.texture;
    (u["res"]?.value as Vector2).set(width, height);
    const b = this.blit.uniforms["tPost"];
    if (b) b.value = this.rtPost.texture;
    this.stats.internalWidth = width;
    this.stats.internalHeight = height;
  }

  /** Projects a world point to internal render px (origin bottom-left, like gl_FragCoord). */
  toInternal(p: Vector3, camera: Camera): { x: number; y: number } {
    const v = this.tmpV.copy(p).project(camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (v.y * 0.5 + 0.5) * this.height };
  }

  /** Renders one frame. `dt` in seconds advances animated post effects (gold-white halo). */
  render(scene: Scene, camera: PerspectiveCamera, dt: number): void {
    const r = this.renderer;
    this.time += dt;
    const info = r.info;
    info.autoReset = false;
    info.reset();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    r.setClearColor(0x000000, 1);

    r.setRenderTarget(this.rtScene);
    r.clear(true, true, true);
    r.render(scene, camera);
    this.stats.sceneCalls = info.render.calls;
    this.stats.sceneTriangles = info.render.triangles;

    r.setRenderTarget(this.rtMask);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    if (this.swapInMaskMaterials(scene) > 0) {
      const layers = camera.layers.mask;
      camera.layers.set(MASK_LAYER);
      r.render(scene, camera);
      camera.layers.mask = layers;
    }
    this.restoreMaterials();
    this.stats.maskCalls = info.render.calls - this.stats.sceneCalls;

    this.updateUniforms(camera);
    this.quad.material = this.post;
    r.setRenderTarget(this.rtPost);
    r.render(this.quadScene, this.quadCam);

    this.quad.material = this.blit;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
    this.stats.totalCalls = info.render.calls;
    r.autoClear = prevAutoClear;
  }

  /** Frees GPU resources owned by the pipeline. */
  dispose(): void {
    this.restoreMaterials();
    this.rtScene.dispose();
    this.rtMask.dispose();
    this.rtPost.dispose();
    this.depth.dispose();
    this.post.dispose();
    this.blit.dispose();
    this.quad.geometry.dispose();
    for (const m of this.maskMats.values()) m.dispose();
    this.maskMats.clear();
  }

  private makeDepth(w: number, h: number): DepthTexture {
    const d = new DepthTexture(w, h, UnsignedInt248Type);
    d.format = DepthStencilFormat;
    d.minFilter = NearestFilter;
    d.magFilter = NearestFilter;
    return d;
  }

  private updateUniforms(camera: PerspectiveCamera): void {
    const u = this.post.uniforms;
    camera.updateMatrixWorld();
    (u["invProj"]?.value as Matrix4).copy(camera.projectionMatrixInverse);
    this.tmpM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    (u["invViewProj"]?.value as Matrix4).copy(this.tmpM);
    (u["camPos"]?.value as Vector3).setFromMatrixPosition(camera.matrixWorld);
    const set = (k: string, v: number): void => {
      const x = u[k];
      if (x) x.value = v;
    };
    (u["fogRange"]?.value as Vector2).set(this.focusDistance + this.sky.fogStart, this.focusDistance + this.sky.fogEnd);
    set("near", camera.near);
    set("far", camera.far);
    set("haloWidth", this.haloWidth);
    set("glowGain", this.glowGain);
    set("time", this.time);
    const f = this.impacts.next();
    set("fullFrame", f.fullFrame);
    set("borderPx", f.border ? 2 : 0);
    const b = u["burst"]?.value as Vector4;
    if (f.burst) b.set(f.burst.x, f.burst.y, f.burst.outer, f.burst.inner);
    else b.set(0, 0, 0, 0);
  }

  private maskMaterial(code: [number, number], side: Side): ShaderMaterial {
    const key = `${code[0]}:${code[1]}:${side}`;
    let m = this.maskMats.get(key);
    if (!m) {
      m = new ShaderMaterial({
        uniforms: { uCode: { value: new Vector2(code[0] / 255, code[1] / 255) } },
        vertexShader: /* glsl */ `
          #include <common>
          #include <batching_pars_vertex>
          void main() {
            #include <batching_vertex>
            #include <begin_vertex>
            #include <project_vertex>
          }`,
        fragmentShader: /* glsl */ `
          uniform vec2 uCode;
          void main() { gl_FragColor = vec4(uCode, 0.0, 1.0); }`,
        depthFunc: LessEqualDepth,
        depthWrite: false,
        blending: NoBlending,
        side,
      });
      this.maskMats.set(key, m);
    }
    return m;
  }

  /** Walks the scene once, resolving inherited tags; swaps tagged meshes to flat code materials. */
  private swapInMaskMaterials(root: Object3D): number {
    const visit = (o: Object3D, parentTag: PostTag | undefined): void => {
      if (!o.visible) return;
      const tag = inheritTag(parentTag, readTag(o));
      if ((o as Mesh).isMesh) {
        const mesh = o as Mesh;
        const code = tagCode(tag);
        if (code[0] > 0 || code[1] > 0) {
          mesh.layers.enable(MASK_LAYER);
          const orig = mesh.material;
          const side = (Array.isArray(orig) ? orig[0]?.side : orig.side) ?? 0;
          this.swapped.push({ mesh, material: orig });
          mesh.material = this.maskMaterial(code, side);
        } else {
          mesh.layers.disable(MASK_LAYER);
        }
      }
      for (const c of o.children) visit(c, tag);
    };
    visit(root, undefined);
    return this.swapped.length;
  }

  private restoreMaterials(): void {
    for (const s of this.swapped) s.mesh.material = s.material;
    this.swapped.length = 0;
  }
}
