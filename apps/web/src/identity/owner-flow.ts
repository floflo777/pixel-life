/**
 * "Use my Friend" (architecture §1.3 / §1.6, GDD §6.8): the owner flow as a small state machine over the SDK's own
 * trusted modules, which are injected so tests can drive it without a browser wallet or chain:
 *
 *   connect (createFriendWalletSession) → discover (readOwnedFriends) → pick (our GameMenu picker)
 *   → fresh gate (readGenerationEligibility, same sequence as the SDK host) → SIWE (nonce, personal_sign, verify)
 *   → POST /api/session/friend (the server repeats the fresh-block check) → identity = owner.
 *
 * Every async step captures the wallet session `revision`; a newer revision (account, chain or provider change) aborts
 * it. A stable account/chain change drops the bound Friend (closing SDK venues via the identity revision) and
 * re-runs discovery, as the SDK requires.
 */
import type { FriendWalletSnapshot } from "@rarefriends/friendsdk/wallet";
import type { OwnedFriend, OwnedFriendsClient } from "@rarefriends/friendsdk/owned";
import type { GenerationIdentityClient } from "@rarefriends/friendsdk/identity";
import type { FriendView } from "@pl/shared";
import type { Address } from "viem";
import { ApiRequestError, errorMessage, type Api } from "../api/client.js";
import { createStore, type Store } from "../lib/store.js";
import { buildSiweMessage, personalSign, type SignProvider } from "./siwe.js";
import type { IdentityController } from "./store.js";

/** Robinhood Chain mainnet: the only chain the SDK gate accepts. */
export const ROBINHOOD_CHAIN_ID = 4663;

/** The SDK wallet session surface the flow uses (`createFriendWalletSession()` satisfies it). */
export interface WalletSessionLike {
  getSnapshot(): FriendWalletSnapshot;
  getProvider(): SignProvider | null;
  subscribe(listener: () => void): () => void;
  connect(walletId?: string): Promise<FriendWalletSnapshot>;
  refresh(): Promise<FriendWalletSnapshot>;
  switchNetwork(): Promise<FriendWalletSnapshot>;
  disconnect(): void;
  dispose(): void;
}

/** Result of SDK `readGenerationEligibility`. */
export interface Eligibility {
  readonly generation: number;
  readonly hardwired: boolean;
  readonly ownedByPlayer: boolean | null;
  readonly eligible: boolean | null;
  readonly blockNumber: bigint;
}

/** Everything the flow needs; production wiring lives in `owner-flow-loader.ts`. */
export interface OwnerFlowDeps {
  session: WalletSessionLike;
  publicClient: GenerationIdentityClient & OwnedFriendsClient;
  readOwnedFriends(
    client: OwnedFriendsClient,
    account: Address,
  ): Promise<{ friends: readonly OwnedFriend[]; blockNumber: bigint; hiddenCount: number }>;
  readGenerationEligibility(client: GenerationIdentityClient, tokenId: bigint, player: Address): Promise<Eligibility>;
  api: Pick<Api, "nonce" | "verify" | "bindFriend" | "me" | "logout" | "unbindFriend">;
  identity: IdentityController;
  /** Page origin for the SIWE domain/URI. */
  origin: string;
  now?: () => Date;
}

/** Where the flow is. `error.at` names the step a retry repeats. */
export type OwnerStep =
  | { step: "idle" }
  | { step: "unavailable" }
  | { step: "connecting" }
  | { step: "wrong-chain" }
  | { step: "discovering" }
  | { step: "picking" }
  | { step: "empty" }
  | { step: "checking"; tokenId: string }
  | { step: "signing"; tokenId: string }
  | { step: "binding"; tokenId: string }
  | { step: "bound"; tokenId: string }
  | { step: "error"; at: "connect" | "discover" | "check" | "sign" | "bind"; message: string; tokenId?: string };

/** Observable flow state. `friends` survives across steps so the picker stays put during checks and errors. */
export interface OwnerFlowState {
  wallet: FriendWalletSnapshot;
  flow: OwnerStep;
  friends: readonly OwnedFriend[];
  hiddenCount: number;
}

/** The running flow. */
export interface OwnerFlow {
  readonly store: Store<OwnerFlowState>;
  /** The read-only chain client the gate uses (handed to `ConnectedGameHost`). */
  readonly publicClient: GenerationIdentityClient & OwnedFriendsClient;
  /** From a user gesture: opens the wallet's connect prompt (never signs or spends). */
  connect(walletId?: string): Promise<void>;
  /** From a user gesture: asks the wallet to switch to chain 4663. */
  switchNetwork(): Promise<void>;
  /** Re-reads owned Friends. */
  discover(): Promise<void>;
  /** Runs the fresh gate, SIWE and the server binding for `tokenId`. */
  select(tokenId: string): Promise<void>;
  /** Repeats the failed step. */
  retry(): Promise<void>;
  /** Forgets the local wallet session and signs out of the server. */
  disconnect(): Promise<void>;
  dispose(): void;
}

class Stale extends Error {}

const lower = (a: string | null | undefined): string | null => (a ? a.toLowerCase() : null);

/** Copy for an ineligible Friend (SDK wording, GDD §6.8 states). */
export function ineligibleMessage(tokenId: string, e: Eligibility): string {
  if (e.ownedByPlayer === false) return `This wallet doesn't own #${tokenId} at block ${e.blockNumber}.`;
  if (!e.hardwired)
    return `#${tokenId} is a hidden generation-0 Friend. Playing needs generation 1 or higher (hardwiring starts at 1 RF).`;
  return `Couldn't confirm #${tokenId} can play. Retry in a moment.`;
}

function isUserRejection(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 4001 || code === "ACTION_REJECTED";
}

/** Creates the owner flow over `deps`. It subscribes to the wallet session immediately. */
export function createOwnerFlow(deps: OwnerFlowDeps): OwnerFlow {
  const now = deps.now ?? (() => new Date());
  const { session, identity, api } = deps;
  const initial = session.getSnapshot();
  const store = createStore<OwnerFlowState>({
    wallet: initial,
    flow: initial.status === "unavailable" ? { step: "unavailable" } : { step: "idle" },
    friends: [],
    hiddenCount: 0,
  });
  let revision = initial.revision;
  /** Account the flow last saw connected on the right chain (null before any). */
  let seenAccount: string | null = null;
  /** Address the server session was signed in with during this flow (skip re-signing on a Friend change). */
  let signedAddress: string | null = null;
  let lastSelected: string | null = null;

  const setFlow = (flow: OwnerStep): void => store.set((s) => ({ ...s, flow }));
  const guard = (rev: number): void => {
    if (session.getSnapshot().revision !== rev) throw new Stale();
  };

  const currentOwner = () => {
    const id = identity.store.get().identity;
    return id.mode === "owner" ? id : null;
  };

  /** A revision change seen during a transient state, handled at the next stable snapshot. */
  let pendingChange = false;
  const onSession = (): void => {
    const snap = session.getSnapshot();
    if (snap.revision !== revision) pendingChange = true;
    revision = snap.revision;
    store.set((s) => ({ ...s, wallet: snap }));
    // The SDK re-reads on account/chain events as `connecting` (revision + 1, no account), then publishes the result
    // without a new revision: act on the settled snapshot.
    if (snap.status === "connecting" || snap.status === "switching-network") {
      setFlow({ step: "connecting" });
      return;
    }
    const changed = pendingChange;
    pendingChange = false;
    // Without a revision change only a waiting flow is re-derived (e.g. a silent restore that ended disconnected).
    const cur = store.get().flow;
    const waiting =
      cur.step === "idle" ||
      cur.step === "connecting" ||
      cur.step === "unavailable" ||
      cur.step === "wrong-chain" ||
      (cur.step === "error" && cur.at === "connect");
    if (!changed && !waiting) return;
    const account = lower(snap.account);
    const owner = currentOwner();
    const rightChain = snap.chainId === ROBINHOOD_CHAIN_ID;
    if (changed) {
      // A stable change of account or chain (or a disconnect after we saw a wallet) invalidates the binding.
      const accountChanged = owner !== null && account !== null && account !== lower(owner.address);
      const lostWallet = seenAccount !== null && (account === null || !rightChain);
      if (owner && (accountChanged || lostWallet)) {
        identity.dropOwner("Your wallet account or network changed. Pick your Friend again.");
        void api.unbindFriend().catch(() => undefined);
      }
      if (account !== seenAccount) signedAddress = null;
      store.set((s) => ({ ...s, friends: [], hiddenCount: 0 }));
    }
    if (snap.status === "unavailable") setFlow({ step: "unavailable" });
    else if (snap.status === "error") setFlow({ step: "error", at: "connect", message: snap.error ?? "Wallet error." });
    else if (snap.status === "wrong-network") setFlow({ step: "wrong-chain" });
    else if (snap.status === "connected" && account && rightChain) {
      seenAccount = account;
      void flow.discover();
    } else {
      seenAccount = null;
      setFlow({ step: "idle" });
    }
  };
  const unsubscribe = session.subscribe(onSession);

  async function bindSelected(tokenId: string, account: Address, rev: number): Promise<void> {
    setFlow({ step: "checking", tokenId });
    let elig: Eligibility;
    try {
      elig = await deps.readGenerationEligibility(deps.publicClient, BigInt(tokenId), account);
    } catch (e) {
      guard(rev);
      setFlow({ step: "error", at: "check", tokenId, message: `Couldn't read the chain: ${errorMessage(e)}` });
      return;
    }
    guard(rev);
    if (elig.eligible !== true) {
      setFlow({ step: "error", at: "check", tokenId, message: ineligibleMessage(tokenId, elig) });
      return;
    }

    // SIWE once per account: reuse a server session that is already ours.
    if (signedAddress !== lower(account)) {
      const me = await api.me().catch(() => null);
      guard(rev);
      if (me?.identity.kind === "owner" && lower(me.identity.address) === lower(account))
        signedAddress = lower(account);
    }
    if (signedAddress !== lower(account)) {
      setFlow({ step: "signing", tokenId });
      try {
        const provider = session.getProvider();
        if (!provider) throw new Error("The wallet disconnected.");
        const { nonce } = await api.nonce();
        guard(rev);
        const message = buildSiweMessage({
          address: account,
          chainId: ROBINHOOD_CHAIN_ID,
          nonce,
          origin: deps.origin,
          now: now(),
        });
        const signature = await personalSign(provider, account, message);
        guard(rev);
        const verified = await api.verify(message, signature);
        guard(rev);
        signedAddress = lower(verified.address);
      } catch (e) {
        if (e instanceof Stale) throw e;
        guard(rev);
        const message = isUserRejection(e) ? "Signature cancelled. Nothing was sent." : errorMessage(e);
        setFlow({ step: "error", at: "sign", tokenId, message });
        return;
      }
    }

    setFlow({ step: "binding", tokenId });
    let view: FriendView;
    try {
      view = await api.bindFriend(tokenId);
    } catch (e) {
      guard(rev);
      if (e instanceof ApiRequestError && e.code === "unauthorized") signedAddress = null;
      const message =
        e instanceof ApiRequestError && (e.code === "not_owner" || e.code === "forbidden")
          ? `The server's fresh check says this wallet can't play #${tokenId}.`
          : errorMessage(e);
      setFlow({ step: "error", at: "bind", tokenId, message });
      return;
    }
    guard(rev);
    identity.setOwner(account, view);
    setFlow({ step: "bound", tokenId });
  }

  const flow: OwnerFlow = {
    store,
    publicClient: deps.publicClient,
    async connect(walletId) {
      setFlow({ step: "connecting" });
      try {
        const snap = await session.connect(walletId);
        // The subscription usually moves the flow on; handle wallets that connect without a revision change.
        if (
          snap.status === "connected" &&
          snap.chainId === ROBINHOOD_CHAIN_ID &&
          store.get().flow.step === "connecting"
        )
          await flow.discover();
        else if (snap.status === "wrong-network") setFlow({ step: "wrong-chain" });
        else if (snap.status === "unavailable") setFlow({ step: "unavailable" });
        else if (snap.status !== "connected" && store.get().flow.step === "connecting")
          setFlow({ step: "error", at: "connect", message: snap.error ?? "The wallet did not connect." });
      } catch (e) {
        setFlow({
          step: "error",
          at: "connect",
          message: isUserRejection(e) ? "Connection cancelled." : errorMessage(e),
        });
      }
    },
    async switchNetwork() {
      try {
        await session.switchNetwork();
      } catch (e) {
        setFlow({ step: "error", at: "connect", message: `Couldn't switch network: ${errorMessage(e)}` });
      }
    },
    async discover() {
      const snap = session.getSnapshot();
      const rev = snap.revision;
      if (!snap.account || snap.chainId !== ROBINHOOD_CHAIN_ID) return;
      seenAccount = lower(snap.account);
      setFlow({ step: "discovering" });
      try {
        const res = await deps.readOwnedFriends(deps.publicClient, snap.account);
        guard(rev);
        store.set((s) => ({ ...s, friends: res.friends, hiddenCount: res.hiddenCount }));
        const owner = currentOwner();
        const bound = owner && res.friends.find((f) => f.id.toString(10) === owner.view.appearance.tokenId);
        if (bound && lower(owner.address) === lower(snap.account))
          setFlow({ step: "bound", tokenId: bound.id.toString(10) });
        else setFlow({ step: res.friends.length ? "picking" : "empty" });
      } catch (e) {
        if (e instanceof Stale) return;
        setFlow({ step: "error", at: "discover", message: `Couldn't list your Friends: ${errorMessage(e)}` });
      }
    },
    async select(tokenId) {
      const snap = session.getSnapshot();
      if (!snap.account || snap.chainId !== ROBINHOOD_CHAIN_ID) return;
      lastSelected = tokenId;
      const owner = currentOwner();
      if (owner && owner.view.appearance.tokenId !== tokenId) identity.dropOwner(null);
      try {
        await bindSelected(tokenId, snap.account, snap.revision);
      } catch (e) {
        if (!(e instanceof Stale)) throw e;
      }
    },
    async retry() {
      const f = store.get().flow;
      if (f.step !== "error") return;
      if (f.at === "connect") return flow.connect();
      if (f.at === "discover") return flow.discover();
      const id = f.tokenId ?? lastSelected;
      if (id) return flow.select(id);
    },
    async disconnect() {
      const wasOwner = currentOwner() !== null;
      seenAccount = null;
      signedAddress = null;
      session.disconnect();
      identity.dropOwner(null);
      store.set((s) => ({ ...s, friends: [], hiddenCount: 0, flow: { step: "idle" } }));
      if (wasOwner) await api.logout().catch(() => undefined);
    },
    dispose() {
      unsubscribe();
      session.dispose();
    },
  };
  return flow;
}
