import {
  MARKET,
  marketPriceProblem,
  marketSchemas,
  type MarketActionRes,
  type MarketBookRes,
  type MarketBuyRes,
  type MarketInboxItem,
  type MarketMineRes,
} from "@pl/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { RUN_RECHECK_MS, requireBinding } from "../auth/binding.js";
import { requireSession } from "../auth/session.js";
import type { AppContext } from "../context.js";
import { HttpError } from "../http/errors.js";
import { enforceRateLimit } from "../http/guards.js";
import { onGoldKept } from "../meta/hooks.js";
import type { FriendBinding } from "../repos/index.js";
import { MarketError } from "./errors.js";
import { buyGold, cancelListing, listGold, mine, orderBook, type MarketEffects } from "./store.js";
import { withMarket } from "./tables.js";

/**
 * The realtime hooks the market calls after a commit, when the app has a hub (`ctx.hub`, T7b): push the inbox notice
 * to the owner's sockets and refresh the Friend's presence (Gold count, scars). Every method is optional.
 */
export interface MarketHub {
  notify?(owner: string, item: MarketInboxItem): void;
  updateToken?(tokenId: string, patch: { goldHeld?: number; scarsHash?: string }): void;
}

/** Options of {@link marketRoutes}. `hub` overrides the one found on `ctx` (tests). */
export interface MarketRoutesOptions {
  readonly ctx: AppContext;
  readonly hub?: MarketHub;
}

/** The app's hub if it has one: duck-typed so the market works with or without the realtime layer. */
function hubOf(ctx: AppContext): MarketHub | null {
  const hub = (ctx as unknown as { hub?: unknown }).hub;
  return typeof hub === "object" && hub !== null ? (hub as MarketHub) : null;
}

/** The part of a zod schema the routes use (keeps the server free of a direct zod dependency). */
interface Schema<T> {
  safeParse(raw: unknown): { success: true; data: T } | { success: false };
}

/**
 * Pushes a committed trade's effects to the hub: presence refresh for every Friend whose Gold count changed, then the
 * inbox notices to their owners. Never throws: the trade is committed and the inbox already holds the notices.
 */
export function publishMarketEffects(
  hub: MarketHub | null,
  effects: MarketEffects,
  onError: (error: unknown) => void,
): void {
  if (!hub) return;
  try {
    for (const g of effects.gold) {
      hub.updateToken?.(g.tokenId, { goldHeld: g.goldHeld, ...(g.scarsHash ? { scarsHash: g.scarsHash } : {}) });
    }
    for (const n of effects.notices) if (n.owner) hub.notify?.(n.owner, n.item);
  } catch (error) {
    onError(error);
  }
}

function parse<T>(schema: Schema<T>, raw: unknown): T {
  const result = schema.safeParse(raw ?? {});
  if (!result.success) throw new HttpError(400, "bad_request", "Invalid market request.");
  return result.data;
}

/**
 * SIMULATED Gold Pixel market (tokenomics §6 phase 1, `contracts/src/GoldPixelMarket.sol`), as a Fastify plugin:
 *
 * - `GET  /api/market/book`   public order book: asks (cheapest first), floor, recent fills, 24 h volume.
 * - `GET  /api/market/mine`   the bound Friend's Golds, asks and royalties.
 * - `POST /api/market/list`   `{ priceMicro, leafId? }` escrow one Gold and ask a fixed price (45–10,000 RF, 0.01 steps).
 * - `POST /api/market/cancel` `{ leafId }` take the ask down; the Gold returns to the seller Friend.
 * - `POST /api/market/buy`    `{ leafId, expectedPriceMicro }` buy at exactly the price seen (front-run protection).
 *
 * Writes need a session and a bound Friend re-checked on chain at a fresh block, are rate-limited per wallet
 * (`economy` scope), and run in one transaction; hub pushes happen only after the commit. Sim mode only.
 */
export const marketRoutes: FastifyPluginAsync<MarketRoutesOptions> = async (app, opts) => {
  const { ctx } = opts;
  const db = withMarket(ctx.db.kysely);
  const hub = opts.hub ?? hubOf(ctx);

  const owner = async (request: FastifyRequest, fresh: boolean): Promise<FriendBinding> => {
    const session = await requireSession(ctx, request.headers);
    const scope = fresh ? ctx.limiters.economy : ctx.limiters.writes;
    enforceRateLimit(scope, `addr:${session.address.toLowerCase()}`);
    if (fresh && ctx.config.economyMode !== "sim") {
      throw new MarketError("sim_only", "The Gold market is simulated in this build; live trading needs the contract.");
    }
    return requireBinding(ctx, session, fresh ? 0 : RUN_RECHECK_MS);
  };

  const publish = (effects: MarketEffects) =>
    publishMarketEffects(hub, effects, (error) => app.log.warn({ err: error }, "market hub push failed"));

  app.get("/api/market/book", async (request): Promise<MarketBookRes> => {
    const { limit } = parse(marketSchemas.book, request.query);
    const book = await orderBook(db, { limit: limit ?? MARKET.bookDepth, now: ctx.now() });
    return { mode: ctx.config.economyMode, simulated: true, backingMicro: MARKET.backingMicro, ...book };
  });

  app.get("/api/market/mine", async (request): Promise<MarketMineRes> => {
    const binding = await owner(request, false);
    return { simulated: true, tokenId: binding.tokenId, ...(await mine(db, binding.tokenId)) };
  });

  app.post("/api/market/list", async (request): Promise<MarketActionRes> => {
    const body = parse(marketSchemas.list, request.body);
    const problem = marketPriceProblem(body.priceMicro);
    if (problem) {
      throw new MarketError(
        "bad_price",
        `Price must be ${MARKET.minPriceMicro / 1e6}–${MARKET.maxPriceMicro / 1e6} RF in 0.01 RF steps (${problem}).`,
      );
    }
    const binding = await owner(request, true);
    const result = await db
      .transaction()
      .execute((trx) =>
        listGold(trx, { seller: binding.tokenId, priceMicro: body.priceMicro, leafId: body.leafId, now: ctx.now() }),
      );
    publish(result.effects);
    return { simulated: true, event: result.event, goldHeld: result.goldHeld };
  });

  app.post("/api/market/cancel", async (request): Promise<MarketActionRes> => {
    const { leafId } = parse(marketSchemas.cancel, request.body);
    const binding = await owner(request, true);
    const result = await db
      .transaction()
      .execute((trx) => cancelListing(trx, { seller: binding.tokenId, leafId, now: ctx.now() }));
    publish(result.effects);
    return { simulated: true, event: result.event, goldHeld: result.goldHeld };
  });

  app.post("/api/market/buy", async (request): Promise<MarketBuyRes> => {
    const { leafId, expectedPriceMicro } = parse(marketSchemas.buy, request.body);
    const binding = await owner(request, true);
    const now = ctx.now();
    const result = await ctx.db.kysely.transaction().execute(async (trx) => {
      const bought = await buyGold(withMarket(trx), { buyer: binding.tokenId, leafId, expectedPriceMicro, now });
      // The buyer now keeps a Gold Pixel on its Friend: same meta event as a Gold kept from a Seed Pack (Gold Keeper).
      // Taken last, after every market lock, like every other meta hook.
      await onGoldKept(trx, binding.tokenId, now);
      return bought;
    });
    request.log.info({ leafId, buyer: binding.tokenId, price: result.fill.priceMicro }, "market sale (simulated)");
    publish(result.effects);
    return { simulated: true, fill: result.fill, goldHeld: result.goldHeld, balanceMicro: result.balanceMicro };
  });
};
