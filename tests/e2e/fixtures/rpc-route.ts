import type { BrowserContext, Page, Route } from "@playwright/test";
import { ROBINHOOD_RPC_URL } from "@pl/mock-rpc";

/** Options for {@link routeChainRpc}. */
export interface RouteChainRpcOptions {
  /** The chain RPC to intercept. Defaults to the public Robinhood RPC the SDK hardcodes. */
  readonly rpcUrl?: string;
  /**
   * When set, every other http(s) origin not listed here is aborted and recorded in the returned
   * `blocked` list, so a test fails loudly instead of touching a real service (SDK fixture rule).
   */
  readonly allowOrigins?: readonly string[];
}

/** Handle returned by {@link routeChainRpc}: requests answered by the mock and blocked externals. */
export interface ChainRpcRoute {
  readonly forwarded: string[];
  readonly blocked: string[];
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

/**
 * Redirects the chain RPC (default https://rpc.mainnet.chain.robinhood.com) to `mockUrl` for every
 * page and frame of `target`, including the SDK's sandboxed child (opaque origin, hence CORS `*`).
 */
export async function routeChainRpc(
  target: BrowserContext | Page,
  mockUrl: string,
  options: RouteChainRpcOptions = {},
): Promise<ChainRpcRoute> {
  const rpcOrigin = new URL(options.rpcUrl ?? ROBINHOOD_RPC_URL).origin;
  const allowed = options.allowOrigins
    ? new Set([...options.allowOrigins.map((o) => new URL(o).origin), rpcOrigin])
    : null;
  const result: ChainRpcRoute = { forwarded: [], blocked: [] };

  const forward = async (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS_HEADERS });
    result.forwarded.push(request.url());
    const response = await route.fetch({ url: mockUrl });
    return route.fulfill({ response, headers: { ...response.headers(), ...CORS_HEADERS } });
  };

  if (!allowed) {
    await target.route((url) => url.origin === rpcOrigin, forward);
    return result;
  }
  await target.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === rpcOrigin) return forward(route);
    if ((url.protocol === "http:" || url.protocol === "https:") && !allowed.has(url.origin)) {
      result.blocked.push(url.href);
      return route.abort("blockedbyclient");
    }
    return route.fallback();
  });
  return result;
}
