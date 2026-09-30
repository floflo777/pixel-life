import { describe, expect, it } from "vitest";
import { edgeDistance, meshSprite, pillowVoxels } from "./mesh";
import { CREATURE_KINDS, CREATURE_SPRITES, spriteSize } from "./sprites";

/** Art bible §10 + task budget: every pose of a small creature ≤ 400 triangles. */
const BUDGET = 400;

describe("creature meshes", () => {
  it("keeps every frame of every kind within the triangle budget", () => {
    for (const kind of CREATURE_KINDS) {
      const s = CREATURE_SPRITES[kind];
      for (const [frame, rows] of Object.entries(s.frames)) {
        const m = meshSprite(rows, s.skin, s.maxD, 0.1);
        expect(m.triangles, `${kind}.${frame}`).toBeLessThanOrEqual(BUDGET);
        expect(m.triangles, `${kind}.${frame}`).toBeGreaterThan(0);
        m.geometry.dispose();
      }
    }
  });

  it("only uses known sprite characters and rectangular-enough rows", () => {
    for (const kind of CREATURE_KINDS)
      for (const [frame, rows] of Object.entries(CREATURE_SPRITES[kind].frames)) {
        expect(rows.join(""), `${kind}.${frame}`).toMatch(/^[.cClLvyYbBpqeKwkTPRM]+$/);
        const { w, h } = spriteSize(rows);
        expect(w).toBeLessThanOrEqual(22);
        expect(h).toBeLessThanOrEqual(12);
      }
  });

  it("puts feet on y = 0 and centres x", () => {
    const s = CREATURE_SPRITES.nib;
    const m = meshSprite(s.frames["idle0"] ?? [], s.skin, s.maxD, 0.1);
    const bb = m.geometry.boundingBox;
    expect(bb?.min.y).toBeCloseTo(0, 2);
    expect((bb?.min.x ?? 0) + (bb?.max.x ?? 0)).toBeCloseTo(0, 2);
  });
});

describe("pillowing", () => {
  it("measures 4-neighbour distance to the edge", () => {
    const d = edgeDistance(["#####", "#####", "#####"].map((r) => r.replace(/#/g, "c")));
    expect(d[1]).toEqual([1, 2, 2, 2, 1]);
    expect(d[0]).toEqual([1, 1, 1, 1, 1]);
  });

  it("grows depth 1 + 2·(d − 1) capped at maxD, and draws features on the front only", () => {
    const rows = ["ccccc", "ccwcc", "ccccc"];
    const vox = pillowVoxels(rows, "c", 3);
    const centre = vox.filter((v) => v.i === 2 && v.j === 1);
    expect(centre.map((v) => v.k).sort((a, b) => a - b)).toEqual([-1, 0, 1]);
    const front = centre.find((v) => v.k === 1);
    const back = centre.find((v) => v.k === -1);
    expect(front?.color).not.toBe(back?.color);
    expect(vox.filter((v) => v.i === 0 && v.j === 1)).toHaveLength(1);
  });

  it("keeps thin cells one voxel deep and out of the body's distance", () => {
    const vox = pillowVoxels(["vcccv", "vcccv", "vcccv"], "c", 3);
    expect(vox.filter((v) => v.i === 0)).toHaveLength(3);
    // The body's rim column stays depth 1 despite the wing next to it.
    expect(vox.filter((v) => v.i === 1 && v.j === 1)).toHaveLength(1);
  });

  it("raises plates one voxel proud and recesses cavities", () => {
    const vox = pillowVoxels(["lllll", "lPPPl", "lMMMl", "lllll"], "l", 3);
    const plate = vox.filter((v) => v.i === 2 && v.j === 2);
    const lipCol = vox.filter((v) => v.i === 0 && v.j === 2);
    expect(Math.max(...plate.map((v) => v.k))).toBeGreaterThan(Math.max(...lipCol.map((v) => v.k)));
    const maw = vox.filter((v) => v.i === 2 && v.j === 1);
    const lip = vox.filter((v) => v.i === 2 && v.j === 2 && v.k < 2);
    expect(Math.max(...maw.map((v) => v.k))).toBeLessThan(Math.max(...lip.map((v) => v.k)));
  });
});
