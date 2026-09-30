/**
 * Typed client for every REST endpoint of architecture §4.3, driven by `ApiEndpoints` from `@pl/shared`: the route key
 * fixes the request and response types, so a DTO change in the shared contract breaks this file at compile time.
 */
import type {
  ApiEndpoints,
  ApiError,
  ApiErrorCode,
  ApiRoute,
  BoardKind,
  BuyRes,
  CATALOG,
  BELTS,
  EconomyAction,
  EconomyRequestReq,
  HomeLayout,
  HomeView,
  InboxItem,
  InboxReadReq,
  MeRes,
  MarketActionRes,
  MarketBookRes,
  MarketBuyRes,
  MarketErrorReason,
  MarketMineRes,
  MetaMeRes,
  OkRes,
  PlotRes,
  RoomSlug,
  RunSubmitReq,
  SeedPackApi,
  SeedPackOp,
  STAMPS,
  StampId,
  TokenIdStr,
} from "@pl/shared";

/** Error codes the client adds for failures that never reached a JSON error body. */
export type ClientErrorCode = "network" | "timeout" | "bad_response";

/** A failed API call. `code` is the server's machine-readable reason, or a client-side transport code. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | ClientErrorCode;
  readonly retryAfterMs: number | undefined;
  /** The market's own reason (`marketError` in the body), when the market refused. */
  readonly marketError: MarketErrorReason | undefined;
  /** True when `message` is the server's own sentence (not a client placeholder). */
  readonly fromServer: boolean;
  constructor(
    status: number,
    code: ApiErrorCode | ClientErrorCode,
    message: string,
    extra: { retryAfterMs?: number; marketError?: MarketErrorReason; fromServer?: boolean } = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = extra.retryAfterMs;
    this.marketError = extra.marketError;
    this.fromServer = extra.fromServer ?? false;
  }
  /** True when retrying the same request may succeed (transport errors, 429, 5xx). */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** Path parameters of a route (`:id`, `:day`). */
type PathParams<R extends string> = R extends `${string}:id${string}`
  ? { id: string }
  : R extends `${string}:day${string}`
    ? { day: string }
    : undefined;

/** Options for {@link createApi}. */
export interface ApiOptions {
  /** Prefix for every path (default "" = same origin, like the edge Worker in production). */
  base?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Called on a `not_owner` answer, before the error is thrown: the shell drops the binding and re-picks. */
  onNotOwner?: () => void;
  /** Called on `unauthorized` (session missing or expired). */
  onUnauthorized?: () => void;
  /** Called with every successful `GET /api/me` answer (server flags such as `guestMode`, the Bits balance). */
  onMe?: (me: MeRes) => void;
}

/** Codes whose copy always wins over the server's sentence (transport, session and ownership problems). */
const FIXED_COPY: ReadonlySet<ApiErrorCode | ClientErrorCode> = new Set([
  "network",
  "timeout",
  "rate_limited",
  "not_owner",
  "guest_forbidden",
  "unauthorized",
  "internal",
]);

const USER_COPY: Partial<Record<ApiErrorCode | ClientErrorCode, string>> = {
  network: "Can't reach the sky right now. Check your connection and retry.",
  timeout: "The server took too long to answer. Retry in a moment.",
  rate_limited: "Too many requests. Wait a few seconds and retry.",
  insufficient_funds: "Not enough simulated RF on this Friend.",
  not_owner: "This wallet no longer owns that Friend. Pick it again.",
  guest_forbidden: "Use your own Friend for this.",
  unauthorized: "Your session expired. Sign in again.",
  not_lost: "Those pixels are no longer missing.",
  mend_cap: "That Friend has received its Mend limit for today.",
  self_mend: "Use Regrow for your own Friend.",
  quote_expired: "The price changed. Check the new price and try again.",
  internal: "Something broke on our side. Retry in a moment.",
};

/**
 * A short, user-facing sentence for any error thrown by the client or anything else. Transport, session and ownership
 * failures use fixed copy; other refusals prefer the server's own sentence ("Not enough Bits.", "Earn the green belt")
 * and fall back to the fixed copy when the server sent none.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) {
    const fixed = USER_COPY[e.code];
    if (FIXED_COPY.has(e.code) || !e.fromServer) return fixed ?? e.message;
    return e.message;
  }
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong.";
}

function isApiError(v: unknown): v is ApiError & { marketError?: MarketErrorReason } {
  return typeof v === "object" && v !== null && typeof (v as { error?: unknown }).error === "string";
}

/** Any notification the inbox can hold (the shared `InboxItem` includes the market's sale and royalty notices). */
export type AnyInboxItem = InboxItem;

/** `GET /api/meta/catalog`: the static catalog, stamp and belt definitions. */
export interface CatalogRes {
  items: typeof CATALOG;
  stamps: typeof STAMPS;
  belts: typeof BELTS;
}

/** `POST /api/home/:tokenId/visit` result: stamps the visit earned. */
export interface VisitRes {
  stamps: StampId[];
}

/** Creates the typed API. Every method rejects with {@link ApiRequestError}. */
export function createApi(opts: ApiOptions = {}) {
  const base = opts.base ?? "";
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

  async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      const init: RequestInit = { method, credentials: "same-origin", signal: ctrl.signal, headers: {} };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers = { "content-type": "application/json" };
      }
      res = await doFetch(`${base}${path}`, init);
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      throw new ApiRequestError(0, aborted ? "timeout" : "network", aborted ? "Request timed out." : "Network error.");
    } finally {
      clearTimeout(timer);
    }
    let json: unknown = null;
    const text = await res.text().catch(() => "");
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const err = isApiError(json)
        ? new ApiRequestError(res.status, json.error, json.message ?? json.error, {
            ...(json.retryAfterMs !== undefined ? { retryAfterMs: json.retryAfterMs } : {}),
            ...(json.marketError !== undefined ? { marketError: json.marketError } : {}),
            fromServer: json.message !== undefined && json.message !== "",
          })
        : new ApiRequestError(res.status, res.status >= 500 ? "internal" : "bad_response", `HTTP ${res.status}`);
      if (err.code === "not_owner") opts.onNotOwner?.();
      if (err.code === "unauthorized") opts.onUnauthorized?.();
      throw err;
    }
    if (json === null) throw new ApiRequestError(res.status, "bad_response", "Empty or malformed response.");
    return json as T;
  }

  /** Calls `route` with its typed request (JSON body for POST, query string for GET) and path parameters. */
  function call<R extends ApiRoute>(
    route: R,
    req: ApiEndpoints[R]["req"],
    ...params: PathParams<R> extends undefined ? [] : [PathParams<R>]
  ): Promise<ApiEndpoints[R]["res"]> {
    const space = route.indexOf(" ");
    const method = route.slice(0, space);
    let path: string = route.slice(space + 1);
    const p = params[0] as Record<string, string> | undefined;
    if (p) for (const [k, v] of Object.entries(p)) path = path.replace(`:${k}`, encodeURIComponent(v));
    if (method === "GET") {
      if (req && typeof req === "object") {
        const q = new URLSearchParams(Object.entries(req as Record<string, string>)).toString();
        if (q) path += `?${q}`;
      }
      return send(method, path);
    }
    return send(method, path, req);
  }

  return {
    call,
    guest: () => call("POST /api/guest", undefined),
    nonce: () => call("GET /api/auth/nonce", undefined),
    verify: (message: string, signature: `0x${string}`) => call("POST /api/auth/verify", { message, signature }),
    logout: () => call("POST /api/auth/logout", undefined),
    bindFriend: (tokenId: TokenIdStr) => call("POST /api/session/friend", { tokenId }),
    /** Drops the server binding (served by apps/server; not in `ApiEndpoints` yet). */
    unbindFriend: () => send<OkRes>("DELETE", "/api/session/friend"),
    me: async (): Promise<MeRes> => {
      const me = await call("GET /api/me", undefined);
      opts.onMe?.(me);
      return me;
    },
    appearance: (id: TokenIdStr) => call("GET /api/friends/:id/appearance", undefined, { id }),
    publicFriend: (id: TokenIdStr) => call("GET /api/friends/:id/public", undefined, { id }),
    submitRun: (run: RunSubmitReq) => call("POST /api/runs", run),
    daily: () => call("GET /api/daily", undefined),
    board: (day: string, board: BoardKind) => call("GET /api/daily/:day/board", { board }, { day }),
    quote: (action: EconomyAction) => call("POST /api/economy/quote", action),
    regrow: (req: EconomyRequestReq) => call("POST /api/economy/regrow", req),
    mend: (req: EconomyRequestReq) => call("POST /api/economy/mend", req),
    seedpack: <O extends SeedPackOp>(op: O, req: SeedPackApi[O]["req"]): Promise<SeedPackApi[O]["res"]> =>
      send("POST", `/api/seedpack/${op}`, req),
    sky: (room: RoomSlug) => call("GET /api/sky", { room }),
    /** The inbox, including market notices (`market_sold`, `market_royalty`). */
    inbox: () => call("GET /api/inbox", undefined),
    inboxRead: (req: InboxReadReq) => call("POST /api/inbox/read", req),
    economyStats: () => call("GET /api/stats/economy", undefined),

    // ── Gold market (SIMULATED, apps/server/src/market) ──
    /** Public order book: asks (cheapest first), floor, recent fills, 24 h stats. */
    marketBook: (limit?: number) =>
      send<MarketBookRes>("GET", `/api/market/book${limit === undefined ? "" : `?limit=${limit}`}`),
    /** The bound Friend's Golds, asks and royalties. */
    marketMine: () => send<MarketMineRes>("GET", "/api/market/mine"),
    /** Escrows one Gold and asks `priceMicro` (omit `leafId` to list a Gold this Friend grew). */
    marketList: (priceMicro: number, leafId?: number) =>
      send<MarketActionRes>("POST", "/api/market/list", leafId === undefined ? { priceMicro } : { priceMicro, leafId }),
    /** Takes an ask down; the Gold returns to the seller Friend. */
    marketCancel: (leafId: number) => send<MarketActionRes>("POST", "/api/market/cancel", { leafId }),
    /** Buys at exactly the price the buyer saw (`price_changed` otherwise). */
    marketBuy: (leafId: number, expectedPriceMicro: number) =>
      send<MarketBuyRes>("POST", "/api/market/buy", { leafId, expectedPriceMicro }),

    // ── Meta: home isle, catalog, stamps, belts (apps/server/src/meta) ──
    /** Static catalog, stamp and belt definitions. */
    catalog: () => send<CatalogRes>("GET", "/api/meta/catalog"),
    /** The bound Friend's isle, Bits, wardrobe and counters. */
    metaMe: () => send<MetaMeRes>("GET", "/api/meta/me"),
    /** A Friend's public isle view (layout, hat, belt, stamps). */
    home: (tokenId: TokenIdStr) => send<HomeView>("GET", `/api/home/${encodeURIComponent(tokenId)}`),
    /** Saves the bound Friend's layout, hat and open-isle toggle. */
    saveHome: (req: { layout: HomeLayout; hat?: string | null; open?: boolean }) =>
      send<HomeView>("PUT", "/api/home", req),
    /** Buys one catalog item with Bits (or simulated RF decor). */
    buyItem: (itemId: string) => send<BuyRes>("POST", "/api/meta/buy", { itemId }),
    /** Buys the next island plot with Bits. */
    buyPlot: () => send<PlotRes>("POST", "/api/meta/plot"),
    /** Counts a visit to another Friend's open isle. */
    visitHome: (tokenId: TokenIdStr) => send<VisitRes>("POST", `/api/home/${encodeURIComponent(tokenId)}/visit`),
  };
}

/** The typed API surface (architecture §2.1 `Api`). */
export type Api = ReturnType<typeof createApi>;
