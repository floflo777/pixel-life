/**
 * Production wiring of the owner flow: loads the SDK wallet / discovery / identity modules (and viem) on demand, so a
 * guest who never taps "Use my Friend" downloads none of it. One flow per page.
 */
import type { Api } from "../api/client.js";
import type { IdentityController } from "./store.js";
import type { OwnerFlow } from "./owner-flow.js";

let pending: Promise<OwnerFlow> | null = null;

/** The page's owner flow, created on first use (restores an already-authorised wallet without prompting). */
export function loadOwnerFlow(api: Api, identity: IdentityController): Promise<OwnerFlow> {
  pending ??= (async () => {
    const [{ createOwnerFlow }, wallet, owned, ident] = await Promise.all([
      import("./owner-flow.js"),
      import("@rarefriends/friendsdk/wallet"),
      import("@rarefriends/friendsdk/owned"),
      import("@rarefriends/friendsdk/identity"),
    ]);
    const session = wallet.createFriendWalletSession();
    const flow = createOwnerFlow({
      session,
      publicClient: wallet.createFriendPublicClient(),
      readOwnedFriends: (client, account) => owned.readOwnedFriends(client, account),
      readGenerationEligibility: (client, tokenId, player) => ident.readGenerationEligibility(client, tokenId, player),
      api,
      identity,
      origin: location.origin,
    });
    // Discovery/restoration never prompts (SDK contract); a previously authorised wallet reconnects silently.
    void session.refresh().catch(() => undefined);
    return flow;
  })().catch((e: unknown) => {
    pending = null;
    throw e;
  });
  return pending;
}

/** The flow if it was already loaded (no import side effects). */
export function peekOwnerFlow(): Promise<OwnerFlow> | null {
  return pending;
}
