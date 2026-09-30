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
  EconomyAction,
  EconomyRequestReq,
  InboxReadReq,
  OkRes,
  RoomSlug,
  RunSubmitReq,
  SeedPackApi,
  SeedPackOp,
  TokenIdStr,
} from "@pl/shared";

/** Error codes the client adds for failures that never reached a JSON error body. */
export type ClientErrorCode = "network" | "timeout" | "bad_response";

/** A failed API call. `code` is the server's machine-readable reason, or a client-side transport code. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | ClientErrorCode;
  readonly retryAfterMs: number | undefined;
  constructor(status: number, code: ApiErrorCode | ClientErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
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
}

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
  internal: "Something broke on our side. Retry in a moment.",
};

/** A short, user-facing sentence for any error thrown by the client or anything else. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) return USER_COPY[e.code] ?? e.message;
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong.";
}

function isApiError(v: unknown): v is ApiError {
  return typeof v === "object" && v !== null && typeof (v as { error?: unknown }).error === "string";
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
        ? new ApiRequestError(res.status, json.error, json.message ?? json.error, json.retryAfterMs)
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
    me: () => call("GET /api/me", undefined),
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
    inbox: () => call("GET /api/inbox", undefined),
    inboxRead: (req: InboxReadReq) => call("POST /api/inbox/read", req),
    economyStats: () => call("GET /api/stats/economy", undefined),
  };
}

/** The typed API surface (architecture §2.1 `Api`). */
export type Api = ReturnType<typeof createApi>;
