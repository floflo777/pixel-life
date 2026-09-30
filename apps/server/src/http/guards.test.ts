import { afterEach, describe, expect, it } from "vitest";
import { LATEST_MIGRATION, ORIGIN, ORIGIN_KEY, cookieFrom, startHarness, type Harness } from "../test/harness.js";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe("origin-key guard", () => {
  it("refuses API requests without the Worker's key, with a bland 403", async () => {
    h = await startHarness();
    const missing = await h.app.inject({ method: "GET", url: "/api/auth/nonce" });
    expect(missing.statusCode).toBe(403);
    expect(missing.json()).toMatchObject({ error: "forbidden", message: "Forbidden." });
    expect(missing.json()).not.toHaveProperty("reason");
    const wrong = await h.app.inject({
      method: "GET",
      url: "/api/auth/nonce",
      headers: { "x-pl-origin-key": "x".repeat(40) },
    });
    expect(wrong.statusCode).toBe(403);
    const unknownRoute = await h.app.inject({ method: "GET", url: "/nope" });
    expect(unknownRoute.statusCode).toBe(403);
    const ok = await h.app.inject({
      method: "GET",
      url: "/api/auth/nonce",
      headers: { "x-pl-origin-key": ORIGIN_KEY },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("leaves liveness and readiness open for the container healthcheck", async () => {
    h = await startHarness({ deps: { expectedMigration: LATEST_MIGRATION } });
    expect((await h.app.inject({ method: "GET", url: "/healthz" })).json()).toMatchObject({ status: "ok" });
    const ready = await h.app.inject({ method: "GET", url: "/readyz" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ready", db: "ok", migration: LATEST_MIGRATION });
  });

  it("reports not ready when the schema is behind the build", async () => {
    h = await startHarness({ deps: { expectedMigration: "9999_future.sql" } });
    const ready = await h.app.inject({ method: "GET", url: "/readyz" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({ status: "not_ready", migration: LATEST_MIGRATION });
  });

  it("is disabled when ORIGIN_KEY is unset (local dev)", async () => {
    h = await startHarness({ env: { ORIGIN_KEY: "" } });
    expect((await h.app.inject({ method: "GET", url: "/api/auth/nonce" })).statusCode).toBe(200);
  });
});

describe("request plumbing", () => {
  it("echoes a sane x-request-id or generates one, and marks API responses no-store + nosniff", async () => {
    h = await startHarness();
    const given = await h.app.inject({
      method: "GET",
      url: "/api/auth/nonce",
      headers: { ...h.edge, "x-request-id": "cf-ray-1234abcd" },
    });
    expect(given.headers["x-request-id"]).toBe("cf-ray-1234abcd");
    expect(given.headers["cache-control"]).toBe("no-store");
    expect(given.headers["x-content-type-options"]).toBe("nosniff");
    const junk = await h.app.inject({
      method: "GET",
      url: "/api/auth/nonce",
      headers: { ...h.edge, "x-request-id": "<script>" },
    });
    expect(junk.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses state-changing requests from another browser origin (CSRF)", async () => {
    h = await startHarness();
    const cross = await h.app.inject({
      method: "POST",
      url: "/api/guest",
      headers: { "x-pl-origin-key": ORIGIN_KEY, origin: "https://evil.example" },
    });
    expect(cross.statusCode).toBe(403);
    expect(cross.json()).toMatchObject({ error: "forbidden", reason: "bad_origin" });
    const sameSite = await h.app.inject({ method: "POST", url: "/api/guest", headers: h.edge });
    expect(sameSite.statusCode).toBe(200);
  });

  it("returns JSON 404s with the shared error shape", async () => {
    h = await startHarness();
    const response = await h.app.inject({ method: "GET", url: "/api/nope", headers: h.edge });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found", requestId: expect.any(String) });
  });
});

describe("rate limits (architecture §4.5)", () => {
  it("allows 10 auth requests per minute per client IP, then 429 with Retry-After", async () => {
    h = await startHarness();
    const nonce = (ip: string) =>
      h?.app.inject({ method: "GET", url: "/api/auth/nonce", headers: { ...h.edge, "x-pl-client-ip": ip } });
    for (let i = 0; i < 10; i++) expect((await nonce("203.0.113.7"))?.statusCode).toBe(200);
    const limited = await nonce("203.0.113.7");
    expect(limited?.statusCode).toBe(429);
    expect(limited?.json()).toMatchObject({ error: "rate_limited", retryAfterMs: expect.any(Number) });
    expect(Number(limited?.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    // Another client is unaffected: the key is the Worker-reported IP, not the proxy's socket address.
    expect((await nonce("198.51.100.1"))?.statusCode).toBe(200);
    // Tokens refill over time.
    h.clock.advance(6_001);
    expect((await nonce("203.0.113.7"))?.statusCode).toBe(200);
  });

  it("ignores x-pl-client-ip when the request did not prove it came through the Worker", async () => {
    h = await startHarness({ env: { ORIGIN_KEY: "" } });
    for (let i = 0; i < 10; i++) {
      const r = await h.app.inject({
        method: "GET",
        url: "/api/auth/nonce",
        headers: { "x-pl-client-ip": `192.0.2.${i}` },
      });
      expect(r.statusCode).toBe(200);
    }
    // All 10 were keyed on the socket address, so spoofing a new IP does not reset the bucket.
    const spoofed = await h.app.inject({
      method: "GET",
      url: "/api/auth/nonce",
      headers: { "x-pl-client-ip": "192.0.2.99" },
    });
    expect(spoofed.statusCode).toBe(429);
  });

  it("allows 5 new guests per minute per IP, but re-presenting a guest cookie is free", async () => {
    h = await startHarness();
    const guest = (cookie?: string) =>
      h?.app.inject({ method: "POST", url: "/api/guest", headers: { ...h.edge, ...(cookie ? { cookie } : {}) } });
    const first = await guest();
    if (!first) throw new Error("no response");
    const cookie = cookieFrom(first, "pl_guest");
    for (let i = 0; i < 4; i++) expect((await guest())?.statusCode).toBe(200);
    expect((await guest())?.statusCode).toBe(429);
    expect((await guest(cookie))?.statusCode).toBe(200);
  });

  it("uses per-scope overrides injected by tests or config", async () => {
    h = await startHarness({ deps: { rateLimits: { auth: { capacity: 1, windowMs: 60_000 } } } });
    const headers = { ...h.edge, origin: ORIGIN };
    expect((await h.app.inject({ method: "GET", url: "/api/auth/nonce", headers })).statusCode).toBe(200);
    expect((await h.app.inject({ method: "GET", url: "/api/auth/nonce", headers })).statusCode).toBe(429);
  });
});
