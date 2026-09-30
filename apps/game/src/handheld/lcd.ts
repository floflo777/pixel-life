/**
 * The 1-bit rasteriser behind the handheld mode: a 128×128 buffer of ink (1) / paper (0) pixels plus the primitives the
 * screens draw with (Bresenham lines, midpoint ellipses, ordered Bayer dither, the 3×5 font, sprite stamps with a
 * screen-space halo, inversion). Pure and DOM-free so it is unit-tested and can render headless (GIF script).
 */
import { ADVANCE, GLYPH_H, GLYPH_W, glyph } from "./font.js";

/** Screen size in pixels (square). */
export const LCD_SIZE = 128;
/** Ink RGB (art bible `ink #111`). */
export const INK_RGB = 0x11;
/** Paper RGB (art bible `paper #eee`). */
export const PAPER_RGB = 0xee;

/** A 1-bit pixel value: 1 = ink, 0 = paper. */
export type Bit = 0 | 1;

/** 4×4 Bayer matrix (values 0..15); a pixel is ink when `BAYER4[y&3][x&3] < level·16`. */
export const BAYER4: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** The Bayer threshold (0..15) at screen pixel (x, y); stable under any integer offset that is a multiple of 4. */
export function bayer4(x: number, y: number): number {
  return BAYER4[y & 3]?.[x & 3] ?? 0;
}

/**
 * True iff an ordered dither of `level` (0..1, fraction of ink) inks pixel (x, y). Exactly `round(level·16)` of every
 * aligned 4×4 block is ink, so 0.25 / 0.5 / 0.75 are the art bible's 25 / 50 / 75 % shades; 0.12 gives 2 of 16.
 */
export function ditherOn(x: number, y: number, level: number): boolean {
  return bayer4(x, y) < Math.round(Math.min(1, Math.max(0, level)) * 16);
}

/**
 * Calls `plot` for every pixel of the Bresenham line from (x0, y0) to (x1, y1), endpoints included, in order from the
 * start. Coordinates are rounded to integers. Every consecutive pair of plotted pixels is 8-connected, with no repeats.
 */
export function bresenham(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number, i: number) => void,
) {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; ; i++) {
    plot(x, y, i);
    if (x === xe && y === ye) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Calls `plot` for every pixel on the outline of the axis-aligned ellipse centred at (cx, cy) with integer semi-axes
 * (rx, ry), using the midpoint algorithm (4-way symmetric, so the outline is mirror-exact). Duplicates are possible at
 * the axis ends; plotting is idempotent for the LCD.
 */
export function ellipseOutline(cx: number, cy: number, rx: number, ry: number, plot: (x: number, y: number) => void) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  rx = Math.max(0, Math.round(rx));
  ry = Math.max(0, Math.round(ry));
  const quad = (x: number, y: number) => {
    plot(cx + x, cy + y);
    plot(cx - x, cy + y);
    plot(cx + x, cy - y);
    plot(cx - x, cy - y);
  };
  if (rx === 0 || ry === 0) {
    for (let x = -rx; x <= rx; x++) plot(cx + x, cy);
    for (let y = -ry; y <= ry; y++) plot(cx, cy + y);
    return;
  }
  const a2 = rx * rx;
  const b2 = ry * ry;
  let x = 0;
  let y = ry;
  let px = 0;
  let py = 2 * a2 * y;
  // Region 1: slope magnitude < 1.
  let p = b2 - a2 * ry + 0.25 * a2;
  while (px < py) {
    quad(x, y);
    x++;
    px += 2 * b2;
    if (p < 0) p += b2 + px;
    else {
      y--;
      py -= 2 * a2;
      p += b2 + px - py;
    }
  }
  // Region 2: slope magnitude >= 1.
  p = b2 * (x + 0.5) * (x + 0.5) + a2 * (y - 1) * (y - 1) - a2 * b2;
  while (y >= 0) {
    quad(x, y);
    y--;
    py -= 2 * a2;
    if (p > 0) p += a2 - py;
    else {
      x++;
      px += 2 * b2;
      p += a2 - py + px;
    }
  }
}

/** True iff integer offset (x, y) from an ellipse centre lies inside the ellipse with semi-axes (rx, ry). */
export function inEllipse(x: number, y: number, rx: number, ry: number): boolean {
  if (rx <= 0 || ry <= 0) return false;
  return (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;
}

/** Stamp source: returns 1 (ink), 0 (paper, opaque) or -1 (transparent) for local pixel (i, j). */
export type StampFn = (i: number, j: number) => Bit | -1;

/** A 128×128 1-bit frame buffer. Writes outside the screen are ignored; reads outside return paper. */
export class Lcd {
  /** Row-major pixels, `buf[y * 128 + x]`, 1 = ink. */
  readonly buf = new Uint8Array(LCD_SIZE * LCD_SIZE);

  /** Sets the whole screen to `v`. */
  clear(v: Bit = 0): void {
    this.buf.fill(v);
  }

  /** Sets pixel (x, y) (rounded down) to `v` if on screen. */
  set(x: number, y: number, v: Bit = 1): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x >= 0 && y >= 0 && x < LCD_SIZE && y < LCD_SIZE) this.buf[y * LCD_SIZE + x] = v;
  }

  /** The pixel at (x, y); paper (0) when off screen. */
  get(x: number, y: number): Bit {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= LCD_SIZE || y >= LCD_SIZE) return 0;
    return this.buf[y * LCD_SIZE + x] ? 1 : 0;
  }

  /** Flips pixel (x, y) if on screen. */
  flip(x: number, y: number): void {
    this.set(x, y, this.get(x, y) ? 0 : 1);
  }

  /** Fills the w×h rectangle at (x, y) with `v`. */
  rect(x: number, y: number, w: number, h: number, v: Bit = 1): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, v);
  }

  /** 1-px outline of the w×h rectangle at (x, y). */
  frame(x: number, y: number, w: number, h: number, v: Bit = 1): void {
    for (let i = 0; i < w; i++) {
      this.set(x + i, y, v);
      this.set(x + i, y + h - 1, v);
    }
    for (let j = 0; j < h; j++) {
      this.set(x, y + j, v);
      this.set(x + w - 1, y + j, v);
    }
  }

  /** Inks pixels of the w×h rectangle chosen by an ordered dither of `level` (0..1); other pixels are untouched. */
  dither(x: number, y: number, w: number, h: number, level: number): void {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) if (ditherOn(x + i, y + j, level)) this.set(x + i, y + j, 1);
  }

  /**
   * Bresenham line. `dash` is an on/off pattern in pixels (e.g. `[3, 1]`), starting "on" at the first endpoint; omit
   * for a solid line.
   */
  line(x0: number, y0: number, x1: number, y1: number, v: Bit = 1, dash?: readonly number[]): void {
    const period = dash ? dash.reduce((a, b) => a + b, 0) : 0;
    bresenham(x0, y0, x1, y1, (x, y, i) => {
      if (dash && period > 0) {
        let k = i % period;
        let on = true;
        for (const d of dash) {
          if (k < d) break;
          k -= d;
          on = !on;
        }
        if (!on) return;
      }
      this.set(x, y, v);
    });
  }

  /** Ellipse outline; with `dotted`, only every other outline pixel (by x+y parity) is drawn. */
  ellipse(cx: number, cy: number, rx: number, ry: number, v: Bit = 1, dotted = false): void {
    ellipseOutline(cx, cy, rx, ry, (x, y) => {
      if (!dotted || ((x + y) & 1) === 0) this.set(x, y, v);
    });
  }

  /** Filled ellipse; `level` < 1 fills with an ordered dither of that density instead (only inking). */
  fillEllipse(cx: number, cy: number, rx: number, ry: number, v: Bit = 1, level = 1): void {
    cx = Math.round(cx);
    cy = Math.round(cy);
    for (let y = -ry; y <= ry; y++)
      for (let x = -rx; x <= rx; x++) {
        if (!inEllipse(x, y, rx, ry)) continue;
        if (level >= 1) this.set(cx + x, cy + y, v);
        else if (ditherOn(cx + x, cy + y, level)) this.set(cx + x, cy + y, v);
      }
  }

  /** Draws `s` with the 3×5 font at (x, y), each font pixel a `scale`×`scale` block. Returns the x after the text. */
  text(s: string, x: number, y: number, v: Bit = 1, scale = 1): number {
    for (const ch of s) {
      const g = glyph(ch);
      for (let k = 0; k < GLYPH_W * GLYPH_H; k++) {
        if (g.charCodeAt(k) !== 49 /* "1" */) continue;
        this.rect(x + (k % GLYPH_W) * scale, y + Math.floor(k / GLYPH_W) * scale, scale, scale, v);
      }
      x += ADVANCE * scale;
    }
    return x;
  }

  /**
   * Stamps a w×h source at (x, y). With `halo`, the silhouette (every non-transparent pixel) first gets a 1-px paper
   * ring (3×3 dilate) and then a 1-px ink keyline around that ring (4-neighbour), computed in screen pixels (art bible
   * §9). With `invert`, ink and paper swap inside the source (not the halo).
   */
  stamp(
    fn: StampFn,
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { halo?: boolean; invert?: boolean } = {},
  ): void {
    const { halo = true, invert = false } = opts;
    if (halo) {
      // Local grid with a 2-px margin: 2 = silhouette, 1 = paper ring.
      const W = w + 4;
      const H = h + 4;
      const g = new Uint8Array(W * H);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (fn(i, j) >= 0) g[(j + 2) * W + i + 2] = 2;
      const ring: number[] = [];
      for (let j = 1; j < H - 1; j++)
        for (let i = 1; i < W - 1; i++) {
          if (g[j * W + i]) continue;
          let near = false;
          for (let b = -1; b <= 1 && !near; b++)
            for (let a = -1; a <= 1; a++) if (g[(j + b) * W + i + a] === 2) near = true;
          if (near) ring.push(j * W + i);
        }
      for (const k of ring) g[k] = 1;
      for (const k of ring) this.set(x + (k % W) - 2, y + Math.floor(k / W) - 2, 0);
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          if (g[j * W + i]) continue;
          const n =
            (i > 0 && g[j * W + i - 1] === 1) ||
            (i < W - 1 && g[j * W + i + 1] === 1) ||
            (j > 0 && g[(j - 1) * W + i] === 1) ||
            (j < H - 1 && g[(j + 1) * W + i] === 1);
          if (n) this.set(x + i - 2, y + j - 2, 1);
        }
    }
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const v = fn(i, j);
        if (v < 0) continue;
        this.set(x + i, y + j, (invert ? 1 - v : v) as Bit);
      }
  }

  /**
   * Stamps a glyph given as rows (`#` ink, `o` paper, anything else transparent) scaled by an integer `scale`, with the
   * screen-space halo by default. Returns nothing; the size is `maxRowLength·scale × rows·scale`.
   */
  blit(rows: readonly string[], x: number, y: number, opts: { scale?: number; halo?: boolean; invert?: boolean } = {}) {
    const scale = opts.scale ?? 1;
    const w = Math.max(0, ...rows.map((r) => r.length));
    this.stamp(
      (i, j) => {
        const ch = rows[Math.floor(j / scale)]?.[Math.floor(i / scale)];
        return ch === "#" ? 1 : ch === "o" ? 0 : -1;
      },
      x,
      y,
      w * scale,
      rows.length * scale,
      { halo: opts.halo ?? true, invert: opts.invert ?? false },
    );
  }

  /** Inverts every pixel (the impact frame's "inverse video"). */
  invert(): void {
    for (let i = 0; i < this.buf.length; i++) this.buf[i] = this.buf[i] ? 0 : 1;
  }

  /** Inverts pixels inside the w×h rectangle at (x, y). */
  invertRect(x: number, y: number, w: number, h: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.flip(x + i, y + j);
  }

  /** Copies the buffer shifted by (dx, dy) (screen shake); vacated pixels become `fill`. */
  shift(dx: number, dy: number, fill: Bit = 0): void {
    if (dx === 0 && dy === 0) return;
    const src = this.buf.slice();
    for (let y = 0; y < LCD_SIZE; y++)
      for (let x = 0; x < LCD_SIZE; x++) {
        const sx = x - dx;
        const sy = y - dy;
        const inside = sx >= 0 && sy >= 0 && sx < LCD_SIZE && sy < LCD_SIZE;
        this.buf[y * LCD_SIZE + x] = inside ? (src[sy * LCD_SIZE + sx] ?? 0) : fill;
      }
  }

  /** Writes the buffer as opaque RGBA (ink #111 / paper #eee) into `out` (length 128·128·4, e.g. `ImageData.data`). */
  toRGBA(out: Uint8ClampedArray | Uint8Array): void {
    for (let i = 0; i < this.buf.length; i++) {
      const v = this.buf[i] ? INK_RGB : PAPER_RGB;
      const o = i * 4;
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    }
  }

  /** Ink pixel count (tests and screenshot diffing). */
  inkCount(): number {
    let n = 0;
    for (const v of this.buf) n += v;
    return n;
  }
}
