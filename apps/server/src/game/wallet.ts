import { BITS, ECON, capBits, runBits, type TokenIdStr } from "@pl/shared";
import { sql } from "kysely";
import type { Executor } from "../repos/index.js";

/**
 * Credits the simulated daily RF grant (ECON.simDailyGrantMicro) once per UTC day per Friend, lazily on first use
 * that day. A single conditional UPDATE, so concurrent requests grant at most once. Sim mode only.
 */
export async function grantDailySim(db: Executor, tokenId: TokenIdStr, today: string): Promise<boolean> {
  const result = await db
    .updateTable("friends")
    .set({
      sim_rf_micro: sql<number>`sim_rf_micro + ${ECON.simDailyGrantMicro}`,
      sim_granted_day: today,
    })
    .where("token_id", "=", tokenId)
    .where((eb) => eb.or([eb("sim_granted_day", "is", null), eb("sim_granted_day", "<", today)]))
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
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

/**
 * Credits the Bits for one completed run (`runBits(skill, firstRunOfDay)`) to an account under the shared daily cap
 * (`capBits`: 250 at full rate, 25 % up to 500, then 0). The first credited run of the UTC day gets the +50 bonus.
 * Locks the account row so concurrent runs cannot both use the same headroom. Returns the Bits actually credited.
 */
export async function creditRunBits(
  db: Executor,
  account: string,
  skill: number,
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
  const credited = capBits(earnedToday, runBits(skill, firstRunOfDay));
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
