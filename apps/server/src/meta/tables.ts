import type { ColumnType, Kysely } from "kysely";
import type { Database, DayColumn, Json, TokenIdColumn } from "../db/schema.js";
import type { Executor } from "../repos/index.js";

/** Kysely types for migrations/0011_meta.sql (kept here so the meta module owns its schema). */

type Defaulted<T> = ColumnType<T, T | undefined, T>;
type JsonColumn = ColumnType<Json, string, string>;

export interface BitsAccountsTable {
  account: string;
  balance: Defaulted<number>;
  earned_day: DayColumn | null;
  earned_today: Defaulted<number>;
  updated_at: Date;
}

export interface HomeIslesTable {
  token_id: TokenIdColumn;
  layout: JsonColumn;
  hat: string | null;
  open: Defaulted<boolean>;
  generation: number | null;
  plots: Defaulted<number>;
  version: Defaulted<number>;
  updated_at: Date;
}

export interface WardrobeItemsTable {
  account: string;
  item_id: string;
  qty: number;
  first_at: Date;
}

export interface FriendDecorTable {
  token_id: TokenIdColumn;
  item_id: string;
  qty: number;
  first_at: Date;
}

export interface BitsSpendsTable {
  id: string;
  account: string;
  token_id: TokenIdColumn | null;
  kind: "item" | "blueprint" | "plot";
  ref: string;
  amount: number;
  created_at: Date;
}

export interface MetaStatsTable {
  token_id: TokenIdColumn;
  stats: JsonColumn;
  updated_at: Date;
}

export interface StampsTable {
  token_id: TokenIdColumn;
  stamp_id: string;
  earned_at: Date;
}

export interface BeltsTable {
  token_id: TokenIdColumn;
  belt_id: string;
  run_id: string | null;
  earned_at: Date;
}

/** The meta tables (a type alias, not an interface: `withTables` needs an implicit index signature). */
export type MetaTables = {
  bits_accounts: BitsAccountsTable;
  home_isles: HomeIslesTable;
  wardrobe_items: WardrobeItemsTable;
  friend_decor: FriendDecorTable;
  bits_spends: BitsSpendsTable;
  meta_stats: MetaStatsTable;
  stamps: StampsTable;
  belts: BeltsTable;
};

/** The whole database as the meta module sees it (core tables + meta tables). */
export type MetaDatabase = Database & MetaTables;

/** The same executor (root handle or open transaction) typed with the meta tables. */
export function metaDb(db: Executor): Kysely<MetaDatabase> {
  // Transaction extends Kysely, so withTables keeps a transaction a transaction.
  return (db as Kysely<Database>).withTables<MetaTables>();
}
