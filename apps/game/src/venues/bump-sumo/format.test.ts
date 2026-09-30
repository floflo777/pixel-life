import { BITS, familyIdFromName, type FamilyName, type FriendAppearance } from "@pl/shared";
import { describe, expect, it } from "vitest";
import { buildSumoResults, fighterLabel, ordinal, pickRivals, roundEndBanner, sumoPlan } from "./format";

function friend(tokenId: string, family: FamilyName): FriendAppearance {
  return { tokenId, familyId: familyIdFromName(family), seed: 0, frames: [] };
}

const POOL = [
  friend("344030", "Mask"),
  friend("63675", "Skeleton"),
  friend("65058", "Family"),
  friend("344034", "Cellular"),
  friend("65042", "Hoverer"),
  friend("63713", "Mask"),
];

describe("pickRivals", () => {
  it("never picks the player, prefers distinct families and is seed-deterministic", () => {
    for (let seed = 1; seed < 40; seed++) {
      const r = pickRivals(POOL, "344030", seed);
      expect(r.map((a) => a.tokenId)).not.toContain("344030");
      expect(new Set(r.map((a) => a.familyId)).size).toBe(3);
      expect(pickRivals(POOL, "344030", seed)).toEqual(r);
    }
    const all = new Set<string>();
    for (let seed = 1; seed < 40; seed++) for (const a of pickRivals(POOL, "344030", seed)) all.add(a.tokenId);
    expect(all.size).toBeGreaterThan(3);
  });

  it("falls back to repeated families and refuses a pool that is too small", () => {
    const masks = [friend("1", "Mask"), friend("2", "Mask"), friend("3", "Mask")];
    expect(pickRivals(masks, "9", 3)).toHaveLength(3);
    expect(() => pickRivals(masks, "1", 3)).toThrow(RangeError);
    expect(() => pickRivals([...masks, masks[0] as FriendAppearance], "1", 3)).toThrow(RangeError);
  });
});

describe("Bump Sumo presentation", () => {
  it("labels fighters with family and sumo trait", () => {
    expect(fighterLabel(0, friend("1", "Colossus"))).toEqual({ name: "you", family: "colossus", trait: "quake" });
    expect(fighterLabel(2, friend("65042", "Hoverer")).name).toBe("#65042");
  });

  it("scales juice with power and saves impact frames for the player's own beats", () => {
    const weak = sumoPlan({ kind: "hit", power: 0.1, mine: false });
    const full = sumoPlan({ kind: "hit", power: 1, mine: true });
    expect(full.hitStopMs ?? 0).toBeGreaterThan(weak.hitStopMs ?? 0);
    expect(full.impactFrames).toBe(2);
    expect(weak.impactFrames).toBeUndefined();
    expect(sumoPlan({ kind: "hit", power: 1, mine: false }).impactFrames).toBeUndefined();
    expect(sumoPlan({ kind: "ringout", mine: true }).impactFrames).toBe(2);
    expect(sumoPlan({ kind: "ringout", mine: false }).impactFrames).toBeUndefined();
  });

  it("writes round banners and ordinals", () => {
    expect(roundEndBanner(0, 0).tone).toBe("lime");
    expect(roundEndBanner(2, 1).tone).toBe("coral");
    expect(roundEndBanner(-1, 1).text).toBe("nobody stands!");
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
    ]);
  });

  it("builds a scarless results card with the full-skill Bits estimate", () => {
    const r = buildSumoResults({ place: 1, wins: 2, kos: 3, grabbed: 4, knockedOff: 6, ringouts: 1 }, 1240);
    expect(r.headline).toBe("yokozuna!");
    expect(r.bitsEstimate).toBe(BITS.runBase + BITS.runSkillMax);
    expect(
      buildSumoResults({ place: 3, wins: 0, kos: 0, grabbed: 0, knockedOff: 0, ringouts: 3 }, 0, true).bitsEstimate,
    ).toBe(BITS.runBase + BITS.runSkillMax + BITS.firstRunOfDay);
    expect(r.stats.find(([k]) => k === "rounds won")?.[1]).toBe("2/3");
    expect(r.scarNote).toMatch(/scarless/);
  });
});
