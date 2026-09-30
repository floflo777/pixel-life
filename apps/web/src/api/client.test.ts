import { describe, expect, it, vi } from "vitest";
import { ApiRequestError, createApi, errorMessage } from "./client.js";

type Call = { url: string; init: RequestInit };

function mockFetch(respond: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const c = { url: String(url), init: init ?? {} };
    calls.push(c);
    return respond(c);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api client", () => {
  it("sends POST bodies as JSON with same-origin credentials", async () => {
    const m = mockFetch(() => json({ tokenId: "7" }));
    const api = createApi({ fetch: m.fetch });
    await api.bindFriend("7");
    expect(m.calls[0]?.url).toBe("/api/session/friend");
    expect(m.calls[0]?.init.method).toBe("POST");
    expect(m.calls[0]?.init.credentials).toBe("same-origin");
    expect(m.calls[0]?.init.body).toBe(JSON.stringify({ tokenId: "7" }));
    expect(m.calls[0]?.init.headers).toEqual({ "content-type": "application/json" });
  });

  it("sends body-less POSTs without a content type (Fastify rejects empty JSON bodies)", async () => {
    const m = mockFetch(() => json({ guestId: "g" }));
    await createApi({ fetch: m.fetch }).guest();
    expect(m.calls[0]?.init.body).toBeUndefined();
    expect(m.calls[0]?.init.headers).toEqual({});
  });

  it("fills path params and GET queries", async () => {
    const m = mockFetch(() => json({}));
    const api = createApi({ fetch: m.fetch, base: "https://x.test" });
    await api.board("2026-10-01", "visitors");
    await api.appearance("344030");
    await api.sky("sky-docks");
    expect(m.calls.map((c) => c.url)).toEqual([
      "https://x.test/api/daily/2026-10-01/board?board=visitors",
      "https://x.test/api/friends/344030/appearance",
      "https://x.test/api/sky?room=sky-docks",
    ]);
    expect(m.calls.every((c) => c.init.method === "GET" && c.init.body === undefined)).toBe(true);
  });

  it("posts seed-pack ops to their own path", async () => {
    const m = mockFetch(() => json({ ok: true }));
    await createApi({ fetch: m.fetch }).seedpack("canBuy", { quantity: "1" });
    expect(m.calls[0]?.url).toBe("/api/seedpack/canBuy");
  });

  it("maps error bodies to ApiRequestError and calls onNotOwner", async () => {
    const onNotOwner = vi.fn();
    const m = mockFetch(() => json({ error: "not_owner", message: "gone" }, 403));
    const api = createApi({ fetch: m.fetch, onNotOwner });
    const err = await api
      .regrow({ action: { kind: "regrow", tokenId: "1", pixels: "0".repeat(63) + "1" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).code).toBe("not_owner");
    expect((err as ApiRequestError).retryable).toBe(false);
    expect(onNotOwner).toHaveBeenCalledOnce();
    expect(errorMessage(err)).toMatch(/Pick it again/);
  });

  it("treats network failures and 5xx as retryable", async () => {
    const down = createApi({ fetch: (async () => Promise.reject(new TypeError("offline"))) as typeof fetch });
    const e1 = (await down.me().catch((e: unknown) => e)) as ApiRequestError;
    expect(e1.code).toBe("network");
    expect(e1.retryable).toBe(true);
    const proxy = createApi({ fetch: mockFetch(() => new Response("Bad gateway", { status: 502 })).fetch });
    const e2 = (await proxy.me().catch((e: unknown) => e)) as ApiRequestError;
    expect(e2.status).toBe(502);
    expect(e2.retryable).toBe(true);
  });

  it("times out slow requests", async () => {
    const slow = createApi({
      timeoutMs: 10,
      fetch: ((_: unknown, init?: RequestInit) =>
        new Promise((_r, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
        )) as typeof fetch,
    });
    const e = (await slow.daily().catch((x: unknown) => x)) as ApiRequestError;
    expect(e.code).toBe("timeout");
  });

  it("calls the market and meta endpoints with their bodies", async () => {
    const m = mockFetch(() => json({}));
    const api = createApi({ fetch: m.fetch });
    await api.marketBook(10);
    await api.marketMine();
    await api.marketList(52_500_000);
    await api.marketList(52_500_000, 4);
    await api.marketCancel(4);
    await api.marketBuy(4, 50_000_000);
    await api.metaMe();
    await api.home("344030");
    await api.saveHome({ layout: { v: 1, items: [] }, hat: null, open: true });
    await api.buyItem("rock");
    await api.buyPlot();
    await api.visitHome("7");
    expect(m.calls.map((c) => `${c.init.method} ${c.url} ${String(c.init.body ?? "")}`)).toEqual([
      "GET /api/market/book?limit=10 ",
      "GET /api/market/mine ",
      'POST /api/market/list {"priceMicro":52500000}',
      'POST /api/market/list {"priceMicro":52500000,"leafId":4}',
      'POST /api/market/cancel {"leafId":4}',
      'POST /api/market/buy {"leafId":4,"expectedPriceMicro":50000000}',
      "GET /api/meta/me ",
      "GET /api/home/344030 ",
      'PUT /api/home {"layout":{"v":1,"items":[]},"hat":null,"open":true}',
      'POST /api/meta/buy {"itemId":"rock"}',
      "POST /api/meta/plot ",
      "POST /api/home/7/visit ",
    ]);
  });

  it("keeps the market's reason and prefers the server's sentence for refusals", async () => {
    const api = createApi({
      fetch: mockFetch(() =>
        json({ error: "quote_expired", message: "The ask moved to 60 RF.", marketError: "price_changed" }, 409),
      ).fetch,
    });
    const err = (await api.marketBuy(1, 50_000_000).catch((e: unknown) => e)) as ApiRequestError;
    expect(err.marketError).toBe("price_changed");
    expect(errorMessage(err)).toBe("The ask moved to 60 RF.");
    const bits = createApi({
      fetch: mockFetch(() => json({ error: "insufficient_funds", message: "Not enough Bits." }, 402)).fetch,
    });
    expect(errorMessage(await bits.buyItem("rock").catch((e: unknown) => e))).toBe("Not enough Bits.");
    // Transport and session problems keep the fixed copy whatever the body says.
    const auth = createApi({ fetch: mockFetch(() => json({ error: "unauthorized", message: "jwt" }, 401)).fetch });
    expect(errorMessage(await auth.metaMe().catch((e: unknown) => e))).toMatch(/session expired/);
    // No sentence from the server: fall back to the fixed copy.
    const bare = createApi({ fetch: mockFetch(() => json({ error: "quote_expired" }, 409)).fetch });
    expect(errorMessage(await bare.marketBuy(1, 1).catch((e: unknown) => e))).toMatch(/price changed/);
  });
});
