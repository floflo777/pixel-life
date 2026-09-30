import { BASE_HEADERS, DEFAULT_SHELL_CSP, withStaticHeaders } from "./headers.js";

/** Bindings and vars from wrangler.jsonc; ORIGIN_KEY is a secret (`wrangler secret put ORIGIN_KEY`). */
export interface Env {
  readonly ASSETS: Pick<Fetcher, "fetch">;
  /** Hidden origin base URL, e.g. https://rf-origin.ailog.fr (never shown to users). */
  readonly ORIGIN_URL?: string;
  /** Shared secret the origin requires in `x-pl-origin-key`. */
  readonly ORIGIN_KEY?: string;
  /** Shell CSP override; empty string disables the header, unset uses DEFAULT_SHELL_CSP. */
  readonly SHELL_CSP?: string;
}

/** Outbound fetch, injectable for tests. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Headers a client must never be able to set on the origin request. */
const SPOOFABLE = [
  "host",
  "x-pl-origin-key",
  "x-pl-client-ip",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
];
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

const isProxied = (pathname: string) =>
  pathname === "/api" || pathname.startsWith("/api/") || pathname.startsWith("/ws/");

function jsonError(status: number, error: string, message: string): Response {
  const response = new Response(JSON.stringify({ error, message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
  for (const [name, value] of Object.entries(BASE_HEADERS)) response.headers.set(name, value);
  return response;
}

/**
 * Forwards `/api/*` and `/ws/*` to the origin with the shared secret and the real client IP.
 * WebSocket upgrades are passed through untouched: the origin's 101 response (carrying the socket) is returned as is.
 */
export async function proxyToOrigin(request: Request, env: Env, fetchOrigin: FetchLike): Promise<Response> {
  if (!env.ORIGIN_URL || !env.ORIGIN_KEY) return jsonError(503, "internal", "Game server is not configured.");
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.ORIGIN_URL).toString();
  const upgrade = (request.headers.get("upgrade") ?? "").toLowerCase() === "websocket";
  if (url.pathname.startsWith("/ws/") && !upgrade) return jsonError(426, "bad_request", "WebSocket upgrade required.");

  const headers = new Headers(request.headers);
  for (const name of SPOOFABLE) headers.delete(name);
  headers.set("x-pl-origin-key", env.ORIGIN_KEY);
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) headers.set("x-pl-client-ip", clientIp);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  const ray = request.headers.get("cf-ray") ?? "";
  headers.set("x-request-id", REQUEST_ID.test(ray) ? ray : crypto.randomUUID());

  let response: Response;
  try {
    if (upgrade) return await fetchOrigin(target, { method: "GET", headers });
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    response = await fetchOrigin(target, {
      method: request.method,
      headers,
      redirect: "manual",
      ...(hasBody ? { body: request.body } : {}),
    });
  } catch {
    return jsonError(502, "internal", "Game server unreachable. Try again shortly.");
  }
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(BASE_HEADERS)) out.headers.set(name, value);
  return out;
}

/** Routes one request: API/WS to the origin, everything else to static assets with security headers. */
export async function handleRequest(request: Request, env: Env, fetchOrigin: FetchLike): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (isProxied(pathname)) return proxyToOrigin(request, env, fetchOrigin);
  const asset = await env.ASSETS.fetch(request);
  const shellCsp = env.SHELL_CSP === undefined ? DEFAULT_SHELL_CSP : env.SHELL_CSP.trim() || null;
  return withStaticHeaders(pathname, asset, shellCsp);
}

/** Cloudflare Worker entry: `pixel-life` on workers.dev (architecture HOSTING DECISION). */
export default {
  fetch: (request, env) => handleRequest(request, env, (input, init) => fetch(input, init)),
} satisfies ExportedHandler<Env>;
