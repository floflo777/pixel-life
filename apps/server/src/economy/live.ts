/**
 * LIVE MODE (ECONOMY_MODE=live) — real RF through `PixelLifeSink` (contracts/README.md).
 *
 * NOT DEPLOYED, NOT AUDITED, NEVER EXERCISED ON CHAIN. This file is the server half of the live runbook: it issues
 * quotes with a 15 min pixel lock, then credits a paid quote from its verified transaction receipt, following the
 * README's event schema 1:1 into `rf_ledger` (idempotent on `(tx_hash, log_index)`). Unit tests cover the log decoding
 * and matching with synthetic receipts only. The sim path (`sim.ts`) is what the product runs.
 */
import { randomBytes } from "node:crypto";
import {
  ECON,
  EMPTY_MASK,
  and,
  popcount,
  subjectOf,
  microToWei,
  weiToMicro,
  type EconomyAction,
  type EconomyReceipt,
  type Hex64,
  type InboxItem,
  type QuoteRes,
} from "@pl/shared";
import { parseAbi, parseEventLogs, type Hex, type Log } from "viem";
import type { AppContext } from "../context.js";
import { utcDay } from "../game/daily.js";
import { HttpError } from "../http/errors.js";
import type { FriendBinding } from "../repos/index.js";
import {
  assertLost,
  assertPayer,
  insertLedger,
  lockParties,
  priced,
  publishEconomy,
  recordMend,
  restore,
  subjectScars,
  type LedgerEntry,
} from "./common.js";

/** `PixelLifeSink` events (contracts/README.md "Event schema for the indexer"). */
export const SINK_EVENTS_ABI = parseAbi([
  "event Regrew(uint256 indexed tokenId, bytes32 indexed quoteId, uint256 pixels, uint256 total, uint256 burned, uint256 streamed)",
  "event Mended(uint256 indexed payerTokenId, uint256 indexed targetTokenId, bytes32 indexed quoteId, address targetWallet, uint256 pixels, uint256 total, uint256 burned, uint256 toTarget)",
]);

/** A decoded sink event mapped onto an `rf_ledger` row plus the quote it pays. */
export interface SinkPayment {
  readonly quoteId: Hex;
  readonly entry: LedgerEntry;
}

/**
 * Decodes every `Regrew`/`Mended` log emitted by `sink` in a receipt into ledger entries (README table: id
 * `live:<chain>:<tx>:<logIndex>`, burn/stream/to_target from the event). Logs from other emitters are ignored.
 */
export function decodeSinkPayments(chainId: number, sink: string, logs: readonly Log[]): SinkPayment[] {
  const own = logs.filter((l) => l.address.toLowerCase() === sink.toLowerCase());
  const events = parseEventLogs({ abi: SINK_EVENTS_ABI, logs: own, strict: true });
  return events.flatMap((e): SinkPayment[] => {
    if (e.transactionHash === null || e.logIndex === null || e.blockNumber === null) return [];
    const common = {
      id: `live:${chainId}:${e.transactionHash}:${e.logIndex}`,
      mode: "live" as const,
      txHash: e.transactionHash,
      logIndex: e.logIndex,
      block: Number(e.blockNumber),
    };
    if (e.eventName === "Regrew") {
      const a = e.args;
      return [
        {
          quoteId: a.quoteId,
          entry: {
            ...common,
            kind: "regrow",
            payer: a.tokenId.toString(),
            target: a.tokenId.toString(),
            pixels: Number(a.pixels),
            totalWei: a.total.toString(),
            burnWei: a.burned.toString(),
            streamWei: a.streamed.toString(),
            toTargetWei: "0",
          },
        },
      ];
    }
    const a = e.args;
    return [
      {
        quoteId: a.quoteId,
        entry: {
          ...common,
          kind: "mend",
          payer: a.payerTokenId.toString(),
          target: a.targetTokenId.toString(),
          pixels: Number(a.pixels),
          totalWei: a.total.toString(),
          burnWei: a.burned.toString(),
          streamWei: "0",
          toTargetWei: a.toTarget.toString(),
        },
      },
    ];
  });
}

/** True when a sink payment pays exactly this quote (kind, parties, pixel count and total). */
export function paymentMatches(
  payment: SinkPayment,
  quote: { id: string; kind: string; payer_token: string; subject_token: string; pixels: Hex64; total: string },
): boolean {
  const e = payment.entry;
  return (
    payment.quoteId.toLowerCase() === quote.id &&
    e.kind === quote.kind &&
    e.payer === quote.payer_token &&
    e.target === quote.subject_token &&
    e.pixels === popcount(quote.pixels) &&
    e.totalWei === quote.total
  );
}

/** Live quote: prices the action and locks its pixels against free regrowth for 15 min (tokenomics §5.3). */
export async function issueLiveQuote(
  ctx: AppContext,
  binding: FriendBinding,
  action: EconomyAction,
): Promise<QuoteRes> {
  const q = priced(action, "live");
  assertPayer(action, binding);
  const subjectId = subjectOf(action);
  const now = ctx.now();
  const lockedUntil = new Date(now.getTime() + ECON.quoteLockMs);
  const id = `0x${randomBytes(32).toString("hex")}`;
  await ctx.db.kysely.transaction().execute(async (trx) => {
    const rows = await lockParties(trx, binding.tokenId, subjectId);
    const scars = await subjectScars(trx, rows.subject, now);
    assertLost(action.pixels, scars.lost);
    if (and(action.pixels, scars.opts.locked) !== EMPTY_MASK) {
      throw new HttpError(409, "scar_conflict", "Someone is already paying for some of those pixels.");
    }
    await trx
      .insertInto("economy_quotes")
      .values({
        id,
        kind: action.kind,
        payer_token: binding.tokenId,
        subject_token: subjectId,
        pixels: action.pixels,
        total: microToWei(q.totalMicro),
        created_at: now,
        locked_until: lockedUntil,
        consumed_at: null,
      })
      .execute();
  });
  return { ...q, quoteId: id, lockedUntil: lockedUntil.getTime() };
}

/**
 * Credits a paid quote from its transaction (README runbook step 5.4): receipt succeeded on this chain, the sink
 * emitted an event paying exactly this quote, and it has the configured confirmations. Idempotent: a second call
 * for the same payment answers with the current state. Pixels healed for free meanwhile are skipped (surplus pixel
 * credit is not implemented yet).
 */
export async function executeLive(
  ctx: AppContext,
  binding: FriendBinding,
  action: EconomyAction,
  quoteId: string | undefined,
  txHash: `0x${string}` | undefined,
): Promise<EconomyReceipt> {
  const sink = ctx.config.pixelLifeSink;
  if (!sink) throw new HttpError(503, "unavailable", "Live payments are not configured.", { reason: "live_only" });
  if (!quoteId || !txHash) throw new HttpError(400, "bad_request", "Live payments need quoteId and txHash.");
  const q = priced(action, "live");
  assertPayer(action, binding);
  const quoteRow = await ctx.db.kysely
    .selectFrom("economy_quotes")
    .selectAll()
    .where("id", "=", quoteId.toLowerCase())
    .executeTakeFirst();
  if (
    !quoteRow ||
    quoteRow.kind !== action.kind ||
    quoteRow.payer_token !== binding.tokenId ||
    quoteRow.subject_token !== subjectOf(action) ||
    quoteRow.pixels !== action.pixels
  ) {
    throw new HttpError(400, "bad_request", "Unknown quote for this action.", { reason: "unknown_quote" });
  }

  let receipt;
  let head: bigint;
  try {
    [receipt, head] = await Promise.all([
      ctx.chain.getTransactionReceipt({ hash: txHash }),
      ctx.chain.getBlockNumber({ cacheTime: 0 }),
    ]);
  } catch {
    throw new HttpError(409, "tx_unverified", "Transaction not found yet. Try again shortly.", {
      reason: "tx_pending",
    });
  }
  if (receipt.status !== "success") {
    throw new HttpError(409, "tx_unverified", "That transaction failed on chain.", { reason: "tx_failed" });
  }
  if (head - receipt.blockNumber + 1n < BigInt(ctx.config.liveConfirmations)) {
    throw new HttpError(409, "tx_unverified", "Waiting for confirmations.", { reason: "tx_pending" });
  }
  const payments = decodeSinkPayments(ctx.config.chainId, sink, receipt.logs);
  const paid = payments.find((p) => paymentMatches(p, quoteRow));
  if (!paid)
    throw new HttpError(409, "tx_unverified", "That transaction does not pay this quote.", { reason: "tx_failed" });

  const subjectId = subjectOf(action);
  const art = action.kind === "mend" ? await ctx.friends.appearance(subjectId) : null;
  const now = ctx.now();
  const today = utcDay(now);
  const toTargetMicro = weiToMicro(paid.entry.toTargetWei);

  const result = await ctx.db.kysely.transaction().execute(async (trx) => {
    const rows = await lockParties(trx, binding.tokenId, subjectId);
    // Every sink event of the tx is booked (a batched smart-account tx may pay several quotes).
    await insertLedger(
      trx,
      payments.map((p) => p.entry),
      now,
    );
    const consumed = await trx
      .updateTable("economy_quotes")
      .set({ consumed_at: now })
      .where("id", "=", quoteRow.id)
      .where("consumed_at", "is", null)
      .executeTakeFirst();
    const scars = await subjectScars(trx, rows.subject, now, quoteRow.id);
    if (consumed.numUpdatedRows !== 1n) {
      return { next: scars.state, notice: null, fresh: false, owner: rows.subject.last_owner };
    }
    const heal = and(action.pixels, scars.lost);
    const next = await restore(trx, rows.subject, heal, now, scars);
    let notice: InboxItem | null = null;
    if (action.kind === "mend" && art) {
      notice = await recordMend(trx, {
        target: rows.subject,
        art,
        payer: binding.tokenId,
        pixels: heal,
        toTargetMicro,
        mode: "live",
        now,
        today,
      });
    }
    return { next, notice, fresh: true, owner: rows.subject.last_owner };
  });

  if (result.fresh) {
    publishEconomy(ctx, {
      subject: subjectId,
      scars: result.next,
      ...(action.kind === "mend"
        ? {
            mend: {
              payer: binding.tokenId,
              px: popcount(action.pixels),
              notice: result.notice,
              owner: result.owner,
            },
          }
        : {}),
    });
  }
  return { id: paid.entry.id, quote: q, scars: result.next, txHash };
}
