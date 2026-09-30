import { describe, expect, it } from "vitest";
import { createGamePreview, expectedReward, parseChanceGame, RF } from "@rarefriends/friendsdk/game";
import gameJson from "../game.json";
import { PALETTE, SPRITES } from "../src/art";
import { economyTerms, formatBps, formatRf, oddsTable, pendingPlay, purchaseBlocker, rarityOf } from "../src/economy";

const definition = parseChanceGame(gameJson);

describe("formatting", () => {
  it("formats RF base units exactly", () => {
    expect(formatRf(5n * RF)).toBe("5");
    expect(formatRf(4_480_000_000_000_000_000n, 2)).toBe("4.48");
    expect(formatRf(1_120_000_000_000_000_000n, 2)).toBe("1.12");
    expect(formatRf(900_000_000_000_000_000n, 2)).toBe("0.90");
    expect(formatRf(1n)).toBe("0.000000000000000001");
    expect(formatRf(0n)).toBe("0");
    expect(formatRf(-2n * RF)).toBe("-2");
  });
  it("formats basis points as exact percentages", () => {
    expect(formatBps(5600)).toBe("56.00");
    expect(formatBps(200)).toBe("2.00");
    expect(formatBps(8960n)).toBe("89.60");
    expect(formatBps(1)).toBe("0.01");
  });
});

describe("published odds", () => {
  it("lists every outcome with its exact chance, value and EV share", () => {
    expect(
      oddsTable(definition).map((row) => [
        row.name,
        row.chanceBps,
        formatRf(row.reward),
        formatRf(row.evContribution, 2),
        row.rarity,
      ]),
    ).toEqual([
      ["Sprout", 5600, "2", "1.12", "common"],
      ["Bloom", 3000, "5", "1.50", "uncommon"],
      ["Full Bloom", 1200, "8", "0.96", "rare"],
      ["Gold Pixel", 200, "45", "0.90", "legendary"],
    ]);
  });
  it("matches tokenomics §3: EV 4.48 RF, RTP 89.6 %, edge 10.4 %, 44 % price back, max prize 45 RF", () => {
    const terms = economyTerms(definition);
    expect(terms.expected).toBe(expectedReward(definition));
    expect(formatRf(terms.expected)).toBe("4.48");
    expect(terms.rtpBps).toBe(8960n);
    expect(terms.edgeBps).toBe(1040n);
    expect(terms.atLeastPriceBps).toBe(4400);
    expect(terms.maxPrize).toBe(45n * RF);
  });
  it("ranks rarity by reward, so the top prize is always the hero reveal", () => {
    expect(rarityOf(definition, 4)).toBe("legendary");
    const shuffled = parseChanceGame({ ...gameJson, outcomes: [...gameJson.outcomes].reverse() });
    expect(rarityOf(shuffled, 1)).toBe("legendary");
    expect(rarityOf(shuffled, 4)).toBe("common");
  });
});

describe("purchase rules mirror the SDK reserve rule", () => {
  it("blocks on funds, then on backing, and agrees with canBuy", async () => {
    const poor = createGamePreview(definition, { stake: 450n * RF, rfBalance: 4n * RF }).client;
    expect(purchaseBlocker(definition, await poor.read())).toBe("funds");
    const unbacked = createGamePreview(definition, { stake: 44n * RF, rfBalance: 20n * RF }).client;
    expect(purchaseBlocker(definition, await unbacked.read())).toBe("backing");
    expect(await unbacked.canBuy(1n)).toBe(false);
    const ok = createGamePreview(definition, { stake: 450n * RF, rfBalance: 20n * RF }).client;
    expect(purchaseBlocker(definition, await ok.read())).toBeNull();
    expect(await ok.canBuy(1n)).toBe(true);
  });
  it("finds an unsettled play to resume", async () => {
    const { client } = createGamePreview(definition, { stake: 450n * RF, rfBalance: 20n * RF, draw: () => 0 });
    await client.buy(1n);
    const [play] = await client.play(1n);
    expect(pendingPlay(await client.read())?.id).toBe(play?.id);
    await client.settle(play?.id ?? 0n);
    expect(pendingPlay(await client.read())).toBeNull();
  });
});

describe("sprites", () => {
  it("are 16×16 and only use palette colours", () => {
    for (const [name, rows] of Object.entries(SPRITES)) {
      expect(rows, name).toHaveLength(16);
      for (const row of rows) {
        expect(row, name).toHaveLength(16);
        for (const cell of row) expect(cell === "." || cell in PALETTE, `${name}: ${cell}`).toBe(true);
      }
    }
  });
  it("reserve gold for the Gold Pixel", () => {
    for (const [name, rows] of Object.entries(SPRITES)) {
      if (name === "goldPixel") continue;
      expect(rows.join("").includes("o"), name).toBe(false);
    }
  });
});
