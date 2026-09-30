/**
 * The handheld's 3×5 pixel font (art bible §9: "the font is our 3×5, 4 px advance"). Glyphs are lifted from the frame 3
 * style source (`docs/design/art/style.html`, `F35`) plus the few letters/symbols it lacked. Rows are top-first, 3 bits
 * each, `1` = ink.
 */

/** Glyph cell width in pixels. */
export const GLYPH_W = 3;
/** Glyph cell height in pixels. */
export const GLYPH_H = 5;
/** Horizontal advance per character (1 px gap). */
export const ADVANCE = 4;

const GLYPHS: Readonly<Record<string, string>> = {
  "0": "111101101101111",
  "1": "010110010010111",
  "2": "111001111100111",
  "3": "111001111001111",
  "4": "101101111001001",
  "5": "111100111001111",
  "6": "111100111101111",
  "7": "111001001010010",
  "8": "111101111101111",
  "9": "111101111001111",
  A: "010101111101101",
  B: "110101110101110",
  C: "111100100100111",
  D: "110101101101110",
  E: "111100110100111",
  F: "111100110100100",
  G: "111100101101111",
  H: "101101111101101",
  I: "111010010010111",
  J: "001001001101111",
  K: "101110100110101",
  L: "100100100100111",
  M: "101111111101101",
  N: "101111111111101",
  O: "111101101101111",
  P: "111101111100100",
  Q: "111101101111001",
  R: "110101110101101",
  S: "111100111001111",
  T: "111010010010010",
  U: "101101101101111",
  V: "101101101101010",
  W: "101101111111101",
  X: "101101010101101",
  Y: "101101010010010",
  Z: "111001010100111",
  " ": "000000000000000",
  ":": "000010000010000",
  "/": "001001010100100",
  "-": "000000111000000",
  "+": "000010111010000",
  "!": "010010010000010",
  "?": "111001011000010",
  ".": "000000000000010",
  ",": "000000000010100",
  "'": "010010000000000",
  "#": "101111101111101",
  "<": "001010100010001",
  ">": "100010001010100",
  "(": "010100100100010",
  ")": "010001001001010",
  "%": "101001010100101",
  x: "000101010101000",
  // ● (the round "A" button) and ◄ ► (the D-pad), used in prompts like "● PLAY".
  "●": "010111111111010",
  "◄": "001011111011001",
  "►": "100110111110100",
  "▣": "000111101111000",
};

/** The 15-bit row string for `ch` (upper-cased when no exact glyph exists); unknown characters render blank. */
export function glyph(ch: string): string {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? "000000000000000";
}

/** Width in pixels of `s` rendered at `scale` (no trailing gap). Empty strings are 0 wide. */
export function textWidth(s: string, scale = 1): number {
  const n = [...s].length;
  return n === 0 ? 0 : (n * ADVANCE - 1) * scale;
}
