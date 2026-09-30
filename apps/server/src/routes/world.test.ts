import {
  EMPTY_MASK,
  ROOMS,
  frontMask,
  fromIndices,
  popcount,
  scarsHash,
  toIndices,
  type FriendAppearance,
  type SkyRes,
} from "@pl/shared";
import { afterEach, describe, expect, it } from "vitest";
import { dailySeed, nextMidnightUtc, utcDay } from "../game/daily.js";
import { signIn } from "../test/harness.js";
import { HOVERER, MASK, SKELETON, art, call, guest, owner, setFriend, startGame, type Game } from "../test/game.js";
import { skyRoomOf } from "./world.js";

let g: Game | undefined;
afterEach(async () => {
  await g?.h.close();
  g = undefined;
});

describe("GET /api/friends/:id/appearance", () => {
  it("reads the registry once, caches in Postgres and serves immutable, CORS-open art", async () => {
    g = await startGame();
    const { h } = g;
    const first = await call(h, "GET", `/api/friends/${MASK}/appearance`);
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(first.headers["access-control-allow-origin"]).toBe("*");
    const body = first.json() as FriendAppearance;
    expect(body).toMatchObject({ tokenId: MASK.toString(), familyId: 1 });
    expect(body.frames).toHaveLength(64);
    const cached = await h.db.kysely.selectFrom("friend_appearance").selectAll().execute();
    expect(cached).toHaveLength(1);
    // Chain down: still served (memory, then Postgres after a restart-like cache miss).
    h.rpc.world.setFault({ kind: "http-error", status: 502 });
    expect((await call(h, "GET", `/api/friends/${MASK}/appearance`)).json()).toEqual(body);
  });

  it("answers 404 for an unminted token, 400 for a malformed id and 503 when the chain is down", async () => {
    g = await startGame();
    const { h } = g;
    const unknown = await call(h, "GET", "/api/friends/424242/appearance");
    expect(unknown.statusCode).toBe(404);
    expect((await call(h, "GET", "/api/friends/0/appearance")).statusCode).toBe(400);
    expect((await call(h, "GET", "/api/friends/12abc/appearance")).statusCode).toBe(400);
    h.rpc.world.setFault({ kind: "http-error", status: 502 });
    const down = await call(h, "GET", `/api/friends/${SKELETON}/appearance`);
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ error: "unavailable", reason: "rpc_error" });
  });
});

describe("GET /api/friends/:id/public", () => {
  it("serves effective scars (free regrowth, Gold perk), streak and a 15 s CORS * cache; 404 when unknown", async () => {
    g = await startGame();
    const { h, alice } = g;
    await owner(h, alice, MASK);
    const unknown = await call(h, "GET", `/api/friends/${SKELETON}/public`);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.headers["access-control-allow-origin"]).toBe("*");

    const idx = toIndices(frontMask(await art(h, MASK))).slice(0, 4);
    await setFriend(h, MASK, { lost: fromIndices(idx) });
    h.clock.advance(2 * 3_600_000); // 0.5 px/h → 1 pixel regrows
    const r = await call(h, "GET", `/api/friends/${MASK}/public`);
    expect(r.headers["cache-control"]).toBe("public, max-age=15");
    expect(r.headers["access-control-allow-origin"]).toBe("*");
    expect(popcount(r.json().scars.lost)).toBe(3);
    expect(r.json()).toMatchObject({ goldHeld: 0, streak: 0, economy: "sim", glowCracks: 0 });
    // Two held Gold Pixels: ×1.5 speed from the stored anchor.
    await h.db.kysely
      .insertInto("seedpack_friend")
      .values({ token_id: MASK.toString(), inventory: JSON.stringify([0, 0, 0, 2]) })
      .execute();
    h.clock.advance(2 * 3_600_000);
    const gold = (await call(h, "GET", `/api/friends/${MASK}/public`)).json();
    expect(gold.goldHeld).toBe(2);
    // 4 h at 1 px / 80 min = 3 pixels back (2 without Gold).
    expect(popcount(gold.scars.lost)).toBe(1);
  });
});

describe("GET /api/me", () => {
  it("describes anonymous, guest and owner callers", async () => {
    g = await startGame();
    const { h, alice } = g;
    expect((await call(h, "GET", "/api/me")).json()).toEqual({
      identity: { kind: "anon" },
      friend: null,
      balanceMicro: null,
      unread: 0,
      economy: "sim",
    });
    const gc = await guest(h);
    expect((await call(h, "GET", "/api/me", gc)).json().identity).toMatchObject({ kind: "guest" });
    const session = await signIn(h, alice);
    expect((await call(h, "GET", "/api/me", session)).json()).toMatchObject({
      identity: { kind: "owner", address: alice.address },
      friend: null,
      balanceMicro: null,
      bits: 0,
    });
    const cookie = await owner(h, alice, MASK);
    const me = (await call(h, "GET", "/api/me", cookie)).json();
    expect(me.friend).toMatchObject({ loaned: false, appearance: { tokenId: MASK.toString() } });
    expect(me.balanceMicro).toBe(20_000_000);
    expect((await call(h, "DELETE", "/api/session/friend", cookie)).json()).toEqual({ ok: true });
    expect((await call(h, "GET", "/api/me", cookie)).json().friend).toBeNull();
  });
});

describe("GET /api/sky", () => {
  it("lists resting Friends of this room (scarred first), excluding owners who are online", async () => {
    g = await startGame();
    const { h, alice, bob } = g;
    await owner(h, alice, MASK);
    await owner(h, bob, SKELETON);
    await owner(h, bob, HOVERER);
    await setFriend(h, SKELETON, { lost: fromIndices(toIndices(frontMask(await art(h, SKELETON))).slice(0, 2)) });
    const room = skyRoomOf(SKELETON.toString());
    const sky = (await call(h, "GET", `/api/sky?room=${room}`)).json() as SkyRes;
    expect(sky.room).toBe(room);
    const ids = sky.friends.map((f) => f.tokenId);
    expect(ids).toContain(SKELETON.toString());
    for (const id of ids) expect(skyRoomOf(id)).toBe(room);
    expect(sky.friends[0]?.tokenId).toBe(SKELETON.toString());
    expect(sky.friends[0]?.pub.scars.lost).not.toBe(EMPTY_MASK);
    // Bob comes online: his Friends are live presences, not resting ones.
    g.h.ctx.hub.directory.ownerOnline(bob.address, "room:plaza:0", "c-test");
    const again = (await call(h, "GET", `/api/sky?room=${room}`)).json() as SkyRes;
    expect(again.friends.map((f) => f.tokenId)).not.toContain(SKELETON.toString());
    expect((await call(h, "GET", "/api/sky?room=atlantis")).statusCode).toBe(400);
    // Every room answers.
    for (const r of ROOMS) expect((await call(h, "GET", `/api/sky?room=${r}`)).statusCode).toBe(200);
  });
});

describe("GET /api/daily", () => {
  it("serves today's HMAC seed and the next midnight", async () => {
    g = await startGame();
    const { h } = g;
    const now = h.clock.now();
    const r = (await call(h, "GET", "/api/daily")).json();
    expect(r).toEqual({
      day: utcDay(now),
      seed: dailySeed(utcDay(now), h.config.dailySecret),
      endsAt: nextMidnightUtc(now),
    });
    expect(dailySeed("2026-10-01", "a".repeat(32))).not.toBe(dailySeed("2026-10-02", "a".repeat(32)));
    expect(dailySeed("2026-10-01", "a".repeat(32))).not.toBe(dailySeed("2026-10-01", "b".repeat(32)));
  });
});

describe("inbox", () => {
  it("requires a session and a bound Friend", async () => {
    g = await startGame();
    const { h, alice } = g;
    expect((await call(h, "GET", "/api/inbox")).json()).toMatchObject({ error: "no_session" });
    expect((await call(h, "GET", "/api/inbox", await signIn(h, alice))).json()).toMatchObject({ reason: "no_binding" });
    const cookie = await owner(h, alice, MASK);
    expect((await call(h, "GET", "/api/inbox", cookie)).json()).toEqual({ items: [], unread: 0 });
    expect((await call(h, "POST", "/api/inbox/read", cookie, { ids: [] })).json()).toEqual({ unread: 0 });
    expect((await call(h, "POST", "/api/inbox/read", cookie, { nope: 1 })).statusCode).toBe(400);
  });
});

describe("GET /api/stats/economy", () => {
  it("labels simulated totals and starts at zero", async () => {
    g = await startGame();
    const r = await call(g.h, "GET", "/api/stats/economy");
    expect(r.json()).toMatchObject({
      mode: "sim",
      simulated: true,
      burnedMicro: 0,
      streamMicro: 0,
      toFriendsMicro: 0,
      counts: { regrow: 0, mend: 0, seedPacks: 0 },
      since: 0,
    });
    expect(r.headers["cache-control"]).toBe("public, max-age=30");
    expect(scarsHash({ lost: EMPTY_MASK, updatedAt: 0, version: 0 })).toMatch(/^[0-9a-f]{8}$/);
  });
});
