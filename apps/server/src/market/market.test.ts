import { designWorld } from "@pl/mock-rpc";
import {
  MARKET,
  MICRO_PER_RF,
  type MarketBookRes,
  type MarketBuyRes,
  type MarketActionRes,
  type MarketInboxItem,
  type MarketMineRes,
} from "@pl/shared";
import type { PrivateKeyAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import { newWallet, signIn, startHarness, type Harness, type HarnessOptions } from "../test/harness.js";
import { publishMarketEffects, type MarketHub } from "./routes.js";
import { buyGold, listGold, reconcileHeldLeaves } from "./store.js";
import { withMarket } from "./tables.js";

const MASK = 344030n;
const ASYMMETRY = 344033n;
const STRANGERS = 63675n;
const RF = MICRO_PER_RF;
const START = 500 * RF;

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

interface Trader {
  readonly wallet: PrivateKeyAccount;
  readonly token: string;
  readonly cookie: string;
}

/** Three signed-in owners with bound Friends: alice (Mask), bob (Asymmetry), carol (Strangers), 500 sim RF each. */
async function market(options: HarnessOptions = {}) {
  const wallets = [newWallet(), newWallet(), newWallet()] as const;
  const tokens = [MASK, ASYMMETRY, STRANGERS] as const;
  h = await startHarness({
    world: designWorld({
      owners: { [wallets[0].address]: [MASK], [wallets[1].address]: [ASYMMETRY], [wallets[2].address]: [STRANGERS] },
    }),
    ...options,
  });
  const harness = h;
  const traders: Trader[] = [];
  for (const [i, wallet] of wallets.entries()) {
    const cookie = await signIn(harness, wallet);
    const token = tokens[i] ?? 0n;
    const bound = await harness.app.inject({
      method: "POST",
      url: "/api/session/friend",
      headers: { ...harness.edge, cookie },
      payload: { tokenId: token.toString() },
    });
    expect(bound.statusCode).toBe(200);
    traders.push({ wallet, token: token.toString(), cookie });
  }
  // Pin balances and mark today's grant as taken, so every assertion below is exact.
  await harness.db.kysely
    .updateTable("friends")
    .set({ sim_rf_micro: START, sim_granted_day: harness.clock.now().toISOString().slice(0, 10) })
    .execute();
  const [alice, bob, carol] = traders as [Trader, Trader, Trader];
  return { harness, alice, bob, carol };
}

const call = (harness: Harness, who: Trader | null, method: "GET" | "POST", url: string, payload?: object) =>
  harness.app.inject({
    method,
    url,
    headers: { ...harness.edge, ...(who ? { cookie: who.cookie } : {}) },
    ...(payload ? { payload } : {}),
  });

async function setGold(harness: Harness, who: Trader, gold: number): Promise<void> {
  const inventory = JSON.stringify([0, 0, 0, gold]);
  await harness.db.kysely
    .insertInto("seedpack_friend")
    .values({ token_id: who.token, inventory })
    .onConflict((oc) => oc.column("token_id").doUpdateSet({ inventory }))
    .execute();
}

async function gold(harness: Harness, who: Trader): Promise<number> {
  const row = await harness.db.kysely
    .selectFrom("seedpack_friend")
    .select("inventory")
    .where("token_id", "=", who.token)
    .executeTakeFirst();
  return Array.isArray(row?.inventory) ? Number(row.inventory[3] ?? 0) : 0;
}

async function balance(harness: Harness, who: Trader): Promise<number> {
  const row = await harness.db.kysely
    .selectFrom("friends")
    .select("sim_rf_micro")
    .where("token_id", "=", who.token)
    .executeTakeFirstOrThrow();
  return row.sim_rf_micro;
}

const list = (harness: Harness, who: Trader, priceMicro: number, leafId?: number) =>
  call(harness, who, "POST", "/api/market/list", { priceMicro, ...(leafId === undefined ? {} : { leafId }) });
const buy = (harness: Harness, who: Trader, leafId: number, expectedPriceMicro: number) =>
  call(harness, who, "POST", "/api/market/buy", { leafId, expectedPriceMicro });
const book = async (harness: Harness) => (await call(harness, null, "GET", "/api/market/book")).json<MarketBookRes>();

describe("order book", () => {
  it("is public, simulated and empty at first", async () => {
    const { harness } = await market();
    const response = await call(harness, null, "GET", "/api/market/book");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: "sim",
      simulated: true,
      floorMicro: null,
      backingMicro: 45 * RF,
      listings: [],
      openListings: 0,
      recentFills: [],
      volume24hMicro: 0,
      fills24h: 0,
      burned24hMicro: 0,
      lastPriceMicro: null,
    });
    expect((await call(harness, null, "GET", "/api/market/book?limit=0")).statusCode).toBe(400);
  });
});

describe("listing", () => {
  it("escrows a grown Gold out of the seller's inventory and shows it in the book", async () => {
    const { harness, alice } = await market();
    await setGold(harness, alice, 2);
    const response = await list(harness, alice, 55 * RF);
    expect(response.statusCode).toBe(200);
    const body = response.json<MarketActionRes>();
    expect(body).toMatchObject({ simulated: true, goldHeld: 1, event: { kind: "Listed", seller: alice.token } });
    expect(await gold(harness, alice)).toBe(1);
    const b = await book(harness);
    expect(b.floorMicro).toBe(55 * RF);
    expect(b.listings).toEqual([
      {
        leafId: body.event.leafId,
        originFriendId: alice.token,
        seller: alice.token,
        priceMicro: 55 * RF,
        listedAt: harness.clock.now().getTime(),
      },
    ]);
    // A second, cheaper ask becomes the floor.
    expect((await list(harness, alice, 47 * RF)).statusCode).toBe(200);
    expect((await book(harness)).floorMicro).toBe(47 * RF);
    expect(await gold(harness, alice)).toBe(0);
  });

  it("refuses prices outside 45–10,000 RF or off the 0.01 RF tick, and Friends without Gold", async () => {
    const { harness, alice, bob } = await market();
    await setGold(harness, alice, 1);
    for (const price of [44 * RF, MARKET.maxPriceMicro + MARKET.tickMicro, 50 * RF + 1]) {
      const response = await list(harness, alice, price);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "bad_request", marketError: "bad_price" });
    }
    const none = await list(harness, bob, 50 * RF);
    expect(none.statusCode).toBe(409);
    expect(none.json()).toMatchObject({ marketError: "no_gold" });
    expect((await call(harness, null, "POST", "/api/market/list", { priceMicro: 50 * RF })).statusCode).toBe(401);
    expect((await call(harness, alice, "POST", "/api/market/list", { priceMicro: "50" })).statusCode).toBe(400);
    expect(await gold(harness, alice)).toBe(1);
  });

  it("re-checks ownership at a fresh block before escrowing", async () => {
    const { harness, alice } = await market();
    await setGold(harness, alice, 1);
    harness.rpc.world.transfer(MASK, newWallet().address);
    const response = await list(harness, alice, 50 * RF);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "not_owner" });
    expect(await gold(harness, alice)).toBe(1);
  });

  it("is refused outside sim mode", async () => {
    const { harness, alice } = await market({ env: { ECONOMY_MODE: "live" } });
    await setGold(harness, alice, 1);
    const response = await list(harness, alice, 50 * RF);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ marketError: "sim_only" });
    expect((await book(harness)).mode).toBe("live");
  });
});

describe("buying", () => {
  it("splits 5 %: 2 % burned, 2 % to the origin Friend, 1 % creator; moves the Gold and notifies", async () => {
    const { harness, alice, bob, carol } = await market();
    await setGold(harness, alice, 1);
    const leafId = (await list(harness, alice, 55 * RF)).json<MarketActionRes>().event.leafId;

    // Bob buys alice's own grown Gold: alice is seller AND origin.
    const first = await buy(harness, bob, leafId, 55 * RF);
    expect(first.statusCode).toBe(200);
    const fill = first.json<MarketBuyRes>();
    expect(fill).toMatchObject({ simulated: true, goldHeld: 1, balanceMicro: START - 55 * RF });
    expect(fill.fill).toMatchObject({
      kind: "Sold",
      leafId,
      originFriendId: alice.token,
      buyer: bob.token,
      seller: alice.token,
      priceMicro: 55_000_000,
      burnedMicro: 1_100_000,
      toOriginMicro: 1_100_000,
      toCreatorMicro: 550_000,
      toSellerMicro: 52_250_000,
    });
    expect(await balance(harness, alice)).toBe(START + 52_250_000 + 1_100_000);
    expect(await balance(harness, bob)).toBe(START - 55 * RF);
    expect(await gold(harness, bob)).toBe(1);
    expect((await book(harness)).listings).toEqual([]);

    // Bob relists the bought Gold by id; carol buys it: alice (origin) earns the royalty on a sale she's not part of.
    const mineBob = (await call(harness, bob, "GET", "/api/market/mine")).json<MarketMineRes>();
    expect(mineBob).toMatchObject({ goldHeld: 1, boughtLeafIds: [leafId], listings: [] });
    expect((await list(harness, bob, 60 * RF, leafId)).statusCode).toBe(200);
    expect(await gold(harness, bob)).toBe(0);
    harness.clock.advance(1000);
    expect((await buy(harness, carol, leafId, 60 * RF)).statusCode).toBe(200);
    expect(await balance(harness, alice)).toBe(START + 52_250_000 + 1_100_000 + 1_200_000);
    expect(await balance(harness, bob)).toBe(START - 55 * RF + 57 * RF);
    expect(await balance(harness, carol)).toBe(START - 60 * RF);
    expect(await gold(harness, carol)).toBe(1);

    const mineAlice = (await call(harness, alice, "GET", "/api/market/mine")).json<MarketMineRes>();
    expect(mineAlice.royaltiesMicro).toBe(2_300_000);

    const b = await book(harness);
    expect(b).toMatchObject({
      fills24h: 2,
      volume24hMicro: 115 * RF,
      burned24hMicro: 2_300_000,
      lastPriceMicro: 60 * RF,
    });
    expect(b.recentFills.map((f) => f.priceMicro)).toEqual([60 * RF, 55 * RF]);

    // Double entry: every sale's legs sum to zero; buyer pays, burn + origin + creator + seller receive.
    const db = withMarket(harness.db.kysely);
    const legs = await db.selectFrom("market_ledger").selectAll().orderBy("id").execute();
    expect(legs).toHaveLength(10);
    const byEvent = new Map<number, number>();
    for (const l of legs) byEvent.set(l.event_id, (byEvent.get(l.event_id) ?? 0) + l.amount_micro);
    expect([...byEvent.values()]).toEqual([0, 0]);
    expect(legs.filter((l) => l.leg === "creator").map((l) => l.amount_micro)).toEqual([550_000, 600_000]);

    // Global ledger: the sinks of each sale (burn + royalty to a Friend), labelled sim.
    const ledger = await harness.db.kysely.selectFrom("rf_ledger").selectAll().orderBy("created_at").execute();
    expect(ledger.map((r) => [r.kind, r.mode, r.burn, r.to_target, r.target_token, r.payer_token])).toEqual([
      ["market_fee", "sim", "1100000000000000000", "1100000000000000000", alice.token, bob.token],
      ["market_fee", "sim", "1200000000000000000", "1200000000000000000", alice.token, carol.token],
    ]);

    // Inbox: seller notices (alice also gets her origin share on the first), royalty notice to alice on the second.
    const inbox = await harness.db.kysely
      .selectFrom("inbox")
      .selectAll()
      .orderBy("created_at")
      .orderBy("kind")
      .execute();
    expect(inbox.map((r) => [r.token_id, r.kind, r.payload])).toEqual([
      [
        alice.token,
        "market_sold",
        {
          mode: "sim",
          leafId,
          buyer: bob.token,
          priceMicro: 55 * RF,
          toSellerMicro: 52_250_000,
          toOriginMicro: 1_100_000,
        },
      ],
      [
        alice.token,
        "market_royalty",
        { mode: "sim", leafId, buyer: carol.token, seller: bob.token, priceMicro: 60 * RF, toOriginMicro: 1_200_000 },
      ],
      [
        bob.token,
        "market_sold",
        { mode: "sim", leafId, buyer: carol.token, priceMicro: 60 * RF, toSellerMicro: 57 * RF, toOriginMicro: 0 },
      ],
    ]);

    const events = await db.selectFrom("market_events").select(["kind", "leaf_id"]).orderBy("id").execute();
    expect(events.map((e) => e.kind)).toEqual(["Listed", "Sold", "Listed", "Sold"]);
  });

  it("protects the buyer from a cancel-and-relist at a higher price (PriceChanged)", async () => {
    const { harness, alice, bob } = await market();
    await setGold(harness, alice, 1);
    const leafId = (await list(harness, alice, 50 * RF)).json<MarketActionRes>().event.leafId;
    // Bob saw 50 RF. Alice front-runs: cancel, relist the same Gold at 90 RF.
    expect((await call(harness, alice, "POST", "/api/market/cancel", { leafId })).statusCode).toBe(200);
    const relisted = (await list(harness, alice, 90 * RF)).json<MarketActionRes>();
    expect(relisted.event.leafId).toBe(leafId);
    const response = await buy(harness, bob, leafId, 50 * RF);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "quote_expired", marketError: "price_changed" });
    expect(await balance(harness, bob)).toBe(START);
    expect(await gold(harness, bob)).toBe(0);
    expect((await book(harness)).floorMicro).toBe(90 * RF);
  });

  it("refuses self-trades, unknown listings and buyers who cannot pay, without side effects", async () => {
    const { harness, alice, bob } = await market();
    await setGold(harness, alice, 1);
    const leafId = (await list(harness, alice, 600 * RF)).json<MarketActionRes>().event.leafId;
    const self = await buy(harness, alice, leafId, 600 * RF);
    expect(self.statusCode).toBe(403);
    expect(self.json()).toMatchObject({ marketError: "self_trade" });
    const poor = await buy(harness, bob, leafId, 600 * RF);
    expect(poor.statusCode).toBe(402);
    expect(poor.json()).toMatchObject({ error: "insufficient_funds", marketError: "insufficient_funds" });
    const missing = await buy(harness, bob, leafId + 99, 600 * RF);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ marketError: "not_listed" });
    expect(await balance(harness, bob)).toBe(START);
    expect((await book(harness)).openListings).toBe(1);
    expect(await harness.db.kysely.selectFrom("rf_ledger").selectAll().execute()).toEqual([]);
  });

  it("lets exactly one of two concurrent buyers win and conserves every Gold", async () => {
    const { harness, alice, bob, carol } = await market();
    await setGold(harness, alice, 1);
    const leafId = (await list(harness, alice, 50 * RF)).json<MarketActionRes>().event.leafId;
    const results = await Promise.all([buy(harness, bob, leafId, 50 * RF), buy(harness, carol, leafId, 50 * RF)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    expect((await gold(harness, bob)) + (await gold(harness, carol)) + (await gold(harness, alice))).toBe(1);
    expect((await balance(harness, bob)) + (await balance(harness, carol))).toBe(2 * START - 50 * RF);
  });

  it("runs crossing trades concurrently without deadlocking (one lock order for every party)", async () => {
    const { harness, alice, bob } = await market();
    await setGold(harness, alice, 1);
    await setGold(harness, bob, 1);
    // Both lose today's grant marker so the grant path runs inside the locked section too.
    await harness.db.kysely.updateTable("friends").set({ sim_granted_day: null }).execute();
    const a = (await list(harness, alice, 50 * RF)).json<MarketActionRes>().event.leafId;
    const b = (await list(harness, bob, 50 * RF)).json<MarketActionRes>().event.leafId;
    const results = await Promise.all([buy(harness, alice, b, 50 * RF), buy(harness, bob, a, 50 * RF)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect([await gold(harness, alice), await gold(harness, bob)]).toEqual([1, 1]);
  });

  it("settles the buyer's free regrowth at the old Gold count before the new Gold speeds it up", async () => {
    const { harness, alice, bob } = await market();
    await setGold(harness, alice, 1);
    const before = await harness.db.kysely
      .selectFrom("friends")
      .select(["scar_version", "scar_updated_at"])
      .where("token_id", "=", bob.token)
      .executeTakeFirstOrThrow();
    const leafId = (await list(harness, alice, 50 * RF)).json<MarketActionRes>().event.leafId;
    harness.clock.advance(60_000);
    expect((await buy(harness, bob, leafId, 50 * RF)).statusCode).toBe(200);
    const after = await harness.db.kysely
      .selectFrom("friends")
      .select(["scar_version", "scar_updated_at"])
      .where("token_id", "=", bob.token)
      .executeTakeFirstOrThrow();
    expect(after.scar_version).toBe(before.scar_version + 1);
    expect(after.scar_updated_at.getTime()).toBe(harness.clock.now().getTime());
  });
});

describe("cancelling", () => {
  it("returns the Gold to the seller; only the seller can cancel, once", async () => {
    const { harness, alice, bob } = await market();
    await setGold(harness, alice, 1);
    const leafId = (await list(harness, alice, 50 * RF)).json<MarketActionRes>().event.leafId;
    const stranger = await call(harness, bob, "POST", "/api/market/cancel", { leafId });
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json()).toMatchObject({ marketError: "not_seller" });
    const ok = await call(harness, alice, "POST", "/api/market/cancel", { leafId });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ goldHeld: 1, event: { kind: "Cancelled", leafId, seller: alice.token } });
    expect(await gold(harness, alice)).toBe(1);
    const again = await call(harness, alice, "POST", "/api/market/cancel", { leafId });
    expect(again.statusCode).toBe(404);
    expect((await book(harness)).openListings).toBe(0);
  });
});

describe("leaf provenance", () => {
  it("lists grown Golds first, relists bought ones by id, and forgets bought Golds that were redeemed", async () => {
    const { harness, alice, bob } = await market();
    await setGold(harness, alice, 1);
    const bought = (await list(harness, alice, 50 * RF)).json<MarketActionRes>().event.leafId;
    expect((await buy(harness, bob, bought, 50 * RF)).statusCode).toBe(200);
    await setGold(harness, bob, 2); // bob also grew one

    const grown = (await list(harness, bob, 70 * RF)).json<MarketActionRes>().event.leafId;
    expect(grown).not.toBe(bought);
    expect((await book(harness)).listings.find((l) => l.leafId === grown)?.originFriendId).toBe(bob.token);
    const wrong = await list(harness, bob, 70 * RF, grown);
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json()).toMatchObject({ marketError: "not_holder" });

    // Bob redeems his last Gold through the Seed Pack (inventory 1 → 0), which reconciles his leaves in its transaction.
    await setGold(harness, bob, 0);
    expect((await call(harness, bob, "GET", "/api/market/mine")).json<MarketMineRes>().boughtLeafIds).toEqual([]);
    expect(await reconcileHeldLeaves(withMarket(harness.db.kysely), bob.token, 0, harness.clock.now())).toEqual([]);
    // A Gold he grows later is his own: the redeemed leaf cannot come back, and a new leaf carries bob as origin.
    await setGold(harness, bob, 1);
    expect((await list(harness, bob, 70 * RF, bought)).json()).toMatchObject({ marketError: "not_holder" });
    const regrown = (await list(harness, bob, 80 * RF)).json<MarketActionRes>().event.leafId;
    expect((await book(harness)).listings.find((l) => l.leafId === regrown)?.originFriendId).toBe(bob.token);
  });
});

describe("hub hooks", () => {
  it("pushes presence and notices after a sale, and never throws", async () => {
    const { harness, alice, bob } = await market();
    await setGold(harness, alice, 1);
    const db = withMarket(harness.db.kysely);
    const now = harness.clock.now();
    const listed = await db
      .transaction()
      .execute((trx) => listGold(trx, { seller: alice.token, priceMicro: 50 * RF, leafId: undefined, now }));
    const sold = await db
      .transaction()
      .execute((trx) =>
        buyGold(trx, { buyer: bob.token, leafId: listed.event.leafId, expectedPriceMicro: 50 * RF, now }),
      );
    const calls: unknown[] = [];
    const hub: MarketHub = {
      updateToken: (tokenId, patch) => calls.push(["updateToken", tokenId, patch]),
      notify: (owner, item: MarketInboxItem) => calls.push(["notify", owner, item.kind]),
    };
    publishMarketEffects(hub, listed.effects, () => undefined);
    publishMarketEffects(hub, sold.effects, () => undefined);
    expect(calls).toEqual([
      ["updateToken", alice.token, { goldHeld: 0 }],
      ["updateToken", bob.token, { goldHeld: 1, scarsHash: expect.stringMatching(/^[0-9a-f]{8}$/) }],
      ["notify", alice.wallet.address.toLowerCase(), "market_sold"],
    ]);
    const errors: unknown[] = [];
    publishMarketEffects(
      {
        notify: () => {
          throw new Error("socket gone");
        },
      },
      sold.effects,
      (e) => errors.push(e),
    );
    expect(errors).toHaveLength(1);
    publishMarketEffects(null, sold.effects, () => undefined);
  });
});
