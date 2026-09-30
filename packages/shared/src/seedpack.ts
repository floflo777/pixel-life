/**
 * The Seed Pack: Pixel Life's single chance game, as FriendSDK `ChanceGameDefinition` JSON (18-decimal wei strings).
 *
 * `SEED_PACK` is byte-for-byte the table in docs/design/tokenomics/game.json, kept as JSON-shaped data so it can be fed
 * to SDK `parseChanceGame()` and served to the sandboxed venue unchanged. Helpers mirror the SDK's bigint maths.
 */
import { BPS, ECON, plantPixels, weiToMicro } from "./economy.js";

/** One outcome row in the SDK's reviewable JSON format. */
export interface ChanceOutcomeJson {
  readonly name: string;
  readonly chanceBps: number;
  /** Fixed RF redemption value, decimal wei string. */
  readonly reward: string;
}

/** A chance game in the SDK's reviewable JSON format (`parseChanceGame` input). */
export interface ChanceGameJson {
  readonly name: string;
  readonly consumable: string;
  /** Price per consumable, decimal wei string. */
  readonly price: string;
  readonly outcomes: readonly ChanceOutcomeJson[];
}

/** The Seed Pack definition (tokenomics §3). Outcome ids are 1-based in table order, as in the SDK contract. */
export const SEED_PACK: ChanceGameJson = Object.freeze({
  name: "Pixel Life: Seed Pack",
  consumable: "Seed Pack",
  price: "5000000000000000000",
  outcomes: Object.freeze([
    Object.freeze({ name: "Sprout", chanceBps: 5600, reward: "2000000000000000000" }),
    Object.freeze({ name: "Bloom", chanceBps: 3000, reward: "5000000000000000000" }),
    Object.freeze({ name: "Full Bloom", chanceBps: 1200, reward: "8000000000000000000" }),
    Object.freeze({ name: "Gold Pixel", chanceBps: 200, reward: "45000000000000000000" }),
  ]),
});

/** SDK outcome ids (1-based) of the Seed Pack table. */
export const SEED_OUTCOME = Object.freeze({ sprout: 1, bloom: 2, fullBloom: 3, goldPixel: 4 } as const);

/** The Gold Pixel's outcome id: its held balance drives the regrowth perk (`balanceOf(tba, 4)`). */
export const GOLD_PIXEL_OUTCOME_ID = SEED_OUTCOME.goldPixel;

const WEI_RE = /^[0-9]+$/;

/**
 * Structural check mirroring SDK `parseChanceGame`/`defineChanceGame`: names non-blank, >= 1 outcome, integer chances
 * 1..10000 summing to 10000, wei strings, price > 0 and at least one prize. Returns the list of problems (empty = valid).
 */
export function chanceGameProblems(g: ChanceGameJson): string[] {
  const problems: string[] = [];
  if (!g.name.trim() || !g.consumable.trim()) problems.push("name and consumable are required");
  if (!WEI_RE.test(g.price) || BigInt(g.price) === 0n) problems.push("price must be a positive wei string");
  if (g.outcomes.length === 0) problems.push("at least one outcome is required");
  let total = 0;
  let prizes = 0;
  g.outcomes.forEach((o, i) => {
    if (!o.name.trim()) problems.push(`outcome ${i + 1} needs a name`);
    if (!Number.isInteger(o.chanceBps) || o.chanceBps < 1 || o.chanceBps > BPS) {
      problems.push(`outcome ${i + 1} chance must be 1..10000 bps`);
    }
    if (!WEI_RE.test(o.reward)) problems.push(`outcome ${i + 1} reward must be a wei string`);
    else if (BigInt(o.reward) > 0n) prizes++;
    total += o.chanceBps;
  });
  if (total !== BPS) problems.push("chances must total 10000 bps");
  if (prizes === 0) problems.push("at least one prize is required");
  return problems;
}

/** The largest reward (wei), which the SDK reserves per purchased pack (`maximumPrize`). */
export function maxPrizeWei(g: ChanceGameJson): bigint {
  return g.outcomes.reduce((m, o) => (BigInt(o.reward) > m ? BigInt(o.reward) : m), 0n);
}

/** Expected reward per pack in wei, rounded down once (same as SDK `expectedReward`). */
export function expectedRewardWei(g: ChanceGameJson): bigint {
  return g.outcomes.reduce((sum, o) => sum + BigInt(o.reward) * BigInt(o.chanceBps), 0n) / BigInt(BPS);
}

/** Return-to-player in bps, rounded down (Seed Pack: 8960 = 89.6 %). */
export function rtpBps(g: ChanceGameJson): number {
  return Number((expectedRewardWei(g) * BigInt(BPS)) / BigInt(g.price));
}

/** One-based outcome id for a uniform roll in [0, 10000), identical to SDK `outcomeForRoll`. */
export function outcomeForRoll(g: ChanceGameJson, roll: number): number {
  if (!Number.isInteger(roll) || roll < 0 || roll >= BPS)
    throw new RangeError("Roll must be an integer from 0 to 9999.");
  let boundary = 0;
  for (let i = 0; i < g.outcomes.length; i++) {
    boundary += g.outcomes[i]?.chanceBps ?? 0;
    if (roll < boundary) return i + 1;
  }
  throw new RangeError("Invalid outcome table.");
}

/**
 * SDK reserve rule for buying `quantity` packs given the house's free stake: `free >= maxPrize` and
 * `free + quantity * price >= quantity * maxPrize` (tokenomics §3; `createGamePreview.canBuy`). Quantity is 1..99.
 */
export function canBuyWithFreeStake(g: ChanceGameJson, freeStakeWei: bigint, quantity: number): boolean {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return false;
  const max = maxPrizeWei(g);
  const q = BigInt(quantity);
  return freeStakeWei >= max && freeStakeWei + q * BigInt(g.price) >= q * max;
}

/** Pixels planting a redeemed outcome regrows (Sprout 4, Bloom 12, Full Bloom 19); 0 for an unknown id. */
export function plantPixelsForOutcome(g: ChanceGameJson, outcomeId: number): number {
  const o = g.outcomes[outcomeId - 1];
  return o ? plantPixels(weiToMicro(o.reward)) : 0;
}

/** Seed Pack price in micro-RF, cross-checked against `ECON.seedPackPriceMicro`. */
export function seedPackPriceMicro(g: ChanceGameJson = SEED_PACK): number {
  return weiToMicro(g.price);
}

// Keep the RF-denominated constant and the SDK table from drifting apart.
if (seedPackPriceMicro(SEED_PACK) !== ECON.seedPackPriceMicro) throw new Error("Seed Pack price drifted from ECON.");
