/** Token-bucket parameters: `capacity` tokens, refilled continuously at `capacity` per `windowMs`. */
export interface BucketSpec {
  readonly capacity: number;
  readonly windowMs: number;
}

/** Result of one {@link RateLimiter.take}: when refused, `retryAfterMs` is when enough tokens exist again. */
export type TakeResult =
  { readonly ok: true; readonly remaining: number } | { readonly ok: false; readonly retryAfterMs: number };

/** In-memory keyed token buckets. Single process only: the server runs as one Node instance by design. */
export interface RateLimiter {
  readonly spec: BucketSpec;
  /** Takes `cost` tokens for `key`; never throws, never goes negative. */
  take(key: string, cost?: number): TakeResult;
  /** Drops buckets that have been full for a while, bounding memory to active keys. */
  sweep(): void;
  /** Number of live buckets (tests, metrics). */
  size(): number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Creates a keyed token-bucket limiter. `now` is injectable so tests control time. */
export function createRateLimiter(spec: BucketSpec, now: () => number = Date.now): RateLimiter {
  if (!(spec.capacity > 0) || !(spec.windowMs > 0)) throw new RangeError("capacity and windowMs must be positive");
  const perMs = spec.capacity / spec.windowMs;
  const buckets = new Map<string, Bucket>();

  const refill = (bucket: Bucket, t: number) => {
    const elapsed = Math.max(0, t - bucket.updatedAt);
    bucket.tokens = Math.min(spec.capacity, bucket.tokens + elapsed * perMs);
    bucket.updatedAt = t;
  };

  return {
    spec,
    take(key, cost = 1) {
      const t = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: spec.capacity, updatedAt: t };
        buckets.set(key, bucket);
      } else refill(bucket, t);
      if (bucket.tokens >= cost) {
        bucket.tokens -= cost;
        return { ok: true, remaining: Math.floor(bucket.tokens) };
      }
      return { ok: false, retryAfterMs: Math.ceil((cost - bucket.tokens) / perMs) };
    },
    sweep() {
      const t = now();
      for (const [key, bucket] of buckets) {
        refill(bucket, t);
        if (bucket.tokens >= spec.capacity) buckets.delete(key);
      }
    },
    size: () => buckets.size,
  };
}

/** Rate-limit scopes from architecture §4.5. */
export type RateScope = "auth" | "guest" | "writes" | "economy" | "wsConnect";

/** Default limits (architecture §4.5): per minute, keyed by IP (auth, guest, wsConnect) or address. */
export const DEFAULT_LIMITS: Readonly<Record<RateScope, BucketSpec>> = {
  auth: { capacity: 10, windowMs: 60_000 },
  guest: { capacity: 5, windowMs: 60_000 },
  writes: { capacity: 60, windowMs: 60_000 },
  economy: { capacity: 20, windowMs: 60_000 },
  wsConnect: { capacity: 6, windowMs: 60_000 },
};

/** One limiter per scope. */
export type RateLimiters = Readonly<Record<RateScope, RateLimiter>>;

/** Builds the per-scope limiters, optionally overriding some specs (tests). */
export function createRateLimiters(
  overrides: Partial<Record<RateScope, BucketSpec>> = {},
  now: () => number = Date.now,
): RateLimiters {
  const make = (scope: RateScope) => createRateLimiter(overrides[scope] ?? DEFAULT_LIMITS[scope], now);
  return {
    auth: make("auth"),
    guest: make("guest"),
    writes: make("writes"),
    economy: make("economy"),
    wsConnect: make("wsConnect"),
  };
}
