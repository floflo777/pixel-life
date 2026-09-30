import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";
import type { ServerConfig } from "../config.js";
import type { RateLimiter } from "../security/rate-limit.js";
import { HttpError } from "./errors.js";

/** Header the edge Worker adds to every proxied request (architecture HOSTING DECISION). */
export const ORIGIN_KEY_HEADER = "x-pl-origin-key";
/** Header carrying the real client IP, set by the Worker from `CF-Connecting-IP`. */
export const CLIENT_IP_HEADER = "x-pl-client-ip";
/** Paths reachable without the origin key: container healthchecks hit them on loopback, nginx never proxies them. */
export const UNGUARDED_PATHS: ReadonlySet<string> = new Set(["/healthz", "/readyz"]);

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time check of the origin key (hashing first makes lengths equal, so length is not leaked either). */
export function originKeyMatches(config: Pick<ServerConfig, "originKey">, headers: IncomingHttpHeaders): boolean {
  if (config.originKey === null) return true;
  const given = headers[ORIGIN_KEY_HEADER];
  if (typeof given !== "string" || given.length === 0) return false;
  return timingSafeEqual(digest(given), digest(config.originKey));
}

/**
 * Client IP for rate limiting: the Worker-supplied header when the request proved it came through
 * the Worker (origin key configured and matched), else the socket peer.
 */
export function clientIpFrom(
  config: Pick<ServerConfig, "originKey" | "trustEdgeClientIp">,
  headers: IncomingHttpHeaders,
  socketIp: string | undefined,
): string {
  if (config.trustEdgeClientIp && config.originKey !== null && originKeyMatches(config, headers)) {
    const edge = headers[CLIENT_IP_HEADER];
    if (typeof edge === "string" && isIP(edge.trim()) !== 0) return edge.trim();
  }
  return socketIp ?? "unknown";
}

/** Browser `Origin` check for state-changing requests and WebSocket upgrades (CSRF / CSWSH defence). */
export function originAllowed(config: Pick<ServerConfig, "publicOrigins">, origin: string | undefined): boolean {
  return origin === undefined || config.publicOrigins.includes(origin);
}

/** Takes one token from `limiter` for `key` or throws 429 with `Retry-After`. */
export function enforceRateLimit(limiter: RateLimiter, key: string): void {
  const result = limiter.take(key);
  if (!result.ok) {
    throw new HttpError(429, "rate_limited", "Too many requests. Slow down.", { retryAfterMs: result.retryAfterMs });
  }
}
