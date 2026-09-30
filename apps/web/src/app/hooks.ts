/**
 * Stable hooks for screens (shell and `src/pages`). Pages should depend on these and on `app/routes.ts` only, never on
 * the stores' internals.
 */
import type { EconomyAction, EconomyReceipt } from "@pl/shared";
import { type DependencyList, useCallback, useEffect, useState } from "react";
import { type Api, errorMessage } from "../api/client.js";
import { useAsync } from "../lib/use-async.js";
import type { Remote } from "../ui/index.js";
import type { Identity, IdentityState } from "../identity/store.js";
import type { OwnerFlow } from "../identity/owner-flow.js";
import { loadOwnerFlow } from "../identity/owner-flow-loader.js";
import { useStore } from "../lib/store.js";
import { requestEconomy } from "../meta/economy.js";
import type { Progress } from "../meta/progress.js";
import type { MetaState } from "./meta.js";
import { reducedMotionOf, type Settings } from "../settings/settings.js";
import { useServices } from "./services.js";

export { useServices } from "./services.js";
export { href } from "./routes.js";
export type { PageProps } from "./routes.js";

/** The typed API client (every §4.3 endpoint). */
export function useApi(): Api {
  return useServices().api;
}

/** The current identity (`none` | `guest` | `owner`) and its revision; re-renders on change. */
export function useIdentityState(): IdentityState {
  return useStore(useServices().identity.store);
}

/** The current identity; re-renders on change. */
export function useIdentity(): Identity {
  return useIdentityState().identity;
}

/** Player settings; re-renders on change. */
export function useSettings(): Settings & { reducedMotionEffective: boolean } {
  const s = useStore(useServices().settings);
  return { ...s, reducedMotionEffective: reducedMotionOf(s) };
}

/** Local Bits/stamps of the current player ("guest" or the owner's token id). */
export function useProgress(): Progress & { player: string } {
  const { progress } = useServices();
  useStore(progress.store);
  const id = useIdentity();
  const player = id.mode === "owner" ? id.view.appearance.tokenId : "guest";
  return { ...progress.get(player), player };
}

/** The owner's server meta state (`GET /api/meta/me`); `status: "none"` for guests. Re-renders on change. */
export function useMeta(): MetaState {
  return useStore(useServices().meta.store);
}

/** A Bits balance and where it lives: the server ledger for owners, this device for guests. */
export interface BitsBalance {
  /** Null while the owner's balance is loading (or failed to load with nothing cached). */
  bits: number | null;
  source: "server" | "device";
}

/** The player's Bits: the server balance for owners (`/api/meta/me`), the local tally for guests. */
export function useBits(): BitsBalance {
  const meta = useMeta();
  const progress = useProgress();
  const id = useIdentity();
  if (id.mode === "owner") return { bits: meta.me?.bits ?? null, source: "server" };
  return { bits: progress.bits, source: "device" };
}

/**
 * Host-confirmed economy for pages (Regrow / Mend): quote → confirm dialog (price, split, SIMULATED) → request →
 * receipt, updating the owner's scars and balance. Rejects with `EconomyRefused` (guest, cancel) or `ApiRequestError`.
 */
export function useEconomy(): (action: EconomyAction) => Promise<EconomyReceipt> {
  const services = useServices();
  return useCallback((action: EconomyAction) => requestEconomy(services, action), [services]);
}

/** The owner flow (SDK wallet session), loaded on first use; null while loading. */
export function useOwnerFlow(): { flow: OwnerFlow | null; error: unknown } {
  const { api, identity } = useServices();
  const [state, setState] = useState<{ flow: OwnerFlow | null; error: unknown }>({ flow: null, error: null });
  useEffect(() => {
    let live = true;
    loadOwnerFlow(api, identity).then(
      (flow) => live && setState({ flow, error: null }),
      (error: unknown) => live && setState({ flow: null, error }),
    );
    return () => {
      live = false;
    };
  }, [api, identity]);
  return state;
}

export { useAsync } from "../lib/use-async.js";

/**
 * A remote read as the kit's {@link Remote} (user-facing error sentence) plus `retry`. The previous data stays on screen
 * while reloading (no flash of skeleton); a failed reload shows the error with its retry.
 */
export function useRemote<T>(fn: () => Promise<T>, deps: DependencyList): { value: Remote<T>; retry(): void } {
  const s = useAsync(fn, deps);
  const value: Remote<T> =
    s.status === "error"
      ? { status: "error", message: errorMessage(s.error) }
      : s.data !== undefined
        ? { status: "ready", data: s.data }
        : { status: "loading" };
  return { value, retry: s.retry };
}
