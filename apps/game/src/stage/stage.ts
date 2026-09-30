import {
  ColorManagement,
  LinearSRGBColorSpace,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type Material,
  type Mesh,
  type Texture,
} from "three";
import { PostPipeline } from "../post/post-pipeline";
import { CameraRig, HUB_POSE, type OrbitPose } from "./camera-rig";
import { FIXED_DT, FrameClock, FrameSampler } from "./frame-loop";
import { createStageLights } from "./lights";
import { bindPointerInput, type PointerInput } from "./pointer-input";
import {
  QUALITY,
  QUALITY_SAMPLE_FRAMES,
  cappedDpr,
  initialTier,
  internalSize,
  selectTier,
  type QualityTier,
  type TierDecision,
} from "./quality";

/** Options accepted by createStage (architecture §2.1, plus optional extras). */
export interface StageOptions {
  /** Fixed tier; when omitted the tier is guessed then adapted from the p95 of the first 120 frames. */
  quality?: QualityTier;
  reducedMotion: boolean;
  /** Disables every 1-bit inversion (GDD "No flashes"). */
  noFlashes?: boolean;
  /** Initial camera pose (defaults to the Hub framing). */
  pose?: OrbitPose;
  /** Keep the drawing buffer for screenshots/share capture (slower; off by default). */
  preserveDrawingBuffer?: boolean;
  /** Start the loop immediately (default true). */
  autoStart?: boolean;
}

/** Callback run once per rendered frame: real `dt` seconds and the fixed-step interpolation `alpha`. */
export type FrameCallback = (dt: number, alpha: number) => void;
/** Callback run once per fixed 60 Hz step with the fixed dt (seconds) and the step index. */
export type TickCallback = (fixedDt: number, tick: number) => void;

/** The shared renderer every scene (hub, venues) mounts into. */
export interface SharedStage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Per-frame hook; returns an unsubscribe. Runs after fixed ticks, before the camera rig and render. */
  onFrame(cb: FrameCallback): () => void;
  /** Fixed-step hook (60 Hz, scaled by `timeScale`); returns an unsubscribe. */
  onTick(cb: TickCallback): () => void;
  readonly input: PointerInput;
  /** Current tier (may drop once after the adaptive sample window). */
  readonly quality: QualityTier;
  /** Called when the adaptive pass changes tier or recommends the 1-bit fallback. */
  onQualityChange(cb: (d: TierDecision) => void): () => void;
  readonly rig: CameraRig;
  readonly post: PostPipeline;
  /** Sim time multiplier: 0 = hit-stop, 0.3 = slow-mo. Rendering continues regardless. */
  timeScale: number;
  readonly reducedMotion: boolean;
  /** Updates accessibility switches at runtime. */
  setAccess(a: { reducedMotion?: boolean; noFlashes?: boolean }): void;
  /** Renders a single frame now (useful while paused or for capture). */
  renderOnce(): void;
  start(): void;
  stop(): void;
  /** Stops the loop, removes listeners, frees every GPU resource in the scene and the context. */
  dispose(): void;
}

/** Thrown when WebGL2 isn't available; the shell should fall back to the 1-bit renderer. */
export class StageUnavailableError extends Error {
  constructor(cause: unknown) {
    super("WebGL2 is unavailable", { cause });
    this.name = "StageUnavailableError";
  }
}

/** Frames ignored at start-up before sampling (shader compiles and first uploads hitch). */
const WARMUP_FRAMES = 10;

function deviceHints(): Parameters<typeof initialTier>[0] {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number });
  const coarse = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)").matches : undefined;
  const hints: { deviceMemoryGb?: number; cores?: number; coarsePointer?: boolean } = {};
  if (nav?.deviceMemory !== undefined) hints.deviceMemoryGb = nav.deviceMemory;
  if (nav?.hardwareConcurrency !== undefined) hints.cores = nav.hardwareConcurrency;
  if (coarse !== undefined) hints.coarsePointer = coarse;
  return hints;
}

function disposeMaterial(m: Material): void {
  for (const v of Object.values(m))
    if (v && typeof v === "object" && (v as Texture).isTexture) (v as Texture).dispose();
  m.dispose();
}

/**
 * Creates the shared stage on a canvas. The canvas is sized by CSS; the stage observes it, renders at
 * `css / pixelScale` internally and upscales with nearest filtering at a capped device pixel ratio.
 */
export function createStage(canvas: HTMLCanvasElement, opts: StageOptions): SharedStage {
  ColorManagement.enabled = false;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    });
  } catch (e) {
    throw new StageUnavailableError(e);
  }
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(1);
  canvas.style.imageRendering = "pixelated";

  const scene = new Scene();
  scene.add(createStageLights());
  const camera = new PerspectiveCamera(30, 16 / 9, 0.5, 120);
  let reducedMotion = opts.reducedMotion;
  const rigOpts: ConstructorParameters<typeof CameraRig>[1] = { reducedMotion, pose: opts.pose ?? HUB_POSE };
  const rig = new CameraRig(camera, rigOpts);
  const adaptive = opts.quality === undefined;
  let tier: QualityTier = opts.quality ?? initialTier(deviceHints());
  const post = new PostPipeline(renderer, QUALITY[tier], { reducedMotion, noFlashes: opts.noFlashes ?? false });
  const input = bindPointerInput(canvas);

  const frameCbs = new Set<FrameCallback>();
  const tickCbs = new Set<TickCallback>();
  const qualityCbs = new Set<(d: TierDecision) => void>();
  const clock = new FrameClock(FIXED_DT);
  const sampler = new FrameSampler(QUALITY_SAMPLE_FRAMES);
  let decisions = 0;
  let frames = 0;
  let tick = 0;
  let raf = 0;
  let running = false;
  let disposed = false;
  let lastStamp: number | null = null;
  let cssW = 0;
  let cssH = 0;

  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const dpr = cappedDpr(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, QUALITY[tier]);
    cssW = w;
    cssH = h;
    renderer.setSize(Math.round(w * dpr), Math.round(h * dpr), false);
    const size = internalSize(w, h, QUALITY[tier]);
    post.setInternalSize(size.width, size.height);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    rig.setViewport(w / h, size.height);
  };

  const applyTier = (d: TierDecision): void => {
    if (d.tier !== tier) {
      tier = d.tier;
      post.setQuality(QUALITY[tier]);
      resize();
    }
    for (const cb of qualityCbs) cb(d);
  };

  const frame = (now: number): void => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const step = clock.advance(now);
    if (adaptive && decisions < 2 && lastStamp !== null && ++frames > WARMUP_FRAMES) {
      if (sampler.push(now - lastStamp)) {
        const d = selectTier(sampler.values(), tier);
        decisions++;
        sampler.clear();
        // Only re-measure after a downgrade; a steady tier is final.
        if (d.tier === tier) decisions = 2;
        if (d.tier !== tier || d.fallback) applyTier(d);
      }
    }
    lastStamp = now;
    for (let i = 0; i < step.steps; i++) {
      tick++;
      for (const cb of tickCbs) cb(clock.fixedDt, tick);
    }
    for (const cb of frameCbs) cb(step.dt, step.alpha);
    rig.update(step.dt);
    post.focusDistance = rig.distance;
    post.render(scene, camera, step.dt);
  };

  const start = (): void => {
    if (running || disposed) return;
    running = true;
    clock.reset();
    lastStamp = null;
    raf = requestAnimationFrame(frame);
  };
  const stop = (): void => {
    running = false;
    cancelAnimationFrame(raf);
  };

  const onVisibility = (): void => {
    if (document.hidden) stop();
    else if (!disposed && wantRunning) start();
  };
  let wantRunning = opts.autoStart ?? true;
  document.addEventListener("visibilitychange", onVisibility);

  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(() => {
      if (canvas.clientWidth !== cssW || canvas.clientHeight !== cssH) resize();
    });
    observer.observe(canvas);
  } else {
    window.addEventListener("resize", resize);
  }
  resize();
  if (wantRunning && !document.hidden) start();

  const stage: SharedStage = {
    renderer,
    scene,
    camera,
    input,
    rig,
    post,
    get quality() {
      return tier;
    },
    get timeScale() {
      return clock.timeScale;
    },
    set timeScale(s: number) {
      clock.timeScale = s;
    },
    get reducedMotion() {
      return reducedMotion;
    },
    setAccess(a) {
      if (a.reducedMotion !== undefined) {
        reducedMotion = a.reducedMotion;
        rig.reducedMotion = a.reducedMotion;
        post.impacts.access.reducedMotion = a.reducedMotion;
      }
      if (a.noFlashes !== undefined) post.impacts.access.noFlashes = a.noFlashes;
    },
    onFrame(cb) {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    onTick(cb) {
      tickCbs.add(cb);
      return () => tickCbs.delete(cb);
    },
    onQualityChange(cb) {
      qualityCbs.add(cb);
      return () => qualityCbs.delete(cb);
    },
    renderOnce() {
      if (disposed) return;
      rig.update(0);
      post.focusDistance = rig.distance;
      post.render(scene, camera, 0);
    },
    start() {
      wantRunning = true;
      if (!document.hidden) start();
    },
    stop() {
      wantRunning = false;
      stop();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", resize);
      input.dispose();
      frameCbs.clear();
      tickCbs.clear();
      qualityCbs.clear();
      scene.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh || (o as { isInstancedMesh?: boolean }).isInstancedMesh) {
          m.geometry.dispose();
          if (Array.isArray(m.material)) m.material.forEach(disposeMaterial);
          else disposeMaterial(m.material);
        }
      });
      scene.clear();
      post.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  return stage;
}
