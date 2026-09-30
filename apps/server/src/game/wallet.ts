import { BITS, ECON, capBits, runBits, type TokenIdStr } from "@pl/shared";
import { sql, type QueryExecutorProvider } from "kysely";
import type { Executor } from "../repos/index.js";

/**
 * Server-side wallets: the simulated RF daily grant and the account-bound Bits balance (tokenomics §7). This module is
 * the only writer of `bits_accounts`: runs credit through {@link creditRunBits} / {@link creditVenueBits}, the meta
 * catalog debits through {@link debitBits}, and `/api/me` + `/api/meta/me` read {@link bitsBalance}.
 */

/**
 * Credits the simulated daily RF grant (ECON.simDailyGrantMicro) once per UTC day per Friend, lazily on first use
 * that day. A single conditional UPDATE, so concurrent requests grant at most once. Sim mode only.
 *
 * Takes any executor (the app's handle, a transaction, or a market/meta-typed one): it is plain SQL on `friends`, so
 * every module that needs the grant (economy, Seed Pack, market, `/api/me`) shares this one definition.
 */
export async function grantDailySim(db: QueryExecutorProvider, tokenId: TokenIdStr, today: string): Promise<boolean> {
  const result = await sql`
    UPDATE friends
    SET sim_rf_micro = sim_rf_micro + ${ECON.simDailyGrantMicro}, sim_granted_day = ${today}
    WHERE token_id = ${tokenId} AND (sim_granted_day IS NULL OR sim_granted_day < ${today})`.execute(db);
  return result.numAffectedRows === 1n;
}

/** The Friend's simulated balance (micro-RF), or null if unknown. */
export async function simBalance(db: Executor, tokenId: TokenIdStr): Promise<number | null> {
  const row = await db.selectFrom("friends").select("sim_rf_micro").where("token_id", "=", tokenId).executeTakeFirst();
  return row?.sim_rf_micro ?? null;
}

/** An account's Bits balance (0 if it never earned any). */
export async function bitsBalance(db: Executor, account: string): Promise<number> {
  const row = await db
    .selectFrom("bits_accounts")
    .select("balance")
    .where("account", "=", account.toLowerCase())
    .executeTakeFirst();
  return row?.balance ?? 0;
}

/** Conditional Bits debit; returns the new balance, or null when the balance is too low (never goes negative). */
export async function debitBits(db: Executor, account: string, amount: number, now: Date): Promise<number | null> {
  const row = await db
    .updateTable("bits_accounts")
    .set({ balance: sql<number>`balance - ${amount}`, updated_at: now })
    .where("account", "=", account.toLowerCase())
    .where("balance", ">=", amount)
    .returning("balance")
    .executeTakeFirst();
  return row ? row.balance : null;
}

/**
 * Credits `raw(firstRunOfDay)` Bits under the shared daily cap (`capBits`: 250 at full rate, 25 % up to 500, then 0).
 * Locks the account row so concurrent runs cannot both use the same headroom. Returns the Bits actually credited.
 */
async function creditUnderDailyCap(
  db: Executor,
  account: string,
  raw: (firstRunOfDay: boolean) => number,
  today: string,
  now: Date,
): Promise<number> {
  const key = account.toLowerCase();
  await db
    .insertInto("bits_accounts")
    .values({ account: key, updated_at: now })
    .onConflict((oc) => oc.column("account").doNothing())
    .execute();
  const row = await db
    .selectFrom("bits_accounts")
    .select(["earned_day", "earned_today"])
    .where("account", "=", key)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const firstRunOfDay = row.earned_day !== today;
  const earnedToday = firstRunOfDay ? 0 : row.earned_today;
  const credited = capBits(earnedToday, raw(firstRunOfDay));
  await db
    .updateTable("bits_accounts")
    .set({
      balance: sql<number>`balance + ${credited}`,
      earned_day: today,
      earned_today: Math.min(BITS.dailyHardCap, earnedToday + credited),
      updated_at: now,
    })
    .where("account", "=", key)
    .execute();
  return credited;
}

/**
 * Credits the Bits for one completed Loose Pixels run (`runBits(skill, firstRunOfDay)`) under the shared daily cap.
 * The first credited run of the UTC day (any venue) gets the +50 bonus. Returns the Bits actually credited.
 */
export async function creditRunBits(
  db: Executor,
  account: string,
  skill: number,
  today: string,
  now: Date,
): Promise<number> {
  return creditUnderDailyCap(db, account, (first) => runBits(skill, first), today, now);
}

/**
 * Per-venue daily cap for venues whose runs are not replayed yet (`BITS_ONLY_VENUES`): ten base runs' worth
 * (`BITS.runBase × 10` = 100 Bits, first-run bonus included). It sits inside the shared 500/day cap, so adding such a
 * venue never raises what an account can earn per day (tokenomics §7).
 */
export const VENUE_DAILY_BITS_CAP = BITS.runBase * 10;
/** Most runs an account may submit per unverified venue per UTC day (anti-spam; the 40 s cooldown also applies). */
export const VENUE_DAILY_RUNS_MAX = 60;

/** Result of {@link creditVenueBits}: `null` when the account already hit today's run limit for that venue. */
export type VenueCredit = { readonly credited: number } | null;

/**
 * Credits one run of an unverified venue: base Bits only (its score is client-claimed, so no skill bonus), plus the
 * shared first-run-of-day bonus, clipped first to the venue's own daily cap then to the shared cap. Counts the run
 * against {@link VENUE_DAILY_RUNS_MAX}. Locks the venue-day row, then the account row (always in that order).
 */
export async function creditVenueBits(
  db: Executor,
  account: string,
  venueId: string,
  today: string,
  now: Date,
): Promise<VenueCredit> {
  const key = account.toLowerCase();
  await db
    .insertInto("bits_venue_days")
    .values({ account: key, venue_id: venueId, day: today })
    .onConflict((oc) => oc.columns(["account", "venue_id", "day"]).doNothing())
    .execute();
  const day = await db
    .selectFrom("bits_venue_days")
    .select(["runs", "earned"])
    .where("account", "=", key)
    .where("venue_id", "=", venueId)
    .where("day", "=", today)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (day.runs >= VENUE_DAILY_RUNS_MAX) return null;
  const room = Math.max(0, VENUE_DAILY_BITS_CAP - day.earned);
  const credited = await creditUnderDailyCap(db, key, (first) => Math.min(room, runBits(0, first)), today, now);
  await db
    .updateTable("bits_venue_days")
    .set({ runs: day.runs + 1, earned: day.earned + credited })
    .where("account", "=", key)
    .where("venue_id", "=", venueId)
    .where("day", "=", today)
    .execute();
  return { credited };
}
