import type { AddressInfo } from "node:net";
import { designWorld } from "@pl/mock-rpc";
import type { Address } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { ORIGIN, ORIGIN_KEY, cookieFrom, newWallet, signIn, startHarness, type Harness } from "../test/harness.js";
import { CLOSE_CODES, createStubRoomRegistry } from "./rooms.js";

const MASK = 344030n;
const STRANGER: Address = "0x9999999999999999999999999999999999999999";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

type Outcome = { open: true; socket: WebSocket } | { open: false; status: number; body: string };

async function listen(harness: Harness): Promise<string> {
  await harness.app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = harness.app.server.address() as AddressInfo;
  return `ws://127.0.0.1:${port}`;
}

function connect(base: string, path: string, headers: Record<string, string>): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base}${path}`, { headers });
    socket.once("open", () => resolve({ open: true, socket }));
    socket.once("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => (body += chunk.toString()));
      res.on("end", () => resolve({ open: false, status: res.statusCode ?? 0, body }));
    });
    socket.once("error", reject);
  });
}

const closed = (socket: WebSocket) =>
  new Promise<number>((resolve) => socket.once("close", (code: number) => resolve(code)));

const edge = { "x-pl-origin-key": ORIGIN_KEY, origin: ORIGIN };

async function guestCookie(harness: Harness): Promise<string> {
  const response = await harness.app.inject({ method: "POST", url: "/api/guest", headers: harness.edge });
  return cookieFrom(response, "pl_guest");
}

describe("WebSocket bootstrap /ws/room/:slug", () => {
  it("accepts a guest and hands the socket to the room registry", async () => {
    const rooms = createStubRoomRegistry(["plaza"]);
    h = await startHarness({ deps: { rooms } });
    const cookie = await guestCookie(h);
    const base = await listen(h);
    const outcome = await connect(base, "/ws/room/plaza", { ...edge, cookie });
    expect(outcome.open).toBe(true);
    await expect.poll(() => rooms.connections.size).toBe(1);
    const [connection] = [...rooms.connections];
    expect(connection?.slug).toBe("plaza");
    expect(connection?.identity).toMatchObject({ kind: "guest" });
    if (outcome.open) outcome.socket.close();
  });

  it("refuses before upgrading: no identity 401 no_session, bad origin 403, no origin key 403, unknown room 404", async () => {
    h = await startHarness();
    const cookie = await guestCookie(h);
    const base = await listen(h);
    const anonymous = await connect(base, "/ws/room/plaza", edge);
    expect(anonymous).toMatchObject({ open: false, status: 401 });
    if (!anonymous.open)
      expect(JSON.parse(anonymous.body)).toMatchObject({ error: "unauthorized", reason: "no_session" });
    // No credential cookie → 401 no_session even from a foreign Origin (nothing to hijack; the client can act on it).
    const foreign = await connect(base, "/ws/room/plaza", { ...edge, origin: "https://evil.example" });
    expect(foreign).toMatchObject({ open: false, status: 401 });
    if (!foreign.open) expect(JSON.parse(foreign.body)).toMatchObject({ reason: "no_session" });
    expect(await connect(base, "/ws/room/plaza", { ...edge, cookie, origin: "https://evil.example" })).toMatchObject({
      open: false,
      status: 403,
    });
    expect(await connect(base, "/ws/room/plaza", { origin: ORIGIN, cookie })).toMatchObject({
      open: false,
      status: 403,
    });
    expect(await connect(base, "/ws/room/atlantis", { ...edge, cookie })).toMatchObject({ open: false, status: 404 });
    expect(await connect(base, "/ws/other", { ...edge, cookie })).toMatchObject({ open: false, status: 404 });
  });

  it("re-checks owner eligibility at a fresh block on join and refuses a Friend that was transferred away", async () => {
    const wallet = newWallet();
    const rooms = createStubRoomRegistry(["plaza"]);
    h = await startHarness({ world: designWorld({ owners: { [wallet.address]: [MASK] } }), deps: { rooms } });
    const session = await signIn(h, wallet);
    const bound = await h.app.inject({
      method: "POST",
      url: "/api/session/friend",
      headers: { ...h.edge, cookie: session },
      payload: { tokenId: MASK.toString() },
    });
    expect(bound.statusCode).toBe(200);
    const base = await listen(h);

    const owner = await connect(base, "/ws/room/plaza", { ...edge, cookie: session });
    expect(owner.open).toBe(true);
    await expect.poll(() => rooms.connections.size).toBe(1);
    expect([...rooms.connections][0]?.identity).toMatchObject({
      kind: "owner",
      tokenId: MASK.toString(),
      address: wallet.address.toLowerCase(),
    });

    h.rpc.world.transfer(MASK, STRANGER);
    const denied = await connect(base, "/ws/room/plaza", { ...edge, cookie: session });
    expect(denied).toMatchObject({ open: false, status: 403 });
    if (!denied.open) expect(JSON.parse(denied.body)).toMatchObject({ error: "not_owner" });
    expect(await h.db.kysely.selectFrom("friend_bindings").selectAll().execute()).toEqual([]);
    if (owner.open) owner.socket.close();
  });

  it("an owner session without a bound Friend must pick one first (403), unless it also holds a guest cookie", async () => {
    const wallet = newWallet();
    h = await startHarness();
    const session = await signIn(h, wallet);
    const guest = await guestCookie(h);
    const base = await listen(h);
    expect(await connect(base, "/ws/room/plaza", { ...edge, cookie: session })).toMatchObject({
      open: false,
      status: 403,
    });
    const both = await connect(base, "/ws/room/plaza", { ...edge, cookie: `${session}; ${guest}` });
    expect(both.open).toBe(true);
    if (both.open) both.socket.close();
  });

  it("keeps at most 2 sockets per identity: a third kicks the oldest with WS_CLOSE.replaced", async () => {
    h = await startHarness({ deps: { rateLimits: { wsConnect: { capacity: 100, windowMs: 60_000 } } } });
    const cookie = await guestCookie(h);
    const base = await listen(h);
    const sockets: WebSocket[] = [];
    for (let i = 0; i < 2; i++) {
      const o = await connect(base, "/ws/room/plaza", { ...edge, cookie });
      if (!o.open) throw new Error("expected open");
      sockets.push(o.socket);
    }
    const firstClosed = closed(sockets[0] as WebSocket);
    const third = await connect(base, "/ws/room/plaza", { ...edge, cookie });
    expect(await firstClosed).toBe(CLOSE_CODES.replaced);
    expect(sockets[1]?.readyState).toBe(WebSocket.OPEN);
    sockets[1]?.close();
    if (third.open) third.socket.close();
  });

  it("limits connection attempts to 6 per minute per IP", async () => {
    h = await startHarness();
    const cookie = await guestCookie(h);
    const base = await listen(h);
    const headers = { ...edge, cookie, "x-pl-client-ip": "203.0.113.9" };
    for (let i = 0; i < 6; i++) {
      const o = await connect(base, "/ws/room/plaza", headers);
      expect(o.open).toBe(true);
      if (o.open) o.socket.close();
    }
    const limited = await connect(base, "/ws/room/plaza", headers);
    expect(limited).toMatchObject({ open: false, status: 429 });
  });

  it("closes open sockets with 1001 when the app shuts down", async () => {
    h = await startHarness();
    const cookie = await guestCookie(h);
    const base = await listen(h);
    const o = await connect(base, "/ws/room/plaza", { ...edge, cookie });
    if (!o.open) throw new Error("expected open");
    const code = closed(o.socket);
    await h.app.close();
    expect(await code).toBe(CLOSE_CODES.goingAway);
  });
});
