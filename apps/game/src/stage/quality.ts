/** Rendering quality tier. `low` keeps the look (pixel-scale 3) and drops the expensive post features. */
export type QualityTier = "high" | "medium" | "low";

/** Every per-tier knob the stage and post pipeline read. */
export interface QualitySettings {
  /** CSS px per internal render px (art bible §3: 2, low tier 3). */
  readonly pixelScale: number;
  /** Device-pixel-ratio cap for the final upscale target (architecture §3: 2, tier L 1.25). */
  readonly dprCap: number;
  /** Largest internal render height, so huge screens don't blow the GPU budget (§10: 360 landscape). */
  readonly maxInternalHeight: number;
  /** Paper halo + ink keyline around Friends. Core readability: on in every tier. */
  readonly halo: boolean;
  /** Dot-glow (dithered bloom) around glow-tagged objects. */
  readonly bloom: boolean;
  /** Crease lines from depth-reconstructed normals. */
  readonly crease: boolean;
  /** Depth-edge ink outline. */
  readonly outline: boolean;
  /** Bayer dither on band edges, sky and fog. */
  readonly dither: boolean;
  /** Stepped fog levels (0 disables fog). */
  readonly fogSteps: number;
  /** Max projected dynamic shadows drawn per frame. */
  readonly maxDynamicShadows: number;
}

/** The fixed table of tiers. */
export const QUALITY: Readonly<Record<QualityTier, QualitySettings>> = {
  high: {
    pixelScale: 2,
    dprCap: 2,
    maxInternalHeight: 400,
    halo: true,
    bloom: true,
    crease: true,
    outline: true,
    dither: true,
    fogSteps: 3,
    maxDynamicShadows: 64,
  },
  medium: {
    pixelScale: 2,
    dprCap: 1.5,
    maxInternalHeight: 360,
    halo: true,
    bloom: true,
    crease: false,
    outline: true,
    dither: true,
    fogSteps: 3,
    maxDynamicShadows: 40,
  },
  low: {
    pixelScale: 3,
    dprCap: 1.25,
    maxInternalHeight: 270,
    halo: true,
    bloom: false,
    crease: false,
    outline: true,
    dither: true,
    fogSteps: 2,
    maxDynamicShadows: 12,
  },
};

/** Tiers from best to cheapest. */
export const TIER_ORDER: readonly QualityTier[] = ["high", "medium", "low"];

/** Frames sampled before the adaptive tier decision (architecture §3). */
export const QUALITY_SAMPLE_FRAMES = 120;

/** p95 frame interval (ms) under which a tier is considered to hold 60 fps with vsync jitter. */
export const P95_OK_MS = 20;
/** p95 above which we jump straight to `low`. */
export const P95_BAD_MS = 28;
/** p95 above which even `low` can't hold 30 fps: the shell should offer the 1-bit fallback. */
export const P95_FALLBACK_MS = 33.4;

/** Returns the q-th percentile (0..1) of the samples with nearest-rank; NaN for an empty list. */
export function percentile(samples: readonly number[], q: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[rank] ?? Number.NaN;
}

/** What the adaptive pass decided after the sample window. */
export interface TierDecision {
  readonly tier: QualityTier;
  readonly p95: number;
  /** True when even the cheapest tier misses 30 fps; the shell should switch to the 1-bit renderer. */
  readonly fallback: boolean;
}

/**
 * Picks the tier from frame intervals. Never upgrades beyond `current` (the initial guess is the
 * ceiling), steps down one tier when p95 misses the 60 fps window, and jumps to `low` when it's far off.
 */
export function selectTier(frameMs: readonly number[], current: QualityTier): TierDecision {
  const p95 = percentile(frameMs, 0.95);
  if (!Number.isFinite(p95)) return { tier: current, p95, fallback: false };
  const idx = TIER_ORDER.indexOf(current);
  let tier = current;
  if (p95 > P95_BAD_MS) tier = "low";
  else if (p95 > P95_OK_MS) tier = TIER_ORDER[Math.min(TIER_ORDER.length - 1, idx + 1)] ?? "low";
  return { tier, p95, fallback: p95 > P95_FALLBACK_MS && tier === "low" };
}

/** Device hints the initial tier guess uses (all optional: browsers expose different subsets). */
export interface DeviceHints {
  readonly deviceMemoryGb?: number;
  readonly cores?: number;
  readonly coarsePointer?: boolean;
  readonly devicePixelRatio?: number;
  readonly maxTextureSize?: number;
}

/** A cheap first guess before any frames are measured: phones start at `medium`, weak devices at `low`. */
export function initialTier(h: DeviceHints): QualityTier {
  if ((h.deviceMemoryGb !== undefined && h.deviceMemoryGb <= 2) || (h.cores !== undefined && h.cores <= 2))
    return "low";
  if (h.maxTextureSize !== undefined && h.maxTextureSize < 4096) return "low";
  if (h.coarsePointer === true) return "medium";
  return "high";
}

/** Internal render size for a CSS viewport: `round(css / pixelScale)`, clamped to the tier's height cap. */
export function internalSize(
  cssWidth: number,
  cssHeight: number,
  s: Pick<QualitySettings, "pixelScale" | "maxInternalHeight">,
): { width: number; height: number; scale: number } {
  let scale = s.pixelScale;
  if (cssHeight / scale > s.maxInternalHeight) scale = cssHeight / s.maxInternalHeight;
  return {
    width: Math.max(1, Math.round(cssWidth / scale)),
    height: Math.max(1, Math.round(cssHeight / scale)),
    scale,
  };
}

/** Effective device pixel ratio after the tier cap. */
export function cappedDpr(dpr: number, s: Pick<QualitySettings, "dprCap">): number {
  return Math.max(1, Math.min(dpr || 1, s.dprCap));
}
