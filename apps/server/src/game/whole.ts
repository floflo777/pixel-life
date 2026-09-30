import { EMPTY_MASK, effectiveLost, wholeAt, type Hex64, type ScarState, type TokenIdStr } from "@pl/shared";
import { onWhole, readStats, type MetaAward } from "../meta/hooks.js";
import type { Executor } from "../repos/index.js";
import { activeLocks, goldHeldOf, readFriend, storedScars } from "./state.js";

/**
 * Whole streak (GDD §12.5 "Whole Week" / "Whole Moon"): how long a Friend has had no effective scars. Scars heal
 * lazily, so the server never sees the moment a Friend becomes whole; it observes the Friend at natural touch points
 * (`/api/me`, run submissions), records `friends.whole_since` the first time it sees it whole (back-dated to when the
 * last pixel regrew, or to the restoring write), clears it as soon as a run adds scars, and reports whole days to the
 * meta `whole` hook.
 */

const DAY_MS = 86_400_000;

/**
 * Pure: the `whole_since` a Friend should have now. Null while it has effective scars. When it is whole and nothing was
 * recorded yet: the moment its last stored scar regrew for free (`wholeAt` from the stored write, at the current Gold
 * rate), or the stored write itself when that write left it whole (a Mend, a Regrow, a scar-free Friend). Never later
 * than `now`; an existing `wholeSince` is kept.
 */
export function nextWholeSince(args: {
  readonly stored: ScarState;
  readonly lostNow: Hex64;
  readonly wholeSince: number | null;
  readonly now: number;
  readonly tokenId: TokenIdStr;
  readonly goldHeld: number;
}): number | null {
  if (args.lostNow !== EMPTY_MASK) return null;
  if (args.wholeSince !== null) return Math.min(args.wholeSince, args.now);
  if (args.stored.lost === EMPTY_MASK) return Math.min(args.stored.updatedAt, args.now);
  const at = wholeAt(args.stored, args.stored.updatedAt, args.tokenId, { goldHeld: args.goldHeld });
  return Math.min(at ?? args.now, args.now);
}

/** Whole days between `since` and `now` (0 when `since` is null). */
export function wholeDays(since: number | null, now: number): number {
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / DAY_MS));
}

/**
 * Observes a Friend's whole streak at `now`: updates `whole_since` (conditional on the value read, so a concurrent run
 * clearing it wins) and reports whole days ≥ 1 to the meta hook when they exceed the recorded best. Returns the award,
 * or null when nothing was reported. Safe to call often; a missing Friend row is a no-op.
 */
export async function observeWhole(db: Executor, tokenId: TokenIdStr, now: Date): Promise<MetaAward | null> {
  const row = await readFriend(db, tokenId);
  if (!row) return null;
  const [goldHeld, locked] = await Promise.all([goldHeldOf(db, tokenId), activeLocks(db, tokenId, now)]);
  const stored = storedScars(row);
  const t = now.getTime();
  const lostNow = effectiveLost(stored, t, tokenId, { goldHeld, locked });
  const before = row.whole_since ? row.whole_since.getTime() : null;
  const since = nextWholeSince({ stored, lostNow, wholeSince: before, now: t, tokenId, goldHeld });
  if (since !== before) {
    await db
      .updateTable("friends")
      .set({ whole_since: since === null ? null : new Date(since) })
      .where("token_id", "=", tokenId)
      .where((eb) =>
        before === null ? eb("whole_since", "is", null) : eb("whole_since", "=", new Date(before)),
      )
      .execute();
  }
  const days = wholeDays(since, t);
  if (days < 1 || (await readStats(db, tokenId)).wholeDays >= days) return null;
  return onWhole(db, tokenId, days, now);
}

/** A run added scars: the streak is broken (call inside the run's transaction). */
export async function breakWhole(db: Executor, tokenId: TokenIdStr): Promise<void> {
  await db.updateTable("friends").set({ whole_since: null }).where("token_id", "=", tokenId).execute();
}
