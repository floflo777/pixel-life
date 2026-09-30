/**
 * The two home-island endpoints the hub needs (GDD §12.3), until the shell's typed client grows them:
 * `GET /api/home/:tokenId` (public isle view: layout, hat, belt, terraces) and `POST /api/home/:tokenId/visit`
 * (counts a visit for the Isle Hopper stamp; owners only, best-effort).
 */
import type { HomeView, TokenIdStr } from "@pl/shared";
import { ApiRequestError } from "../api/client.js";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: Fetch = (input, init) => globalThis.fetch(input, init);

/** Loads a Friend's public isle view. Throws `ApiRequestError` on failure (status 0 = network). */
export async function fetchHome(tokenId: TokenIdStr, doFetch: Fetch = defaultFetch): Promise<HomeView> {
  let res: Response;
  try {
    res = await doFetch(`/api/home/${encodeURIComponent(tokenId)}`, { credentials: "same-origin" });
  } catch {
    throw new ApiRequestError(0, "network", "Network error.");
  }
  if (!res.ok)
    throw new ApiRequestError(res.status, res.status >= 500 ? "internal" : "bad_response", `HTTP ${res.status}`);
  return (await res.json()) as HomeView;
}

/** The worn belt of a Friend (null when none or unknown); never throws. */
export async function fetchBelt(tokenId: TokenIdStr, doFetch: Fetch = defaultFetch): Promise<string | null> {
  try {
    return (await fetchHome(tokenId, doFetch)).belt;
  } catch {
    return null;
  }
}

/** Counts a visit to another Friend's isle (owners only on the server; guests and failures are ignored). */
export function recordVisit(tokenId: TokenIdStr, doFetch: Fetch = defaultFetch): void {
  void doFetch(`/api/home/${encodeURIComponent(tokenId)}/visit`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => undefined);
}
