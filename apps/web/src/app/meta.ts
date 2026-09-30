/**
 * The owner's server-side meta state (`GET /api/meta/me`): Bits, wardrobe, isle, stamps and belt. Bits live on the
 * server for owners (tokenomics §7); guests keep an honest local tally (`meta/progress.ts`, "this device").
 *
 * The book refetches whenever the identity value changes (Friend switch, run acks, receipts, the shell's 60 s `/api/me`
 * sync), so the HUD's Bits follow what runs earn without the venues knowing about it.
 */
import type { BuyRes, HomeView, MetaMeRes, PlotRes } from "@pl/shared";
import type { Api } from "../api/client.js";
import type { IdentityController } from "../identity/store.js";
import { createStore, type Store } from "../lib/store.js";

/** What the book knows. `tokenId` is the Friend `me` belongs to (null for guests). */
export type MetaState =
  | { status: "none"; tokenId: null; me: null }
  | { status: "loading"; tokenId: string; me: MetaMeRes | null }
  | { status: "ready"; tokenId: string; me: MetaMeRes }
  | { status: "error"; tokenId: string; me: MetaMeRes | null; error: unknown };

/** The owner's meta state and the patches purchases apply to it. */
export interface MetaBook {
  readonly store: Store<MetaState>;
  /** Refetches `GET /api/meta/me` for the current owner (no-op for guests). */
  refresh(): Promise<void>;
  /** Applies a purchase result (Bits, owned count, simulated RF). */
  applyBuy(res: BuyRes): void;
  /** Applies a saved isle. */
  applyHome(home: HomeView): void;
  /** Applies a bought plot. */
  applyPlot(res: PlotRes): void;
  /** Stops following the identity. */
  dispose(): void;
}

const NONE: MetaState = { status: "none", tokenId: null, me: null };

/** Creates the book and starts following `identity`. */
export function createMetaBook(api: Pick<Api, "metaMe">, identity: IdentityController): MetaBook {
  const store = createStore<MetaState>(NONE);
  let seq = 0;
  let lastIdentity: unknown = null;

  const ownerToken = (): string | null => {
    const id = identity.store.get().identity;
    return id.mode === "owner" ? id.view.appearance.tokenId : null;
  };

  const refresh = async (): Promise<void> => {
    const tokenId = ownerToken();
    const run = ++seq;
    if (tokenId === null) {
      store.set(NONE);
      return;
    }
    store.set((s) => ({ status: "loading", tokenId, me: s.tokenId === tokenId ? s.me : null }));
    try {
      const me = await api.metaMe();
      if (run === seq) store.set({ status: "ready", tokenId, me });
    } catch (error) {
      if (run === seq) store.set((s) => ({ status: "error", tokenId, me: s.me, error }));
    }
  };

  const patch = (f: (me: MetaMeRes) => MetaMeRes): void =>
    store.set((s) => (s.status !== "none" && s.me ? { ...s, me: f(s.me) } : s));

  // Any new identity value (a Friend switch, a run ack's scars, a receipt's balance, the 60 s `/api/me` sync) may mean
  // Bits or stamps moved on the server: refetch. Guests stay at `none` without a request.
  const onIdentity = (): void => {
    const current = identity.store.get().identity;
    if (current === lastIdentity) return;
    const wasNone = store.get().status === "none";
    lastIdentity = current;
    if (current.mode !== "owner" && wasNone) return;
    void refresh();
  };
  const unsubscribe = identity.store.subscribe(onIdentity);
  onIdentity();

  return {
    store,
    refresh,
    applyBuy(res) {
      patch((me) => ({
        ...me,
        bits: res.bits,
        owned: { ...me.owned, [res.item]: res.owned },
        ...(res.simRfMicro !== undefined ? { simRfMicro: res.simRfMicro } : {}),
      }));
    },
    applyHome(home) {
      patch((me) => ({ ...me, home }));
    },
    applyPlot(res) {
      patch((me) => ({ ...me, bits: res.bits, home: { ...me.home, plots: res.plots, terraces: res.terraces } }));
    },
    dispose: unsubscribe,
  };
}
