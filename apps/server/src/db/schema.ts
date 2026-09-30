import type { ColumnType, Generated } from "kysely";

/**
 * Kysely table types for migrations/0001_init.sql. Type mapping (see db/pool.ts parsers):
 * numeric → decimal string, int8 → JS number (safe range enforced), date → "YYYY-MM-DD",
 * timestamptz → Date, bytea → Buffer, jsonb → parsed JSON.
 */

/** uint256 token id as a decimal string. */
export type TokenIdColumn = string;
/** Lowercase 0x-prefixed address. */
export type AddressColumn = string;
/** Column with a DB default: optional on insert. */
type Defaulted<T> = ColumnType<T, T | undefined, T>;
/** Calendar day in UTC, "YYYY-MM-DD". */
export type DayColumn = string;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface AuthNoncesTable {
  nonce: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

export interface SessionsTable {
  sid: string;
  address: AddressColumn;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface FriendBindingsTable {
  sid: string;
  token_id: TokenIdColumn;
  address: AddressColumn;
  tba: AddressColumn;
  block: number;
  checked_at: Date;
}

export interface FriendsTable {
  token_id: TokenIdColumn;
  family_id: number;
  seed: number;
  tba: AddressColumn | null;
  last_owner: AddressColumn | null;
  lost: Defaulted<string>;
  scar_version: Defaulted<number>;
  scar_updated_at: Date;
  glow_cracks: Defaulted<number>;
  streak: Defaulted<number>;
  streak_day: DayColumn | null;
  sim_rf_micro: Defaulted<number>;
  sim_granted_day: DayColumn | null;
  last_seen: Date;
  created_at: Date;
}

export interface RunsTable {
  id: string;
  token_id: TokenIdColumn | null;
  guest_id: string | null;
  kind: "free" | "daily";
  day: DayColumn | null;
  seed: number;
  inputs: Buffer;
  score: number;
  lost_delta: string;
  final_hash: string;
  verified: Defaulted<-1 | 0 | 1>;
  created_at: Date;
}

export interface DailyBestTable {
  day: DayColumn;
  board: "owners" | "visitors";
  entrant: string;
  score: number;
  run_id: string;
}

export interface RfLedgerTable {
  id: string;
  kind: string;
  mode: "sim" | "live";
  payer_token: TokenIdColumn | null;
  target_token: TokenIdColumn | null;
  pixels: number | null;
  total: string;
  burn: string;
  stream: string;
  to_target: string;
  tx_hash: string | null;
  log_index: number | null;
  block: number | null;
  created_at: Date;
}

export interface InboxTable {
  id: string;
  token_id: TokenIdColumn;
  kind: string;
  payload: ColumnType<Json, string, string>;
  created_at: Date;
  read_at: Date | null;
}

export interface SeedpackHouseTable {
  id: 1;
  stake_micro: number;
  reserved_micro: number;
  liability_micro: number;
}

export interface SeedpackFriendTable {
  token_id: TokenIdColumn;
  consumables: Defaulted<number>;
  inventory: ColumnType<Json, string | undefined, string>;
}

export interface SeedpackPlaysTable {
  id: Generated<number>;
  token_id: TokenIdColumn;
  outcome_id: number | null;
  created_at: Date;
  settled_at: Date | null;
}

export interface ChainCursorTable {
  name: string;
  block: number;
}

/** The whole database, as Kysely sees it. */
export interface Database {
  auth_nonces: AuthNoncesTable;
  sessions: SessionsTable;
  friend_bindings: FriendBindingsTable;
  friends: FriendsTable;
  runs: RunsTable;
  daily_best: DailyBestTable;
  rf_ledger: RfLedgerTable;
  inbox: InboxTable;
  seedpack_house: SeedpackHouseTable;
  seedpack_friend: SeedpackFriendTable;
  seedpack_plays: SeedpackPlaysTable;
  chain_cursor: ChainCursorTable;
}
