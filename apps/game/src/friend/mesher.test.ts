import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  EMPTY_MASK,
  FULL_MASK,
  frontMask,
  goldSlots,
  popcount,
  regrowthOrder,
  andNot,
  fromIndices,
  frameIndex,
  FACINGS,
} from "@pl/shared";
import { FIXTURE_FRIENDS } from "./dev/fixtures.js";
import { Cell, CELLS, composeLayers, friendAnchor, GRID, gridToMask, type FriendLayers } from "./layers.js";
import { greedyRects, meshFriend, triangleCount, type MeshOptions, type QuadData } from "./mesher.js";

const S = 1;
const DEPTH = 1.5;

const hex64 = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""));

function opts(layers: FriendLayers, over: Partial<MeshOptions> = {}): MeshOptions {
  void layers;
  return { pixelSize: S, depth: DEPTH, anchor: { cx: 8, bottom: 16 }, lod: 0, halo: null, eyeColor: 0xf3ead0, ...over };
}

interface QuadInfo {
  n: [number, number, number];
  area: number;
  z: [number, number];
  uvTiled: boolean;
}

function quads(q: QuadData): QuadInfo[] {
  const out: QuadInfo[] = [];
  for (let k = 0; k < q.quads; k++) {
    const p = (v: number, c: number): number => q.positions[k * 12 + v * 3 + c] as number;
    const e1 = [p(1, 0) - p(0, 0), p(1, 1) - p(0, 1), p(1, 2) - p(0, 2)];
    const e2 = [p(3, 0) - p(0, 0), p(3, 1) - p(0, 1), p(3, 2) - p(0, 2)];
    const cx = (e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number);
    const cy = (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number);
    const cz = (e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number);
    const area = Math.hypot(cx, cy, cz);
    const n: [number, number, number] = [
      Math.round(cx / area) + 0,
      Math.round(cy / area) + 0,
      Math.round(cz / area) + 0,
    ];
    // The stored normal must agree with the winding (du × dv).
    expect([q.normals[k * 12], q.normals[k * 12 + 1], q.normals[k * 12 + 2]]).toEqual(n.map((c) => c * 127));
    const zs = [p(0, 2), p(1, 2), p(2, 2), p(3, 2)];
    out.push({ n, area, z: [Math.min(...zs), Math.max(...zs)], uvTiled: (q.uvs[k * 8] as number) !== 0.5 / 8 });
  }
  return out;
}

function exposedEdges(cells: Uint8Array, kind: number): number {
  let e = 0;
  const inFrame = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < GRID && y < GRID && cells[y * GRID + x] !== Cell.Empty;
  for (let i = 0; i < CELLS; i++) {
    if (cells[i] !== kind) continue;
    const x = i % GRID;
    const y = i >> 4;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      if (!inFrame(x + dx, y + dy)) e++;
  }
  return e;
}

describe("greedyRects", () => {
  it("covers exactly the picked cells with disjoint rectangles", () => {
    fc.assert(
      fc.property(hex64, (m) => {
        const g = new Uint8Array(CELLS);
        for (let i = 0; i < CELLS; i++) g[i] = (Number.parseInt(m.charAt(63 - (i >> 2)), 16) >> (i & 3)) & 1;
        const cover = new Uint8Array(CELLS);
        const rects = greedyRects((i) => g[i] === 1);
        for (const r of rects) {
          for (let y = r.y; y < r.y + r.h; y++)
            for (let x = r.x; x < r.x + r.w; x++) cover[y * GRID + x] = (cover[y * GRID + x] as number) + 1;
        }
        for (let i = 0; i < CELLS; i++) expect(cover[i]).toBe(g[i]);
        expect(rects.length).toBeLessThanOrEqual(g.reduce((a, b) => a + b, 0));
      }),
      { numRuns: 200 },
    );
  });

  it("uses one rectangle for a full grid and none for an empty one", () => {
    expect(greedyRects(() => true)).toEqual([{ x: 0, y: 0, w: 16, h: 16 }]);
    expect(greedyRects(() => false)).toEqual([]);
  });
});

describe("meshFriend", () => {
  it("front/back areas equal the present voxels and side areas the exposed edges (random masks)", () => {
    fc.assert(
      fc.property(hex64, hex64, hex64, (frame, lost, gold) => {
        const layers = composeLayers({ frame, lost, gold, stitched: EMPTY_MASK, crack: 0 });
        const data = meshFriend(layers, opts(layers, { lod: 0 }));
        for (const [q, kind] of [
          [data.main, Cell.Body],
          [data.gold, Cell.Gold],
        ] as const) {
          const count = layers.cells.reduce((a, c) => a + (c === kind ? 1 : 0), 0);
          if (!q) {
            expect(count).toBe(0);
            continue;
          }
          const info = quads(q).filter((i) => !i.uvTiled);
          const front = info.filter((i) => i.n[2] === 1 && i.z[0] === 0 && i.z[1] === 0);
          const back = info.filter((i) => i.n[2] === -1);
          const sides = info.filter((i) => i.n[2] === 0);
          const sum = (a: QuadInfo[]): number => a.reduce((t, i) => t + i.area, 0);
          expect(sum(front)).toBeCloseTo(count * S * S, 6);
          expect(sum(back)).toBeCloseTo(count * S * S, 6);
          expect(sum(sides)).toBeCloseTo(exposedEdges(layers.cells, kind) * S * DEPTH * S, 6);
        }
      }),
      { numRuns: 150 },
    );
  });

  it("emits one tiled plate per scar and per stitched / cracked pixel", () => {
    const frame = FULL_MASK;
    const lost = fromIndices([0, 17, 34]);
    const gold = fromIndices([100, 101]);
    const stitched = fromIndices([50, 51, 52, 0]); // 0 is lost: no stitch on a scar
    const layers = composeLayers({ frame, lost, gold, stitched, crack: 2 });
    const data = meshFriend(layers, opts(layers));
    const mainTiles = quads(data.main).filter((i) => i.uvTiled).length;
    const goldTiles = data.gold ? quads(data.gold).filter((i) => i.uvTiled).length : 0;
    expect(mainTiles).toBe(3 + 3);
    expect(goldTiles).toBe(2);
  });

  it("LOD1 drops back faces and bevel strips", () => {
    const layers = composeLayers({
      frame: frontMask(FIXTURE_FRIENDS[0] as never),
      lost: EMPTY_MASK,
      gold: EMPTY_MASK,
      stitched: EMPTY_MASK,
      crack: 0,
    });
    const l0 = meshFriend(layers, opts(layers, { lod: 0 }));
    const l1 = meshFriend(layers, opts(layers, { lod: 1 }));
    expect(quads(l1.main).some((i) => i.n[2] === -1)).toBe(false);
    expect(triangleCount(l1)).toBeLessThan(triangleCount(l0));
  });

  it("the halo is the Chebyshev dilation of the frame (scars included) behind the front plane", () => {
    const frame = fromIndices([7 * 16 + 7]);
    const layers = composeLayers({ frame, lost: frame, gold: EMPTY_MASK, stitched: EMPTY_MASK, crack: 0 });
    const data = meshFriend(
      layers,
      opts(layers, { halo: { width: 0.5, keyline: 0.25, color: 0xf4f2ea, depthFraction: 0.5 } }),
    );
    const behind = quads(data.main).filter((i) => i.z[1] < 0 && i.n[2] === 1);
    expect(behind.map((i) => i.area).sort()).toEqual([4, 6.25].map((a) => a * S * S)); // (1+2·0.5)², (1+2·0.75)²
  });

  it("stays within the LOD0 budget (≤ 700 tris) for every fixture frame with scars, gold and stitches", () => {
    let worst = 0;
    for (const a of FIXTURE_FRIENDS) {
      const front = frontMask(a);
      const order = regrowthOrder(a.tokenId).filter(
        (i) => (Number.parseInt(front.charAt(63 - (i >> 2)), 16) >> (i & 3)) & 1,
      );
      const lost = fromIndices(order.slice(0, Math.floor(popcount(front) / 4)));
      const gold = goldSlots(front, lost, a.tokenId, 2);
      const stitched = fromIndices(order.slice(-6));
      const anchor = friendAnchor(front);
      for (const walking of [false, true])
        for (const facing of FACINGS)
          for (let f = 0; f < 8; f++) {
            const frame = a.frames[frameIndex(walking, facing, f)] as string;
            if (frame === EMPTY_MASK) continue;
            for (const l of [lost, EMPTY_MASK]) {
              const layers = composeLayers({ frame, lost: l, gold, stitched: andNot(stitched, l), crack: 3 });
              const data = meshFriend(layers, {
                ...opts(layers),
                anchor,
                halo: { width: 0.6, keyline: 0.3, color: 0xf4f2ea, depthFraction: 0.5 },
              });
              worst = Math.max(worst, triangleCount(data));
            }
          }
    }
    expect(worst).toBeLessThanOrEqual(700);
  });

  it("round-trips grids", () => {
    fc.assert(
      fc.property(hex64, (m) => {
        const layers = composeLayers({ frame: m, lost: EMPTY_MASK, gold: EMPTY_MASK, stitched: EMPTY_MASK, crack: 0 });
        expect(gridToMask(layers.cells.map((c) => (c ? 1 : 0)))).toBe(m);
      }),
    );
  });
});
