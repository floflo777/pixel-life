import { describe, expect, it } from "vitest";
import { parseCookies, serializeCookie } from "../http/cookies.js";
import { signJwt, verifyJwt } from "./jwt.js";
import { createRateLimiter } from "./rate-limit.js";

const SECRET = "x".repeat(40);

describe("jwt", () => {
  const claims = { kind: "sess" as const, sub: "0xabc", sid: "s1", iat: 1_000, exp: 2_000 };

  it("round-trips and enforces kind, expiry, secret and header", () => {
    const token = signJwt(claims, SECRET);
    expect(verifyJwt(token, SECRET, "sess", 1_500)).toEqual(claims);
    expect(verifyJwt(token, SECRET, "guest", 1_500)).toBeNull();
    expect(verifyJwt(token, SECRET, "sess", 2_000)).toBeNull();
    expect(verifyJwt(token, "y".repeat(40), "sess", 1_500)).toBeNull();
    const [, payload, mac] = token.split(".");
    const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    expect(verifyJwt(`${none}.${payload}.${mac}`, SECRET, "sess", 1_500)).toBeNull();
    expect(verifyJwt(`${token}x`, SECRET, "sess", 1_500)).toBeNull();
    expect(verifyJwt("a.b", SECRET, "sess", 1_500)).toBeNull();
  });

  it("rejects tokens issued in the future", () => {
    expect(verifyJwt(signJwt({ ...claims, iat: 5_000, exp: 9_000 }, SECRET), SECRET, "sess", 1_500)).toBeNull();
  });
});

describe("cookies", () => {
  it("serializes HttpOnly Lax cookies and parses them back", () => {
    const set = serializeCookie("pl_sess", "a b", { maxAgeSeconds: 60, secure: true });
    expect(set).toBe("pl_sess=a%20b; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure");
    expect(serializeCookie("pl_sess", "", { maxAgeSeconds: 0, secure: false })).toContain("Expires=Thu, 01 Jan 1970");
    const parsed = parseCookies('pl_sess=a%20b; other="q"; pl_sess=second; bad; =x');
    expect(parsed.get("pl_sess")).toBe("a b");
    expect(parsed.get("other")).toBe("q");
    expect(parseCookies(undefined).size).toBe(0);
  });
});

describe("token bucket", () => {
  it("allows a burst of `capacity`, refills continuously and reports retry time", () => {
    let t = 0;
    const limiter = createRateLimiter({ capacity: 3, windowMs: 3_000 }, () => t);
    expect([1, 2, 3].map(() => limiter.take("k").ok)).toEqual([true, true, true]);
    const refused = limiter.take("k");
    expect(refused).toEqual({ ok: false, retryAfterMs: 1_000 });
    t = 999;
    expect(limiter.take("k").ok).toBe(false);
    t = 1_000;
    expect(limiter.take("k").ok).toBe(true);
    expect(limiter.take("other").ok).toBe(true);
  });

  it("sweeps idle full buckets so memory tracks active keys", () => {
    let t = 0;
    const limiter = createRateLimiter({ capacity: 2, windowMs: 1_000 }, () => t);
    limiter.take("a");
    limiter.take("b");
    expect(limiter.size()).toBe(2);
    t = 10_000;
    limiter.sweep();
    expect(limiter.size()).toBe(0);
  });

  it("rejects nonsensical specs", () => {
    expect(() => createRateLimiter({ capacity: 0, windowMs: 1 })).toThrow(RangeError);
  });
});
