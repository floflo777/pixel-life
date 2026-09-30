import { tokenIdToBigInt, type FriendView, type GuestRes, type NonceRes, type OkRes, type VerifyRes } from "@pl/shared";
import type { FastifyInstance } from "fastify";
import { bindFriend } from "../auth/binding.js";
import {
  clearSessionCookie,
  issueGuest,
  readGuest,
  readSession,
  requireSession,
  startSession,
} from "../auth/session.js";
import { issueNonce, verifySiwe } from "../auth/siwe.js";
import type { AppContext } from "../context.js";
import { validated } from "../http/errors.js";
import { enforceRateLimit } from "../http/guards.js";

/**
 * Identity endpoints (architecture §1.6, §4.3) with the shared `ApiEndpoints` DTOs:
 * SIWE nonce/verify/logout, guest cookie, and Friend binding (fresh-block eligibility → `FriendView`).
 */
export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/auth/nonce", async (request): Promise<NonceRes> => {
    enforceRateLimit(ctx.limiters.auth, `ip:${request.clientIp}`);
    const { nonce } = await issueNonce(ctx);
    return { nonce };
  });

  app.post("/api/auth/verify", async (request, reply): Promise<VerifyRes> => {
    enforceRateLimit(ctx.limiters.auth, `ip:${request.clientIp}`);
    const body = validated("POST /api/auth/verify", request.body);
    const address = await verifySiwe(ctx, body);
    // Rotate: a new sign-in revokes the session this browser held before.
    const previous = await readSession(ctx, request.headers);
    if (previous) await ctx.repos.sessions.revoke(previous.sid, ctx.now());
    const { session, setCookie } = await startSession(ctx, address);
    request.log.info({ address, sid: session.sid }, "session started");
    reply.header("set-cookie", setCookie);
    return { address };
  });

  app.post("/api/auth/logout", async (request, reply): Promise<OkRes> => {
    const session = await readSession(ctx, request.headers);
    if (session) await ctx.repos.sessions.revoke(session.sid, ctx.now());
    reply.header("set-cookie", clearSessionCookie(ctx));
    return { ok: true };
  });

  app.post("/api/guest", async (request, reply): Promise<GuestRes> => {
    const existing = readGuest(ctx, request.headers);
    if (existing) return { guestId: existing.guestId };
    enforceRateLimit(ctx.limiters.guest, `ip:${request.clientIp}`);
    const { guest, setCookie } = issueGuest(ctx);
    reply.header("set-cookie", setCookie);
    return { guestId: guest.guestId };
  });

  app.post("/api/session/friend", async (request): Promise<FriendView> => {
    const session = await requireSession(ctx, request.headers);
    enforceRateLimit(ctx.limiters.writes, `addr:${session.address.toLowerCase()}`);
    const { tokenId } = validated("POST /api/session/friend", request.body);
    const binding = await bindFriend(ctx, session, tokenIdToBigInt(tokenId));
    request.log.info({ sid: session.sid, tokenId: binding.tokenId, block: binding.block }, "friend bound");
    return ctx.friends.onBound(binding);
  });

  /** Drops the bound Friend (the client re-picks after an account/Friend change). Not in ApiEndpoints yet. */
  app.delete("/api/session/friend", async (request): Promise<OkRes> => {
    const session = await requireSession(ctx, request.headers);
    await ctx.repos.bindings.delete(session.sid);
    return { ok: true };
  });
}
