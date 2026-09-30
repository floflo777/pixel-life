/**
 * 1-bit sprites for the handheld: the Friend drawn from its canonical 16×16 mask with per-pixel states (art bible §2.1,
 * 1-bit column), and the Munchie glyphs (`#` ink, `o` paper, `.` transparent), lifted from / in the style of frame 3.
 */
import { getBit, type Hex64 } from "@pl/shared";
import type { Lcd } from "./lcd.js";

/** How one Friend pixel is drawn. */
export type FriendPixel = "ink" | "hole" | "sprout" | "empty";

/** Munchie glyphs by sim kind (0 Nib, 1 Pogo, 2 Clank, 3 Snatch, 4 Slurp, 5 Fizz). Drawn at 2×. */
export const CREATURE_GLYPHS: readonly (readonly string[])[] = [
  // Nib: round, 2 paper teeth, tiny feet.
  ["..####..", ".######.", "#o##o###", "########", "#oooooo#", ".######.", "#.#..#.#"],
  // Pogo: one big eye on two long stick legs.
  [".####.", "#oo###", "#oo###", ".####.", ".#..#.", ".#..#.", ".#..#.", "##..##"],
  // Clank: dome shell over a solid plate with a rivet row.
  [
    "..######..",
    ".########.",
    "#o######o#",
    "##########",
    "#oooooooo#",
    "#o#o#o#o##",
    "#oooooooo#",
    "##########",
    ".#......#.",
  ],
  // Snatch: "M" wings.
  ["#.......#", "##.....##", "###.#.###", "#########", ".##ooo##.", "..#.#.#.."],
  // Slurp: a wide bar with half-lidded eyes.
  ["..########..", ".##########.", "#o#o####o#o#", "############", "#oooooooooo#", ".##########."],
  // Fizz: a spiky ball.
  ["..#.#.#..", ".#######.", "#########", ".##o#o##.", "#########", ".#######.", "..#.#.#.."],
];

/** Old Gulp's eye-and-teeth wedge (event creature; drawn when a view carries it). */
export const GULP_GLYPH: readonly string[] = [
  "..##########..",
  ".############.",
  "##ooo####ooo##",
  "##o#o####o#o##",
  "##ooo####ooo##",
  "##############",
  "#o#o#o#o#o#o##",
  ".############.",
];

/** Glyph for a creature kind (unknown kinds fall back to Nib). */
export function creatureGlyph(kind: number): readonly string[] {
  return CREATURE_GLYPHS[kind] ?? CREATURE_GLYPHS[0] ?? [];
}

/** Width/height of a glyph in cells. */
export function glyphSize(rows: readonly string[]): { w: number; h: number } {
  return { w: Math.max(0, ...rows.map((r) => r.length)), h: rows.length };
}

/**
 * Draws a Friend at (x, y), `scale` screen px per sprite px, from `pixelAt(id)` (id = row·16 + col). Holes are paper;
 * at scale ≥ 3 they get an ink dotted rim whose dots alternate with `frame` parity (so a scar reads as "missing"), and a
 * `sprout` (healing) pixel adds a centred ink dot that grows with `sproutGrowth` (0..1, 4 steps). `halo` adds the 1 px
 * paper + 1 px ink screen-space keyline around the whole silhouette (holes included, so the outline never breaks).
 */
export function drawFriend(
  lcd: Lcd,
  pixelAt: (id: number) => FriendPixel,
  x: number,
  y: number,
  opts: { scale?: number; halo?: boolean; frame?: number; sproutGrowth?: number; invert?: boolean } = {},
): void {
  const scale = opts.scale ?? 2;
  const frame = opts.frame ?? 0;
  const growth = Math.min(1, Math.max(0, opts.sproutGrowth ?? 1));
  lcd.stamp(
    (i, j) => {
      const c = Math.floor(i / scale);
      const r = Math.floor(j / scale);
      const st = pixelAt(r * 16 + c);
      if (st === "empty") return -1;
      if (st === "ink") return 1;
      if (scale < 3) return st === "sprout" ? (i % scale === 0 && j % scale === 0 ? 1 : 0) : 0;
      const u = i % scale;
      const v = j % scale;
      if (st === "sprout") {
        // 4 growth steps: 25/50/75/100 % of the inner half-size block (art bible: healing = centred ink block).
        const inner = Math.max(1, Math.round((scale / 2) * Math.ceil(growth * 4) * 0.25));
        const lo = Math.floor((scale - inner) / 2);
        if (u >= lo && u < lo + inner && v >= lo && v < lo + inner) return 1;
      }
      const edge = u === 0 || v === 0 || u === scale - 1 || v === scale - 1;
      return edge && ((u + v + frame) & 1) === 1 ? 1 : 0;
    },
    Math.round(x),
    Math.round(y),
    16 * scale,
    16 * scale,
    { halo: opts.halo ?? true, invert: opts.invert ?? false },
  );
}

/** A `pixelAt` for a mask with a set of holes: pixels of `mask` are ink unless in `holes`, then `hole`/`sprout`. */
export function maskPixels(mask: Hex64, holes: Hex64, sprout = -1): (id: number) => FriendPixel {
  // Decoded once: stamps query every pixel at every scale step.
  const st: FriendPixel[] = [];
  for (let id = 0; id < 256; id++) {
    st.push(!getBit(mask, id) ? "empty" : !getBit(holes, id) ? "ink" : id === sprout ? "sprout" : "hole");
  }
  return (id) => st[id] ?? "empty";
}
