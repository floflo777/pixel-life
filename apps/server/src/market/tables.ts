import type { Generated, Kysely, Transaction } from "kysely";
import type { Database, TokenIdColumn } from "../db/schema.js";

/** Kysely types for migrations/0010_market.sql (int8 → JS number, see db/pool.ts). Kept here so the market owns them. */

/** Where a leaf (a Gold Pixel that entered the market) is now. */
export type LeafState = "held" | "listed" | "redeemed";

export interface MarketLeavesTable {
  id: Generated<number>;
  origin_token: TokenIdColumn;
  holder_token: TokenIdColumn | null;
  state: LeafState;
  created_at: Date;
  updated_at: Date;
}

export interface MarketListingsTable {
  leaf_id: number;
  seller_token: TokenIdColumn;
  price_micro: number;
  created_at: Date;
}

/** Mirrors the contract event names. */
export type MarketEventKind = "Listed" | "Cancelled" | "Sold";

export interface MarketEventsTable {
  id: Generated<number>;
  kind: MarketEventKind;
  mode: "sim";
  leaf_id: number;
  seller_token: TokenIdColumn;
  price_micro: number | null;
  origin_token: TokenIdColumn | null;
  buyer_token: TokenIdColumn | null;
  burned_micro: number | null;
  to_origin_micro: number | null;
  to_creator_micro: number | null;
  to_seller_micro: number | null;
  created_at: Date;
}

/** One leg of a sale's double entry. */
export type MarketLeg = "buyer" | "burn" | "origin" | "creator" | "seller";

export interface MarketLedgerTable {
  id: Generated<number>;
  event_id: number;
  leg: MarketLeg;
  token_id: TokenIdColumn | null;
  amount_micro: number;
  created_at: Date;
}

/** The market's tables (a type alias: `withTables` needs an index-signature-compatible record). */
export type MarketTables = {
  market_leaves: MarketLeavesTable;
  market_listings: MarketListingsTable;
  market_events: MarketEventsTable;
  market_ledger: MarketLedgerTable;
};

/** The whole database as the market sees it: the shared schema plus the market tables. */
export type MarketDatabase = Database & MarketTables;

/** A root handle or a transaction over {@link MarketDatabase}. */
export type MarketExecutor = Kysely<MarketDatabase> | Transaction<MarketDatabase>;

/** Widens the app's Kysely handle with the market tables (no runtime cost). */
export const withMarket = (db: Kysely<Database>): Kysely<MarketDatabase> => db.withTables<MarketTables>();
