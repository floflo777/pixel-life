import type { AddressInfo } from "node:net";
import {
  EMPTY_MASK,
  WS_CLOSE,
  decodeServerFrame,
  encodeMsg,
  frontMask,
  fromIndices,
  scarsHash,
  toIndices,
  type ServerMsg,
} from "@pl/shared";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { ORIGIN, ORIGIN_KEY } from "../test/harness.js";
import { MASK, SKELETON, art, call, guest, owner, setFriend, startGame, type Game } from "../test/game.js";
import { DEFAULT_LOANER } from "./hub-registry.js";

let g: Game | undefined;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await g?.h.close();
  g = undefined;
});

/** A client socket that records decoded server messages. */
async function connect(game: Game, path: string, cookie: string): Promise<{ ws: WebSocket; inbox: ServerMsg[] }> {
  if (!game.h.app.server.listening) await game.h.app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = game.h.app.server.address() as AddressInfo;
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    headers: { "x-pl-origin-key": ORIGIN_KEY, origin: ORIGIN, cookie },
  });
  sockets.push(ws);
  const inbox: ServerMsg[] = [];
  ws.on("message", (data) => {
    const m = decodeServerFrame(String(data));
    if (m) inbox.push(m);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return { ws, inbox };
}

const ofType = <T extends ServerMsg[0]>(inbox: ServerMsg[], type: T) =>
  inbox.filter((m): m is Extract<ServerMsg, [T, ...unknown[]]> => m[0] === type);

describe("WebSocket rooms on the @pl/realtime hub", () => {
  it("welcomes an owner with its settled scars and a guest walking a loaned Friend; relays pings and joins", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const lost = fromIndices(toIndices(frontMask(await art(h, MASK))).slice(0, 2));
    await setFriend(h, MASK, { lost });
    const o = await connect(g, "/ws/room/plaza", cookie);
    await expect.poll(() => ofType(o.inbox, "welcome").length).toBe(1);
    const [, you, roster] = ofType(o.inbox, "welcome")[0] ?? [];
    const me = roster?.find((e) => e.id === you);
    expect(me).toMatchObject({ kind: "owner", tokenId: MASK.toString(), loaned: false, goldHeld: 0 });
    expect(me?.scarsHash).toBe(scarsHash({ lost, updatedAt: 0, version: 0 }));

    const gc = await guest(h);
    const v = await connect(g, "/ws/room/plaza?loan=65042", gc);
    await expect.poll(() => ofType(v.inbox, "welcome").length).toBe(1);
    await expect.poll(() => ofType(o.inbox, "join").length).toBe(1);
    expect(ofType(o.inbox, "join")[0]?.[1]).toMatchObject({ kind: "guest", tokenId: "65042", loaned: true });

    v.ws.send(encodeMsg(["ping", 123]));
    await expect.poll(() => ofType(v.inbox, "pong").length).toBe(1);
    v.ws.close();
    await expect.poll(() => ofType(o.inbox, "leave").length).toBe(1);
  });

  it("defaults a guest to the landing loaner, honours ?shard= invites, and kicks binary frames with 4000", async () => {
    g = await startGame();
    const { h } = g;
    const a = await connect(g, "/ws/room/plaza?shard=3&loan=nope", await guest(h));
    await expect.poll(() => ofType(a.inbox, "welcome").length).toBe(1);
    const [, you, roster] = ofType(a.inbox, "welcome")[0] ?? [];
    expect(roster?.find((e) => e.id === you)?.tokenId).toBe(DEFAULT_LOANER);
    expect(h.ctx.hub.populations().plaza).toBe(1);
    expect(h.ctx.hub.snapshot("room:plaza:3").length).toBe(1);
    const closed = new Promise<number>((resolve) => a.ws.once("close", (code) => resolve(code)));
    a.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    expect(await closed).toBe(WS_CLOSE.badMessage);
  });

  it("a Mend reaches the online target owner (notify) and sparkles in its room (mended, scars)", async () => {
    g = await startGame();
    const { h, alice, bob } = g;
    const payer = await owner(h, alice, MASK);
    const target = await owner(h, bob, SKELETON);
    const px = fromIndices(toIndices(frontMask(await art(h, SKELETON))).slice(0, 1));
    await setFriend(h, SKELETON, { lost: px });
    const b = await connect(g, "/ws/room/sky-docks", target);
    await expect.poll(() => ofType(b.inbox, "welcome").length).toBe(1);
    const r = await call(h, "POST", "/api/economy/mend", payer, {
      action: { kind: "mend", payer: MASK.toString(), target: SKELETON.toString(), pixels: px },
    });
    expect(r.statusCode).toBe(200);
    await expect.poll(() => ofType(b.inbox, "notify").length).toBe(1);
    expect(ofType(b.inbox, "notify")[0]?.[1]).toMatchObject({ kind: "mended", by: MASK.toString(), px: 1 });
    await expect.poll(() => ofType(b.inbox, "mended").length).toBe(1);
    expect(ofType(b.inbox, "mended")[0]).toEqual(["mended", SKELETON.toString(), MASK.toString(), 1]);
    await expect.poll(() => ofType(b.inbox, "scars").length).toBe(1);
    expect(ofType(b.inbox, "scars")[0]?.[2]).toBe(scarsHash(r.json().scars));
    expect(r.json().scars.lost).toBe(EMPTY_MASK);
  });

  it("closes hub sockets with 1001 on shutdown", async () => {
    g = await startGame();
    const { h } = g;
    const a = await connect(g, "/ws/room/plaza", await guest(h));
    await expect.poll(() => ofType(a.inbox, "welcome").length).toBe(1);
    const closed = new Promise<number>((resolve) => a.ws.once("close", (code) => resolve(code)));
    await h.app.close();
    expect(await closed).toBe(1001);
  });
});
