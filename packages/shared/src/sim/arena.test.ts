import { describe, expect, it } from "vitest";
import { Island } from "./arena.js";
import { degToAngle } from "./fixed-math.js";
import { ARENAS, GULP_WEDGE_INNER, SPAWN_SLOTS } from "./tuning.js";

describe("Island", () => {
  it("is the GDD meadow ellipse with a fall-off edge", () => {
    const isl = new Island("meadow");
    expect([isl.a, isl.b]).toEqual([36, 24]);
    expect(isl.contains(0, 0)).toBe(true);
    expect(isl.contains(35, 0)).toBe(true);
    expect(isl.contains(37.5, 0)).toBe(false);
    expect(isl.edgeDistance(40, 0)).toBeCloseTo(4, 0);
    expect(isl.edgeDistance(0, 23)).toBeLessThan(0);
    expect(isl.edgeDistance(0, 26)).toBeGreaterThan(1);
    expect(isl.bumpers).toHaveLength(ARENAS.meadow?.bumpers ?? 0);
    expect(isl.slots).toHaveLength(SPAWN_SLOTS);
    for (const s of isl.slots) expect(isl.contains(s.x, s.z)).toBe(true);
  });

  it("knows every arena and rejects unknown ones", () => {
    for (const name of Object.keys(ARENAS)) expect(new Island(name).name).toBe(name);
    expect(() => new Island("lava")).toThrow(RangeError);
    expect(() => new Island("toString")).toThrow(RangeError);
    expect(new Island("pond").inPond(0, 0)).toBe(true);
    expect(new Island("meadow").inPond(0, 0)).toBe(false);
  });

  it("points outward toward the nearest rim", () => {
    const isl = new Island("meadow");
    const o = { x: 0, z: 0 };
    isl.outward(o, 10, 0);
    expect(o).toEqual({ x: 1, z: 0 });
    isl.outward(o, 0, -3);
    expect(o.z).toBe(-1);
  });

  it("bites out the outer part of Gulp's wedge and regrows it", () => {
    const isl = new Island("meadow");
    isl.setWedge(0, degToAngle(45));
    expect(isl.wedgeShadow).toBe(true);
    expect(isl.contains(30, 0)).toBe(true);
    isl.biteWedge();
    expect(isl.contains(30, 0)).toBe(false);
    expect(isl.contains(36 * GULP_WEDGE_INNER - 2, 0)).toBe(true);
    expect(isl.contains(0, 0)).toBe(true);
    expect(isl.contains(-30, 0)).toBe(true);
    expect(isl.contains(5, 20)).toBe(true);
    expect(isl.bumpers.some((b) => !b.active)).toBe(true);
    const p = { x: 1, z: 1 };
    isl.respawnPoint(p);
    expect(p).toEqual({ x: 0, z: 0 });
    isl.clearWedge();
    expect(isl.contains(30, 0)).toBe(true);
    expect(isl.bumpers.every((b) => b.active)).toBe(true);
  });
});
