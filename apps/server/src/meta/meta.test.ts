import { designWorld } from "@pl/mock-rpc";
import {
  BITS,
  CATALOG,
  catalogItem,
  FRIEND_SPOT,
  itemCost,
  microToWei,
  STAMPS,
  type BuyRes,
  type HomeView,
  type MetaMeRes,
  type PlotRes,
} from "@pl/shared";
import type { Address } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { newWallet, signIn, startHarness, type Harness } from "../test/harness.js";
import { onGoldKept, onMendGiven, onRunFinished, recordMetaEvent } from "./hooks.js";
import { metaDb } from "./tables.js";

const MASK = 344030n;
const OTHER = 344033n;

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

interface Player {
  readonly h: Harness;
  readonly cookie: string;
  readonly address: string;
  readonly tokenId: string;
}

async function player(): Promise<Player> {
  const wallet = newWallet();
  h = await startHarness({ world: designWorld({ owners: { [wallet.address as Address]: [MASK, OTHER] } }) });
  const cookie = await signIn(h, wallet);
  const bound = await h.app.inject({
    method: "POST",
    url: "/api/session/friend",
    headers: { ...h.edge, cookie },
    payload: { tokenId: MASK.toString() },
  });
  expect(bound.statusCode).toBe(200);
  return { h, cookie, address: wallet.address.toLowerCase(), tokenId: MASK.toString() };
}

async function fundBits(p: Player, balance: number): Promise<void> {
  await metaDb(p.h.db.kysely)
    .insertInto("bits_accounts")
    .values({ account: p.address, balance, updated_at: p.h.clock.now() })
    .onConflict((oc) => oc.column("account").doUpdateSet({ balance }))
    .execute();
}

async function fundRf(p: Player, micro: number): Promise<void> {
  await p.h.db.kysely.updateTable("friends").set({ sim_rf_micro: micro }).where("token_id", "=", p.tokenId).execute();
}

const call = (p: Player, method: "GET" | "PUT" | "POST", url: string, payload?: object) =>
  p.h.app.inject({ method, url, headers: { ...p.h.edge, cookie: p.cookie }, ...(payload ? { payload } : {}) });

const buy = (p: Player, itemId: string) => call(p, "POST", "/api/meta/buy", { itemId });

describe("catalog and public home view", () => {
  it("serves the static catalog and a default isle for any valid token", async () => {
    const p = await player();
    const catalog = await p.h.app.inject({ method: "GET", url: "/api/meta/catalog", headers: p.h.edge });
    expect(catalog.statusCode).toBe(200);
    expect((catalog.json() as { items: unknown[] }).items).toHaveLength(CATALOG.length);
    const view = await p.h.app.inject({ method: "GET", url: "/api/home/12345", headers: p.h.edge });
    expect(view.statusCode).toBe(200);
    expect(view.headers["cache-control"]).toContain("public");
    const body = view.json() as HomeView;
    expect(body).toMatchObject({ tokenId: "12345", terraces: 1, layout: { v: 1, items: [] }, belt: null, stamps: [] });
    const bad = await p.h.app.inject({ method: "GET", url: "/api/home/0x12", headers: p.h.edge });
    expect(bad.statusCode).toBe(400);
  });
});

describe("buying", () => {
  it("buys a Bits item into the account wardrobe and refuses without enough Bits", async () => {
    const p = await player();
    expect((await buy(p, "bench")).statusCode).toBe(402);
    await fundBits(p, 1000);
    const res = await buy(p, "bench");
    expect(res.statusCode).toBe(200);
    const body = res.json() as BuyRes;
    expect(body).toMatchObject({ item: "bench", owned: 1, bits: 600 });
    expect(body.receipt).toBeUndefined();
    const again = (await buy(p, "bench")).json() as BuyRes;
    expect(again).toMatchObject({ owned: 2, bits: 200 });
    const spends = await metaDb(p.h.db.kysely).selectFrom("bits_spends").selectAll().execute();
    expect(spends.map((s) => [s.kind, s.ref, s.amount])).toEqual([
      ["item", "bench", 400],
      ["item", "bench", 400],
    ]);
    expect((await buy(p, "nope")).statusCode).toBe(404);
    expect(
      (await p.h.app.inject({ method: "POST", url: "/api/meta/buy", headers: p.h.edge, payload: { itemId: "bench" } }))
        .statusCode,
    ).toBe(401);
  });

  it("buys RF decor on the sim ledger with a 50/50 burn/stream split, plus the blueprint for crafted tiers", async () => {
    const p = await player();
    await fundRf(p, 30_000_000);
    await fundBits(p, 500);
    const lantern = (await buy(p, "sun_lantern")).json() as BuyRes;
    expect(lantern.receipt).toMatchObject({ totalMicro: 2_000_000, burnMicro: 1_000_000, streamMicro: 1_000_000 });
    expect(lantern.simRfMicro).toBe(28_000_000);
    expect(lantern.bits).toBe(500);
    // The 10 RF crafted arch also needs a 1,000 Bits blueprint: refused atomically (no RF taken).
    expect((await buy(p, "gold_arch")).statusCode).toBe(402);
    const friend = await p.h.db.kysely
      .selectFrom("friends")
      .select("sim_rf_micro")
      .where("token_id", "=", p.tokenId)
      .executeTakeFirstOrThrow();
    expect(friend.sim_rf_micro).toBe(28_000_000);
    await fundBits(p, BITS.craftedBlueprints.rf10);
    const arch = (await buy(p, "gold_arch")).json() as BuyRes;
    expect(arch).toMatchObject({ bits: 0, simRfMicro: 18_000_000 });
    const ledger = await p.h.db.kysely.selectFrom("rf_ledger").selectAll().orderBy("total").execute();
    expect(ledger.map((r) => [r.kind, r.mode, r.payer_token, r.total, r.burn, r.stream, r.to_target])).toEqual([
      ["decor", "sim", p.tokenId, microToWei(2_000_000), microToWei(1_000_000), microToWei(1_000_000), "0"],
      ["decor", "sim", p.tokenId, microToWei(10_000_000), microToWei(5_000_000), microToWei(5_000_000), "0"],
    ]);
    const falls = catalogItem("cloud_falls");
    expect(falls && itemCost(falls).bits).toBe(BITS.craftedBlueprints.rf25);
    // RF decor belongs to the Friend.
    const decor = await metaDb(p.h.db.kysely).selectFrom("friend_decor").selectAll().execute();
    expect(decor.map((d) => [d.token_id, d.item_id, d.qty])).toEqual([
      [p.tokenId, "sun_lantern", 1],
      [p.tokenId, "gold_arch", 1],
    ]);
  });

  it("gates flex items on stamps and belts", async () => {
    const p = await player();
    await fundBits(p, 10_000);
    expect((await buy(p, "gulp_tooth")).statusCode).toBe(403);
    expect((await buy(p, "dojo_mat")).statusCode).toBe(403);
    await recordMetaEvent(
      p.h.db.kysely,
      p.tokenId,
      { kind: "run_finished", run: { venueId: "pixel-life", score: 1 } },
      p.h.clock.now(),
    );
    for (let i = 0; i < 50; i++) {
      await onRunFinished(
        p.h.db.kysely,
        p.tokenId,
        { venueId: "pixel-life", score: 1, gulpBurped: true },
        p.h.clock.now(),
      );
    }
    expect((await buy(p, "gulp_tooth")).statusCode).toBe(200);
    const trial = (belt: "yellow" | "orange" | "green", extra: object) =>
      onRunFinished(
        p.h.db.kysely,
        p.tokenId,
        { venueId: "pixel-life", island: "meadow", beltTrial: belt, score: 0, ...extra },
        p.h.clock.now(),
      );
    expect((await trial("yellow", { score: 2000 })).belt).toBe("yellow");
    expect((await trial("orange", { maxCombo: 4 })).belt).toBe("orange");
    expect((await buy(p, "dojo_mat")).statusCode).toBe(403);
    expect((await trial("green", { keptBps: 9500 })).belt).toBe("green");
    expect((await buy(p, "dojo_mat")).statusCode).toBe(200);
  });

  it("buys escalating island plots", async () => {
    const p = await player();
    await fundBits(p, 3500);
    const first = (await call(p, "POST", "/api/meta/plot")).json() as PlotRes;
    expect(first).toMatchObject({ plots: 1, bits: 2500 });
    const second = (await call(p, "POST", "/api/meta/plot")).json() as PlotRes;
    expect(second).toMatchObject({ plots: 2, bits: 500 });
    expect((await call(p, "POST", "/api/meta/plot")).statusCode).toBe(402);
  });
});

describe("PUT /api/home", () => {
  it("saves a validated layout, hat and open flag, visible publicly", async () => {
    const p = await player();
    await fundBits(p, 2000);
    await buy(p, "bench");
    await buy(p, "rock");
    await buy(p, "hat_cap");
    const layout = {
      v: 1,
      items: [
        { item: "bench", t: 0, x: 0, z: 0, r: 1 },
        { item: "rock", t: 3, x: 11, z: 11, r: 0 },
      ],
    };
    const res = await call(p, "PUT", "/api/home", { layout, hat: "hat_cap", open: true });
    expect(res.statusCode).toBe(200);
    // designWorld Friends are generation 1: six terraces.
    expect(res.json()).toMatchObject({ generation: 1, terraces: 6, hat: "hat_cap", open: true, layout });
    const pub = (
      await p.h.app.inject({ method: "GET", url: `/api/home/${p.tokenId}`, headers: p.h.edge })
    ).json() as HomeView;
    expect(pub.layout).toEqual(layout);
    const me = (await call(p, "GET", "/api/meta/me")).json() as MetaMeRes;
    expect(me).toMatchObject({
      bits: 2000 - 400 - 150 - 200,
      owned: { bench: 1, rock: 1, hat_cap: 1 },
      economy: "sim",
    });
    expect(me.stats.homeItems).toBe(2);
  });

  it("refuses bad placements, unowned items and unowned hats", async () => {
    const p = await player();
    await fundBits(p, 1000);
    await buy(p, "rock");
    const put = (body: object) => call(p, "PUT", "/api/home", body);
    const one = (item: string, t: number, x: number, z: number) => ({
      layout: { v: 1, items: [{ item, t, x, z, r: 0 }] },
    });
    expect((await put(one("rock", 0, FRIEND_SPOT.x, FRIEND_SPOT.z))).json()).toMatchObject({ error: "bad_request" });
    expect((await put(one("rock", 6, 0, 0))).statusCode).toBe(400); // terrace 6 does not exist (6 terraces: 0..5)
    expect((await put(one("bench", 0, 0, 0))).statusCode).toBe(400); // not owned
    expect((await put({ layout: { v: 1, items: [{ item: "rock", t: 0, x: 12, z: 0, r: 0 }] } })).statusCode).toBe(400);
    expect((await put({ layout: { v: 1, items: [] }, hat: "hat_cap" })).statusCode).toBe(403);
    expect((await put({ layout: { v: 1, items: [] }, hat: "rock" })).statusCode).toBe(400);
    expect((await put({ layout: { v: 2, items: [] } })).statusCode).toBe(400);
    expect((await put(one("rock", 0, 0, 0))).statusCode).toBe(200);
  });
});

describe("stamp and belt hooks", () => {
  it("awards stamps on runs, Mends and kept Gold, once each, with XP", async () => {
    const p = await player();
    const now = p.h.clock.now();
    const db = p.h.db.kysely;
    const first = await onRunFinished(
      db,
      p.tokenId,
      { venueId: "pixel-life", score: 1200, grabbedBack: 1 },
      now,
      "run-1",
    );
    expect(first.stamps).toEqual(["first_flight", "first_grab", "warm_up"]);
    expect(first.belt).toBe("white");
    expect(first.xp).toBe(75);
    expect(
      (await onRunFinished(db, p.tokenId, { venueId: "pixel-life", score: 1200, grabbedBack: 1 }, now)).stamps,
    ).toEqual([]);
    const mend = await onMendGiven(db, p.tokenId, OTHER.toString(), 3, now);
    expect(mend.payer.stamps).toEqual(["first_stitch"]);
    expect(mend.target.stamps).toEqual([]);
    expect((await onGoldKept(db, p.tokenId, now)).stamps).toEqual(["gold_keeper"]);
    const view = (
      await p.h.app.inject({ method: "GET", url: `/api/home/${p.tokenId}`, headers: p.h.edge })
    ).json() as HomeView;
    expect(view.belt).toBe("white");
    expect(view.stamps.map((s) => s.id).sort()).toEqual([
      "first_flight",
      "first_grab",
      "first_stitch",
      "gold_keeper",
      "warm_up",
    ]);
    expect(view.stampXp).toBe(25 * 4 + 75);
  });

  it("counts distinct menders across concurrent hook calls without losing updates", async () => {
    const p = await player();
    const db = p.h.db.kysely;
    const now = p.h.clock.now();
    await Promise.all([1, 2, 3, 4, 5].map((i) => onMendGiven(db, String(1000 + i), p.tokenId, 1, now)));
    const row = await metaDb(db).selectFrom("stamps").select("stamp_id").where("token_id", "=", p.tokenId).execute();
    expect(row.map((r) => r.stamp_id)).toEqual(["well_loved"]);
    expect(STAMPS.some((s) => s.id === "well_loved")).toBe(true);
  });

  it("counts visits to open isles only", async () => {
    const p = await player();
    const visit = (owner: string) => call(p, "POST", `/api/home/${owner}/visit`);
    expect((await visit("777")).statusCode).toBe(403);
    for (let i = 1; i <= 5; i++) {
      await metaDb(p.h.db.kysely)
        .insertInto("home_isles")
        .values({
          token_id: String(800 + i),
          layout: '{"v":1,"items":[]}',
          hat: null,
          generation: 3,
          open: true,
          updated_at: p.h.clock.now(),
        })
        .execute();
    }
    const results = [];
    for (let i = 1; i <= 5; i++) results.push((await visit(String(800 + i))).json() as { stamps: string[] });
    expect(results.at(-1)?.stamps).toEqual(["isle_hopper"]);
    expect(((await visit(p.tokenId)).json() as { stamps: string[] }).stamps).toEqual([]);
  });
});
