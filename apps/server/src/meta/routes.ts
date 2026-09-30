import { randomUUID } from "node:crypto";
import {
  BELTS,
  CATALOG,
  catalogItem,
  currentBelt,
  parseBuy,
  parseHomeSave,
  homeTerraces,
  isTokenIdStr,
  itemCost,
  itemOwner,
  microToWei,
  nextPlotPrice,
  STAMPS,
  validateLayout,
  beltRank,
  type BuyRes,
  type CatalogItem,
  type HomeView,
  type MetaParse,
  type MetaMeRes,
  type PlotRes,
  type StampId,
  type TokenIdStr,
} from "@pl/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "kysely";
import { requireBinding, RUN_RECHECK_MS } from "../auth/binding.js";
import { requireSession } from "../auth/session.js";
import { checkFriendEligibility } from "../chain/eligibility.js";
import type { AppContext } from "../context.js";
import { HttpError } from "../http/errors.js";
import { enforceRateLimit } from "../http/guards.js";
import type { FriendBinding } from "../repos/index.js";
import { heldStamps, passedBelts, readStats, recordMetaEvent } from "./hooks.js";
import { bitsBalance, debitBits } from "../game/wallet.js";
import { homeView, lockIsle, ownedItems, writeIsle } from "./store.js";
import { metaDb } from "./tables.js";

/** Most copies of one item an owner can hold. */
const MAX_QTY = 99;

function parse<T>(result: MetaParse<T>): T {
  if (!result.ok) throw new HttpError(400, "bad_request", result.error);
  return result.value;
}

async function ownerBinding(ctx: AppContext, request: FastifyRequest, maxAgeMs: number): Promise<FriendBinding> {
  const session = await requireSession(ctx, request.headers);
  enforceRateLimit(ctx.limiters.writes, `addr:${session.address.toLowerCase()}`);
  return requireBinding(ctx, session, maxAgeMs);
}

async function assertUnlocked(ctx: AppContext, tokenId: TokenIdStr, item: CatalogItem): Promise<void> {
  if (!item.unlock) return;
  if ("stamp" in item.unlock) {
    if (!(await heldStamps(ctx.db.kysely, tokenId)).has(item.unlock.stamp)) {
      throw new HttpError(403, "forbidden", `Earn the "${item.unlock.stamp}" stamp to unlock ${item.name}.`);
    }
    return;
  }
  const worn = currentBelt(await passedBelts(ctx.db.kysely, tokenId));
  if (worn === null || beltRank(worn) < beltRank(item.unlock.belt)) {
    throw new HttpError(403, "forbidden", `Earn the ${item.unlock.belt} belt to unlock ${item.name}.`);
  }
}

/**
 * Home island + catalog + stamp book endpoints (GDD §12.3–12.5, tokenomics §7):
 * - `GET  /api/meta/catalog`        static catalog, stamp and belt definitions
 * - `GET  /api/home/:tokenId`       public isle view (layout, hat, belt, stamps)
 * - `GET  /api/meta/me`             the bound Friend's isle + Bits + wardrobe + counters
 * - `PUT  /api/home`                save the bound Friend's layout / hat / open toggle (validated grid placement)
 * - `POST /api/meta/buy`            buy one item with Bits, or RF decor (sim ledger, 50/50 burn/stream)
 * - `POST /api/meta/plot`           buy the next island plot with Bits
 * - `POST /api/home/:tokenId/visit` count a visit to another Friend's open isle (Isle Hopper stamp)
 */
export function registerMetaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const catalog = { items: CATALOG, stamps: STAMPS, belts: BELTS };

  app.get("/api/meta/catalog", async (_request, reply) => {
    reply.header("cache-control", "public, max-age=300");
    return catalog;
  });

  app.get<{ Params: { tokenId: string } }>("/api/home/:tokenId", async (request, reply): Promise<HomeView> => {
    const { tokenId } = request.params;
    if (!isTokenIdStr(tokenId)) throw new HttpError(400, "bad_token", "Invalid token id.");
    reply.header("cache-control", "public, max-age=15");
    return homeView(ctx.db.kysely, tokenId);
  });

  app.get("/api/meta/me", async (request): Promise<MetaMeRes> => {
    const binding = await ownerBinding(ctx, request, RUN_RECHECK_MS);
    const db = ctx.db.kysely;
    const [home, bits, owned, stats, friend] = await Promise.all([
      homeView(db, binding.tokenId),
      bitsBalance(db, binding.address),
      ownedItems(db, binding.address, binding.tokenId),
      readStats(db, binding.tokenId),
      db.selectFrom("friends").select("sim_rf_micro").where("token_id", "=", binding.tokenId).executeTakeFirst(),
    ]);
    const economy = ctx.config.economyMode;
    return {
      home,
      bits,
      owned,
      stats,
      economy,
      ...(economy === "sim" && friend ? { simRfMicro: friend.sim_rf_micro } : {}),
    };
  });

  app.put("/api/home", async (request): Promise<HomeView> => {
    const session = await requireSession(ctx, request.headers);
    enforceRateLimit(ctx.limiters.writes, `addr:${session.address.toLowerCase()}`);
    const body = parse(parseHomeSave(request.body));
    const binding = await requireBinding(ctx, session, RUN_RECHECK_MS);
    // Fresh-block read: the generation sets the terrace count (Promote = more land) and re-proves ownership.
    const elig = await checkFriendEligibility(ctx.chain, ctx.deployment, BigInt(binding.tokenId), session.address);
    if (!elig.ok) throw new HttpError(403, "not_owner", "This wallet no longer owns that Friend.");
    const tokenId = binding.tokenId;
    const now = ctx.now();
    await ctx.db.kysely.transaction().execute(async (trx) => {
      const isle = await lockIsle(trx, tokenId, now);
      const owned = await ownedItems(trx, binding.address, tokenId);
      const terraces = homeTerraces(elig.generation, isle.plots);
      const check = validateLayout(body.layout, { terraces, owned });
      if (!check.ok) {
        throw new HttpError(400, "bad_request", `Item ${check.index + 1} can't go there (${check.error}).`);
      }
      if (body.hat !== undefined && body.hat !== null) {
        const hat = catalogItem(body.hat);
        if (!hat || hat.kind !== "hat") throw new HttpError(400, "bad_request", "That is not a hat.");
        if ((owned[hat.id] ?? 0) < 1) throw new HttpError(403, "forbidden", "Buy that hat first.");
      }
      await writeIsle(
        trx,
        tokenId,
        {
          layout: body.layout,
          generation: elig.generation,
          ...(body.hat !== undefined ? { hat: body.hat } : {}),
          ...(body.open !== undefined ? { open: body.open } : {}),
        },
        now,
      );
      await recordMetaEvent(trx, tokenId, { kind: "home_saved", items: body.layout.items.length }, now);
    });
    request.log.info({ tokenId, items: body.layout.items.length }, "home saved");
    return homeView(ctx.db.kysely, tokenId);
  });

  app.post("/api/meta/buy", async (request): Promise<BuyRes> => {
    const { itemId } = parse(parseBuy(request.body));
    const item = catalogItem(itemId);
    if (!item) throw new HttpError(404, "not_found", "No such catalog item.");
    const cost = itemCost(item);
    // RF spends re-check ownership at a fresh block (architecture §1.6, like Regrow and Mend).
    const binding = await ownerBinding(ctx, request, cost.rfMicro > 0 ? 0 : RUN_RECHECK_MS);
    if (cost.rfMicro > 0) {
      enforceRateLimit(ctx.limiters.economy, `addr:${binding.address}`);
      if (ctx.config.economyMode !== "sim") {
        throw new HttpError(400, "bad_request", "RF decor is only available in simulated mode for now.");
      }
    }
    await assertUnlocked(ctx, binding.tokenId, item);
    const tokenId = binding.tokenId;
    const account = binding.address.toLowerCase();
    const now = ctx.now();

    const result = await ctx.db.kysely.transaction().execute(async (trx) => {
      const m = metaDb(trx);
      let simRfMicro: number | undefined;
      let receipt: BuyRes["receipt"];
      if (cost.rfMicro > 0) {
        const debited = await trx
          .updateTable("friends")
          .set({ sim_rf_micro: sql<number>`sim_rf_micro - ${cost.rfMicro}` })
          .where("token_id", "=", tokenId)
          .where("sim_rf_micro", ">=", cost.rfMicro)
          .returning("sim_rf_micro")
          .executeTakeFirst();
        if (!debited) throw new HttpError(402, "insufficient_funds", "Not enough simulated RF.");
        simRfMicro = debited.sim_rf_micro;
        const id = `sim:${randomUUID()}`;
        // Same ledger shape as Regrow: burn + stream = total, nothing to a target (PixelSplitter spend(DECOR)).
        await trx
          .insertInto("rf_ledger")
          .values({
            id,
            kind: "decor",
            mode: "sim",
            payer_token: tokenId,
            target_token: null,
            pixels: null,
            total: microToWei(cost.rfMicro),
            burn: microToWei(cost.burnMicro),
            stream: microToWei(cost.streamMicro),
            to_target: "0",
            tx_hash: null,
            log_index: null,
            block: null,
            created_at: now,
          })
          .execute();
        receipt = { id, totalMicro: cost.rfMicro, burnMicro: cost.burnMicro, streamMicro: cost.streamMicro };
      }
      let bits: number | null = await bitsBalance(trx, account);
      if (cost.bits > 0) {
        bits = await debitBits(trx, account, cost.bits, now);
        if (bits === null) throw new HttpError(402, "insufficient_funds", "Not enough Bits.");
        await m
          .insertInto("bits_spends")
          .values({
            id: `bits:${randomUUID()}`,
            account,
            token_id: tokenId,
            kind: cost.rfMicro > 0 ? "blueprint" : "item",
            ref: item.id,
            amount: cost.bits,
            created_at: now,
          })
          .execute();
      }
      const owner = itemOwner(item);
      const row =
        owner === "friend"
          ? await m
              .insertInto("friend_decor")
              .values({ token_id: tokenId, item_id: item.id, qty: 1, first_at: now })
              .onConflict((oc) =>
                oc
                  .columns(["token_id", "item_id"])
                  .doUpdateSet({ qty: sql<number>`friend_decor.qty + 1` })
                  .where("friend_decor.qty", "<", MAX_QTY),
              )
              .returning("qty")
              .executeTakeFirst()
          : await m
              .insertInto("wardrobe_items")
              .values({ account, item_id: item.id, qty: 1, first_at: now })
              .onConflict((oc) =>
                oc
                  .columns(["account", "item_id"])
                  .doUpdateSet({ qty: sql<number>`wardrobe_items.qty + 1` })
                  .where("wardrobe_items.qty", "<", MAX_QTY),
              )
              .returning("qty")
              .executeTakeFirst();
      if (!row) throw new HttpError(409, "bad_request", `You already own ${MAX_QTY} of those.`);
      const award = await recordMetaEvent(trx, tokenId, { kind: "item_bought", item: item.id }, now);
      return { owned: row.qty, bits, simRfMicro, receipt, stamps: award.stamps };
    });

    request.log.info({ tokenId, item: item.id, bits: cost.bits, rfMicro: cost.rfMicro }, "meta item bought");
    return {
      item: item.id,
      owned: result.owned,
      bits: result.bits,
      ...(result.simRfMicro !== undefined ? { simRfMicro: result.simRfMicro } : {}),
      ...(result.receipt ? { receipt: result.receipt } : {}),
      stamps: result.stamps as StampId[],
    };
  });

  app.post("/api/meta/plot", async (request): Promise<PlotRes> => {
    const binding = await ownerBinding(ctx, request, RUN_RECHECK_MS);
    const tokenId = binding.tokenId;
    const account = binding.address.toLowerCase();
    const now = ctx.now();
    return ctx.db.kysely.transaction().execute(async (trx) => {
      const isle = await lockIsle(trx, tokenId, now);
      const price = nextPlotPrice(isle.plots);
      if (price === null) throw new HttpError(409, "bad_request", "This isle has every plot already.");
      const bits = await debitBits(trx, account, price, now);
      if (bits === null) throw new HttpError(402, "insufficient_funds", "Not enough Bits.");
      await metaDb(trx)
        .insertInto("bits_spends")
        .values({
          id: `bits:${randomUUID()}`,
          account,
          token_id: tokenId,
          kind: "plot",
          ref: `plot-${isle.plots + 1}`,
          amount: price,
          created_at: now,
        })
        .execute();
      const plots = isle.plots + 1;
      await writeIsle(trx, tokenId, { plots }, now);
      return { plots, terraces: homeTerraces(isle.generation ?? 0, plots), bits };
    });
  });

  app.post<{ Params: { tokenId: string } }>("/api/home/:tokenId/visit", async (request) => {
    const { tokenId: owner } = request.params;
    if (!isTokenIdStr(owner)) throw new HttpError(400, "bad_token", "Invalid token id.");
    const binding = await ownerBinding(ctx, request, RUN_RECHECK_MS);
    if (owner === binding.tokenId) return { stamps: [] };
    const isle = await metaDb(ctx.db.kysely)
      .selectFrom("home_isles")
      .select("open")
      .where("token_id", "=", owner)
      .executeTakeFirst();
    if (!isle?.open) throw new HttpError(403, "forbidden", "That isle is not open for visits.");
    const award = await recordMetaEvent(ctx.db.kysely, binding.tokenId, { kind: "isle_visited", owner }, ctx.now());
    return { stamps: award.stamps };
  });
}
