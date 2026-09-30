import type { EconomyRequestRes, QuoteRes } from "@pl/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireBinding } from "../auth/binding.js";
import { requireSession } from "../auth/session.js";
import type { AppContext } from "../context.js";
import { HttpError, validated } from "../http/errors.js";
import { enforceRateLimit } from "../http/guards.js";
import type { FriendBinding } from "../repos/index.js";
import { priced } from "./common.js";
import { executeLive, issueLiveQuote } from "./live.js";
import { executeSim } from "./sim.js";

/**
 * RF spends require a session, the economy rate limit (20/min/address) and a binding re-checked at a fresh block
 * (architecture §1.6 step 5: every RF-spending action).
 */
async function spender(ctx: AppContext, request: FastifyRequest): Promise<FriendBinding> {
  const session = await requireSession(ctx, request.headers);
  enforceRateLimit(ctx.limiters.economy, `addr:${session.address.toLowerCase()}`);
  return requireBinding(ctx, session, 0);
}

/** Registers `/api/economy/{quote,regrow,mend}` (architecture §4.3; sim and live paths kept separate). */
export function registerEconomyRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/economy/quote", async (request): Promise<QuoteRes> => {
    const action = validated("POST /api/economy/quote", request.body);
    if (ctx.config.economyMode === "live") return issueLiveQuote(ctx, await spender(ctx, request), action);
    // Sim: the pure shared quote, for anyone (guests see prices on the CTA too).
    enforceRateLimit(ctx.limiters.writes, `ip:${request.clientIp}`);
    return priced(action, "sim");
  });

  for (const kind of ["regrow", "mend"] as const) {
    const route = `POST /api/economy/${kind}` as const;
    app.post(`/api/economy/${kind}`, async (request): Promise<EconomyRequestRes> => {
      const body = validated(route, request.body);
      const binding = await spender(ctx, request);
      if (body.action.kind !== kind) {
        throw new HttpError(400, "bad_request", `This endpoint only accepts ${kind}.`);
      }
      const receipt =
        ctx.config.economyMode === "live"
          ? await executeLive(ctx, binding, body.action, body.quoteId, body.txHash)
          : await executeSim(ctx, binding, body.action);
      request.log.info({ id: receipt.id, kind, totalMicro: receipt.quote.totalMicro }, "economy action");
      return receipt;
    });
  }
}
