import { randomUUID } from "node:crypto";
import { ECON, popcount, subjectOf, type EconomyAction, type EconomyReceipt, type InboxItem } from "@pl/shared";
import { sql } from "kysely";
import type { AppContext } from "../context.js";
import { utcDay } from "../game/daily.js";
import { grantDailySim } from "../game/wallet.js";
import { HttpError } from "../http/errors.js";
import type { FriendBinding } from "../repos/index.js";
import {
  assertLost,
  assertPayer,
  insertLedger,
  lockParties,
  mendedToday,
  priced,
  publishEconomy,
  recordMend,
  restore,
  simEntry,
  subjectScars,
} from "./common.js";

/**
 * Executes a Regrow or Mend against the simulated ledger (architecture §1.5, sim column) in one transaction:
 * lock payer + subject rows → daily grant → validate pixels are lost and the Mend caps → conditional debit
 * (and the target's 50 % credit for a Mend) → CAS scar restore → ledger row (50/50 split) → stitches + inbox.
 * Hub events are published only after the commit.
 */
export async function executeSim(
  ctx: AppContext,
  binding: FriendBinding,
  action: EconomyAction,
): Promise<EconomyReceipt> {
  const q = priced(action, "sim");
  assertPayer(action, binding);
  const payerId = binding.tokenId;
  const subjectId = subjectOf(action);
  // Art is immutable and may need the chain: fetch it before holding row locks.
  const art = action.kind === "mend" ? await ctx.friends.appearance(subjectId) : null;
  const px = popcount(action.pixels);
  const now = ctx.now();
  const today = utcDay(now);
  const receiptId = `sim:${randomUUID()}`;

  const result = await ctx.db.kysely.transaction().execute(async (trx) => {
    await grantDailySim(trx, payerId, today);
    const rows = await lockParties(trx, payerId, subjectId);
    const scars = await subjectScars(trx, rows.subject, now);
    assertLost(action.pixels, scars.lost);

    if (action.kind === "mend") {
      if ((await mendedToday(trx, "payer_token", payerId, today)) + px > ECON.mendReceivedDailyPxCap) {
        throw new HttpError(409, "mend_cap", `You can Mend at most ${ECON.mendReceivedDailyPxCap} pixels a day.`, {
          reason: "payer_cap",
        });
      }
      if ((await mendedToday(trx, "target_token", subjectId, today)) + px > ECON.mendReceivedDailyPxCap) {
        throw new HttpError(409, "mend_cap", "That Friend has received all the Mends it can today.", {
          reason: "target_cap",
        });
      }
    }

    // Conditional debit: never negative, even under concurrent spends (the CHECK constraint is the last line).
    const debited = await trx
      .updateTable("friends")
      .set({ sim_rf_micro: sql<number>`sim_rf_micro - ${q.totalMicro}` })
      .where("token_id", "=", payerId)
      .where("sim_rf_micro", ">=", q.totalMicro)
      .returning("sim_rf_micro")
      .executeTakeFirst();
    if (!debited) throw new HttpError(402, "insufficient_funds", "Not enough simulated RF.");
    // A Mend's 50 % goes to the target Friend's (simulated) wallet; quote() already refused self-Mends.
    if (q.toTargetMicro > 0) {
      await trx
        .updateTable("friends")
        .set({ sim_rf_micro: sql<number>`sim_rf_micro + ${q.toTargetMicro}` })
        .where("token_id", "=", subjectId)
        .execute();
    }

    const next = await restore(trx, rows.subject, action.pixels, now, scars);
    await insertLedger(trx, [simEntry(receiptId, q)], now);
    let notice: InboxItem | null = null;
    if (action.kind === "mend" && art) {
      notice = await recordMend(trx, {
        target: rows.subject,
        art,
        payer: payerId,
        pixels: action.pixels,
        toTargetMicro: q.toTargetMicro,
        mode: "sim",
        now,
        today,
      });
    }
    return { next, balanceMicro: debited.sim_rf_micro, notice, owner: rows.subject.last_owner };
  });

  publishEconomy(ctx, {
    subject: subjectId,
    scars: result.next,
    ...(action.kind === "mend" ? { mend: { payer: payerId, px, notice: result.notice, owner: result.owner } } : {}),
  });
  return { id: receiptId, quote: q, scars: result.next, balanceMicro: result.balanceMicro };
}
