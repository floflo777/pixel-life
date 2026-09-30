/**
 * Brand palette tokens from the art bible (§1.1). Values are exact sRGB hex: colour management is
 * off in the stage, so these land on screen untouched wherever a surface sits in the `base` band.
 */
export const PALETTE = {
  ink: 0x111111,
  body: 0x1d1b24,
  paper: 0xeeeeee,
  paperWarm: 0xf6f3ea,
  halo: 0xf4f2ea,
  signal: 0xccff00,
  meadow: 0xb9d984,
  meadowLight: 0xc9e39c,
  meadowDrip: 0x9cc56c,
  meadowTuft: 0x86b05a,
  pond: 0x7db4db,
  pondLight: 0x9ec8e4,
  pondGlint: 0xe8f2f6,
  sun: 0xf2ce68,
  gold: 0xe8b530,
  goldSpec: 0xfff8e4,
  coral: 0xed927e,
  coralDark: 0xd67a68,
  lilac: 0xb3a0d8,
  lilacDark: 0x8f7bbd,
  tile: 0xe6e1d2,
  trunk: 0x3a3140,
  stone: 0xd9d4c6,
  cloud: 0xf7f7f2,
  treePaper: 0xf2efe4,
  lampBulb: 0xfff1c2,
  doorway: 0x2a2433,
  fog: 0xe4eef0,
} as const;

/** Name of a palette token. */
export type PaletteToken = keyof typeof PALETTE;

/** The cool lilac multiply every lit material uses for its shade band (art bible §1.1). */
export const SHADE_MUL: readonly [number, number, number] = [0.55, 0.56, 0.76];
/** Multiplier from the shade band to the deep band. */
export const DEEP_MUL = 0.74;
/** Warm near-white the light band mixes toward. */
export const LIGHT_TARGET = PALETTE.goldSpec;

/** Splits a 0xRRGGBB integer into 0..1 channels. */
export function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** Packs 0..1 channels into a 0xRRGGBB integer (rounded, clamped). */
export function rgbToHex(r: number, g: number, b: number): number {
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

/** The shade-band colour of a base colour: never grey, never black, always pushed toward lilac. */
export function shadeOf(hex: number): number {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * SHADE_MUL[0], g * SHADE_MUL[1], b * SHADE_MUL[2]);
}

/** The deep-band colour of a base colour (`shade × 0.74`). */
export function deepOf(hex: number): number {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * SHADE_MUL[0] * DEEP_MUL, g * SHADE_MUL[1] * DEEP_MUL, b * SHADE_MUL[2] * DEEP_MUL);
}

/** The light-band colour of a base colour, `mix(base, #FFF8E4, t)` with the bible's 0.26–0.75 range. */
export function lightOf(hex: number, t = 0.34): number {
  const [r, g, b] = hexToRgb(hex);
  const [lr, lg, lb] = hexToRgb(LIGHT_TARGET);
  return rgbToHex(r + (lr - r) * t, g + (lg - g) * t, b + (lb - b) * t);
}
