/**
 * Stable hooks for screens (shell and `src/pages`). Pages should depend on these and on `app/routes.ts` only, never on
 * the stores' internals.
 */
import type { EconomyAction, EconomyReceipt } from "@pl/shared";
import { useCallback, useEffect, useState } from "react";
import type { Api } from "../api/client.js";
import type { Identity, IdentityState } from "../identity/store.js";
import type { OwnerFlow } from "../identity/owner-flow.js";
import { loadOwnerFlow } from "../identity/owner-flow-loader.js";
import { useStore } from "../lib/store.js";
import { requestEconomy } from "../meta/economy.js";
import type { Progress } from "../meta/progress.js";
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

export { useAsync, useNow } from "../lib/use-async.js";
