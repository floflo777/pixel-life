/**
 * The simulated Gold Pixel market (tokenomics §6, phase 1; contract spec `contracts/src/GoldPixelMarket.sol`).
 *
 * SIMULATED: in the MVP the market runs on the server's simulated ledger (`ECONOMY_MODE=sim`). No RF moves on chain.
 * A listed Gold Pixel is escrowed out of the seller Friend's Seed Pack inventory (so its regrowth perk ends while
 * listed) and a buy moves it into the buyer's inventory, where it stays fully backed (redeemable for 45 RF).
 *
 * Fees mirror the contract to the wei: 5 % of the price, 2 % burned, 2 % to the origin Friend (the one that grew the
 * Gold), 1 % to the game creator, each rounded down, the rest (and any dust) to the seller. Prices are whole
 * `MARKET.tickMicro` steps, which makes every fee an exact integer both in micro-RF and in wei.
 */
import { z } from "zod";
import { BPS, type EconomyMode, MICRO_PER_RF, WEI_PER_MICRO, weiToMicro } from "./economy.js";
import type { TokenIdStr } from "./ids.js";
import { GOLD_PIXEL_OUTCOME_ID, SEED_PACK } from "./seedpack.js";

const goldReward = SEED_PACK.outcomes[GOLD_PIXEL_OUTCOME_ID - 1]?.reward;
if (goldReward === undefined) throw new Error("The Seed Pack table has no Gold Pixel outcome.");

/** Market rules as data. Fee bps are the contract's constants (`BURN_BPS`, `ORIGIN_BPS`, `CREATOR_BPS`). */
export const MARKET = Object.freeze({
  /** Share of the price burned. */
  burnBps: 200,
  /** Share of the price paid to the origin Friend's wallet (the Friend that grew the Gold). */
  originBps: 200,
  /** Share of the price paid to the game creator. */
  creatorBps: 100,
  /** Total fee (the three shares above). */
  feeBps: 500,
  /** Backing of one Gold Pixel (its fixed Seed Pack redemption value, micro-RF): the practical price floor. */
  backingMicro: weiToMicro(goldReward),
  /** Lowest accepted ask: the backing. Below it a seller would simply redeem the Gold instead. */
  minPriceMicro: weiToMicro(goldReward),
  /** Highest accepted ask (a fat-finger guard, not an economic rule). */
  maxPriceMicro: 10_000 * MICRO_PER_RF,
  /** Price granularity: 0.01 RF. Keeps every bps share an exact integer in micro-RF and in wei. */
  tickMicro: 10_000,
  /** Open asks shown in the order book. */
  bookDepth: 50,
  /** Fills shown in the order book's recent trades. */
  recentFills: 20,
  /** Volume window of the order book stats. */
  volumeWindowMs: 24 * 60 * 60 * 1000,
} as const);

if (MARKET.burnBps + MARKET.originBps + MARKET.creatorBps !== MARKET.feeBps || MARKET.feeBps >= BPS) {
  throw new Error("Market fee shares must add up to the fee, below 100 %.");
}
if ((MARKET.tickMicro * MARKET.burnBps) % BPS !== 0 || (MARKET.tickMicro * MARKET.creatorBps) % BPS !== 0) {
  throw new Error("The price tick must make every fee share exact.");
}
if (MARKET.minPriceMicro % MARKET.tickMicro !== 0 || MARKET.maxPriceMicro % MARKET.tickMicro !== 0) {
  throw new Error("Price bounds must be whole ticks.");
}

/** A sale's split (micro-RF). Guarantees `burned + toOrigin + toCreator + toSeller === price`, all >= 0. */
export interface MarketSplit {
  readonly priceMicro: number;
  readonly burnedMicro: number;
  readonly toOriginMicro: number;
  readonly toCreatorMicro: number;
  readonly toSellerMicro: number;
}

const share = (price: number, bps: number) => Math.floor((price * bps) / BPS);

/**
 * Splits a sale price exactly like `GoldPixelMarket.fees`: each fee rounds down, the seller gets the rest. Accepts any
 * non-negative safe integer whose bps products stay exact (price <= 2^53 / BPS); throws `RangeError` otherwise.
 */
export function marketSplit(priceMicro: number): MarketSplit {
  if (!Number.isSafeInteger(priceMicro) || priceMicro < 0 || priceMicro > Number.MAX_SAFE_INTEGER / BPS) {
    throw new RangeError("Price must be a non-negative safe integer of micro-RF.");
  }
  const burnedMicro = share(priceMicro, MARKET.burnBps);
  const toOriginMicro = share(priceMicro, MARKET.originBps);
  const toCreatorMicro = share(priceMicro, MARKET.creatorBps);
  return {
    priceMicro,
    burnedMicro,
    toOriginMicro,
    toCreatorMicro,
    toSellerMicro: priceMicro - burnedMicro - toOriginMicro - toCreatorMicro,
  };
}

/** The contract's `fees(price)` over 18-decimal wei, for parity checks against a live deployment. */
export function marketSplitWei(priceWei: bigint): {
  burned: bigint;
  toOrigin: bigint;
  toCreator: bigint;
  toSeller: bigint;
} {
  if (priceWei < 0n) throw new RangeError("Price must be non-negative.");
  const bps = BigInt(BPS);
  const burned = (priceWei * BigInt(MARKET.burnBps)) / bps;
  const toOrigin = (priceWei * BigInt(MARKET.originBps)) / bps;
  const toCreator = (priceWei * BigInt(MARKET.creatorBps)) / bps;
  return { burned, toOrigin, toCreator, toSeller: priceWei - burned - toOrigin - toCreator };
}

/** Why an ask price is refused. */
export type MarketPriceProblem = "not_integer" | "below_min" | "above_max" | "off_tick";

/** Validates an ask: a safe integer in [min, max] on the 0.01 RF tick. Returns null when acceptable. */
export function marketPriceProblem(priceMicro: number): MarketPriceProblem | null {
  if (!Number.isSafeInteger(priceMicro)) return "not_integer";
  if (priceMicro < MARKET.minPriceMicro) return "below_min";
  if (priceMicro > MARKET.maxPriceMicro) return "above_max";
  if (priceMicro % MARKET.tickMicro !== 0) return "off_tick";
  return null;
}

/** `priceMicro` as 18-decimal wei (exact; the market's on-chain price unit). */
export function marketPriceWei(priceMicro: number): bigint {
  return BigInt(priceMicro) * WEI_PER_MICRO;
}

// ── Wire types ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Market event log entries, mirroring the contract events `Listed(leafId, seller, price)`, `Cancelled(leafId, seller)`
 * and `Sold(leafId, originFriendId, buyer, seller, price, burned, toOrigin, toCreator)`. In the simulation the
 * parties are Friends (their token ids stand for their wallets) and amounts are micro-RF.
 */
export type MarketEvent =
  | { kind: "Listed"; leafId: number; seller: TokenIdStr; priceMicro: number; at: number }
  | { kind: "Cancelled"; leafId: number; seller: TokenIdStr; at: number }
  | {
      kind: "Sold";
      leafId: number;
      originFriendId: TokenIdStr;
      buyer: TokenIdStr;
      seller: TokenIdStr;
      priceMicro: number;
      burnedMicro: number;
      toOriginMicro: number;
      toCreatorMicro: number;
      at: number;
    };

/** A completed sale with the seller's proceeds (`price − burned − toOrigin − toCreator`). */
export type MarketFill = Extract<MarketEvent, { kind: "Sold" }> & { toSellerMicro: number };

/** An open fixed-price ask for one Gold Pixel ("Gold Leaf"), escrowed by the market. */
export interface MarketListing {
  leafId: number;
  /** The Friend that grew this Gold (receives the 2 % origin royalty on every sale). */
  originFriendId: TokenIdStr;
  seller: TokenIdStr;
  priceMicro: number;
  listedAt: number;
}

/** `GET /api/market/book`: open asks (cheapest first), recent fills and 24 h stats. Always simulated in the MVP. */
export interface MarketBookRes {
  mode: EconomyMode;
  simulated: true;
  /** Cheapest open ask, or null when nothing is listed. */
  floorMicro: number | null;
  /** Backing per Gold (the practical floor). */
  backingMicro: number;
  listings: MarketListing[];
  openListings: number;
  recentFills: MarketFill[];
  volume24hMicro: number;
  fills24h: number;
  burned24hMicro: number;
  lastPriceMicro: number | null;
}

/** `GET /api/market/mine`: the bound Friend's Golds and asks. */
export interface MarketMineRes {
  simulated: true;
  tokenId: TokenIdStr;
  /** Gold Pixels in the Friend's inventory right now (the regrowth perk counts these, D-13). */
  goldHeld: number;
  /** Held Golds bought on the market (relist them by `leafId`); the rest were grown by this Friend. */
  boughtLeafIds: number[];
  listings: MarketListing[];
  /** Royalties earned as an origin Friend, all time (micro-RF). */
  royaltiesMicro: number;
}

/** `POST /api/market/list`: escrow one Gold and ask `priceMicro`. Omit `leafId` to list a Gold this Friend grew. */
export interface MarketListReq {
  priceMicro: number;
  leafId?: number;
}

/** `POST /api/market/cancel`: take the ask down and return the Gold to the seller Friend. */
export interface MarketCancelReq {
  leafId: number;
}

/** `POST /api/market/buy`: `expectedPriceMicro` must equal the current ask (front-run protection, `PriceChanged`). */
export interface MarketBuyReq {
  leafId: number;
  expectedPriceMicro: number;
}

/** Response of list/cancel: the event recorded plus the seller's Gold count after it. */
export interface MarketActionRes {
  simulated: true;
  event: MarketEvent;
  goldHeld: number;
}

/** Response of buy: the fill and the buyer's balance and Gold count after it. */
export interface MarketBuyRes {
  simulated: true;
  fill: MarketFill;
  goldHeld: number;
  balanceMicro: number;
}

/** Machine-readable market failure, sent as `marketError` next to the shared `error` code. */
export type MarketErrorReason =
  | "sim_only"
  | "bad_price"
  | "no_gold"
  | "not_holder"
  | "not_listed"
  | "not_seller"
  | "price_changed"
  | "self_trade"
  | "no_friend";

/** Market inbox notifications (seller sale, origin royalty). Same envelope as the shared `InboxItem`. */
export type MarketInboxItem =
  | {
      id: string;
      tokenId: TokenIdStr;
      createdAt: number;
      readAt: number | null;
      kind: "market_sold";
      mode: EconomyMode;
      leafId: number;
      buyer: TokenIdStr;
      priceMicro: number;
      toSellerMicro: number;
      /** Also set when the seller grew this Gold itself (the royalty came back to it). */
      toOriginMicro: number;
    }
  | {
      id: string;
      tokenId: TokenIdStr;
      createdAt: number;
      readAt: number | null;
      kind: "market_royalty";
      mode: EconomyMode;
      leafId: number;
      buyer: TokenIdStr;
      seller: TokenIdStr;
      priceMicro: number;
      toOriginMicro: number;
    };

// ── Validation ──────────────────────────────────────────────────────────────────────────────────────────────────────

const leafId = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
const price = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Zod schemas for the market request bodies (shape only; prices are checked by `marketPriceProblem`). */
export const marketSchemas = {
  list: z.strictObject({ priceMicro: price, leafId: leafId.optional() }),
  cancel: z.strictObject({ leafId }),
  buy: z.strictObject({ leafId, expectedPriceMicro: price }),
  book: z.strictObject({ limit: z.coerce.number().int().min(1).max(MARKET.bookDepth).optional() }),
} as const;
