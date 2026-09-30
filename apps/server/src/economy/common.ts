import {
  EMPTY_MASK,
  EconomyError,
  or,
  applyRestore,
  effectiveLost,
  frontMask,
  isSubset,
  microToWei,
  payerOf,
  popcount,
  quote,
  scarsHash,
  subjectOf,
  type EconomyAction,
  type EconomyMode,
  type EconomyQuote,
  type FriendAppearance,
  type Hex64,
  type InboxItem,
  type ScarState,
  type TokenIdStr,
} from "@pl/shared";
import type { AppContext } from "../context.js";
import { activeLocks, casWriteScars, goldHeldOf, readFriend, storedScars, type FriendRow } from "../game/state.js";
import { HttpError } from "../http/errors.js";
import { recordMendNotice } from "../inbox/store.js";
import type { Executor } from "../repos/index.js";
import type { FriendBinding } from "../repos/index.js";
import { mendRegion } from "./region.js";

/** Prices an action with the shared pure `quote()`, mapping its errors to 400 with the same code. */
export function priced(action: EconomyAction, mode: EconomyMode): EconomyQuote {
  try {
    return quote(action, mode);
  } catch (error) {
    if (error instanceof EconomyError) throw new HttpError(400, error.code, error.message);
    throw error;
  }
}

/** The bound Friend must be the one paying (Regrow owner / Mend payer). */
export function assertPayer(action: EconomyAction, binding: FriendBinding): void {
  if (payerOf(action) !== binding.tokenId) {
    throw new HttpError(403, "not_owner", "You can only pay with the Friend you picked.", { reason: "not_payer" });
  }
}

/** Locks the payer and subject rows in token order (no deadlocks between opposite Mends) and returns both. */
export async function lockParties(
  db: Executor,
  payer: TokenIdStr,
  subject: TokenIdStr,
): Promise<{ payer: FriendRow; subject: FriendRow }> {
  const ids = [...new Set([payer, subject])].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const rows = new Map<string, FriendRow>();
  for (const id of ids) {
    const row = await readFriend(db, id, true);
    if (row) rows.set(id, row);
  }
  const p = rows.get(payer);
  const s = rows.get(subject);
  if (!s)
    throw new HttpError(404, "not_found", "That Friend has never visited Pixel Life.", { reason: "unknown_friend" });
  if (!p) throw new HttpError(403, "not_owner", "Pick your Friend again.", { reason: "unknown_friend" });
  return { payer: p, subject: s };
}

/** Subject's scar state and regrowth options at `now`, for validating and restoring pixels. */
export async function subjectScars(
  db: Executor,
  row: FriendRow,
  now: Date,
  excludeQuote?: string,
): Promise<{ state: ScarState; lost: Hex64; opts: { goldHeld: number; locked: Hex64 } }> {
  const [goldHeld, locked] = await Promise.all([
    goldHeldOf(db, row.token_id),
    excludeQuote === undefined ? activeLocks(db, row.token_id, now) : locksExcept(db, row.token_id, now, excludeQuote),
  ]);
  const state = storedScars(row);
  const opts = { goldHeld, locked };
  return { state, lost: effectiveLost(state, now.getTime(), row.token_id, opts), opts };
}

async function locksExcept(db: Executor, tokenId: TokenIdStr, now: Date, quoteId: string): Promise<Hex64> {
  const rows = await db
    .selectFrom("economy_quotes")
    .select("pixels")
    .where("subject_token", "=", tokenId)
    .where("consumed_at", "is", null)
    .where("locked_until", ">", now)
    .where("id", "!=", quoteId)
    .execute();
  return rows.reduce<Hex64>((m, r) => or(m, r.pixels), EMPTY_MASK);
}

/** Every pixel of a paid action must be missing right now (architecture §4.6: "cannot target a pixel that isn't lost"). */
export function assertLost(pixels: Hex64, lost: Hex64): void {
  if (!isSubset(pixels, lost)) {
    throw new HttpError(409, "not_lost", "Some of those pixels are not missing any more. Pick again.");
  }
}

/** Restores `pixels` on the locked subject row with a CAS write; the row lock makes a conflict impossible. */
export async function restore(
  db: Executor,
  subject: FriendRow,
  pixels: Hex64,
  now: Date,
  scars: { state: ScarState; opts: { goldHeld: number; locked: Hex64 } },
): Promise<ScarState> {
  const next = applyRestore(scars.state, pixels, now.getTime(), subject.token_id, scars.opts);
  if (!(await casWriteScars(db, subject.token_id, scars.state.version, next))) {
    throw new HttpError(409, "scar_conflict", "That Friend changed meanwhile. Try again.");
  }
  return next;
}

/** One `rf_ledger` row (amounts in micro-RF, stored as 18-decimal base units for audit). */
export interface LedgerEntry {
  readonly id: string;
  readonly kind: "regrow" | "mend";
  readonly mode: EconomyMode;
  readonly payer: TokenIdStr;
  readonly target: TokenIdStr;
  readonly pixels: number;
  readonly totalWei: string;
  readonly burnWei: string;
  readonly streamWei: string;
  readonly toTargetWei: string;
  readonly txHash?: `0x${string}`;
  readonly logIndex?: number;
  readonly block?: number;
}

/** A sim ledger entry from a quote (the 50/50 split `quote()` computed). */
export function simEntry(id: string, q: EconomyQuote): LedgerEntry {
  return {
    id,
    kind: q.action.kind,
    mode: "sim",
    payer: payerOf(q.action),
    target: subjectOf(q.action),
    pixels: popcount(q.action.pixels),
    totalWei: microToWei(q.totalMicro),
    burnWei: microToWei(q.burnMicro),
    streamWei: microToWei(q.streamMicro),
    toTargetWei: microToWei(q.toTargetMicro),
  };
}

/** Inserts ledger rows; live rows are idempotent on `(tx_hash, log_index)`. Returns the ids actually inserted. */
export async function insertLedger(db: Executor, entries: readonly LedgerEntry[], now: Date): Promise<string[]> {
  if (entries.length === 0) return [];
  const rows = await db
    .insertInto("rf_ledger")
    .values(
      entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        mode: e.mode,
        payer_token: e.payer,
        target_token: e.target,
        pixels: e.pixels,
        total: e.totalWei,
        burn: e.burnWei,
        stream: e.streamWei,
        to_target: e.toTargetWei,
        tx_hash: e.txHash ?? null,
        log_index: e.logIndex ?? null,
        block: e.block ?? null,
        created_at: now,
      })),
    )
    .onConflict((oc) => oc.doNothing())
    .returning("id")
    .execute();
  return rows.map((r) => r.id);
}

/** Pixels mended today (UTC) by a payer or received by a target (for the 24 px/day caps, D-10 + tokenomics F2). */
export async function mendedToday(
  db: Executor,
  column: "payer_token" | "target_token",
  tokenId: TokenIdStr,
  today: string,
): Promise<number> {
  const row = await db
    .selectFrom("rf_ledger")
    .select((eb) => eb.fn.coalesce(eb.fn.sum<string>("pixels"), eb.val("0")).as("px"))
    .where("kind", "=", "mend")
    .where(column, "=", tokenId)
    .where("created_at", ">=", new Date(`${today}T00:00:00Z`))
    .executeTakeFirstOrThrow();
  return Number(row.px);
}

/** Effects of a Mend beyond the payment: the stitch record and the target's inbox notice. */
export async function recordMend(
  db: Executor,
  args: {
    target: FriendRow;
    art: FriendAppearance;
    payer: TokenIdStr;
    pixels: Hex64;
    toTargetMicro: number;
    mode: EconomyMode;
    now: Date;
    today: string;
  },
): Promise<InboxItem | null> {
  await db
    .insertInto("stitches")
    .values({ target_token: args.target.token_id, payer_token: args.payer, pixels: args.pixels, at: args.now })
    .execute();
  return recordMendNotice(
    db,
    args.target.token_id,
    {
      by: args.payer,
      px: popcount(args.pixels),
      toTargetMicro: args.toTargetMicro,
      mode: args.mode,
      region: mendRegion(frontMask(args.art), args.pixels),
    },
    args.now,
    args.today,
  );
}

/** After the DB commit: relay scars, the Mend sparkle and the owner notification to the hub (architecture §4.7). */
export function publishEconomy(
  ctx: AppContext,
  args: {
    subject: TokenIdStr;
    scars: ScarState;
    mend?: { payer: TokenIdStr; px: number; notice: InboxItem | null; owner: string | null };
  },
): void {
  ctx.hub.updateToken(args.subject, { scarsHash: scarsHash(args.scars) });
  if (args.mend) {
    ctx.hub.mended(args.subject, args.mend.payer, args.mend.px);
    if (args.mend.notice && args.mend.owner) ctx.hub.notify(args.mend.owner, args.mend.notice);
  }
}
