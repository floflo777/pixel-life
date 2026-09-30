import {
  applyMetaEvent,
  beltEarnedBy,
  beltRank,
  newStamps,
  parseMetaStats,
  stampsXp,
  type BeltId,
  type MetaEvent,
  type MetaStats,
  type RunFacts,
  type StampId,
  type TokenIdStr,
} from "@pl/shared";
import type { Kysely } from "kysely";
import type { Executor } from "../repos/index.js";
import { metaDb, type MetaDatabase } from "./tables.js";

/**
 * Stamp and belt awarding hooks (GDD §12.4–12.5). Other modules call these on events: a verified run, a Mend, a kept
 * Gold Pixel, a whole streak, an isle visit. Each call is one atomic update of the Friend's counters, stamps and belts;
 * pass an open transaction to make it part of the caller's commit, or the root handle to get a transaction of its own.
 * Hooks never pay Bits (tokenomics §7: completion is not farmable); the returned XP is for the caller's XP ledger.
 */

/** What an event earned a Friend. */
export interface MetaAward {
  readonly stamps: StampId[];
  /** XP of the new stamps (25 / 75 / 150 / 300 by colour). */
  readonly xp: number;
  /** A belt earned by this event, if any. */
  readonly belt: BeltId | null;
}

const NOTHING: MetaAward = Object.freeze({ stamps: [], xp: 0, belt: null });

async function inTransaction<T>(db: Executor, fn: (trx: Kysely<MetaDatabase>) => Promise<T>): Promise<T> {
  return db.isTransaction ? fn(metaDb(db)) : db.transaction().execute((trx) => fn(metaDb(trx)));
}

/** Locks (creating if needed) the Friend's counters row and returns the parsed counters. */
async function lockStats(db: Kysely<MetaDatabase>, tokenId: TokenIdStr, now: Date): Promise<MetaStats> {
  await db
    .insertInto("meta_stats")
    .values({ token_id: tokenId, stats: "{}", updated_at: now })
    .onConflict((oc) => oc.column("token_id").doNothing())
    .execute();
  const row = await db
    .selectFrom("meta_stats")
    .select("stats")
    .where("token_id", "=", tokenId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  return parseMetaStats(row.stats);
}

/** Stamps a Friend holds. */
export async function heldStamps(db: Executor, tokenId: TokenIdStr): Promise<Set<string>> {
  const rows = await metaDb(db).selectFrom("stamps").select("stamp_id").where("token_id", "=", tokenId).execute();
  return new Set(rows.map((r) => r.stamp_id));
}

/** Belts a Friend has passed. */
export async function passedBelts(db: Executor, tokenId: TokenIdStr): Promise<string[]> {
  const rows = await metaDb(db).selectFrom("belts").select("belt_id").where("token_id", "=", tokenId).execute();
  return rows.map((r) => r.belt_id);
}

async function applyLocked(
  db: Kysely<MetaDatabase>,
  tokenId: TokenIdStr,
  events: readonly MetaEvent[],
  now: Date,
  runId: string | null,
): Promise<MetaAward> {
  let stats = await lockStats(db, tokenId, now);
  const held = await heldStamps(db, tokenId);
  const passed = await passedBelts(db, tokenId);
  const earned: StampId[] = [];
  let belt: BeltId | null = null;
  const queue = [...events];
  for (let event = queue.shift(); event; event = queue.shift()) {
    if (event.kind === "run_finished") {
      const b = beltEarnedBy(passed, event.run);
      if (b) {
        await db
          .insertInto("belts")
          .values({ token_id: tokenId, belt_id: b, run_id: runId, earned_at: now })
          .onConflict((oc) => oc.columns(["token_id", "belt_id"]).doNothing())
          .execute();
        passed.push(b);
        belt = b;
        queue.push({ kind: "belt_earned", belt: b });
      }
    }
    stats = applyMetaEvent(stats, event);
    for (const id of newStamps(stats, event, held)) {
      held.add(id);
      earned.push(id);
    }
  }
  // The stored belt rank follows the belts table even if an older row predates the counter.
  const rank = Math.max(stats.beltRank, ...passed.map(beltRank));
  stats = { ...stats, beltRank: rank };
  await db
    .updateTable("meta_stats")
    .set({ stats: JSON.stringify(stats), updated_at: now })
    .where("token_id", "=", tokenId)
    .execute();
  if (earned.length > 0) {
    await db
      .insertInto("stamps")
      .values(earned.map((id) => ({ token_id: tokenId, stamp_id: id, earned_at: now })))
      .onConflict((oc) => oc.columns(["token_id", "stamp_id"]).doNothing())
      .execute();
  }
  return earned.length === 0 && belt === null ? NOTHING : { stamps: earned, xp: stampsXp(earned), belt };
}

/** Records any meta event for a Friend and returns the stamps (and belt) it earned. */
export async function recordMetaEvent(
  db: Executor,
  tokenId: TokenIdStr,
  event: MetaEvent,
  now: Date,
): Promise<MetaAward> {
  return inTransaction(db, (trx) => applyLocked(trx, tokenId, [event], now, null));
}

/**
 * A verified run finished (call after replay verification; practice/unverified runs should not be reported).
 * Updates counters, awards run stamps and, when the run meets the next belt's trial, that belt.
 */
export async function onRunFinished(
  db: Executor,
  tokenId: TokenIdStr,
  run: RunFacts,
  now: Date,
  runId: string | null = null,
): Promise<MetaAward> {
  return inTransaction(db, (trx) => applyLocked(trx, tokenId, [{ kind: "run_finished", run }], now, runId));
}

/**
 * A Mend was paid: the payer counts a Mend given (distinct targets for "Kind Stranger"), the target counts a
 * distinct mender ("Well Loved"). Rows are locked in token order so opposite Mends cannot deadlock.
 */
export async function onMendGiven(
  db: Executor,
  payer: TokenIdStr,
  target: TokenIdStr,
  px: number,
  now: Date,
): Promise<{ payer: MetaAward; target: MetaAward }> {
  return inTransaction(db, async (trx) => {
    const payerFirst = BigInt(payer) < BigInt(target);
    const give = () => applyLocked(trx, payer, [{ kind: "mend_given", target, px }], now, null);
    const receive = () => applyLocked(trx, target, [{ kind: "mend_received", from: payer, px }], now, null);
    if (payerFirst) {
      const p = await give();
      return { payer: p, target: await receive() };
    }
    const t = await receive();
    return { payer: await give(), target: t };
  });
}

/** The Friend kept (did not redeem) a Gold Pixel from a Seed Pack. */
export async function onGoldKept(db: Executor, tokenId: TokenIdStr, now: Date, count = 1): Promise<MetaAward> {
  return recordMetaEvent(db, tokenId, { kind: "gold_kept", count }, now);
}

/** The Friend has been whole for `days` consecutive days (call daily, or when it becomes whole with days = 0). */
export async function onWhole(db: Executor, tokenId: TokenIdStr, days: number, now: Date): Promise<MetaAward> {
  return recordMetaEvent(db, tokenId, { kind: "whole", days }, now);
}

/** Current counters of a Friend (zeros if it has none yet). */
export async function readStats(db: Executor, tokenId: TokenIdStr): Promise<MetaStats> {
  const row = await metaDb(db)
    .selectFrom("meta_stats")
    .select("stats")
    .where("token_id", "=", tokenId)
    .executeTakeFirst();
  return parseMetaStats(row?.stats);
}
