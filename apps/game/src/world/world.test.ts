import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { SUN_DIRECTION } from "../stage/lights";
import { PALETTE } from "../stage/palette";
import { cloudColumns } from "./clouds";
import { MEADOW, buildIsland, islandCells, stratumColor, undersideRows } from "./island";
import { hash3, mulberry32, valueNoise } from "./noise";
import { inFootprint } from "./props";
import { Occupancy, TERRAIN, VoxelMesher } from "./voxel-mesher";

describe("noise", () => {
  it("is deterministic and in range", () => {
    expect(hash3(3, 4, 5)).toBe(hash3(3, 4, 5));
    expect(hash3(3, 4, 5)).not.toBe(hash3(4, 3, 5));
    for (let i = 0; i < 200; i++) {
      const v = valueNoise(i * 0.37, i * 0.11, 9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("VoxelMesher", () => {
  it("culls hidden faces and greedy-merges coplanar ones", () => {
    const m = new VoxelMesher();
    const g = m.grid(1);
    g.set(0, 0, 0, 0xff0000);
    expect(m.build().triangles).toBe(12);
    g.set(1, 0, 0, 0xff0000);
    // Two cubes side by side merge into one 2×1×1 box.
    expect(m.build().triangles).toBe(12);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) g.set(i, j, k, 0xff0000);
    expect(m.build().triangles).toBe(12);
  });

  it("never merges faces of different colours", () => {
    const m = new VoxelMesher();
    const g = m.grid(1);
    g.set(0, 0, 0, 0xff0000);
    g.set(1, 0, 0, 0x00ff00);
    // Shared face culled; 4 long faces split in two each; 2 end caps: 10 quads.
    expect(m.build().triangles).toBe(20);
  });

  it("keeps every face wound outward (CCW seen from its normal)", () => {
    const m = new VoxelMesher();
    const g = m.grid(0.5, [1, 2, 3]);
    for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) g.set(i, 0, k, (i + k) % 2 ? 1 : 2);
    g.set(1, 1, 1, 3);
    m.box([0, 0, 0], [1, 2, 3], 4);
    const { geometry } = m.build();
    const p = geometry.getAttribute("position");
    const nm = geometry.getAttribute("normal");
    const idx = geometry.index;
    if (!idx) throw new Error("indexed geometry expected");
    for (let t = 0; t < idx.count; t += 3) {
      const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      const va = new Vector3().fromBufferAttribute(p, a);
      const e1 = new Vector3().fromBufferAttribute(p, b).sub(va);
      const e2 = new Vector3().fromBufferAttribute(p, c).sub(va);
      const n = new Vector3().fromBufferAttribute(nm, a);
      expect(e1.cross(e2).dot(n)).toBeGreaterThan(0);
    }
  });

  it("writes exact palette colours and band attributes", () => {
    const m = new VoxelMesher();
    m.box([0, 0, 0], [1, 1, 1], PALETTE.meadow, { dither: 0.22, lightMix: 0.5 }, { skipBottom: true });
    const { geometry, triangles } = m.build();
    expect(triangles).toBe(10);
    const c = geometry.getAttribute("color");
    expect([c.getX(0), c.getY(0), c.getZ(0)]).toEqual([0xb9 / 255, 0xd9 / 255, 0x84 / 255].map((v) => Math.fround(v)));
    const band = geometry.getAttribute("aBand");
    expect(band.getY(0)).toBeCloseTo(0.22, 6);
    expect(band.getZ(0)).toBeCloseTo(0.5, 6);
  });

  it("bakes a hard shadow under a floating caster only", () => {
    const m = new VoxelMesher();
    const ground = m.grid(0.24, [0, -0.12, 0]);
    for (let i = -10; i <= 10; i++) for (let k = -10; k <= 10; k++) ground.set(i, 0, k, PALETTE.meadow, TERRAIN);
    m.box([0, 1, 0], [0.5, 0.5, 0.5], PALETTE.coral, TERRAIN);
    const withCaster = m.build({ sun: SUN_DIRECTION.clone() }).shadowedFaces;
    expect(withCaster).toBeGreaterThan(0);
    const bare = new VoxelMesher();
    const g2 = bare.grid(0.24, [0, -0.12, 0]);
    for (let i = -10; i <= 10; i++) for (let k = -10; k <= 10; k++) g2.set(i, 0, k, PALETTE.meadow, TERRAIN);
    expect(bare.build({ sun: SUN_DIRECTION.clone() }).shadowedFaces).toBe(0);
  });

  it("uses 32-bit indices only when needed", () => {
    const m = new VoxelMesher();
    m.box([0, 0, 0], [1, 1, 1], 1);
    expect(m.build().geometry.index?.array).toBeInstanceOf(Uint16Array);
  });
});

describe("Occupancy", () => {
  it("fills cells whose centres are inside the box and marches toward the sun", () => {
    const o = new Occupancy(0.1);
    o.fill(-0.5, 1, -0.5, 0.5, 1.2, 0.5);
    expect(o.at(new Vector3(0, 1.1, 0))).toBe(true);
    expect(o.at(new Vector3(0, 0.5, 0))).toBe(false);
    expect(o.shadowed(new Vector3(0, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 1, 0), 5)).toBe(true);
    expect(o.shadowed(new Vector3(3, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 1, 0), 5)).toBe(false);
  });
});

describe("island", () => {
  it("builds a noisy ellipse whose rim has edge distance 0", () => {
    const cells = islandCells({ radius: 10, seed: 3 });
    expect(cells.size).toBeGreaterThan(150);
    expect(cells.size).toBeLessThan(700);
    const centre = cells.get("0,0");
    expect(centre?.edge).toBeGreaterThan(3);
    for (const c of cells.values()) expect(c.edge).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic per seed", () => {
    const a = [...islandCells({ radius: 8, seed: 5 }).keys()].sort();
    const b = [...islandCells({ radius: 8, seed: 5 }).keys()].sort();
    const c = [...islandCells({ radius: 8, seed: 6 }).keys()].sort();
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("stacks coral strata over a lilac stalactite with a lilac-dark tip", () => {
    const rows = 7;
    const col = Array.from({ length: rows }, (_, k) => stratumColor(k + 1, rows, false, MEADOW));
    expect(col[0]).toBe(PALETTE.coral);
    expect(col[1]).toBe(PALETTE.coralDark);
    expect(col[2]).toBe(PALETTE.lilac);
    expect(col.slice(-2)).toEqual([PALETTE.lilacDark, PALETTE.lilacDark]);
    expect(stratumColor(1, rows, true, MEADOW)).toBe(PALETTE.meadowDrip);
  });

  it("hangs deeper toward the centre, within the cap", () => {
    expect(undersideRows(0, 0, 0, 1, 12)).toBeLessThan(undersideRows(0, 0, 8, 1, 12));
    for (let e = 0; e < 30; e++) expect(undersideRows(e, -e, e, 2, 9)).toBeLessThanOrEqual(9);
  });

  it("builds a plaza island within the per-island triangle budget", () => {
    const isl = buildIsland({
      radius: 20,
      seed: 21,
      plaza: { radius: 9, paths: [{ toward: "-z", halfWidth: 2 }] },
      pond: { i: -13, j: 5, r: 3 },
      scatter: { tufts: 30, flowers: 30 },
      props: [
        { kind: "tree", x: 3.5, z: -1, canopy: "paper" },
        { kind: "lamp", x: -1.5, z: 1 },
        { kind: "bench", x: 1.5, z: 1.5 },
        { kind: "venue", x: 0, z: -3.5, name: "pixel-life", popPixel: [8, 12] },
      ],
    });
    // Art bible §10: ≈ 8–15k tris per greedy-meshed island; face culling alone must stay under 30k.
    expect(isl.stats.triangles).toBeLessThan(30_000);
    // One static mesh + one per glow tint (lamp, signal).
    expect(isl.stats.drawCalls).toBe(3);
    expect(isl.surfaceAt(0, 0)).toBe("plaza");
    expect(isl.surfaceAt(0, -1.6)).toBe("plaza");
    expect(isl.surfaceAt(0, -4.2)).toBe("path");
    expect(isl.surfaceAt(-13 * 0.24, 5 * 0.24)).toBe("pond");
    expect(isl.surfaceAt(100, 100)).toBeNull();
    expect(isl.isWalkable(0, 0)).toBe(true);
    expect(isl.isWalkable(0, -3.5)).toBe(false);
    expect(isl.isWalkable(-13 * 0.24, 5 * 0.24)).toBe(false);
    expect(isl.anchors.map((a) => a.name)).toContain("pixel-life:door");
    isl.dispose();
  });
});

describe("props", () => {
  it("tests circle and rectangle footprints", () => {
    expect(inFootprint({ x: 0, z: 0, r: 1 }, 0.5, 0.5)).toBe(true);
    expect(inFootprint({ x: 0, z: 0, r: 1 }, 1, 1)).toBe(false);
    expect(inFootprint({ x: 0, z: 0, hx: 2, hz: 0.5 }, 1.9, 0.4)).toBe(true);
    expect(inFootprint({ x: 0, z: 0, hx: 2, hz: 0.5 }, 1.9, 0.6)).toBe(false);
  });
});

describe("clouds", () => {
  it("are 1–3 cells high slabs", () => {
    const cols = cloudColumns(2, 4, 0.3);
    expect(cols.length).toBeGreaterThan(10);
    for (const [, , h] of cols) {
      expect(h).toBeGreaterThanOrEqual(1);
      expect(h).toBeLessThanOrEqual(3);
    }
  });
});
