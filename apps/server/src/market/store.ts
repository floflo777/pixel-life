import { randomBytes } from "node:crypto";
import {
  GOLD_PIXEL_OUTCOME_ID,
  MARKET,
  SEED_PACK,
  marketSplit,
  microToWei,
  scarsHash,
  settleScars,
  type MarketEvent,
  type MarketFill,
  type MarketInboxItem,
  type MarketListing,
  type ScarState,
  type TokenIdStr,
} from "@pl/shared";
import { sql, type Selectable } from "kysely";
import type { Json } from "../db/schema.js";
import { utcDay } from "../game/daily.js";
import { grantDailySim } from "../game/wallet.js";
import { MarketError } from "./errors.js";
import type { MarketEventsTable, MarketExecutor } from "./tables.js";

/**
 * The SIMULATED Gold Pixel market over Postgres. Every operation runs inside the caller's transaction and locks rows in
 * one global order (listing → friends by token id → seedpack_friend by token id → leaves) so concurrent market,
 * Seed Pack and economy writes serialise instead of deadlocking. Balances move with conditional updates and the
 * CHECK constraints are the last line of defence.
 */

const GOLD_INDEX = GOLD_PIXEL_OUTCOME_ID - 1;
const OUTCOMES = SEED_PACK.outcomes.length;

/** Post-commit side effects the route hands to the realtime hub. */
export interface MarketEffects {
  /** Friends whose held Gold count changed (and their scars, when regrowth was settled first). */
  readonly gold: readonly { tokenId: TokenIdStr; goldHeld: number; scarsHash: string | null }[];
  /** Inbox items with the owner address to push them to (null when the owner is unknown). */
  readonly notices: readonly { owner: string | null; item: MarketInboxItem }[];
}

// ── Rows → DTOs ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Rebuilds a `Sold` event as a fill (the row CHECKs guarantee the Sold columns are present). */
export function fillFromRow(row: Selectable<MarketEventsTable>): MarketFill {
  const need = <T>(v: T | null, name: string): T => {
    if (v === null) throw new Error(`Sold event ${row.id} has no ${name}`);
    return v;
  };
  return {
    kind: "Sold",
    leafId: row.leaf_id,
    originFriendId: need(row.origin_token, "origin"),
    buyer: need(row.buyer_token, "buyer"),
    seller: row.seller_token,
    priceMicro: need(row.price_micro, "price"),
    burnedMicro: need(row.burned_micro, "burned"),
    toOriginMicro: need(row.to_origin_micro, "toOrigin"),
    toCreatorMicro: need(row.to_creator_micro, "toCreator"),
    toSellerMicro: need(row.to_seller_micro, "toSeller"),
    at: row.created_at.getTime(),
  };
}

// ── Inventory (seedpack_friend.inventory: count per outcome, index = outcome id − 1) ───────────────────────────────

/** Parses a stored inventory into non-negative integer counts, one per Seed Pack outcome. */
export function inventoryCounts(stored: Json | undefined): number[] {
  const raw = Array.isArray(stored) ? stored : [];
  const length = Math.max(OUTCOMES, raw.length);
  return Array.from({ length }, (_, i) => {
    const v = Number(raw[i] ?? 0);
    return Number.isSafeInteger(v) && v > 0 ? v : 0;
  });
}

/** Locks (creating it empty if needed) a Friend's Seed Pack inventory row and returns its counts. */
async function lockInventory(db: MarketExecutor, tokenId: TokenIdStr): Promise<number[]> {
  await db
    .insertInto("seedpack_friend")
    .values({ token_id: tokenId, inventory: JSON.stringify(Array.from({ length: OUTCOMES }, () => 0)) })
    .onConflict((oc) => oc.column("token_id").doNothing())
    .execute();
  const row = await db
    .selectFrom("seedpack_friend")
    .select("inventory")
    .where("token_id", "=", tokenId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  return inventoryCounts(row.inventory);
}

async function saveInventory(db: MarketExecutor, tokenId: TokenIdStr, counts: readonly number[]): Promise<void> {
  await db
    .updateTable("seedpack_friend")
    .set({ inventory: JSON.stringify(counts) })
    .where("token_id", "=", tokenId)
    .execute();
}

/** Gold Pixels a Friend holds right now (read live, D-13). */
export async function goldHeld(db: MarketExecutor, tokenId: TokenIdStr): Promise<number> {
  const row = await db
    .selectFrom("seedpack_friend")
    .select("inventory")
    .where("token_id", "=", tokenId)
    .executeTakeFirst();
  return inventoryCounts(row?.inventory)[GOLD_INDEX] ?? 0;
}

// ── Friends (simulated wallets and scars) ───────────────────────────────────────────────────────────────────────────

interface FriendLock {
  readonly tokenId: TokenIdStr;
  readonly lastOwner: string | null;
  readonly scars: ScarState;
}

/** Locks the given Friends' rows in token-id order. Missing Friends are simply absent from the map. */
async function lockFriends(db: MarketExecutor, ids: readonly TokenIdStr[]): Promise<Map<TokenIdStr, FriendLock>> {
  const unique = [...new Set(ids)].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
  const out = new Map<TokenIdStr, FriendLock>();
  for (const id of unique) {
    const row = await db
      .selectFrom("friends")
      .select(["token_id", "last_owner", "lost", "scar_version", "scar_updated_at"])
      .where("token_id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (row) {
      out.set(id, {
        tokenId: id,
        lastOwner: row.last_owner,
        scars: { lost: row.lost, updatedAt: row.scar_updated_at.getTime(), version: row.scar_version },
      });
    }
  }
  return out;
}

/**
 * Before a Friend's Gold count goes UP, materialise the free regrowth accrued so far at the old count (tokenomics §4:
 * the perk uses the minimum held over each interval). A decrease needs nothing: the lower count already applies to
 * the whole open interval. Compare-and-swap on the scar version (architecture §4.2); returns the new scars hash.
 */
async function settleBeforeGoldGain(
  db: MarketExecutor,
  friend: FriendLock,
  goldBefore: number,
  now: Date,
): Promise<string> {
  const settled = settleScars(friend.scars, now.getTime(), friend.tokenId, { goldHeld: goldBefore });
  const next: ScarState = { ...settled, version: friend.scars.version + 1 };
  const result = await db
    .updateTable("friends")
    .set({ lost: next.lost, scar_version: next.version, scar_updated_at: new Date(next.updatedAt) })
    .where("token_id", "=", friend.tokenId)
    .where("scar_version", "=", friend.scars.version)
    .executeTakeFirst();
  if (result.numUpdatedRows !== 1n) {
    throw new MarketError("conflict", "That Friend changed meanwhile. Try again.");
  }
  return scarsHash(next);
}

// ── Leaves ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Keeps a Friend's held leaves consistent with its inventory: if it holds more bought leaves than Golds (it redeemed
 * some through the Seed Pack), the newest excess leaves are marked `redeemed`. Returns the remaining held leaf ids,
 * oldest first. Exported so a Seed Pack redeem can call it in its own transaction.
 */
export async function reconcileHeldLeaves(
  db: MarketExecutor,
  tokenId: TokenIdStr,
  gold: number,
  now: Date,
): Promise<number[]> {
  const held = await db
    .selectFrom("market_leaves")
    .select("id")
    .where("holder_token", "=", tokenId)
    .where("state", "=", "held")
    .orderBy("id", "asc")
    .forUpdate()
    .execute();
  const ids = held.map((r) => r.id);
  const excess = ids.slice(Math.max(0, gold));
  if (excess.length > 0) {
    await db
      .updateTable("market_leaves")
      .set({ state: "redeemed", holder_token: null, updated_at: now })
      .where("id", "in", excess)
      .execute();
  }
  return ids.slice(0, Math.max(0, gold));
}

const noticeId = () => `n_${randomBytes(12).toString("base64url")}`;

async function insertNotice(db: MarketExecutor, item: MarketInboxItem): Promise<void> {
  const { id, tokenId, createdAt, readAt, kind, ...payload } = item;
  await db
    .insertInto("inbox")
    .values({
      id,
      token_id: tokenId,
      kind,
      payload: JSON.stringify(payload),
      created_at: new Date(createdAt),
      read_at: readAt === null ? null : new Date(readAt),
    })
    .execute();
}

// ── Operations ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Result of a list or cancel. */
export interface MarketActionResult {
  readonly event: MarketEvent;
  readonly goldHeld: number;
  readonly effects: MarketEffects;
}

/**
 * Lists one Gold of `seller` at `priceMicro` (already validated): escrows it out of the seller's inventory. Without
 * `leafId` it lists a Gold the seller grew when it has one, else its oldest bought Gold; with `leafId` it relists that
 * bought Gold. Emits `Listed`.
 */
export async function listGold(
  db: MarketExecutor,
  args: { seller: TokenIdStr; priceMicro: number; leafId: number | undefined; now: Date },
): Promise<MarketActionResult> {
  const { seller, priceMicro, now } = args;
  const friends = await lockFriends(db, [seller]);
  if (!friends.has(seller)) throw new MarketError("no_friend", "Open your Friend once before trading.");
  const counts = await lockInventory(db, seller);
  const gold = counts[GOLD_INDEX] ?? 0;
  if (gold < 1) throw new MarketError("no_gold", "This Friend holds no Gold Pixel to list.");
  const held = await reconcileHeldLeaves(db, seller, gold, now);

  let leafId: number;
  if (args.leafId !== undefined) {
    if (!held.includes(args.leafId)) throw new MarketError("not_holder", "This Friend does not hold that Gold.");
    leafId = args.leafId;
  } else if (gold > held.length) {
    // A Gold this Friend grew itself enters the market for the first time: it becomes a leaf with this origin.
    const leaf = await db
      .insertInto("market_leaves")
      .values({ origin_token: seller, holder_token: null, state: "listed", created_at: now, updated_at: now })
      .returning("id")
      .executeTakeFirstOrThrow();
    leafId = leaf.id;
  } else {
    // Every Gold held was bought: `gold >= 1` and `gold <= held.length` here, so `held[0]` exists.
    leafId = held[0] ?? 0;
  }
  await db
    .updateTable("market_leaves")
    .set({ state: "listed", holder_token: null, updated_at: now })
    .where("id", "=", leafId)
    .execute();

  counts[GOLD_INDEX] = gold - 1;
  await saveInventory(db, seller, counts);
  await db
    .insertInto("market_listings")
    .values({ leaf_id: leafId, seller_token: seller, price_micro: priceMicro, created_at: now })
    .execute();
  await db
    .insertInto("market_events")
    .values({
      kind: "Listed",
      mode: "sim",
      leaf_id: leafId,
      seller_token: seller,
      price_micro: priceMicro,
      created_at: now,
    })
    .execute();
  return {
    event: { kind: "Listed", leafId, seller, priceMicro, at: now.getTime() },
    goldHeld: gold - 1,
    effects: { gold: [{ tokenId: seller, goldHeld: gold - 1, scarsHash: null }], notices: [] },
  };
}

/** Locks an open listing, or throws `not_listed`. */
async function lockListing(db: MarketExecutor, leafId: number) {
  const listing = await db
    .selectFrom("market_listings")
    .innerJoin("market_leaves", "market_leaves.id", "market_listings.leaf_id")
    .select([
      "market_listings.leaf_id",
      "market_listings.seller_token",
      "market_listings.price_micro",
      "market_leaves.origin_token",
    ])
    .where("market_listings.leaf_id", "=", leafId)
    .forUpdate("market_listings")
    .executeTakeFirst();
  if (!listing) throw new MarketError("not_listed", "That Gold is not listed any more.");
  return listing;
}

/** Moves an escrowed leaf into `holder`'s inventory (settling its regrowth first) and closes the listing. */
async function release(
  db: MarketExecutor,
  leafId: number,
  holder: FriendLock | undefined,
  holderId: TokenIdStr,
  now: Date,
): Promise<{ goldHeld: number; scarsHash: string | null }> {
  const counts = await lockInventory(db, holderId);
  const before = counts[GOLD_INDEX] ?? 0;
  const hash = holder ? await settleBeforeGoldGain(db, holder, before, now) : null;
  counts[GOLD_INDEX] = before + 1;
  await saveInventory(db, holderId, counts);
  await db
    .updateTable("market_leaves")
    .set({ state: "held", holder_token: holderId, updated_at: now })
    .where("id", "=", leafId)
    .execute();
  await db.deleteFrom("market_listings").where("leaf_id", "=", leafId).execute();
  return { goldHeld: before + 1, scarsHash: hash };
}

/** Cancels `seller`'s ask on `leafId` and returns the Gold to it. Emits `Cancelled`. */
export async function cancelListing(
  db: MarketExecutor,
  args: { seller: TokenIdStr; leafId: number; now: Date },
): Promise<MarketActionResult> {
  const { seller, leafId, now } = args;
  const listing = await lockListing(db, leafId);
  if (listing.seller_token !== seller) throw new MarketError("not_seller", "Only the seller can cancel this listing.");
  const friends = await lockFriends(db, [seller]);
  const after = await release(db, leafId, friends.get(seller), seller, now);
  await db
    .insertInto("market_events")
    .values({
      kind: "Cancelled",
      mode: "sim",
      leaf_id: leafId,
      seller_token: seller,
      price_micro: null,
      created_at: now,
    })
    .execute();
  return {
    event: { kind: "Cancelled", leafId, seller, at: now.getTime() },
    goldHeld: after.goldHeld,
    effects: { gold: [{ tokenId: seller, ...after }], notices: [] },
  };
}

/** Result of a buy. */
export interface MarketBuyResult {
  readonly fill: MarketFill;
  readonly goldHeld: number;
  readonly balanceMicro: number;
  readonly effects: MarketEffects;
}

/**
 * `buyer` buys the Gold on `leafId` at exactly `expectedPriceMicro` (else `price_changed`, the contract's
 * `PriceChanged`). Debits the buyer, burns 2 %, pays 2 % to the origin Friend, 1 % to the creator and the rest to the
 * seller, moves the Gold into the buyer's inventory, and writes the Sold event, ledger legs and inbox notices.
 */
export async function buyGold(
  db: MarketExecutor,
  args: { buyer: TokenIdStr; leafId: number; expectedPriceMicro: number; now: Date },
): Promise<MarketBuyResult> {
  const { buyer, leafId, now } = args;
  const listing = await lockListing(db, leafId);
  if (listing.seller_token === buyer) throw new MarketError("self_trade", "You cannot buy your own listing.");
  if (listing.price_micro !== args.expectedPriceMicro) {
    throw new MarketError("price_changed", "The price changed since you looked. Check the new price and try again.");
  }
  const seller = listing.seller_token;
  const origin = listing.origin_token;
  const split = marketSplit(listing.price_micro);

  // Lock every party in token order first; the daily grant then updates an already-locked row (no lock-order cycle).
  const friends = await lockFriends(db, [buyer, seller, origin]);
  if (!friends.has(buyer)) throw new MarketError("no_friend", "Open your Friend once before trading.");
  await grantDailySim(db, buyer, utcDay(now));

  const debited = await db
    .updateTable("friends")
    .set({ sim_rf_micro: sql<number>`sim_rf_micro - ${split.priceMicro}` })
    .where("token_id", "=", buyer)
    .where("sim_rf_micro", ">=", split.priceMicro)
    .returning("sim_rf_micro")
    .executeTakeFirst();
  if (!debited) throw new MarketError("insufficient_funds", "Not enough simulated RF.");
  for (const [tokenId, amount] of [
    [seller, split.toSellerMicro],
    [origin, split.toOriginMicro],
  ] as const) {
    const credited = await db
      .updateTable("friends")
      .set({ sim_rf_micro: sql<number>`sim_rf_micro + ${amount}` })
      .where("token_id", "=", tokenId)
      .executeTakeFirst();
    // Sellers and origins always have a row (listing requires one); a missing row must not silently drop RF.
    if (credited.numUpdatedRows !== 1n) throw new Error(`market credit to unknown Friend ${tokenId}`);
  }

  const after = await release(db, leafId, friends.get(buyer), buyer, now);
  const event = await db
    .insertInto("market_events")
    .values({
      kind: "Sold",
      mode: "sim",
      leaf_id: leafId,
      seller_token: seller,
      price_micro: split.priceMicro,
      origin_token: origin,
      buyer_token: buyer,
      burned_micro: split.burnedMicro,
      to_origin_micro: split.toOriginMicro,
      to_creator_micro: split.toCreatorMicro,
      to_seller_micro: split.toSellerMicro,
      created_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db
    .insertInto("market_ledger")
    .values([
      { event_id: event.id, leg: "buyer", token_id: buyer, amount_micro: -split.priceMicro, created_at: now },
      { event_id: event.id, leg: "burn", token_id: null, amount_micro: split.burnedMicro, created_at: now },
      { event_id: event.id, leg: "origin", token_id: origin, amount_micro: split.toOriginMicro, created_at: now },
      { event_id: event.id, leg: "creator", token_id: null, amount_micro: split.toCreatorMicro, created_at: now },
      { event_id: event.id, leg: "seller", token_id: seller, amount_micro: split.toSellerMicro, created_at: now },
    ])
    .execute();
  // The sale's RF sinks in the global ledger (burned + paid to a Friend's wallet), as the economy stats count them.
  // The seller's proceeds and the creator fee are transfers, not sinks: they live in market_ledger only.
  await db
    .insertInto("rf_ledger")
    .values({
      id: `sim:market:${event.id}`,
      kind: "market_fee",
      mode: "sim",
      payer_token: buyer,
      target_token: origin,
      pixels: null,
      total: microToWei(split.burnedMicro + split.toOriginMicro),
      burn: microToWei(split.burnedMicro),
      stream: "0",
      to_target: microToWei(split.toOriginMicro),
      tx_hash: null,
      log_index: null,
      block: null,
      created_at: now,
    })
    .execute();

  const notices: { owner: string | null; item: MarketInboxItem }[] = [];
  const at = now.getTime();
  const sold: MarketInboxItem = {
    id: noticeId(),
    tokenId: seller,
    createdAt: at,
    readAt: null,
    kind: "market_sold",
    mode: "sim",
    leafId,
    buyer,
    priceMicro: split.priceMicro,
    toSellerMicro: split.toSellerMicro,
    toOriginMicro: origin === seller ? split.toOriginMicro : 0,
  };
  notices.push({ owner: friends.get(seller)?.lastOwner ?? null, item: sold });
  if (origin !== seller) {
    const royalty: MarketInboxItem = {
      id: noticeId(),
      tokenId: origin,
      createdAt: at,
      readAt: null,
      kind: "market_royalty",
      mode: "sim",
      leafId,
      buyer,
      seller,
      priceMicro: split.priceMicro,
      toOriginMicro: split.toOriginMicro,
    };
    notices.push({ owner: friends.get(origin)?.lastOwner ?? null, item: royalty });
  }
  for (const n of notices) await insertNotice(db, n.item);

  return {
    fill: fillFromRow(event),
    goldHeld: after.goldHeld,
    balanceMicro: debited.sim_rf_micro,
    effects: { gold: [{ tokenId: buyer, ...after }], notices },
  };
}

// ── Queries ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Open asks, cheapest first (ties: oldest first). */
export async function openListings(
  db: MarketExecutor,
  filter: { limit: number; seller?: TokenIdStr },
): Promise<MarketListing[]> {
  let q = db
    .selectFrom("market_listings")
    .innerJoin("market_leaves", "market_leaves.id", "market_listings.leaf_id")
    .select([
      "market_listings.leaf_id",
      "market_listings.seller_token",
      "market_listings.price_micro",
      "market_listings.created_at",
      "market_leaves.origin_token",
    ]);
  if (filter.seller !== undefined) q = q.where("market_listings.seller_token", "=", filter.seller);
  const rows = await q
    .orderBy("market_listings.price_micro", "asc")
    .orderBy("market_listings.created_at", "asc")
    .orderBy("market_listings.leaf_id", "asc")
    .limit(filter.limit)
    .execute();
  return rows.map((r) => ({
    leafId: r.leaf_id,
    originFriendId: r.origin_token,
    seller: r.seller_token,
    priceMicro: r.price_micro,
    listedAt: r.created_at.getTime(),
  }));
}

/** Order book: asks, floor, recent fills and trailing-window stats. */
export async function orderBook(db: MarketExecutor, args: { limit: number; now: Date }) {
  const listings = await openListings(db, { limit: args.limit });
  const open = await db
    .selectFrom("market_listings")
    .select((eb) => [eb.fn.countAll<string>().as("n"), eb.fn.min("price_micro").as("floor")])
    .executeTakeFirstOrThrow();
  const fills = await db
    .selectFrom("market_events")
    .selectAll()
    .where("kind", "=", "Sold")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(MARKET.recentFills)
    .execute();
  const since = new Date(args.now.getTime() - MARKET.volumeWindowMs);
  const window = await db
    .selectFrom("market_events")
    .select((eb) => [
      eb.fn.countAll<string>().as("n"),
      eb.fn.coalesce(eb.fn.sum<string>("price_micro"), eb.val("0")).as("volume"),
      eb.fn.coalesce(eb.fn.sum<string>("burned_micro"), eb.val("0")).as("burned"),
    ])
    .where("kind", "=", "Sold")
    .where("created_at", ">=", since)
    .executeTakeFirstOrThrow();
  const recentFills = fills.map(fillFromRow);
  return {
    floorMicro: open.floor === null ? null : Number(open.floor),
    listings,
    openListings: Number(open.n),
    recentFills,
    volume24hMicro: Number(window.volume),
    fills24h: Number(window.n),
    burned24hMicro: Number(window.burned),
    lastPriceMicro: recentFills[0]?.priceMicro ?? null,
  };
}

/** A Friend's market view: Golds held, which of them were bought (relistable by id), its asks and royalties. */
export async function mine(db: MarketExecutor, tokenId: TokenIdStr) {
  const gold = await goldHeld(db, tokenId);
  const held = await db
    .selectFrom("market_leaves")
    .select("id")
    .where("holder_token", "=", tokenId)
    .where("state", "=", "held")
    .orderBy("id", "asc")
    .limit(Math.max(0, gold))
    .execute();
  const royalties = await db
    .selectFrom("market_events")
    .select((eb) => eb.fn.coalesce(eb.fn.sum<string>("to_origin_micro"), eb.val("0")).as("sum"))
    .where("kind", "=", "Sold")
    .where("origin_token", "=", tokenId)
    .executeTakeFirstOrThrow();
  return {
    goldHeld: gold,
    boughtLeafIds: held.map((r) => r.id),
    listings: await openListings(db, { limit: MARKET.bookDepth, seller: tokenId }),
    royaltiesMicro: Number(royalties.sum),
  };
}
