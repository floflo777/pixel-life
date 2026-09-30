/**
 * The identity store (architecture §1.3): who is playing, as one of
 *  - `none`: nothing chosen yet (landing),
 *  - `guest`: a loaned Friend, local scars, no economy, never in the SDK runtime,
 *  - `owner`: the wallet's own Friend, bound on the server after SIWE + a server-side fresh-block ownership check.
 *
 * `revision` increases on every identity change. SDK venues pass it to `ConnectedGameHost` so an account, chain or
 * Friend change closes the old bridge and re-runs the gate; native venues are unmounted by the venue manager.
 */
import type { FriendView, Hex64, MeRes, ScarState } from "@pl/shared";
import { createStore, type Store } from "../lib/store.js";
import { applyGuestRun, guestFriendView, loadGuestProfile, saveGuestProfile, type GuestProfile } from "./guest.js";
import type { LoanerFriend } from "./loaners.js";

/** Who is playing. */
export type Identity =
  | { mode: "none" }
  | { mode: "guest"; loaner: LoanerFriend; view: FriendView }
  | {
      mode: "owner";
      address: `0x${string}`;
      view: FriendView;
      /** Simulated RF balance of the bound Friend (micro-RF), null when unknown or live mode. */
      balanceMicro: number | null;
      unread: number;
      economy: "sim" | "live";
    };

/** Store value: the identity, its revision and an optional notice explaining the last forced change. */
export interface IdentityState {
  identity: Identity;
  revision: number;
  notice: string | null;
}

/** Operations on the identity store. */
export interface IdentityController {
  readonly store: Store<IdentityState>;
  /** Starts (or switches) guest play with `loaner`; restores its local scars. */
  startGuest(loaner: LoanerFriend): void;
  /** Binds the owner identity returned by `POST /api/session/friend` (or restored from `/api/me`). */
  setOwner(address: `0x${string}`, view: FriendView, extra?: { balanceMicro?: number | null; unread?: number }): void;
  /** Drops the owner binding (account/chain/Friend change, `not_owner`, logout) and falls back to guest or none. */
  dropOwner(notice: string | null): void;
  /** Applies a server `/api/me` answer: owner with a bound Friend, or nothing to change. */
  syncMe(me: MeRes): void;
  /** Replaces the owner's scars and balance after a receipt or run ack. */
  updateOwner(patch: { scars?: ScarState; balanceMicro?: number; unread?: number }): void;
  /** Records a finished guest run's scars locally. */
  applyGuestLoss(lostDelta: Hex64): void;
  /** Re-derives the guest view (free regrowth ticks on the local copy). */
  refreshGuest(): void;
  clearNotice(): void;
}

/** Creates an identity controller. `now` is injectable for tests. */
export function createIdentity(opts: { now?: () => number; initial?: Identity } = {}): IdentityController {
  const now = opts.now ?? Date.now;
  const store = createStore<IdentityState>({ identity: opts.initial ?? { mode: "none" }, revision: 0, notice: null });
  let profile: GuestProfile = loadGuestProfile();
  /** The last loaner used, so dropping an owner lands back on a playable guest. */
  let lastLoaner: LoanerFriend | null = null;

  const set = (identity: Identity, notice: string | null = null): void =>
    store.set((s) => ({ identity, revision: s.revision + 1, notice }));

  const guestOf = (loaner: LoanerFriend): Identity => ({
    mode: "guest",
    loaner,
    view: guestFriendView(loaner, profile, now()),
  });

  const ctl: IdentityController = {
    store,
    startGuest(loaner) {
      lastLoaner = loaner;
      profile = { ...profile, loaner: loaner.appearance.tokenId };
      saveGuestProfile(profile);
      set(guestOf(loaner));
    },
    setOwner(address, view, extra = {}) {
      const cur = store.get().identity;
      const same =
        cur.mode === "owner" && cur.address === address && cur.view.appearance.tokenId === view.appearance.tokenId;
      const identity: Identity = {
        mode: "owner",
        address,
        view: { ...view, loaned: false },
        balanceMicro: extra.balanceMicro ?? (same ? cur.balanceMicro : null),
        unread: extra.unread ?? (same ? cur.unread : 0),
        economy: view.pub.economy,
      };
      // Same bound Friend (e.g. a refreshed view): keep the revision so an open SDK venue is not torn down.
      if (same) store.set((s) => ({ ...s, identity }));
      else set(identity);
    },
    dropOwner(notice) {
      if (store.get().identity.mode !== "owner") {
        if (notice) store.set((s) => ({ ...s, notice }));
        return;
      }
      set(lastLoaner ? guestOf(lastLoaner) : { mode: "none" }, notice);
    },
    syncMe(me) {
      const cur = store.get().identity;
      if (me.identity.kind === "owner" && me.friend) {
        ctl.setOwner(me.identity.address, me.friend, { balanceMicro: me.balanceMicro, unread: me.unread });
      } else if (cur.mode === "owner") {
        // The server no longer has our binding (expired session, revoked, re-bound elsewhere).
        ctl.dropOwner("Your session ended. Connect again to play with your Friend.");
      }
    },
    updateOwner(patch) {
      store.set((s) => {
        const id = s.identity;
        if (id.mode !== "owner") return s;
        return {
          ...s,
          identity: {
            ...id,
            view: patch.scars ? { ...id.view, pub: { ...id.view.pub, scars: patch.scars } } : id.view,
            balanceMicro: patch.balanceMicro ?? id.balanceMicro,
            unread: patch.unread ?? id.unread,
          },
        };
      });
    },
    applyGuestLoss(lostDelta) {
      const id = store.get().identity;
      if (id.mode !== "guest") return;
      profile = applyGuestRun(profile, id.loaner, lostDelta, now());
      saveGuestProfile(profile);
      store.set((s) => ({ ...s, identity: guestOf(id.loaner) }));
    },
    refreshGuest() {
      const id = store.get().identity;
      if (id.mode === "guest") store.set((s) => ({ ...s, identity: guestOf(id.loaner) }));
    },
    clearNotice() {
      if (store.get().notice !== null) store.set((s) => ({ ...s, notice: null }));
    },
  };
  return ctl;
}

/** The guest's preferred loaner token id from the stored profile (null = loaner of the day). */
export function storedLoanerId(): string | null {
  return loadGuestProfile().loaner;
}
