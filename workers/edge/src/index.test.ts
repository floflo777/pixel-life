import { describe, expect, it } from "vitest";
import { CHILD_CSP, DEFAULT_SHELL_CSP, SDK_CHILD_CSP } from "./headers.js";
import { handleRequest, type Env, type FetchLike } from "./index.js";

const KEY = "k".repeat(40);
const APP = "https://pixel-life.florent-g.workers.dev";

interface Call {
  url: string;
  init: RequestInit;
}

function setup(overrides: Partial<Env> = {}, originResponse: () => Response = () => Response.json({ ok: true })) {
  const calls: Call[] = [];
  const assets: Request[] = [];
  const env: Env = {
    ASSETS: {
      fetch: async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        assets.push(request);
        const { pathname } = new URL(request.url);
        const type = pathname.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8";
        return new Response(pathname.endsWith(".js") ? "console.log(1)" : "<!doctype html>", {
          headers: { "content-type": type },
        });
      },
    } as Env["ASSETS"],
    ORIGIN_URL: "https://rf-origin.example.test",
    ORIGIN_KEY: KEY,
    ...overrides,
  };
  const fetchOrigin: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return originResponse();
  };
  return { env, calls, assets, fetchOrigin };
}

const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

describe("API proxy", () => {
  it("forwards /api/* to the origin with the secret, client IP and request id, keeping method, query and body", async () => {
    const { env, calls, fetchOrigin } = setup();
    const request = new Request(`${APP}/api/auth/verify?x=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "pl_sess=abc",
        "cf-connecting-ip": "203.0.113.5",
        "cf-ray": "8abc1234def-CDG",
      },
      body: JSON.stringify({ hello: "world" }),
    });
    const response = await handleRequest(request, env, fetchOrigin);
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    if (!call) throw new Error("no call");
    expect(call.url).toBe("https://rf-origin.example.test/api/auth/verify?x=1");
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect(header(call.init, "x-pl-origin-key")).toBe(KEY);
    expect(header(call.init, "x-pl-client-ip")).toBe("203.0.113.5");
    expect(header(call.init, "x-request-id")).toBe("8abc1234def-CDG");
    expect(header(call.init, "x-forwarded-host")).toBe("pixel-life.florent-g.workers.dev");
    expect(header(call.init, "cookie")).toBe("pl_sess=abc");
    expect(await new Response(call.init.body).text()).toBe('{"hello":"world"}');
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("never forwards a client-supplied origin key or client IP", async () => {
    const { env, calls, fetchOrigin } = setup();
    await handleRequest(
      new Request(`${APP}/api/me`, { headers: { "x-pl-origin-key": "guess", "x-pl-client-ip": "1.2.3.4" } }),
      env,
      fetchOrigin,
    );
    const init = calls[0]?.init ?? {};
    expect(header(init, "x-pl-origin-key")).toBe(KEY);
    expect(header(init, "x-pl-client-ip")).toBeNull();
    expect(init.body).toBeUndefined();
  });

  it("passes WebSocket upgrades through and returns the origin response untouched", async () => {
    const upgradeResponse = new Response(null, { status: 200, headers: { "x-origin": "yes" } });
    const { env, calls, fetchOrigin } = setup({}, () => upgradeResponse);
    const response = await handleRequest(
      new Request(`${APP}/ws/room/plaza`, { headers: { upgrade: "websocket", cookie: "pl_guest=g" } }),
      env,
      fetchOrigin,
    );
    expect(response).toBe(upgradeResponse);
    expect(calls[0]?.url).toBe("https://rf-origin.example.test/ws/room/plaza");
    expect(header(calls[0]?.init ?? {}, "upgrade")).toBe("websocket");
    expect(header(calls[0]?.init ?? {}, "x-pl-origin-key")).toBe(KEY);
  });

  it("answers 426 for /ws/* without an upgrade, 502 when the origin is down, 503 when unconfigured", async () => {
    const ok = setup();
    expect((await handleRequest(new Request(`${APP}/ws/room/plaza`), ok.env, ok.fetchOrigin)).status).toBe(426);
    expect(ok.calls).toHaveLength(0);

    const down = setup({}, () => {
      throw new TypeError("connect ECONNREFUSED");
    });
    const bad = await handleRequest(new Request(`${APP}/api/me`), down.env, down.fetchOrigin);
    expect(bad.status).toBe(502);
    expect(await bad.json()).toMatchObject({ error: "internal" });

    const unset = setup({ ORIGIN_KEY: "" });
    expect((await handleRequest(new Request(`${APP}/api/me`), unset.env, unset.fetchOrigin)).status).toBe(503);
  });

  it("proxies the bare /api path but not look-alikes such as /apiary", async () => {
    const { env, calls, assets, fetchOrigin } = setup();
    await handleRequest(new Request(`${APP}/api`), env, fetchOrigin);
    await handleRequest(new Request(`${APP}/apiary`), env, fetchOrigin);
    expect(calls.map((c) => c.url)).toEqual(["https://rf-origin.example.test/api"]);
    expect(assets.map((r) => new URL(r.url).pathname)).toEqual(["/apiary"]);
  });
});

describe("static assets", () => {
  it("serves SDK child documents with the SDK child CSP, framable only by our origin", async () => {
    const { env, fetchOrigin } = setup();
    const response = await handleRequest(new Request(`${APP}/venues/seed-pack/game.html`), env, fetchOrigin);
    expect(response.headers.get("content-security-policy")).toBe(CHILD_CSP);
    expect(CHILD_CSP.startsWith(SDK_CHILD_CSP)).toBe(true);
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("gives the shell a CSP and anti-framing, and immutable caching to hashed assets", async () => {
    const { env, fetchOrigin } = setup();
    const page = await handleRequest(new Request(`${APP}/hub`), env, fetchOrigin);
    expect(page.headers.get("content-security-policy")).toBe(DEFAULT_SHELL_CSP);
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(page.headers.get("strict-transport-security")).toContain("max-age=31536000");
    const js = await handleRequest(new Request(`${APP}/assets/index-AbCdEf12.js`), env, fetchOrigin);
    expect(js.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(js.headers.get("content-security-policy")).toBeNull();
  });

  it("lets SHELL_CSP override or disable the shell policy", async () => {
    const custom = setup({ SHELL_CSP: "default-src 'self'" });
    const page = await handleRequest(new Request(`${APP}/`), custom.env, custom.fetchOrigin);
    expect(page.headers.get("content-security-policy")).toBe("default-src 'self'");
    const off = setup({ SHELL_CSP: "" });
    const bare = await handleRequest(new Request(`${APP}/`), off.env, off.fetchOrigin);
    expect(bare.headers.get("content-security-policy")).toBeNull();
  });
});
