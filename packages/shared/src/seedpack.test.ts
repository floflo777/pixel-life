import {
  createGamePreview,
  expectedReward,
  maximumPrize,
  outcomeForRoll as sdkOutcomeForRoll,
  parseChanceGame,
} from "@rarefriends/friendsdk/game";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import gameJson from "../../../docs/design/tokenomics/game.json";
import { ECON } from "./economy.js";
import {
  canBuyWithFreeStake,
  chanceGameProblems,
  expectedRewardWei,
  GOLD_PIXEL_OUTCOME_ID,
  maxPrizeWei,
  outcomeForRoll,
  plantPixelsForOutcome,
  rtpBps,
  SEED_OUTCOME,
  SEED_PACK,
  seedPackPriceMicro,
} from "./seedpack.js";
import { snapshotFromDto, snapshotToDto } from "./protocol.js";

const RF = 10n ** 18n;

describe("SEED_PACK", () => {
  it("is exactly docs/design/tokenomics/game.json", () => {
    expect(SEED_PACK).toEqual(gameJson);
    expect(chanceGameProblems(SEED_PACK)).toEqual([]);
  });

  it("parses with the SDK and agrees on EV, max prize and rolls", () => {
    const def = parseChanceGame(SEED_PACK);
    expect(maxPrizeWei(SEED_PACK)).toBe(maximumPrize(def));
    expect(maxPrizeWei(SEED_PACK)).toBe(45n * RF);
    expect(expectedRewardWei(SEED_PACK)).toBe(expectedReward(def));
    expect(expectedRewardWei(SEED_PACK)).toBe(4_480_000_000_000_000_000n);
    expect(rtpBps(SEED_PACK)).toBe(8960);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 }), (roll) => {
        expect(outcomeForRoll(SEED_PACK, roll)).toBe(sdkOutcomeForRoll(def, roll));
      }),
    );
    expect(() => outcomeForRoll(SEED_PACK, 10_000)).toThrow(RangeError);
    expect(() => outcomeForRoll({ ...SEED_PACK, outcomes: [] }, 0)).toThrow(RangeError);
  });

  it("names outcomes and prices consistently with ECON", () => {
    expect(SEED_PACK.outcomes[GOLD_PIXEL_OUTCOME_ID - 1]?.name).toBe("Gold Pixel");
    expect(SEED_PACK.outcomes[SEED_OUTCOME.sprout - 1]?.name).toBe("Sprout");
    expect(seedPackPriceMicro()).toBe(ECON.seedPackPriceMicro);
    expect([1, 2, 3, 4, 5].map((id) => plantPixelsForOutcome(SEED_PACK, id))).toEqual([4, 12, 19, 108, 0]);
  });

  it("reserve rule matches the SDK preview ledger and the tokenomics parser check", async () => {
    expect(canBuyWithFreeStake(SEED_PACK, 50n * RF, 1)).toBe(true);
    expect(canBuyWithFreeStake(SEED_PACK, 50n * RF, 2)).toBe(false);
    expect(canBuyWithFreeStake(SEED_PACK, 3960n * RF, 99)).toBe(true);
    expect(canBuyWithFreeStake(SEED_PACK, 3959n * RF, 99)).toBe(false);
    expect(canBuyWithFreeStake(SEED_PACK, 10_000n * RF, 100)).toBe(false);
    expect(canBuyWithFreeStake(SEED_PACK, 10_000n * RF, 0)).toBe(false);
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: 0n, max: 5000n }), fc.integer({ min: 1, max: 99 }), async (stakeRf, q) => {
        const { client } = createGamePreview(parseChanceGame(SEED_PACK), { stake: stakeRf * RF, rfBalance: 0n });
        expect(canBuyWithFreeStake(SEED_PACK, stakeRf * RF, q)).toBe(await client.canBuy(BigInt(q)));
      }),
    );
  });

  it("snapshot codecs round-trip a real SDK preview snapshot", async () => {
    const { client: preview } = createGamePreview(parseChanceGame(SEED_PACK), {
      stake: 50n * RF,
      rfBalance: 20n * RF,
      friendId: 344030n,
      draw: () => 9999,
    });
    await preview.buy(1n);
    const [play] = await preview.play(1n);
    await preview.settle(play?.id ?? 1n);
    const snap = await preview.read();
    const dto = snapshotToDto(snap);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
    expect(dto.inventory).toEqual(["0", "0", "0", "1"]);
    expect(snapshotFromDto(dto)).toEqual({
      ...snap,
      inventory: [...snap.inventory],
      plays: snap.plays.map((p) => ({ ...p })),
    });
  });
});

describe("chanceGameProblems", () => {
  it("reports every structural problem the SDK parser would reject", () => {
    expect(
      chanceGameProblems({
        name: " ",
        consumable: "",
        price: "0",
        outcomes: [
          { name: "", chanceBps: 0, reward: "x" },
          { name: "a", chanceBps: 5000, reward: "0" },
        ],
      }),
    ).toEqual([
      "name and consumable are required",
      "price must be a positive wei string",
      "outcome 1 needs a name",
      "outcome 1 chance must be 1..10000 bps",
      "outcome 1 reward must be a wei string",
      "chances must total 10000 bps",
      "at least one prize is required",
    ]);
    expect(chanceGameProblems({ ...SEED_PACK, outcomes: [] })).toContain("at least one outcome is required");
  });
});
