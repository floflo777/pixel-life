/**
 * Voxel Friend palette and band ramps (art bible §1.1 and §2). Values are sRGB hex exactly as in the bible; the three.js
 * layer converts them through `THREE.Color`, so they land on the palette hex whatever the renderer's colour management.
 */

/** Palette tokens used by the Friend renderer (sRGB hex). */
export const FRIEND_COLORS = Object.freeze({
  ink: 0x111111,
  body: 0x1d1b24,
  paper: 0xeeeeee,
  halo: 0xf4f2ea,
  eye: 0xf3ead0,
  eyeGlow: 0xfff1c2,
  eyeGlowBloom: 0x6e6040,
  gold: 0xe8b530,
  goldSpec: 0xfff8e4,
  goldBloom: 0xf2ce68,
  coral: 0xed927e,
  signal: 0xccff00,
});

/** Streak halo tiers (art bible §2 "Halo"): paper, sun, coral, lilac; 30+ is animated gold-white by the stage. */
export const HALO_TIERS = Object.freeze({ paper: 0xf4f2ea, sun: 0xf2ce68, coral: 0xed927e, lilac: 0xb3a0d8 });

const SHADE_MUL = [0.55, 0.56, 0.76] as const;
const DEEP_MUL = 0.74;
const LIGHT = FRIEND_COLORS.goldSpec;

function channels(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function pack(r: number, g: number, b: number): number {
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

/** `base × (0.55, 0.56, 0.76)`: the cool lilac shade band (never grey, never black). */
export function shadeOf(base: number): number {
  const [r, g, b] = channels(base);
  return pack(r * SHADE_MUL[0], g * SHADE_MUL[1], b * SHADE_MUL[2]);
}

/** `shade × 0.74`: the deep band. */
export function deepOf(base: number): number {
  const [r, g, b] = channels(shadeOf(base));
  return pack(r * DEEP_MUL, g * DEEP_MUL, b * DEEP_MUL);
}

/** `mix(base, #FFF8E4, t)`: the light band used for bevels (body t = 0.26, gold t = 0.75). */
export function lightOf(base: number, t: number): number {
  const [r, g, b] = channels(base);
  const [lr, lg, lb] = channels(LIGHT);
  return pack(r + (lr - r) * t, g + (lg - g) * t, b + (lb - b) * t);
}

/** Linear mix of two sRGB hex colours (used for the half-strength left bevel). */
export function mixHex(a: number, b: number, t: number): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return pack(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** The flat colour of every face of one voxel material, precomputed from the band rules. */
export interface FaceBands {
  front: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  back: number;
  bevelTop: number;
  bevelLeft: number;
}

/**
 * Face colours for a voxel material. The Friend's front face is the flat base band (it reads as its 2D art); with the
 * sun from the upper left the left side stays base and the right/bottom sides fall to shade (art bible §2, §3).
 */
export function faceBands(base: number, lightMix: number, litTop: boolean): FaceBands {
  const light = lightOf(base, lightMix);
  return {
    front: base,
    top: litTop ? light : base,
    bottom: shadeOf(base),
    left: base,
    right: shadeOf(base),
    back: deepOf(base),
    bevelTop: light,
    bevelLeft: mixHex(base, light, 0.5),
  };
}

/** Body voxel bands (`lightMix 0.26`). */
export const BODY_BANDS: FaceBands = Object.freeze(faceBands(FRIEND_COLORS.body, 0.26, false));
/** Gold voxel bands (`lightMix 0.75`, top face in the light band: the 2-step specular). */
export const GOLD_BANDS: FaceBands = Object.freeze(faceBands(FRIEND_COLORS.gold, 0.75, true));
