import { ROOMS } from "@pl/shared";
import { describe, expect, it } from "vitest";
import { pointInPolygon, rect, segmentCrossing, type Vec2 } from "./geometry.js";
import { centroid, type HubNavmesh, Navmesh, validateNavmesh } from "./navmesh.js";
import { HUB_NAVMESHES } from "./rooms.js";

const box: HubNavmesh = {
  room: "plaza",
  version: 1,
  areas: [rect(0, 0, 1000, 1000)],
  holes: [rect(400, 400, 600, 600)],
  spawns: [[100, 100]],
  doors: [],
  landmarks: [],
};

describe("geometry", () => {
  it("point in polygon, including concave shapes", () => {
    const l: Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 40],
      [40, 40],
      [40, 100],
      [0, 100],
    ];
    expect(pointInPolygon([20, 80], l)).toBe(true);
    expect(pointInPolygon([80, 80], l)).toBe(false);
    expect(pointInPolygon([-1, 5], l)).toBe(false);
  });

  it("segment crossing parameter", () => {
    expect(segmentCrossing([0, 0], [10, 0], [5, -5], [5, 5])).toBeCloseTo(0.5);
    expect(segmentCrossing([0, 0], [10, 0], [5, 1], [5, 5])).toBeNull();
    expect(segmentCrossing([0, 0], [10, 0], [0, 1], [10, 1])).toBeNull();
  });
});

describe("Navmesh", () => {
  const m = new Navmesh(box);

  it("walkable = inside an area and outside every hole", () => {
    expect(m.contains([100, 100])).toBe(true);
    expect(m.contains([500, 500])).toBe(false);
    expect(m.contains([1100, 100])).toBe(false);
  });

  it("clips a walk at the first obstacle, strictly inside", () => {
    const q = m.clip([100, 500], [900, 500]);
    expect(q[0]).toBeLessThan(400);
    expect(q[0]).toBeGreaterThan(390);
    expect(m.contains(q)).toBe(true);
    expect(m.clip([100, 100], [900, 100])).toEqual([900, 100]);
  });

  it("clips at the island edge", () => {
    const q = m.clip([500, 100], [500, -500]);
    expect(q[1]).toBeGreaterThanOrEqual(0);
    expect(q[1]).toBeLessThan(10);
  });

  it("finds a path around a hole and every leg is walkable", () => {
    const a: Vec2 = [100, 500];
    const b: Vec2 = [900, 500];
    const path = m.findPath(a, b);
    expect(path).not.toBeNull();
    const p = path as Vec2[];
    expect(p[0]).toEqual(a);
    expect(p.at(-1)).toEqual(b);
    expect(p.length).toBeGreaterThan(2);
    for (let i = 0; i + 1 < p.length; i++) expect(m.segmentWalkable(p[i] as Vec2, p[i + 1] as Vec2)).toBe(true);
  });

  it("refuses unreachable targets and snaps taps on props to the nearest walkable point", () => {
    expect(m.findPath([100, 100], [500, 500])).toBeNull();
    const n = m.nearestWalkable([500, 450]);
    expect(n).not.toBeNull();
    expect(m.contains(n as Vec2)).toBe(true);
  });
});

describe("hub room data", () => {
  it.each(ROOMS)("%s navmesh is valid (spawns, doors reachable, int16)", (slug) => {
    const data = HUB_NAVMESHES[slug];
    expect(data.room).toBe(slug);
    expect(validateNavmesh(data)).toEqual([]);
  });

  it("every room door leads to a room that has a door back", () => {
    for (const slug of ROOMS) {
      for (const d of HUB_NAVMESHES[slug].doors) {
        if (d.kind !== "room") continue;
        const back = new Navmesh(HUB_NAVMESHES[d.target as keyof typeof HUB_NAVMESHES]).doorTo(slug);
        expect(back, `${slug} → ${d.target}`).toBeDefined();
      }
    }
  });

  it("plaza links all four satellite rooms and the walk from spawn to each door is pathable", () => {
    const plaza = new Navmesh(HUB_NAVMESHES.plaza);
    for (const target of ["pixel-arena", "seed-booth", "sky-docks", "daily-gate"]) {
      const door = plaza.doorTo(target);
      expect(door).toBeDefined();
      const path = plaza.findPath([0, 700], centroid(door?.area ?? []));
      expect(path).not.toBeNull();
    }
    expect(plaza.contains([0, 0])).toBe(false); // fountain
  });
});
