import {
  GOLD_PIXEL_OUTCOME_ID,
  WEI_PER_MICRO,
  scarsHash,
  settleScars,
  snapshotToDto,
  weiToMicro,
  type GameSnapshotDto,
  type SeedPackApi,
  type TokenIdStr,
} from "@pl/shared";
import type { GamePlay } from "@rarefriends/friendsdk/game";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireBinding, RUN_RECHECK_MS } from "../auth/binding.js";
import { requireSession } from "../auth/session.js";
import type { AppContext } from "../context.js";
import { utcDay } from "../game/daily.js";
import { activeLocks, casWriteScars, readFriend, storedScars } from "../game/state.js";
import { grantDailySim } from "../game/wallet.js";
import { HttpError, validated } from "../http/errors.js";
import { enforceRateLimit } from "../http/guards.js";
import { reconcileHeldLeaves } from "../market/store.js";
import { withMarket } from "../market/tables.js";
import { onGoldKept } from "../meta/hooks.js";
import type { Executor } from "../repos/index.js";
import {
  LedgerError,
  SEED_PACK_GAME,
  buy,
  canBuy,
  play,
  redeem,
  settle,
  snapshot,
  type LedgerFailure,
  type LedgerState,
} from "./ledger.js";

const FAILURES: Record<
  LedgerFailure,
  { status: number; code: "bad_request" | "seedpack_reserve" | "insufficient_funds" | "not_found" }
> = {
  invalid_quantity: { status: 400, code: "bad_request" },
  invalid_play_id: { status: 400, code: "bad_request" },
  seedpack_reserve: { status: 409, code: "seedpack_reserve" },
  insufficient_funds: { status: 402, code: "insufficient_funds" },
  insufficient_consumables: { status: 409, code: "bad_request" },
  unknown_play: { status: 404, code: "not_found" },
  already_settled: { status: 409, code: "bad_request" },
  unknown_outcome: { status: 400, code: "bad_request" },
  no_redemption_value: { status: 400, code: "bad_request" },
  insufficient_inventory: { status: 409, code: "bad_request" },
  overflow: { status: 400, code: "bad_request" },
};

const REASONS: Partial<
  Record<
    LedgerFailure,
    | "invalid_quantity"
    | "unknown_play"
    | "already_settled"
    | "insufficient_consumables"
    | "insufficient_inventory"
    | "unknown_outcome"
    | "no_redemption_value"
  >
> = {
  invalid_quantity: "invalid_quantity",
  invalid_play_id: "unknown_play",
  insufficient_consumables: "insufficient_consumables",
  unknown_play: "unknown_play",
  already_settled: "already_settled",
  unknown_outcome: "unknown_outcome",
  no_redemption_value: "no_redemption_value",
  insufficient_inventory: "insufficient_inventory",
  overflow: "invalid_quantity",
};

/** Runs a pure ledger step, turning SDK-equivalent failures into HTTP errors with the SDK's own message. */
function step<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof LedgerError) {
      const f = FAILURES[error.failure];
      const reason = REASONS[error.failure];
      throw new HttpError(f.status, f.code, error.message, reason ? { reason } : {});
    }
    throw error;
  }
}

const micro = (wei: bigint): number => {
  try {
    return weiToMicro(wei);
  } catch {
    throw new HttpError(400, "bad_request", "Amount is out of range.", { reason: "invalid_quantity" });
  }
};
const wei = (m: number): bigint => BigInt(m) * WEI_PER_MICRO;

interface Loaded {
  readonly state: LedgerState;
  readonly packsSold: number;
}

/** Loads (and row-locks) the house, the Friend's balance, packs, inventory and plays. */
async function load(db: Executor, tokenId: TokenIdStr, stakeMicro: number): Promise<Loaded> {
  await db
    .insertInto("seedpack_house")
    .values({ id: 1, stake_micro: stakeMicro, reserved_micro: 0, liability_micro: 0 })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
  await db
    .insertInto("seedpack_friend")
    .values({ token_id: tokenId, inventory: JSON.stringify(SEED_PACK_GAME.outcomes.map(() => 0)) })
    .onConflict((oc) => oc.column("token_id").doNothing())
    .execute();
  const house = await db
    .selectFrom("seedpack_house")
    .selectAll()
    .where("id", "=", 1)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const friend = await readFriend(db, tokenId, true);
  if (!friend) throw new HttpError(403, "not_owner", "Pick your Friend again.", { reason: "unknown_friend" });
  const packs = await db
    .selectFrom("seedpack_friend")
    .selectAll()
    .where("token_id", "=", tokenId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const plays = await db
    .selectFrom("seedpack_plays")
    .select(["play_no", "outcome_id"])
    .where("token_id", "=", tokenId)
    .orderBy("play_no")
    .execute();
  const stored = Array.isArray(packs.inventory) ? packs.inventory : [];
  // Inventory order = outcome id − 1 (SDK), padded to the table length.
  const inventory = SEED_PACK_GAME.outcomes.map((_, i) => {
    const v = stored[i];
    return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : 0n;
  });
  return {
    packsSold: house.packs_sold,
    state: {
      friendId: BigInt(tokenId),
      rfBalance: wei(friend.sim_rf_micro),
      consumables: BigInt(packs.consumables),
      stake: wei(house.stake_micro),
      reservedPlays: wei(house.reserved_micro),
      rewardLiability: wei(house.liability_micro),
      inventory,
      plays: plays.map((p) => ({ id: BigInt(p.play_no), outcomeId: p.outcome_id })),
    },
  };
}

/** Persists the difference between two states of the same Friend. */
async function save(
  db: Executor,
  tokenId: TokenIdStr,
  before: Loaded,
  after: LedgerState,
  now: Date,
  settledPlay?: GamePlay,
): Promise<void> {
  const b = before.state;
  const sold = after.consumables - b.consumables + BigInt(after.plays.length - b.plays.length);
  await db
    .updateTable("seedpack_house")
    .set({
      stake_micro: micro(after.stake),
      reserved_micro: micro(after.reservedPlays),
      liability_micro: micro(after.rewardLiability),
      packs_sold: before.packsSold + Number(sold > 0n ? sold : 0n),
    })
    .where("id", "=", 1)
    .execute();
  if (after.rfBalance !== b.rfBalance) {
    await db
      .updateTable("friends")
      .set({ sim_rf_micro: micro(after.rfBalance) })
      .where("token_id", "=", tokenId)
      .execute();
  }
  if (after.consumables > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HttpError(400, "bad_request", "Too many packs.", { reason: "invalid_quantity" });
  }
  await db
    .updateTable("seedpack_friend")
    .set({
      consumables: Number(after.consumables),
      inventory: JSON.stringify(after.inventory.map((v) => Number(v))),
    })
    .where("token_id", "=", tokenId)
    .execute();
  const added = after.plays.slice(b.plays.length);
  if (added.length > 0) {
    await db
      .insertInto("seedpack_plays")
      .values(
        added.map((p) => ({
          token_id: tokenId,
          play_no: Number(p.id),
          outcome_id: null,
          created_at: now,
          settled_at: null,
        })),
      )
      .execute();
  }
  if (settledPlay && settledPlay.outcomeId !== null) {
    await db
      .updateTable("seedpack_plays")
      .set({ outcome_id: settledPlay.outcomeId, settled_at: now })
      .where("token_id", "=", tokenId)
      .where("play_no", "=", Number(settledPlay.id))
      .where("settled_at", "is", null)
      .execute();
  }
}

const goldOf = (s: LedgerState) => Number(s.inventory[GOLD_PIXEL_OUTCOME_ID - 1] ?? 0n);

/**
 * Registers `POST /api/seedpack/{read,canBuy,buy,play,settle,redeem}`: the server half of the venue's
 * `ServerLedgerClient` (architecture §1.5, sim column). Session + bound Friend; buy/play/redeem re-check ownership at a
 * fresh block (§1.6 step 5). Every mutation runs in one transaction with the house and Friend rows locked.
 */
export function registerSeedPackRoutes(app: FastifyInstance, ctx: AppContext): void {
  const owner = async (request: FastifyRequest, fresh: boolean) => {
    if (ctx.config.economyMode !== "sim") {
      throw new HttpError(503, "unavailable", "Live mode uses the on-chain Seed Pack.", { reason: "sim_only" });
    }
    const session = await requireSession(ctx, request.headers);
    enforceRateLimit(ctx.limiters.writes, `addr:${session.address.toLowerCase()}`);
    return requireBinding(ctx, session, fresh ? 0 : RUN_RECHECK_MS);
  };

  /** One locked read-modify-write of the ledger; `apply` returns the new state (or null for read-only). */
  const mutate = async <R>(
    tokenId: TokenIdStr,
    apply: (state: LedgerState) => { state: LedgerState | null; result: R; settled?: GamePlay },
  ): Promise<R> => {
    const now = ctx.now();
    const done = await ctx.db.kysely.transaction().execute(async (trx) => {
      await grantDailySim(trx, tokenId, utcDay(now));
      const before = await load(trx, tokenId, ctx.config.seedpackStakeMicro);
      const out = step(() => apply(before.state));
      if (!out.state) return { out, goldBefore: goldOf(before.state), goldAfter: goldOf(before.state), hash: null };
      const goldBefore = goldOf(before.state);
      const goldAfter = goldOf(out.state);
      let hash: string | null = null;
      if (goldAfter > goldBefore) {
        // A new Gold speeds regrowth only from now on (tokenomics §4: min held over each interval): materialise the
        // regrowth accrued so far at the old rate before the inventory changes.
        const row = await readFriend(trx, tokenId, true);
        if (row) {
          const state = storedScars(row);
          const settledNow = settleScars(state, now.getTime(), tokenId, {
            goldHeld: goldBefore,
            locked: await activeLocks(trx, tokenId, now),
          });
          const next = { ...settledNow, version: state.version + 1 };
          if (await casWriteScars(trx, tokenId, state.version, next)) hash = scarsHash(next);
        }
      }
      await save(trx, tokenId, before, out.state, now, out.settled);
      if (goldAfter < goldBefore) {
        // Golds redeemed through the Seed Pack leave the market too: bought leaves beyond the new count are retired
        // (market lock order: leaves come after seedpack_friend, which `load` already holds).
        await reconcileHeldLeaves(withMarket(trx), tokenId, goldAfter, now);
      }
      if (out.settled?.outcomeId === GOLD_PIXEL_OUTCOME_ID) {
        // A Gold grown from a pack stays on the Friend unless redeemed: the "Gold Keeper" stamp (GDD §12.5).
        await onGoldKept(trx, tokenId, now);
      }
      return { out, goldBefore, goldAfter, hash };
    });
    if (done.goldAfter !== done.goldBefore) {
      ctx.hub.updateToken(tokenId, { goldHeld: done.goldAfter, ...(done.hash ? { scarsHash: done.hash } : {}) });
    }
    return done.out.result;
  };

  const snap = (s: LedgerState): GameSnapshotDto => snapshotToDto(snapshot(s));

  app.post("/api/seedpack/read", async (request): Promise<SeedPackApi["read"]["res"]> => {
    validated("POST /api/seedpack/read", request.body ?? {});
    const b = await owner(request, false);
    return mutate(b.tokenId, (s) => ({ state: null, result: snap(s) }));
  });

  app.post("/api/seedpack/canBuy", async (request): Promise<SeedPackApi["canBuy"]["res"]> => {
    const { quantity } = validated("POST /api/seedpack/canBuy", request.body);
    const b = await owner(request, false);
    return mutate(b.tokenId, (s) => ({ state: null, result: { ok: canBuy(s, BigInt(quantity)) } }));
  });

  app.post("/api/seedpack/buy", async (request): Promise<SeedPackApi["buy"]["res"]> => {
    const { quantity } = validated("POST /api/seedpack/buy", request.body);
    const b = await owner(request, true);
    return mutate(b.tokenId, (s) => {
      const next = buy(s, BigInt(quantity));
      return { state: next, result: snap(next) };
    });
  });

  app.post("/api/seedpack/play", async (request): Promise<SeedPackApi["play"]["res"]> => {
    const { quantity } = validated("POST /api/seedpack/play", request.body ?? {});
    const b = await owner(request, true);
    return mutate(b.tokenId, (s) => {
      const { state, added } = play(s, quantity === undefined ? 1n : BigInt(quantity));
      return { state, result: { plays: added.map((p) => ({ id: p.id.toString(), outcomeId: p.outcomeId })) } };
    });
  });

  app.post("/api/seedpack/settle", async (request): Promise<SeedPackApi["settle"]["res"]> => {
    const { playId } = validated("POST /api/seedpack/settle", request.body);
    const b = await owner(request, false);
    return mutate(b.tokenId, (s) => {
      const { state, play: settled } = settle(s, BigInt(playId), ctx.seedpackDraw);
      return { state, settled, result: { id: settled.id.toString(), outcomeId: settled.outcomeId } };
    });
  });

  app.post("/api/seedpack/redeem", async (request): Promise<SeedPackApi["redeem"]["res"]> => {
    const { outcomeId, quantity } = validated("POST /api/seedpack/redeem", request.body);
    const b = await owner(request, true);
    return mutate(b.tokenId, (s) => {
      const next = redeem(s, outcomeId, BigInt(quantity));
      return { state: next, result: snap(next) };
    });
  });
}
