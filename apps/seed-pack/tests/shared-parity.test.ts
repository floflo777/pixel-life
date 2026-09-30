/**
 * The sandboxed SDK child cannot import @pl/shared (the FriendSDK checker rejects sources outside the game dir),
 * so game.json and src/rules.ts are copies. These tests fail as soon as either drifts from the source of truth.
 */
import { describe, expect, it } from "vitest";
import {
  ECON,
  SEED_OUTCOME,
  SEED_PACK,
  expectedRewardWei,
  maxPrizeWei,
  plantPixelsForOutcome,
  rtpBps,
} from "@pl/shared";
import { parseChanceGame } from "@rarefriends/friendsdk/game";
import gameJson from "../game.json";
import { economyTerms } from "../src/economy";
import { GOLD_REGROWTH_BONUS_BPS, GOLD_REGROWTH_MAX_COUNT, PLANT_PX, goldMultiplierText } from "../src/rules";

describe("parity with @pl/shared", () => {
  it("game.json is exactly SEED_PACK (and so docs/design/tokenomics/game.json)", () => {
    expect(gameJson).toEqual(SEED_PACK);
  });

  it("headline terms agree with the shared maths", () => {
    const terms = economyTerms(parseChanceGame(gameJson));
    expect(terms.expected).toBe(expectedRewardWei(SEED_PACK));
    expect(terms.maxPrize).toBe(maxPrizeWei(SEED_PACK));
    expect(Number(terms.rtpBps)).toBe(rtpBps(SEED_PACK));
  });

  it("plant pixels shown in the reveal match plantPixelsForOutcome", () => {
    for (const id of [SEED_OUTCOME.sprout, SEED_OUTCOME.bloom, SEED_OUTCOME.fullBloom]) {
      expect(PLANT_PX[id], `outcome ${id}`).toBe(plantPixelsForOutcome(SEED_PACK, id));
    }
    expect(PLANT_PX[SEED_OUTCOME.goldPixel]).toBeUndefined();
  });

  it("Gold Pixel perk copy matches ECON", () => {
    expect(GOLD_REGROWTH_BONUS_BPS).toBe(ECON.goldRegrowthBonusBps);
    expect(GOLD_REGROWTH_MAX_COUNT).toBe(ECON.goldRegrowthMaxCount);
    expect(goldMultiplierText()).toBe("1.25");
  });
});
