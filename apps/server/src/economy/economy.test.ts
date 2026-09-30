import {
  ECON,
  EMPTY_MASK,
  andNot,
  frontMask,
  fromIndices,
  microToWei,
  or,
  popcount,
  quote,
  toIndices,
  type EconomyAction,
  type EconomyReceipt,
  type Hex64,
  type InboxItem,
} from "@pl/shared";
import { afterEach, describe, expect, it } from "vitest";
import { signIn } from "../test/harness.js";
import {
  CELLULAR,
  HOVERER,
  MASK,
  SKELETON,
  art,
  call,
  guest,
  owner,
  setFriend,
  skipNewbie,
  startGame,
  type Game,
} from "../test/game.js";
import { mendRegion } from "./region.js";

let g: Game | undefined;
afterEach(async () => {
  await g?.h.close();
  g = undefined;
});

const regrow = (tokenId: bigint, pixels: Hex64): EconomyAction => ({
  kind: "regrow",
  tokenId: tokenId.toString(),
  pixels,
});
const mend = (payer: bigint, target: bigint, pixels: Hex64): EconomyAction => ({
  kind: "mend",
  payer: payer.toString(),
  target: target.toString(),
  pixels,
});

async function scarred(game: Game, tokenId: bigint, n: number): Promise<Hex64[]> {
  const idx = toIndices(frontMask(await art(game.h, tokenId))).slice(0, n);
  await setFriend(game.h, tokenId, { lost: fromIndices(idx) });
  return idx.map((i) => fromIndices([i]));
}

describe("POST /api/economy/quote (sim)", () => {
  it("returns the pure shared quote to anyone, and maps quote errors to their codes", async () => {
    g = await startGame();
    const { h } = g;
    const px = fromIndices([1, 2, 3]);
    const r = await call(h, "POST", "/api/economy/quote", await guest(h), regrow(MASK, px));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(quote(regrow(MASK, px), "sim"));
    expect(r.json()).toMatchObject({ totalMicro: 1_500_000, burnMicro: 750_000, streamMicro: 750_000 });
    expect(r.json()).not.toHaveProperty("quoteId");
    const self = await call(h, "POST", "/api/economy/quote", undefined, mend(MASK, MASK, px));
    expect(self.json()).toMatchObject({ error: "self_mend" });
    expect((await call(h, "POST", "/api/economy/quote", undefined, regrow(MASK, EMPTY_MASK))).json()).toMatchObject({
      error: "no_pixels",
    });
    expect((await call(h, "POST", "/api/economy/quote", undefined, { kind: "burn" })).statusCode).toBe(400);
  });
});

describe("POST /api/economy/regrow (sim)", () => {
  it("debits 0.5 RF/px conditionally, books a 50/50 ledger row, restores the pixels with CAS and relays scars", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const [a, b, c] = await scarred(g, MASK, 3);
    const pixels = or(a ?? EMPTY_MASK, b ?? EMPTY_MASK);
    const r = await call(h, "POST", "/api/economy/regrow", cookie, { action: regrow(MASK, pixels) });
    expect(r.statusCode).toBe(200);
    const receipt = r.json() as EconomyReceipt;
    expect(receipt.balanceMicro).toBe(ECON.simStartMicro - 1_000_000);
    expect(receipt.scars.lost).toBe(c);
    expect(receipt.scars.version).toBe(1);
    const ledger = await h.db.kysely.selectFrom("rf_ledger").selectAll().execute();
    expect(ledger).toEqual([
      expect.objectContaining({
        id: receipt.id,
        kind: "regrow",
        mode: "sim",
        payer_token: MASK.toString(),
        target_token: MASK.toString(),
        pixels: 2,
        total: microToWei(1_000_000),
        burn: microToWei(500_000),
        stream: microToWei(500_000),
        to_target: "0",
        tx_hash: null,
        log_index: null,
      }),
    ]);
    expect(g.events.updateToken).toHaveBeenCalledWith(
      MASK.toString(),
      expect.objectContaining({ scarsHash: expect.any(String) }),
    );
    const stats = (await call(h, "GET", "/api/stats/economy")).json();
    expect(stats).toMatchObject({
      mode: "sim",
      simulated: true,
      burnedMicro: 500_000,
      streamMicro: 500_000,
      toFriendsMicro: 0,
      counts: { regrow: 1, mend: 0, seedPacks: 0 },
    });
  });

  it("refuses pixels that are not missing (409 not_lost) and never charges for them", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const [a] = await scarred(g, MASK, 1);
    const present = fromIndices([toIndices(frontMask(await art(h, MASK)))[5] ?? 0]);
    const r = await call(h, "POST", "/api/economy/regrow", cookie, {
      action: regrow(MASK, or(a ?? EMPTY_MASK, present)),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "not_lost" });
    expect((await call(h, "GET", "/api/me", cookie)).json().balanceMicro).toBe(ECON.simStartMicro);
  });

  it("answers 402 insufficient_funds without touching scars", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const [a] = await scarred(g, MASK, 1);
    await setFriend(h, MASK, { simMicro: 400_000 });
    const r = await call(h, "POST", "/api/economy/regrow", cookie, { action: regrow(MASK, a ?? EMPTY_MASK) });
    expect(r.statusCode).toBe(402);
    expect(r.json()).toMatchObject({ error: "insufficient_funds" });
    const row = await h.db.kysely
      .selectFrom("friends")
      .selectAll()
      .where("token_id", "=", MASK.toString())
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ sim_rf_micro: 400_000, scar_version: 0, lost: a });
  });

  it("requires a session (401 no_session), the payer's own Friend (403) and a fresh ownership check", async () => {
    g = await startGame();
    const { h, alice } = g;
    const px = fromIndices([1]);
    const anon = await call(h, "POST", "/api/economy/regrow", undefined, { action: regrow(MASK, px) });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ error: "no_session" });
    expect(
      (await call(h, "POST", "/api/economy/regrow", await guest(h), { action: regrow(MASK, px) })).statusCode,
    ).toBe(401);
    const cookie = await owner(h, alice, MASK);
    const other = await call(h, "POST", "/api/economy/regrow", cookie, { action: regrow(SKELETON, px) });
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ error: "not_owner", reason: "not_payer" });
    expect(
      (await call(h, "POST", "/api/economy/regrow", cookie, { action: mend(MASK, SKELETON, px) })).statusCode,
    ).toBe(400);
    // Stale binding: transferred away a second ago, spends re-check at a fresh block.
    const [a] = await scarred(g, MASK, 1);
    h.rpc.world.transfer(MASK, "0x9999999999999999999999999999999999999999");
    const stale = await call(h, "POST", "/api/economy/regrow", cookie, { action: regrow(MASK, a ?? EMPTY_MASK) });
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ error: "not_owner" });
    expect(await h.db.kysely.selectFrom("friend_bindings").selectAll().execute()).toEqual([]);
  });

  it("an owner with only a gen-0 Friend can never bind, so can never spend", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await signIn(h, alice);
    const bind = await call(h, "POST", "/api/session/friend", cookie, { tokenId: "1969" });
    expect(bind.json()).toMatchObject({ error: "not_owner", reason: "not_hardwired" });
    const r = await call(h, "POST", "/api/economy/regrow", cookie, { action: regrow(1969n, fromIndices([1])) });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ reason: "no_binding" });
  });

  it("limits RF spends to 20 per minute per address", async () => {
    g = await startGame({ limits: { economy: { capacity: 2, windowMs: 60_000 } } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const [a, b, c] = await scarred(g, MASK, 3);
    for (const px of [a, b]) {
      expect(
        (await call(h, "POST", "/api/economy/regrow", cookie, { action: regrow(MASK, px ?? EMPTY_MASK) })).statusCode,
      ).toBe(200);
    }
    const limited = await call(h, "POST", "/api/economy/regrow", cookie, { action: regrow(MASK, c ?? EMPTY_MASK) });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: "rate_limited" });
  });

  it("grants the simulated daily RF once per UTC day", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    expect((await call(h, "GET", "/api/me", cookie)).json().balanceMicro).toBe(ECON.simStartMicro);
    h.clock.advance(86_400_000);
    const [first, second] = await Promise.all([call(h, "GET", "/api/me", cookie), call(h, "GET", "/api/me", cookie)]);
    expect(first.json().balanceMicro).toBe(ECON.simStartMicro + ECON.simDailyGrantMicro);
    expect(second.json().balanceMicro).toBe(ECON.simStartMicro + ECON.simDailyGrantMicro);
  });
});

describe("POST /api/economy/mend (sim)", () => {
  it("pays 50 % to the target, restores its pixels, records stitches, notifies its owner and sparkles in the hub", async () => {
    g = await startGame();
    const { h, alice, bob } = g;
    const a = await owner(h, alice, MASK);
    const b = await owner(h, bob, SKELETON);
    const [p1, p2] = await scarred(g, SKELETON, 2);
    const pixels = or(p1 ?? EMPTY_MASK, p2 ?? EMPTY_MASK);
    const r = await call(h, "POST", "/api/economy/mend", a, { action: mend(MASK, SKELETON, pixels) });
    expect(r.statusCode).toBe(200);
    const receipt = r.json() as EconomyReceipt;
    expect(receipt).toMatchObject({ balanceMicro: ECON.simStartMicro - 2_000_000, scars: { lost: EMPTY_MASK } });
    expect(receipt.quote).toMatchObject({ totalMicro: 2_000_000, burnMicro: 1_000_000, toTargetMicro: 1_000_000 });
    expect((await call(h, "GET", "/api/me", b)).json().balanceMicro).toBe(ECON.simStartMicro + 1_000_000);

    const pub = (await call(h, "GET", `/api/friends/${SKELETON}/public`)).json();
    expect(pub.stitched).toBe(pixels);

    const inbox = (await call(h, "GET", "/api/inbox", b)).json();
    expect(inbox.unread).toBe(1);
    const item = inbox.items[0] as Extract<InboxItem, { kind: "mended" }>;
    expect(item).toMatchObject({
      kind: "mended",
      tokenId: SKELETON.toString(),
      by: MASK.toString(),
      px: 2,
      toTargetMicro: 1_000_000,
      mode: "sim",
      batched: 0,
      readAt: null,
    });
    expect(item.region === null || typeof item.region === "string").toBe(true);
    const read = await call(h, "POST", "/api/inbox/read", b, { ids: [item.id] });
    expect(read.json()).toEqual({ unread: 0 });

    expect(g.events.mended).toHaveBeenCalledWith(SKELETON.toString(), MASK.toString(), 2);
    expect(g.events.notify).toHaveBeenCalledWith(bob.address.toLowerCase(), expect.objectContaining({ id: item.id }));
    const stats = (await call(h, "GET", "/api/stats/economy")).json();
    expect(stats).toMatchObject({ burnedMicro: 1_000_000, toFriendsMicro: 1_000_000, counts: { mend: 1 } });
    // Stitches fade after 7 days (sessions last 7 days too, so this goes last).
    h.clock.advance(7 * 86_400_000);
    expect((await call(h, "GET", `/api/friends/${SKELETON}/public`)).json()).not.toHaveProperty("stitched");
  });

  it("refuses self-Mends, unknown targets and targets without missing pixels", async () => {
    g = await startGame();
    const { h, alice, bob } = g;
    const a = await owner(h, alice, MASK);
    await owner(h, bob, SKELETON);
    const px = fromIndices([toIndices(frontMask(await art(h, SKELETON)))[0] ?? 0]);
    expect((await call(h, "POST", "/api/economy/mend", a, { action: mend(MASK, MASK, px) })).json()).toMatchObject({
      error: "self_mend",
    });
    const unknown = await call(h, "POST", "/api/economy/mend", a, { action: mend(MASK, CELLULAR, px) });
    expect(unknown.statusCode).toBe(404);
    const whole = await call(h, "POST", "/api/economy/mend", a, { action: mend(MASK, SKELETON, px) });
    expect(whole.statusCode).toBe(409);
    expect(whole.json()).toMatchObject({ error: "not_lost" });
    const notPayer = await call(h, "POST", "/api/economy/mend", a, { action: mend(HOVERER, SKELETON, px) });
    expect(notPayer.json()).toMatchObject({ error: "not_owner", reason: "not_payer" });
  });

  it("caps Mends at 24 px/day per payer and per target (mend_cap), resetting at 00:00 UTC", async () => {
    g = await startGame();
    const { h, alice, bob } = g;
    const a = await owner(h, alice, MASK);
    await owner(h, bob, SKELETON);
    await setFriend(h, MASK, { simMicro: 100_000_000 });
    const front = toIndices(frontMask(await art(h, SKELETON)));
    await setFriend(h, SKELETON, { lost: fromIndices(front.slice(0, 30)) });
    const twenty = fromIndices(front.slice(0, 20));
    expect((await call(h, "POST", "/api/economy/mend", a, { action: mend(MASK, SKELETON, twenty) })).statusCode).toBe(
      200,
    );
    const over = await call(h, "POST", "/api/economy/mend", a, {
      action: mend(MASK, SKELETON, fromIndices(front.slice(20, 25))),
    });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ error: "mend_cap", reason: "payer_cap" });
    // A second payer still hits the target's own cap.
    const c = await owner(h, bob, HOVERER);
    const target = await call(h, "POST", "/api/economy/mend", c, {
      action: mend(HOVERER, SKELETON, fromIndices(front.slice(20, 25))),
    });
    expect(target.json()).toMatchObject({ error: "mend_cap", reason: "target_cap" });
    h.clock.advance(86_400_000);
    await setFriend(h, SKELETON, { lost: fromIndices(front.slice(20, 30)) });
    expect(
      (
        await call(h, "POST", "/api/economy/mend", a, {
          action: mend(MASK, SKELETON, fromIndices(front.slice(20, 25))),
        })
      ).statusCode,
    ).toBe(200);
  });

  it("delivers 20 Mend notices a day individually, then batches the rest into the newest one", async () => {
    g = await startGame();
    const { h, alice, bob } = g;
    const a = await owner(h, alice, MASK);
    const b = await owner(h, bob, SKELETON);
    await setFriend(h, MASK, { simMicro: 100_000_000 });
    const pixels = await scarred(g, SKELETON, 22);
    for (const px of pixels.slice(0, 22)) {
      expect((await call(h, "POST", "/api/economy/mend", a, { action: mend(MASK, SKELETON, px) })).statusCode).toBe(
        200,
      );
      h.clock.advance(1_000);
    }
    const inbox = (await call(h, "GET", "/api/inbox", b)).json();
    expect(inbox.items).toHaveLength(ECON.mendNotifyDailyCap);
    expect(inbox.items[0]).toMatchObject({ batched: 2 });
    expect(g.events.notify).toHaveBeenCalledTimes(ECON.mendNotifyDailyCap);
    expect(g.events.mended).toHaveBeenCalledTimes(22);
    expect((await call(h, "POST", "/api/inbox/read", b, { all: true })).json()).toEqual({ unread: 0 });
  });
});

describe("concurrency (CAS races, architecture §5)", () => {
  it("20 concurrent Mends + 1 run land exactly like some sequential order", async () => {
    g = await startGame();
    const { h, alice, bob } = g;
    const payer = await owner(h, alice, MASK);
    const target = await owner(h, bob, SKELETON);
    await skipNewbie(h, SKELETON);
    await setFriend(h, MASK, { simMicro: 100_000_000 });
    const front = toIndices(frontMask(await art(h, SKELETON)));
    const initial = fromIndices(front.slice(0, 20));
    await setFriend(h, SKELETON, { lost: initial });
    const runLoss = fromIndices(front.slice(-3));
    const mends = front
      .slice(0, 20)
      .map((i) => call(h, "POST", "/api/economy/mend", payer, { action: mend(MASK, SKELETON, fromIndices([i])) }));
    const runReq = call(h, "POST", "/api/runs", target, {
      venueId: "pixel-life",
      kind: "free",
      seed: 1,
      inputs: "AQID",
      claimed: { score: 1, lostDelta: runLoss, recovered: 0, smashed: 0, ticks: 3600, finalHash: "h" },
    });
    const [runRes, ...mendRes] = await Promise.all([runReq, ...mends]);
    expect(mendRes.map((r) => r.statusCode)).toEqual(Array(20).fill(200));
    const row = await h.db.kysely
      .selectFrom("friends")
      .selectAll()
      .where("token_id", "=", SKELETON.toString())
      .executeTakeFirstOrThrow();
    // Sequential model: every mended pixel is back; the run's pixels are lost iff the run was applied.
    if (runRes.statusCode === 200) {
      expect(row.lost).toBe(runLoss);
      expect(row.scar_version).toBe(21);
    } else {
      expect(runRes.json()).toMatchObject({ error: "scar_conflict" });
      expect(row.lost).toBe(EMPTY_MASK);
      expect(row.scar_version).toBe(20);
    }
    const payerRow = await h.db.kysely
      .selectFrom("friends")
      .selectAll()
      .where("token_id", "=", MASK.toString())
      .executeTakeFirstOrThrow();
    expect(payerRow.sim_rf_micro).toBe(100_000_000 - 20 * ECON.mendMicroPerPx);
    expect(await h.db.kysely.selectFrom("rf_ledger").selectAll().execute()).toHaveLength(20);
    expect(await h.db.kysely.selectFrom("stitches").selectAll().execute()).toHaveLength(20);
  });

  it("two concurrent spends of the last RF: exactly one wins, the balance never goes negative", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const [a, b] = await scarred(g, MASK, 2);
    await setFriend(h, MASK, { simMicro: 500_000 });
    const results = await Promise.all([
      call(h, "POST", "/api/economy/regrow", cookie, { action: regrow(MASK, a ?? EMPTY_MASK) }),
      call(h, "POST", "/api/economy/regrow", cookie, { action: regrow(MASK, b ?? EMPTY_MASK) }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 402]);
    expect((await call(h, "GET", "/api/me", cookie)).json().balanceMicro).toBe(0);
  });

  it("the same pixel regrown twice concurrently is charged once", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const [a] = await scarred(g, MASK, 1);
    const results = await Promise.all(
      [0, 1, 2].map(() => call(h, "POST", "/api/economy/regrow", cookie, { action: regrow(MASK, a ?? EMPTY_MASK) })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect((await call(h, "GET", "/api/me", cookie)).json().balanceMicro).toBe(
      ECON.simStartMicro - ECON.regrowMicroPerPx,
    );
  });
});

describe("mendRegion (GDD §9.5)", () => {
  it("names the 3 × 3 region of the sprite's bounding box, or null on a tie", () => {
    const front = fromIndices([0, 2, 32, 34]); // a 3 × 3 box from (0,0) to (2,2)
    expect(mendRegion(front, fromIndices([0]))).toBe("left ear");
    expect(mendRegion(front, fromIndices([34]))).toBe("right foot");
    expect(mendRegion(front, fromIndices([0, 34]))).toBeNull();
    expect(mendRegion(front, EMPTY_MASK)).toBeNull();
    expect(andNot(front, front)).toBe(EMPTY_MASK);
    expect(popcount(front)).toBe(4);
  });
});
