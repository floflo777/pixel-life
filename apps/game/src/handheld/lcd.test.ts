import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { textWidth } from "./font.js";
import { BAYER4, LCD_SIZE, Lcd, bayer4, bresenham, ditherOn, ellipseOutline } from "./lcd.js";

const line = (x0: number, y0: number, x1: number, y1: number) => {
  const pts: [number, number][] = [];
  bresenham(x0, y0, x1, y1, (x, y) => pts.push([x, y]));
  return pts;
};

describe("bresenham", () => {
  it("draws exact horizontal, vertical and diagonal lines", () => {
    expect(line(0, 0, 3, 0)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect(line(2, 5, 2, 2)).toEqual([
      [2, 5],
      [2, 4],
      [2, 3],
      [2, 2],
    ]);
    expect(line(0, 0, -3, 3)).toEqual([
      [0, 0],
      [-1, 1],
      [-2, 2],
      [-3, 3],
    ]);
  });

  it("plots a single pixel for a zero-length line", () => {
    expect(line(4, 4, 4, 4)).toEqual([[4, 4]]);
  });

  it("matches the textbook octant-1 result", () => {
    expect(line(0, 0, 6, 2)).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 2],
      [6, 2],
    ]);
  });

  it("is endpoint-inclusive, 8-connected, repeat-free and has max(|dx|,|dy|)+1 pixels", () => {
    const c = fc.integer({ min: -200, max: 200 });
    fc.assert(
      fc.property(c, c, c, c, (x0, y0, x1, y1) => {
        const pts = line(x0, y0, x1, y1);
        expect(pts[0]).toEqual([x0, y0]);
        expect(pts.at(-1)).toEqual([x1, y1]);
        expect(pts.length).toBe(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
        expect(new Set(pts.map((p) => p.join(","))).size).toBe(pts.length);
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1] ?? [0, 0];
          const [bx, by] = pts[i] ?? [0, 0];
          expect(Math.max(Math.abs(bx - ax), Math.abs(by - ay))).toBe(1);
        }
      }),
    );
  });

  it("stays within one pixel of the ideal line", () => {
    const c = fc.integer({ min: -100, max: 100 });
    fc.assert(
      fc.property(c, c, c, c, (x0, y0, x1, y1) => {
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len === 0) return;
        for (const [x, y] of line(x0, y0, x1, y1)) {
          const dist = Math.abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / len;
          expect(dist).toBeLessThanOrEqual(0.75);
        }
      }),
    );
  });
});

describe("ordered dither", () => {
  it("uses the 4×4 Bayer matrix (a permutation of 0..15)", () => {
    expect(
      BAYER4.flat()
        .slice()
        .sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(bayer4(0, 0)).toBe(0);
    expect(bayer4(5, 4)).toBe(bayer4(1, 0));
    expect(bayer4(-1, -1)).toBe(bayer4(3, 3));
  });

  it("inks exactly round(level·16) pixels of every aligned 4×4 block", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.integer({ min: -8, max: 8 }), (level, block) => {
        let n = 0;
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) n += ditherOn(block * 4 + x, block * 4 + y, level) ? 1 : 0;
        expect(n).toBe(Math.round(level * 16));
      }),
    );
  });

  it("is monotonic: a denser level inks a superset of pixels", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) if (ditherOn(x, y, lo)) expect(ditherOn(x, y, hi)).toBe(true);
      }),
    );
  });

  it("gives the art bible's 12/25/50/75 % shades and clamps out-of-range levels", () => {
    const lcd = new Lcd();
    lcd.dither(0, 0, 128, 128, 0.5);
    expect(lcd.inkCount()).toBe(128 * 64);
    lcd.clear();
    lcd.dither(0, 0, 16, 16, 0.25);
    expect(lcd.inkCount()).toBe(64);
    expect(ditherOn(0, 0, -1)).toBe(false);
    expect(ditherOn(3, 3, 2)).toBe(true);
  });

  it("50 % is a checkerboard with no two 4-neighbours alike", () => {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) expect(ditherOn(x, y, 0.5)).not.toBe(ditherOn(x + 1, y, 0.5));
  });
});

describe("ellipse", () => {
  it("is mirror-symmetric and hits the four axis extremes", () => {
    const pts = new Set<string>();
    ellipseOutline(0, 0, 54, 22, (x, y) => pts.add(`${x},${y}`));
    for (const p of pts) {
      const [x = 0, y = 0] = p.split(",").map(Number);
      expect(pts.has(`${-x},${y}`)).toBe(true);
      expect(pts.has(`${x},${-y}`)).toBe(true);
    }
    for (const p of ["54,0", "-54,0", "0,22", "0,-22"]) expect(pts.has(p)).toBe(true);
  });

  it("keeps every outline pixel close to the true ellipse", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 1, max: 60 }), (rx, ry) => {
        ellipseOutline(0, 0, rx, ry, (x, y) => {
          // Distance to the curve along the radial direction, in pixels.
          const r = Math.hypot(x / rx, y / ry);
          const d = Math.abs(1 - r) * Math.min(rx, ry);
          expect(d).toBeLessThanOrEqual(1.5);
        });
      }),
    );
  });

  it("degenerates to a line for a zero radius", () => {
    const pts: string[] = [];
    ellipseOutline(0, 0, 3, 0, (x, y) => pts.push(`${x},${y}`));
    expect(pts).toEqual(["-3,0", "-2,0", "-1,0", "0,0", "1,0", "2,0", "3,0", "0,0"]);
  });
});

describe("Lcd", () => {
  it("ignores off-screen writes and reads them as paper", () => {
    const lcd = new Lcd();
    lcd.set(-1, 0);
    lcd.set(128, 5);
    lcd.set(3, 200);
    expect(lcd.inkCount()).toBe(0);
    expect(lcd.get(-5, -5)).toBe(0);
    lcd.rect(120, 120, 20, 20);
    expect(lcd.inkCount()).toBe(64);
  });

  it("inversion is an involution and swaps the ink count", () => {
    const lcd = new Lcd();
    lcd.dither(0, 0, 128, 128, 0.25);
    const before = lcd.buf.slice();
    lcd.invert();
    expect(lcd.inkCount()).toBe(LCD_SIZE * LCD_SIZE - before.reduce((a, b) => a + b, 0));
    lcd.invert();
    expect(lcd.buf).toEqual(before);
  });

  it("dashes lines with an on/off pattern", () => {
    const lcd = new Lcd();
    lcd.line(0, 0, 9, 0, 1, [3, 1]);
    expect([...Array(10).keys()].map((x) => lcd.get(x, 0)).join("")).toBe("1110111011");
  });

  it("renders text with a 4 px advance and measures it", () => {
    const lcd = new Lcd();
    const end = lcd.text("11", 0, 0);
    expect(end).toBe(8);
    expect(textWidth("11")).toBe(7);
    // "1" = 010/110/010/010/111: 8 ink pixels each.
    expect(lcd.inkCount()).toBe(16);
    lcd.clear();
    lcd.text("1", 0, 0, 1, 2);
    expect(lcd.inkCount()).toBe(32);
  });

  it("stamps a 1 px paper halo and a 1 px ink keyline around a silhouette", () => {
    const lcd = new Lcd();
    lcd.clear(1);
    lcd.stamp(() => 1, 10, 10, 1, 1);
    // The ring (3×3 minus the centre) is paper; the pixel itself ink.
    for (let y = 9; y <= 11; y++)
      for (let x = 9; x <= 11; x++) expect(lcd.get(x, y)).toBe(x === 10 && y === 10 ? 1 : 0);
    lcd.clear(0);
    lcd.stamp(() => 1, 10, 10, 1, 1);
    // Keyline: the 4-neighbours of the ring, outside it (a 5×5 minus corners and the ring).
    let key = 0;
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) if (lcd.get(x, y) && !(x === 10 && y === 10)) key++;
    expect(key).toBe(12);
    expect(lcd.get(8, 8)).toBe(0);
  });

  it("respects transparency and inversion in blits", () => {
    const lcd = new Lcd();
    lcd.blit(["#o.", "..#"], 0, 0, { halo: false });
    expect([lcd.get(0, 0), lcd.get(1, 0), lcd.get(2, 1)]).toEqual([1, 0, 1]);
    lcd.clear(1);
    lcd.blit(["#o."], 0, 0, { halo: false, invert: true });
    expect([lcd.get(0, 0), lcd.get(1, 0), lcd.get(2, 0)]).toEqual([0, 1, 1]);
  });

  it("shifts the buffer for shake and fills the gap", () => {
    const lcd = new Lcd();
    lcd.set(0, 0);
    lcd.shift(1, 0);
    expect(lcd.get(0, 0)).toBe(0);
    expect(lcd.get(1, 0)).toBe(1);
  });

  it("writes ink #111 and paper #eee RGBA", () => {
    const lcd = new Lcd();
    lcd.set(1, 0);
    const out = new Uint8ClampedArray(LCD_SIZE * LCD_SIZE * 4);
    lcd.toRGBA(out);
    expect([...out.slice(0, 8)]).toEqual([0xee, 0xee, 0xee, 255, 0x11, 0x11, 0x11, 255]);
  });
});
