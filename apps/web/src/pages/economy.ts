/**
 * Page-level economy helpers: split parts for the diagrams, the Gold Pixel market fee maths (tokenomics §6, contract
 * `GoldPixelMarket.sol`) and the Seed Pack figures the odds page shows. Prices come from `ECON` / `SEED_PACK` in
 * `@pl/shared`; the few numbers that live only in tokenomics.md are named constants here with their source.
 */
import {
  BPS,
  ECON,
  type EconomyQuote,
  expectedRewardWei,
  MARKET,
  marketSplit,
  maxPrizeWei,
  rtpBps,
  SEED_PACK,
  seedPackPriceMicro,
  weiToMicro,
} from "@pl/shared";
import type { SplitPart } from "../ui/index.js";

/** Split parts of a quote (exact micro amounts). Regrow: burn + stream. Mend: burn + to the target Friend's wallet. */
export function quoteParts(q: EconomyQuote): SplitPart[] {
  const pct = (m: number): number => (q.totalMicro === 0 ? 0 : Math.round((m * BPS) / q.totalMicro));
  if (q.action.kind === "regrow") {
    const burnBps = pct(q.burnMicro);
    return [
      { label: "burned", kind: "burn", bps: burnBps, micro: q.burnMicro },
      { label: "active-Friends stream", kind: "stream", bps: BPS - burnBps, micro: q.streamMicro },
    ];
  }
  const burnBps = pct(q.burnMicro);
  return [
    { label: "burned", kind: "burn", bps: burnBps, micro: q.burnMicro },
    { label: `to #${q.action.target}'s wallet`, kind: "friend", bps: BPS - burnBps, micro: q.toTargetMicro },
  ];
}

/** Regrow split as percentages only (for the economy page). */
export const REGROW_PARTS: readonly SplitPart[] = [
  { label: "burned", kind: "burn", bps: ECON.burnBps },
  { label: "active-Friends stream", kind: "stream", bps: ECON.streamBps },
];

/** Mend split as percentages only. */
export const MEND_PARTS: readonly SplitPart[] = [
  { label: "burned", kind: "burn", bps: ECON.burnBps },
  { label: "to the mended Friend's wallet", kind: "friend", bps: ECON.targetBps },
];

// ── Gold Pixel market (tokenomics §6; simulated in the MVP). Fees come from `MARKET` in @pl/shared, like the server. ──

/** Seller's share after fees (95 %). */
export const MARKET_SELLER_BPS = BPS - MARKET.feeBps;

/** A Gold Pixel's backing (its fixed redemption value): the practical market floor. */
export const GOLD_FLOOR_MICRO = MARKET.backingMicro;

/** Split parts of a market sale; with a price, amounts are exact (the shared `marketSplit`, as the server charges). */
export function marketParts(priceMicro?: number, originTokenId?: string): SplitPart[] {
  const s = priceMicro === undefined ? null : marketSplit(priceMicro);
  const m = (v: number | undefined): { micro?: number } => (v === undefined ? {} : { micro: v });
  return [
    { label: "seller", kind: "seller", bps: MARKET_SELLER_BPS, ...m(s?.toSellerMicro) },
    { label: "burned", kind: "burn", bps: MARKET.burnBps, ...m(s?.burnedMicro) },
    {
      label: originTokenId ? `royalty to origin #${originTokenId}` : "royalty to the origin Friend",
      kind: "friend",
      bps: MARKET.originBps,
      ...m(s?.toOriginMicro),
    },
    { label: "game creator", kind: "creator", bps: MARKET.creatorBps, ...m(s?.toCreatorMicro) },
  ];
}

// ── Seed Pack figures (tokenomics §3) ──

/** Initial ChanceGame stake and weekly sweep target (tokenomics §3.1). */
export const SEED_BANKROLL_MICRO = 10_000_000_000;

/** Everything the odds table shows, derived from the SDK JSON so it can never drift from what is deployed. */
export function seedPackFacts() {
  const price = seedPackPriceMicro(SEED_PACK);
  const ev = weiToMicro(expectedRewardWei(SEED_PACK));
  const max = weiToMicro(maxPrizeWei(SEED_PACK));
  const rows = SEED_PACK.outcomes.map((o, i) => {
    const reward = weiToMicro(o.reward);
    return {
      id: i + 1,
      name: o.name,
      chanceBps: o.chanceBps,
      rewardMicro: reward,
      evMicro: Math.floor((reward * o.chanceBps) / BPS),
    };
  });
  const moneyBackBps = rows.filter((r) => r.rewardMicro >= price).reduce((s, r) => s + r.chanceBps, 0);
  return {
    price,
    ev,
    max,
    rtpBps: rtpBps(SEED_PACK),
    edgeMicro: price - ev,
    /** Free stake each in-flight pack needs (max prize − price). */
    reservePerPackMicro: max - price,
    moneyBackBps,
    rows,
  };
}
