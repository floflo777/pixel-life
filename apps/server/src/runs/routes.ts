import { randomBytes } from "node:crypto";
import {
  BITS,
  BITS_ONLY_VENUES,
  EMPTY_MASK,
  beltDef,
  beltTrialSeed,
  isRunVenue,
  and,
  andNot,
  applyLoss,
  effectiveLost,
  fromIndices,
  frontMask,
  getBit,
  maxPersistedLost,
  popcount,
  regrowthOrder,
  runScarCap,
  scarsHash,
  settleScars,
  type Hex64,
  type RunAck,
  type RunNotAppliedReason,
  type RunSubmitReq,
  type ScarState,
  type SimConfig,
  type TokenIdStr,
} from "@pl/shared";
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { RUN_RECHECK_MS, requireBinding } from "../auth/binding.js";
import { readGuest, readSession } from "../auth/session.js";
import type { AppContext } from "../context.js";
import { dailySeed, nextStreak, utcDay } from "../game/daily.js";
import { activeLocks, casWriteScars, goldHeldOf, readFriend, storedScars } from "../game/state.js";
import { creditRunBits, creditVenueBits } from "../game/wallet.js";
import { breakWhole, observeWhole } from "../game/whole.js";
import { HttpError, validated } from "../http/errors.js";
import { enforceRateLimit } from "../http/guards.js";
import type { Executor } from "../repos/index.js";
import { plausibleStartLost } from "./start.js";

/** Decoded input logs are at most 8 KiB (GDD §5.8). */
const MAX_INPUT_BYTES = 8 * 1024;
/** Daily Run submissions per entrant per UTC day; the best counts (architecture §4.5). */
export const DAILY_SUBMISSIONS_MAX = 20;
/** Runs with a newly connected own Friend that teach the stakes without persisting scars (GDD §2.5). */
export const NEWBIE_RUNS = 3;
/** Scar CAS attempts before answering `scar_conflict` (architecture §4.2). */
const CAS_ATTEMPTS = 3;
/** Default sim arena when the client does not name one. */
export const DEFAULT_ARENA = "meadow";

type Entrant =
  | { kind: "owner"; tokenId: TokenIdStr; address: string; key: string }
  | { kind: "guest"; guestId: string; key: string };

/** Keeps at most `cap` pixels of `m`, choosing in the token's regrowth order (deterministic, like the 50 % floor). */
export function clipPixels(m: Hex64, cap: number, tokenId: TokenIdStr): Hex64 {
  if (popcount(m) <= cap) return m;
  const kept: number[] = [];
  for (const i of regrowthOrder(tokenId)) {
    if (kept.length >= cap) break;
    if (getBit(m, i)) kept.push(i);
  }
  return fromIndices(kept);
}

/** Bits skill bonus: the full 20 for a clean run, shrinking linearly to 0 at the per-run scar cap (tokenomics §7). */
export function skillBonus(lostPx: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.floor((BITS.runSkillMax * Math.max(0, cap - lostPx)) / cap);
}

async function resolveEntrant(ctx: AppContext, headers: Parameters<typeof readSession>[1]): Promise<Entrant> {
  const session = await readSession(ctx, headers);
  if (session) {
    const binding = await ctx.repos.bindings.get(session.sid);
    if (binding) {
      // Architecture §1.6 step 5: runs re-check ownership when the last check is older than 10 min.
      const fresh = await requireBinding(ctx, session, RUN_RECHECK_MS);
      return { kind: "owner", tokenId: fresh.tokenId, address: fresh.address, key: `token:${fresh.tokenId}` };
    }
  }
  // D-15 kill switch: with GUEST_MODE=off an old guest cookie is simply not an identity any more.
  const guest = ctx.config.guestMode ? readGuest(ctx, headers) : null;
  if (guest) return { kind: "guest", guestId: guest.guestId, key: `guest:${guest.guestId}` };
  if (session) throw new HttpError(403, "forbidden", "Pick one of your Friends first.", { reason: "no_binding" });
  throw new HttpError(401, "unauthorized", "Sign in or start as a guest first.");
}

const newRunId = () => `r_${randomBytes(12).toString("base64url")}`;

async function upsertDailyBest(
  db: Executor,
  day: string,
  board: "owners" | "visitors",
  entrant: string,
  score: number,
  runId: string,
): Promise<void> {
  await db
    .insertInto("daily_best")
    .values({ day, board, entrant, score, run_id: runId })
    .onConflict((oc) =>
      oc
        .columns(["day", "board", "entrant"])
        .doUpdateSet({ score: (eb) => eb.ref("excluded.score"), run_id: (eb) => eb.ref("excluded.run_id") })
        .where("daily_best.score", "<", (eb) => eb.ref("excluded.score")),
    )
    .execute();
}

/** Pixels of this Friend restored by paid Regrows / Mends since `since` (a claimed run start's healing budget). */
async function paidRestoredSince(db: Executor, tokenId: TokenIdStr, since: Date): Promise<number> {
  const row = await db
    .selectFrom("rf_ledger")
    .select((eb) => eb.fn.coalesce(eb.fn.sum<string>("pixels"), eb.val("0")).as("px"))
    .where("target_token", "=", tokenId)
    .where("kind", "in", ["regrow", "mend"])
    .where("created_at", ">=", since)
    .executeTakeFirstOrThrow();
  return Number(row.px);
}

/** Owner submission: stores the run and applies its scars with compare-and-swap (architecture §4.2). */
async function submitOwnerRun(
  ctx: AppContext,
  entrant: Extract<Entrant, { kind: "owner" }>,
  body: RunSubmitReq,
  inputs: Buffer,
  runId: string,
): Promise<RunAck & { applied_lost: Hex64 | null }> {
  const { tokenId } = entrant;
  const art = await ctx.friends.appearance(tokenId);
  const front = frontMask(art);
  const n0 = popcount(front);
  const cap = runScarCap(n0);
  const now = ctx.now();
  const t = now.getTime();
  const today = utcDay(now);
  const claimedOnBody = and(body.claimed.lostDelta, front);

  return ctx.db.kysely.transaction().execute(async (trx) => {
    const priorRuns = await trx
      .selectFrom("runs")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("token_id", "=", tokenId)
      .executeTakeFirstOrThrow();
    const newbie = Number(priorRuns.n) < NEWBIE_RUNS;
    const claimedStart =
      body.startLost !== undefined && body.startedAt !== undefined
        ? {
            startLost: body.startLost,
            startedAt: body.startedAt,
            paidRestoredPx: await paidRestoredSince(trx, tokenId, new Date(Math.min(body.startedAt, t))),
          }
        : null;

    let reason: RunNotAppliedReason | undefined = newbie ? "newbie" : undefined;
    let scars: ScarState | null = null;
    let applied: Hex64 | null = null;
    let simFriend: SimConfig["friend"] | null = null;
    for (let attempt = 0; attempt < CAS_ATTEMPTS && scars === null; attempt++) {
      const row = await readFriend(trx, tokenId);
      if (!row) throw new HttpError(409, "not_owner", "Pick your Friend again.", { reason: "unknown_friend" });
      const [goldHeld, locked] = await Promise.all([goldHeldOf(trx, tokenId), activeLocks(trx, tokenId, now)]);
      const state = storedScars(row);
      const opts = { goldHeld, locked, front };
      const startLost = effectiveLost(state, t, tokenId, opts);
      // Replay from the scars the client flew with when they are plausible (pixels may heal mid-run); scars below are
      // still applied against the server's own `startLost`.
      const replayLost =
        claimedStart && plausibleStartLost({ ...claimedStart, now: t, front, lostNow: startLost, locked, goldHeld })
          ? claimedStart.startLost
          : startLost;
      simFriend = { front, lost: replayLost, familyId: art.familyId, goldHeld };
      if (!reason && popcount(startLost) >= maxPersistedLost(n0)) reason = "floor";
      if (reason) {
        scars = settleScars(state, t, tokenId, opts);
        break;
      }
      const delta = clipPixels(andNot(claimedOnBody, startLost), cap, tokenId);
      const next = applyLoss(state, delta, t, tokenId, opts);
      if (await casWriteScars(trx, tokenId, state.version, next)) {
        scars = next;
        applied = andNot(next.lost, startLost);
      } else if (attempt < CAS_ATTEMPTS - 1) {
        // Someone (a Mend, a Regrow, another run) wrote in between: back off a little and re-read.
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 20)));
      }
    }
    if (scars === null) {
      throw new HttpError(409, "scar_conflict", "Your Friend changed while saving the run. Submit again.");
    }

    const lostPx = popcount(clipPixels(claimedOnBody, cap, tokenId));
    await trx
      .insertInto("runs")
      .values({
        id: runId,
        token_id: tokenId,
        guest_id: null,
        kind: body.kind,
        day: body.kind === "daily" ? today : null,
        seed: body.seed,
        inputs,
        score: body.claimed.score,
        lost_delta: body.claimed.lostDelta,
        final_hash: body.claimed.finalHash,
        created_at: now,
        arena: body.arena ?? DEFAULT_ARENA,
        venue_id: body.venueId,
        sim_friend: JSON.stringify(simFriend),
        applied_lost: applied,
        belt_trial: body.beltTrial ?? null,
      })
      .execute();
    // New scars break the whole streak (it restarts the next time the Friend is seen whole).
    if (applied !== null && applied !== EMPTY_MASK) await breakWhole(trx, tokenId);

    const row = await readFriend(trx, tokenId, true);
    if (body.kind === "daily" && row && row.streak_day !== today) {
      await trx
        .updateTable("friends")
        .set({ streak: nextStreak(row.streak, row.streak_day, today), streak_day: today })
        .where("token_id", "=", tokenId)
        .execute();
    }
    await trx
      .updateTable("friends")
      .set({ last_seen: sql<Date>`GREATEST(last_seen, ${now})` })
      .where("token_id", "=", tokenId)
      .execute();
    if (body.kind === "daily") await upsertDailyBest(trx, today, "owners", tokenId, body.claimed.score, runId);

    const bits = await creditRunBits(trx, entrant.address, skillBonus(lostPx, cap), today, now);
    await trx.updateTable("runs").set({ bits }).where("id", "=", runId).execute();

    return {
      runId,
      verified: "pending" as const,
      applied: applied !== null,
      ...(reason ? { reason } : {}),
      scars,
      bits,
      applied_lost: applied,
    };
  });
}

/**
 * Checks the venue and the venue-specific rules of a submission; returns true for a Bits-only venue.
 * Scar venues (`SCAR_VENUES`) take any kind and may claim a belt trial; Bits-only venues take free runs only.
 */
function checkVenue(body: RunSubmitReq): boolean {
  if (!isRunVenue(body.venueId)) {
    throw new HttpError(400, "bad_request", "Runs from that venue are not accepted.", { reason: "unknown_venue" });
  }
  const bitsOnly = (BITS_ONLY_VENUES as readonly string[]).includes(body.venueId);
  if (bitsOnly && (body.kind !== "free" || body.beltTrial !== undefined)) {
    throw new HttpError(400, "bad_request", "Only free runs count for this venue.", { reason: "bad_kind" });
  }
  if (body.beltTrial !== undefined) {
    const belt = beltDef(body.beltTrial);
    const island = belt?.requirement.island;
    if (
      !belt?.trial ||
      body.kind !== "free" ||
      body.seed !== beltTrialSeed(belt.id) ||
      (island !== undefined && (body.arena ?? DEFAULT_ARENA) !== island)
    ) {
      throw new HttpError(400, "bad_request", "That is not a belt trial run.", { reason: "bad_trial" });
    }
  }
  return bitsOnly;
}

/**
 * Owner submission for a venue whose runs are not replayed yet (`BITS_ONLY_VENUES`): stores the run (never replayed,
 * so it stays `pending`; no scars, stamps, belts or boards) and credits base Bits under the venue's own daily cap and
 * the shared cap. A 61st run of the day for that venue is refused (`venue_daily_limit`).
 */
async function submitBitsOnlyRun(
  ctx: AppContext,
  entrant: Extract<Entrant, { kind: "owner" }>,
  body: RunSubmitReq,
  inputs: Buffer,
  runId: string,
): Promise<RunAck> {
  const now = ctx.now();
  const today = utcDay(now);
  return ctx.db.kysely.transaction().execute(async (trx) => {
    const credit = await creditVenueBits(trx, entrant.address, body.venueId, today, now);
    if (!credit) {
      throw new HttpError(429, "rate_limited", "That's enough of this game for today.", {
        reason: "venue_daily_limit",
      });
    }
    await trx
      .insertInto("runs")
      .values({
        id: runId,
        token_id: entrant.tokenId,
        guest_id: null,
        kind: "free",
        day: null,
        seed: body.seed,
        inputs,
        score: body.claimed.score,
        lost_delta: EMPTY_MASK,
        final_hash: body.claimed.finalHash,
        created_at: now,
        arena: body.arena ?? DEFAULT_ARENA,
        venue_id: body.venueId,
        sim_friend: null,
        bits: credit.credited,
      })
      .execute();
    await trx
      .updateTable("friends")
      .set({ last_seen: sql<Date>`GREATEST(last_seen, ${now})` })
      .where("token_id", "=", entrant.tokenId)
      .execute();
    return { runId, verified: "pending", applied: false, reason: "no_scars", scars: null, bits: credit.credited };
  });
}

/** Registers `POST /api/runs` (architecture §4.3, §4.5, §4.6). */
export function registerRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/runs", async (request): Promise<RunAck> => {
    const entrant = await resolveEntrant(ctx, request.headers);
    enforceRateLimit(ctx.limiters.writes, entrant.kind === "owner" ? `addr:${entrant.address}` : entrant.key);
    const body = validated("POST /api/runs", request.body);

    const bitsOnly = checkVenue(body);

    const inputs = Buffer.from(body.inputs, "base64");
    if (inputs.length > MAX_INPUT_BYTES) {
      throw new HttpError(400, "bad_request", "Input log is larger than 8 KiB.", { reason: "bad_inputs" });
    }
    const now = ctx.now();
    const today = utcDay(now);
    if (body.kind === "daily") {
      if (body.day !== today)
        throw new HttpError(400, "bad_request", "That Daily Run is over.", { reason: "wrong_day" });
      if (body.seed !== dailySeed(today, ctx.config.dailySecret)) {
        throw new HttpError(400, "bad_request", "Daily Runs must use today's seed.", { reason: "bad_seed" });
      }
      const count = await ctx.db.kysely
        .selectFrom("runs")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("day", "=", today)
        .where(
          entrant.kind === "owner" ? "token_id" : "guest_id",
          "=",
          entrant.kind === "owner" ? entrant.tokenId : entrant.guestId,
        )
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= DAILY_SUBMISSIONS_MAX) {
        throw new HttpError(429, "rate_limited", "That's today's last Daily attempt.", { reason: "daily_limit" });
      }
    }
    // Unverified venues have their own cooldown lane, so a Sumo round never blocks the next Loose Pixels run.
    const cooldown = ctx.limiters.runSubmit.take(bitsOnly ? `${entrant.key}:${body.venueId}` : entrant.key);
    if (!cooldown.ok) {
      throw new HttpError(429, "rate_limited", "One run at a time.", {
        reason: "run_cooldown",
        retryAfterMs: cooldown.retryAfterMs,
      });
    }

    const runId = newRunId();
    if (bitsOnly && entrant.kind === "owner") {
      const ack = await submitBitsOnlyRun(ctx, entrant, body, inputs, runId);
      request.log.info({ runId, tokenId: entrant.tokenId, venue: body.venueId, bits: ack.bits }, "venue run stored");
      return ack;
    }
    if (entrant.kind === "guest") {
      await ctx.db.kysely.transaction().execute(async (trx) => {
        await trx
          .insertInto("runs")
          .values({
            id: runId,
            token_id: null,
            guest_id: entrant.guestId,
            kind: body.kind,
            day: body.kind === "daily" ? today : null,
            seed: body.seed,
            inputs,
            score: body.claimed.score,
            lost_delta: body.claimed.lostDelta,
            final_hash: body.claimed.finalHash,
            created_at: now,
            arena: body.arena ?? DEFAULT_ARENA,
            venue_id: body.venueId,
          })
          .execute();
        if (body.kind === "daily") {
          await upsertDailyBest(trx, today, "visitors", entrant.guestId, body.claimed.score, runId);
        }
      });
      // Guests' scars live in localStorage (D-11) and their runs are not replayed (no server Friend to replay against).
      return { runId, verified: "pending", applied: false, reason: "guest", scars: null };
    }

    // Credit the whole streak up to now before this run can break it (best effort: never blocks the run).
    await observeWhole(ctx.db.kysely, entrant.tokenId, now).catch((error: unknown) =>
      request.log.warn({ err: error, tokenId: entrant.tokenId }, "whole streak check failed"),
    );

    const { applied_lost: appliedLost, ...ack } = await submitOwnerRun(ctx, entrant, body, inputs, runId);
    request.log.info({ runId, tokenId: entrant.tokenId, kind: body.kind, applied: ack.applied }, "run stored");
    if (appliedLost !== null && appliedLost !== EMPTY_MASK && ack.scars) {
      ctx.hub.updateToken(entrant.tokenId, { scarsHash: scarsHash(ack.scars) });
    }
    ctx.runs.enqueue(runId);
    return ack;
  });
}
