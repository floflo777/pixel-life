import { Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import {
  GLOW_COLORS,
  GLOW_TINTS,
  HALO_COLORS,
  HALO_TINTS,
  inheritTag,
  readTag,
  tagCode,
  tagGlow,
  tagHalo,
  untagged,
} from "./tags";

describe("post tags", () => {
  it("packs halo and glow indices", () => {
    expect(tagCode(undefined)).toEqual([0, 0]);
    expect(tagCode({ halo: "lilac" })).toEqual([HALO_TINTS.lilac, 0]);
    expect(tagCode({ halo: "halo", glow: "gold" })).toEqual([HALO_TINTS.halo, GLOW_TINTS.gold]);
    expect(tagCode({ none: true, halo: "sun" })).toEqual([0, 0]);
  });

  it("keeps every index inside the shader's 8-slot tables", () => {
    for (const i of Object.values(HALO_TINTS)) expect(i).toBeLessThan(HALO_COLORS.length);
    for (const i of Object.values(GLOW_TINTS)) expect(i).toBeLessThan(GLOW_COLORS.length);
    expect(HALO_COLORS).toHaveLength(8);
    expect(GLOW_COLORS).toHaveLength(8);
  });

  it("merges tags and undoes them", () => {
    const g = new Group();
    const undoHalo = tagHalo(g, "coral");
    const undoGlow = tagGlow(g, "gold");
    expect(readTag(g)).toEqual({ halo: "coral", glow: "gold" });
    undoGlow();
    expect(readTag(g)).toEqual({ halo: "coral" });
    undoHalo();
    expect(readTag(g)).toBeUndefined();
  });

  it("inherits down the tree unless a child opts out", () => {
    const parent = { halo: "halo" } as const;
    expect(inheritTag(parent, undefined)).toEqual(parent);
    expect(inheritTag(parent, { glow: "gold" })).toEqual({ halo: "halo", glow: "gold" });
    const m = new Mesh();
    untagged(m);
    expect(inheritTag(parent, readTag(m))).toBeUndefined();
  });
});
