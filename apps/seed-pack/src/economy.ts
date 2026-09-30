import type { ChanceGameDefinition, GameSnapshot } from "@rarefriends/friendsdk/game";

/** Presentation tier of an outcome; drives reveal scale, sound and art. Never affects odds. */
export type Rarity = "common" | "uncommon" | "rare" | "legendary";

/** One published row of the odds table, all figures exact (bigint base units, integer bps). */
export type OddsRow = Readonly<{
  outcomeId: number;
  name: string;
  chanceBps: number;
  reward: bigint;
  /** reward × chanceBps / 10,000, exact to the base unit (rounded down once). */
  evContribution: bigint;
  rarity: Rarity;
}>;

const RF_DECIMALS = 18n;
const RF_UNIT = 10n ** RF_DECIMALS;

/** Exact RF string from 18-decimal base units: trims trailing zeros, keeps at least `minFraction` digits. */
export function formatRf(value: bigint, minFraction = 0): string {
  if (value < 0n) return `-${formatRf(-value, minFraction)}`;
  const whole = value / RF_UNIT;
  let fraction = (value % RF_UNIT).toString().padStart(Number(RF_DECIMALS), "0").replace(/0+$/, "");
  if (fraction.length < minFraction) fraction = fraction.padEnd(minFraction, "0");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Exact percentage from basis points with two decimals (5600 → "56.00"). */
export function formatBps(bps: number | bigint): string {
  const value = BigInt(bps);
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

/**
 * Rarity by rank of reward value: the top prize is legendary, then rare, then uncommon; the rest common.
 * Ranking (not fixed names) keeps the mapping valid if the tokenomics table changes.
 */
export function rarityOf(definition: ChanceGameDefinition, outcomeId: number): Rarity {
  const ranked = [...definition.outcomes.keys()].sort((a, b) => {
    const left = definition.outcomes[a]?.reward ?? 0n;
    const right = definition.outcomes[b]?.reward ?? 0n;
    return left === right ? 0 : left > right ? -1 : 1;
  });
  const rank = ranked.indexOf(outcomeId - 1);
  return rank === 0 ? "legendary" : rank === 1 ? "rare" : rank === 2 ? "uncommon" : "common";
}

/** The published odds table in outcome order. */
export function oddsTable(definition: ChanceGameDefinition): readonly OddsRow[] {
  return definition.outcomes.map((outcome, index) => ({
    outcomeId: index + 1,
    name: outcome.name,
    chanceBps: outcome.chanceBps,
    reward: outcome.reward,
    evContribution: (outcome.reward * BigInt(outcome.chanceBps)) / 10_000n,
    rarity: rarityOf(definition, index + 1),
  }));
}

/** Headline economy terms, all exact: EV per pack, return-to-player and house edge in bps. */
export function economyTerms(definition: ChanceGameDefinition) {
  const expected =
    definition.outcomes.reduce((sum, outcome) => sum + outcome.reward * BigInt(outcome.chanceBps), 0n) / 10_000n;
  const maxPrize = definition.outcomes.reduce((max, outcome) => (outcome.reward > max ? outcome.reward : max), 0n);
  const rtpBps = (expected * 10_000n) / definition.price;
  const atLeastPriceBps = definition.outcomes
    .filter((outcome) => outcome.reward >= definition.price)
    .reduce((sum, outcome) => sum + outcome.chanceBps, 0);
  return {
    price: definition.price,
    expected,
    maxPrize,
    rtpBps,
    edgeBps: 10_000n - rtpBps,
    /** Chance that one pack returns at least its price. */
    atLeastPriceBps,
  } as const;
}

/** Why a purchase of `quantity` packs is (not) possible right now, mirroring the SDK reserve rule. */
export function purchaseBlocker(
  definition: ChanceGameDefinition,
  snapshot: GameSnapshot,
  quantity = 1n,
): "funds" | "backing" | null {
  const { maxPrize } = economyTerms(definition);
  const cost = definition.price * quantity;
  if (snapshot.rfBalance < cost) return "funds";
  if (snapshot.freeStake < maxPrize || snapshot.freeStake + cost < maxPrize * quantity) return "backing";
  return null;
}

/** First play that was committed but never settled; it must be finished before a new opening. */
export function pendingPlay(snapshot: GameSnapshot) {
  return snapshot.plays.find((play) => play.outcomeId === null) ?? null;
}
