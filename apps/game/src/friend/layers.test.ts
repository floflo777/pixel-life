import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  and,
  andNot,
  EMPTY_MASK,
  frameIndex,
  fromIndices,
  fromRows,
  frontMask,
  goldSlots,
  isSubset,
  popcount,
  visibleStitches,
} from "@pl/shared";
import { FIXTURE_FRIENDS } from "./dev/fixtures.js";
import { Cell, CELLS, composeLayers, crackStage, friendAnchor, gridToMask, maskToGrid, smallHoles } from "./layers.js";

const hex64 = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""));

function cellsOf(cells: Uint8Array, kind: number): string {
  return gridToMask(cells.map((c) => (c === kind ? 1 : 0)));
}

describe("composeLayers", () => {
  it("partitions the frame into body / gold / scar, keeps gold and stitches off scars", () => {
    fc.assert(
      fc.property(hex64, hex64, hex64, hex64, fc.integer({ min: -2, max: 9 }), (frame, lost, gold, stitched, crack) => {
        const l = composeLayers({ frame, lost, gold, stitched, crack });
        const body = cellsOf(l.cells, Cell.Body);
        const g = cellsOf(l.cells, Cell.Gold);
        const scar = cellsOf(l.cells, Cell.Scar);
        expect(scar).toBe(and(frame, lost));
        expect(g).toBe(andNot(and(frame, gold), lost));
        expect(body).toBe(andNot(andNot(frame, lost), gold));
        expect(gridToMask(l.stitch)).toBe(andNot(and(frame, stitched), lost));
        expect(isSubset(gridToMask(l.eyes), andNot(fromIndices([...Array(CELLS).keys()]), frame))).toBe(true);
        expect(l.crack).toBe(crackStage(crack));
      }),
      { numRuns: 300 },
    );
  });

  it("applies front-mask scars to other frames by pixel-index coincidence", () => {
    const a = FIXTURE_FRIENDS[0];
    if (!a) throw new Error("fixtures missing");
    const front = frontMask(a);
    const walk = a.frames[frameIndex(true, "down", 3)] as string;
    const lost = fromIndices([...Array(CELLS).keys()].filter((i) => maskToGrid(front)[i]).slice(0, 10));
    const l = composeLayers({ frame: walk, lost, gold: EMPTY_MASK, stitched: EMPTY_MASK, crack: 0 });
    expect(cellsOf(l.cells, Cell.Scar)).toBe(and(walk, lost));
  });

  it("composes shared gold slots and visible stitches without overlap", () => {
    for (const a of FIXTURE_FRIENDS) {
      const front = frontMask(a);
      const lost = fromIndices(
        [...Array(CELLS).keys()].filter((i) => maskToGrid(front)[i]).filter((_, k) => k % 5 === 0),
      );
      const gold = goldSlots(front, lost, a.tokenId, 5);
      const stitched = visibleStitches([{ pixels: front, at: 1000 }], front, lost, 2000);
      const l = composeLayers({ frame: front, lost, gold, stitched, crack: 1 });
      expect(popcount(cellsOf(l.cells, Cell.Gold))).toBe(Math.min(2, popcount(andNot(front, lost))));
      expect(popcount(cellsOf(l.cells, Cell.Scar))).toBe(popcount(lost));
      expect(and(gridToMask(l.stitch), lost)).toBe(EMPTY_MASK);
    }
  });
});

describe("smallHoles (eye back-plates)", () => {
  const ring = (n: number): string => {
    const rows = Array.from({ length: 16 }, () => ".".repeat(16).split(""));
    for (let y = 0; y < n + 2; y++)
      for (let x = 0; x < n + 2; x++)
        if (y === 0 || x === 0 || y === n + 1 || x === n + 1) (rows[y] as string[])[x] = "#";
    return fromRows(rows.map((r) => r.join("")));
  };

  it("fills enclosed holes up to 4 cells and leaves bigger ones see-through", () => {
    expect(popcount(gridToMask(smallHoles(maskToGrid(ring(1)), 4)))).toBe(1);
    expect(popcount(gridToMask(smallHoles(maskToGrid(ring(2)), 4)))).toBe(4);
    expect(popcount(gridToMask(smallHoles(maskToGrid(ring(3)), 4)))).toBe(0);
  });

  it("never marks cells connected to the border", () => {
    fc.assert(
      fc.property(hex64, (m) => {
        const g = maskToGrid(m);
        const eyes = smallHoles(g, 4);
        for (let k = 0; k < 16; k++) {
          for (const i of [k, 240 + k, k * 16, k * 16 + 15]) expect(eyes[i]).toBe(0);
        }
      }),
    );
  });

  it("finds the Mask Friend's eyes", () => {
    const mask = FIXTURE_FRIENDS.find((f) => f.tokenId === "344030");
    if (!mask) throw new Error("fixture missing");
    const l = composeLayers({
      frame: frontMask(mask),
      lost: EMPTY_MASK,
      gold: EMPTY_MASK,
      stitched: EMPTY_MASK,
      crack: 0,
    });
    expect(popcount(gridToMask(l.eyes))).toBeGreaterThan(0);
  });
});

describe("friendAnchor", () => {
  it("centres on the front mask and stands on its lowest row", () => {
    expect(friendAnchor(fromIndices([3 * 16 + 4, 10 * 16 + 9]))).toEqual({ cx: 7, bottom: 11 });
    expect(friendAnchor(EMPTY_MASK)).toEqual({ cx: 8, bottom: 16 });
  });
});
