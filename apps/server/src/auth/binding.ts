import { checkFriendEligibility } from "../chain/eligibility.js";
import type { AppContext } from "../context.js";
import { HttpError } from "../http/errors.js";
import type { FriendBinding } from "../repos/index.js";
import type { OwnerSession } from "./session.js";

/** How stale a binding may be before a run submission re-checks ownership (architecture §1.6 step 5). */
export const RUN_RECHECK_MS = 10 * 60_000;

const denialError = (reason: "not_owner" | "not_hardwired") =>
  reason === "not_owner"
    ? new HttpError(403, "not_owner", "This wallet does not own that Friend.")
    : new HttpError(403, "not_owner", "Only hardwired (generation 1+) Friends can play as owners.", {
        reason: "not_hardwired",
      });

/**
 * Binds a Friend to the session after a fresh-block eligibility check (architecture §1.6 step 4).
 * On denial the session's previous binding is dropped too, so a failed re-pick never leaves a stale Friend.
 */
export async function bindFriend(ctx: AppContext, session: OwnerSession, tokenId: bigint): Promise<FriendBinding> {
  const result = await checkFriendEligibility(ctx.chain, ctx.deployment, tokenId, session.address);
  if (!result.ok) {
    await ctx.repos.bindings.delete(session.sid);
    throw denialError(result.reason);
  }
  const binding: FriendBinding = {
    sid: session.sid,
    tokenId: tokenId.toString(),
    address: session.address.toLowerCase(),
    tba: result.tba.toLowerCase(),
    block: Number(result.blockNumber),
    checkedAt: ctx.now(),
  };
  await ctx.repos.bindings.upsert(binding);
  return binding;
}

/**
 * Returns the session's binding, re-checking ownership at a fresh block when it is older than `maxAgeMs`
 * (0 = always: RF spends and WebSocket joins). A failed re-check deletes the binding and throws 403
 * `not_owner`/`not_hardwired`, which the client answers by re-picking. Missing binding → 403 `no_binding`.
 */
export async function requireBinding(ctx: AppContext, session: OwnerSession, maxAgeMs: number): Promise<FriendBinding> {
  const binding = await ctx.repos.bindings.get(session.sid);
  if (!binding) throw new HttpError(403, "forbidden", "Pick one of your Friends first.", { reason: "no_binding" });
  if (ctx.now().getTime() - binding.checkedAt.getTime() < maxAgeMs) return binding;
  return bindFriend(ctx, session, BigInt(binding.tokenId));
}
