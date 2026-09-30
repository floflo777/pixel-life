import {
  CATALOG,
  decorItem,
  DECOR_MODELS,
  EMPTY_LAYOUT,
  FRIEND_SPOT,
  frontMask,
  getBit,
  HAT_MODELS,
  HOME_GRID,
  pixelIndex,
  placementCells,
  SPRITE_SIZE,
  validateLayout,
  type HomeLayout,
} from "@pl/shared";
import type { Mesh } from "three";
import { Box3 } from "three";
import { describe, expect, it } from "vitest";
import { FIXTURE_FRIENDS } from "../friend/dev/fixtures";
import { buildDecorGeometry, DecorLibrary } from "./decor";
import { HomeEditor, type HomeEditEvent } from "./editor";
import {
  cellCenter,
  ISLAND_CELL,
  pickTile,
  placementCenter,
  TERRACE_RADIUS_CELLS,
  TERRACE_SPACING,
  terraceOrigin,
} from "./grid";
import { beltRow, buildBelt, buildHat, HAT_ART, hatVoxels } from "./wearables";

describe("grid geometry", () => {
  it("keeps every terrace clear of the others", () => {
    const n = 11; // 6 generation terraces + 5 plots
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const A = terraceOrigin(a);
        const B = terraceOrigin(b);
        expect(Math.hypot(A.x - B.x, A.z - B.z)).toBeGreaterThanOrEqual(2 * TERRACE_RADIUS_CELLS * ISLAND_CELL);
      }
    expect(TERRACE_SPACING).toBeGreaterThan(2 * TERRACE_RADIUS_CELLS * ISLAND_CELL);
    expect(terraceOrigin(0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("fits the 12×12 grid inside the island radius", () => {
    const corner = cellCenter(0, 0, 0);
    expect(Math.hypot(corner.x - 0.5, corner.z - 0.5)).toBeLessThan(TERRACE_RADIUS_CELLS * ISLAND_CELL * 0.79);
  });

  it("picks the tile under a ray, nearest terrace first", () => {
    for (const [t, x, z] of [
      [0, 0, 0],
      [0, 11, 11],
      [2, 3, 7],
    ] as const) {
      const c = cellCenter(t, x, z);
      // A ray from above-front, like the home camera.
      const origin = { x: c.x, y: c.y + 20, z: c.z + 20 };
      expect(pickTile(origin, { x: 0, y: -20, z: -20 }, 3)).toEqual({ t, x, z });
    }
    expect(pickTile({ x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 }, 1)).toBeNull();
    expect(pickTile({ x: 100, y: 10, z: 100 }, { x: 0, y: -1, z: 0 }, 1)).toBeNull();
  });

  it("centres placements on their rotated footprint", () => {
    expect(placementCenter({ item: "bench", t: 0, x: 0, z: 0, r: 0 })).toEqual({ x: -5, y: 0, z: -5.5 });
    expect(placementCenter({ item: "bench", t: 0, x: 0, z: 0, r: 1 })).toEqual({ x: -5.5, y: 0, z: -5 });
    expect(placementCenter({ item: "hat_cap", t: 0, x: 0, z: 0, r: 0 })).toBeNull();
  });
});

describe("HomeEditor", () => {
  const rules = { terraces: 1, owned: { bench: 1, rock: 2 } };
  const make = (layout: HomeLayout = EMPTY_LAYOUT) => {
    const ed = new HomeEditor(layout, rules);
    const events: HomeEditEvent[] = [];
    ed.on((e) => events.push(e));
    ed.begin();
    return { ed, events };
  };

  it("refuses edits outside edit mode", () => {
    const ed = new HomeEditor(EMPTY_LAYOUT, rules);
    expect(ed.tap({ t: 0, x: 0, z: 0 })).toEqual({ ok: false, error: "not_editing" });
  });

  it("places an armed item, then selects, rotates, moves and removes it", () => {
    const { ed, events } = make();
    ed.arm("bench");
    expect(ed.tap({ t: 0, x: 1, z: 1 })).toEqual({ ok: true });
    expect(ed.armed).toBeNull();
    expect(ed.selected).toBe(0);
    expect(ed.layout.items).toEqual([{ item: "bench", t: 0, x: 1, z: 1, r: 0 }]);
    expect(ed.rotate()).toEqual({ ok: true });
    expect(ed.layout.items[0]?.r).toBe(1);
    expect(ed.tap({ t: 0, x: 9, z: 9 })).toEqual({ ok: true });
    expect(ed.layout.items[0]).toMatchObject({ x: 9, z: 9, r: 1 });
    // Tapping the selected item again deselects it.
    expect(ed.tap({ t: 0, x: 9, z: 10 })).toEqual({ ok: true });
    expect(ed.selected).toBeNull();
    ed.tap({ t: 0, x: 9, z: 9 });
    expect(ed.remove()).toEqual({ ok: true });
    expect(ed.layout.items).toEqual([]);
    expect(events.filter((e) => e.type === "change")).toHaveLength(4);
    expect(validateLayout(ed.layout, rules).ok).toBe(true);
  });

  it("rejects invalid edits and reports why", () => {
    const { ed, events } = make();
    ed.arm("bench");
    expect(ed.tap({ t: 0, x: 11, z: 0 })).toEqual({ ok: false, error: "out_of_bounds" });
    expect(ed.tap({ t: 0, x: FRIEND_SPOT.x, z: FRIEND_SPOT.z })).toEqual({ ok: false, error: "friend_spot" });
    ed.tap({ t: 0, x: 0, z: 0 });
    ed.arm("bench");
    expect(ed.tap({ t: 0, x: 3, z: 3 })).toEqual({ ok: false, error: "not_owned" });
    ed.arm(null);
    ed.tap({ t: 0, x: 3, z: 3 });
    expect(ed.rotate()).toEqual({ ok: false, error: "nothing_selected" });
    expect(events.filter((e) => e.type === "rejected").map((e) => e.type === "rejected" && e.error)).toEqual([
      "out_of_bounds",
      "friend_spot",
      "not_owned",
      "nothing_selected",
    ]);
  });

  it("moves the keyboard cursor inside the grid and across terraces", () => {
    const ed = new HomeEditor(EMPTY_LAYOUT, { terraces: 2 });
    expect(ed.moveCursor(-1, -1)).toEqual({ t: 0, x: 0, z: 0 });
    for (let i = 0; i < 20; i++) ed.moveCursor(1, 1);
    expect(ed.cursor).toEqual({ t: 0, x: HOME_GRID - 1, z: HOME_GRID - 1 });
    expect(ed.moveCursor(0, 0, 5).t).toBe(1);
  });

  it("keeps the layout valid under random command sequences (fuzz)", () => {
    const decor = CATALOG.filter((i) => i.kind === "decor").map((i) => i.id);
    const owned = Object.fromEntries(decor.map((id) => [id, 2]));
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
    const ed = new HomeEditor(EMPTY_LAYOUT, { terraces: 2, owned });
    ed.begin();
    for (let i = 0; i < 2000; i++) {
      const r = rnd();
      if (r < 0.2) ed.arm(decor[Math.floor(rnd() * decor.length)] ?? null);
      else if (r < 0.75) ed.tap({ t: Math.floor(rnd() * 2), x: Math.floor(rnd() * 12), z: Math.floor(rnd() * 12) });
      else if (r < 0.9) ed.rotate();
      else ed.remove();
      expect(validateLayout(ed.layout, ed.rules).ok).toBe(true);
    }
  });
});

describe("wearables", () => {
  it("never puts a hat voxel on or below a canonical pixel", () => {
    for (const a of FIXTURE_FRIENDS) {
      const front = frontMask(a);
      for (const model of HAT_MODELS) {
        const voxels = hatVoxels(front, HAT_ART[model]);
        expect(voxels.length).toBeGreaterThan(0);
        for (const v of voxels) {
          for (let y = Math.max(0, v.y); y < SPRITE_SIZE; y++) {
            // No canonical pixel at or above the hat voxel in its column.
            if (v.x >= 0 && v.x < SPRITE_SIZE && y <= v.y) expect(getBit(front, pixelIndex(v.x, y))).toBe(false);
          }
          if (v.x >= 0 && v.x < SPRITE_SIZE && v.y >= 0) {
            for (let y = 0; y <= v.y; y++) expect(getBit(front, pixelIndex(v.x, y))).toBe(false);
          }
        }
      }
    }
  });

  it("finds a waist row inside the silhouette and builds hats and belts", () => {
    for (const a of FIXTURE_FRIENDS) {
      const front = frontMask(a);
      const row = beltRow(front);
      expect(row).not.toBeNull();
      if (!row) continue;
      expect(getBit(front, pixelIndex(row.minX, row.y))).toBe(true);
      expect(getBit(front, pixelIndex(row.maxX, row.y))).toBe(true);
    }
    const front = frontMask(FIXTURE_FRIENDS[0] ?? { tokenId: "1", familyId: 0, seed: 0, frames: [] });
    const hat = buildHat("hat_crown", front);
    expect(hat?.object.children.length).toBe(2); // plain + glowing gold
    hat?.dispose();
    expect(buildHat("bench", front)).toBeNull();
    const belt = buildBelt("gulp_master", front);
    expect(belt?.object.children.length).toBe(1);
    belt?.dispose();
    expect(buildBelt("nope", front)).toBeNull();
  });
});

describe("decor models", () => {
  it("builds every model within its footprint", () => {
    for (const model of DECOR_MODELS) {
      const built = buildDecorGeometry(model);
      expect(built.geometries.length).toBeGreaterThan(0);
      expect(built.triangles).toBeGreaterThan(0);
      const items = CATALOG.filter((i) => i.kind === "decor" && i.model === model);
      const box = new Box3();
      for (const g of built.geometries) {
        g.geometry.computeBoundingBox();
        if (g.geometry.boundingBox) box.union(g.geometry.boundingBox);
        g.geometry.dispose();
      }
      for (const item of items) {
        const d = decorItem(item.id);
        if (!d) continue;
        // Half a tile of slack: canopies may overhang a little, never into the next-but-one tile.
        expect(box.max.x - box.min.x).toBeLessThanOrEqual(d.w + 0.5);
        expect(box.max.z - box.min.z).toBeLessThanOrEqual(d.d + 0.5);
      }
    }
  });

  it("shares geometry between placements and frees it once", () => {
    const lib = new DecorLibrary();
    const a = lib.instance("tree_paper");
    const b = lib.instance("tree_paper");
    expect(a && b).toBeTruthy();
    expect((a?.children[0] as Mesh).geometry).toBe((b?.children[0] as Mesh).geometry);
    expect(lib.instance("hat_cap")).toBeNull();
    lib.dispose();
  });

  it("footprint cells match the rendered pivot", () => {
    const p = { item: "fountain", t: 1, x: 4, z: 2, r: 0 as const };
    const cells = placementCells(p) ?? [];
    const c = placementCenter(p);
    const mean = cells
      .map(([x, z]) => cellCenter(1, x, z))
      .reduce((s, v) => ({ x: s.x + v.x / cells.length, z: s.z + v.z / cells.length }), { x: 0, z: 0 });
    expect(c?.x).toBeCloseTo(mean.x);
    expect(c?.z).toBeCloseTo(mean.z);
  });
});
