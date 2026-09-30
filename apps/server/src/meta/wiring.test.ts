import {
  BITS,
  EMPTY_MASK,
  GOLD_PIXEL_OUTCOME_ID,
  MICRO_PER_RF,
  beltTrialSeed,
  fromIndices,
  frontMask,
  or,
  toIndices,
  type RunAck,
  type RunSubmitReq,
} from "@pl/shared";
import { afterEach, describe, expect, it } from "vitest";
import { VENUE_DAILY_BITS_CAP, VENUE_DAILY_RUNS_MAX } from "../game/wallet.js";
import { emptyTally, type RunTally } from "../runs/facts.js";
import type { ReplayOutcome } from "../runs/replay-protocol.js";
import type { RunVerifier } from "../runs/verifier.js";
import { ASYMMETRY, MASK, SKELETON, art, call, guest, owner, setFriend, startGame, type Game } from "../test/game.js";
import type { Harness } from "../test/harness.js";
import { withMarket } from "../market/tables.js";
import { heldStamps, passedBelts, readStats } from "./hooks.js";
import { metaDb } from "./tables.js";

/**
 * The meta hooks called from the real events (wave 4): verified runs, belt trials, Mends, Seed Pack Golds, market
 * sales, whole streaks, plus the Bits-only venues and the guest-mode kill switch. Real Postgres, scripted replays.
 */

let g: Game | undefined;
afterEach(async () => {
  await g?.h.close();
  g = undefined;
});

const DAY = 86_400_000;
const RF = MICRO_PER_RF;

const claimed = (over: Partial<RunSubmitReq["claimed"]> = {}): RunSubmitReq["claimed"] => ({
  score: 1200,
  lostDelta: EMPTY_MASK,
  recovered: 0,
  smashed: 0,
  ticks: 3600,
  finalHash: "abc123",
  ...over,
});

const run = (over: Partial<RunSubmitReq> = {}): RunSubmitReq => ({
  venueId: "pixel-life",
  kind: "free",
  seed: 42,
  inputs: Buffer.from([1, 2, 3, 4]).toString("base64"),
  claimed: claimed(),
  ...over,
});

/** A verifier that accepts every run with the given tally. */
function accepting(tally: RunTally | null): RunVerifier & { calls: number } {
  const v = {
    calls: 0,
    verify: async (): Promise<ReplayOutcome> => {
      v.calls++;
      return tally ? { status: "ok", summary: claimed(), tally } : { status: "ok", summary: claimed() };
    },
    close: async () => undefined,
  };
  return v;
}

const tok = (id: bigint) => id.toString();
const idle = (game: Game) => game.h.ctx.runs.idle();

describe("verified runs → stamps and belts", () => {
  it("awards run stamps and the White belt once the replay verifies, exactly once", async () => {
    const verifier = accepting({ ...emptyTally(), grabbedBack: 2, maxCombo: 3 });
    g = await startGame({ deps: { verifier } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const ack = (await call(h, "POST", "/api/runs", cookie, run())).json() as RunAck;
    // Nothing is awarded before verification.
    expect(ack.verified).toBe("pending");
    await idle(g);
    const stamps = await heldStamps(h.db.kysely, tok(MASK));
    expect([...stamps].sort()).toEqual(["first_flight", "first_grab", "flawless", "triple", "warm_up"]);
    expect(await passedBelts(h.db.kysely, tok(MASK))).toEqual(["white"]);
    expect((await readStats(h.db.kysely, tok(MASK))).runs).toBe(1);

    // Re-queueing an already verified run changes nothing.
    h.ctx.runs.enqueue(ack.runId);
    await idle(g);
    expect((await readStats(h.db.kysely, tok(MASK))).runs).toBe(1);
    const home = (await call(h, "GET", `/api/home/${MASK}`)).json();
    expect(home).toMatchObject({ belt: "white" });
  });

  it("counts handheld runs as Pixel Life runs, and awards summary-only facts without a tally", async () => {
    g = await startGame({ deps: { verifier: accepting(null) } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    expect((await call(h, "POST", "/api/runs", cookie, run({ venueId: "handheld" }))).statusCode).toBe(200);
    await idle(g);
    expect([...(await heldStamps(h.db.kysely, tok(MASK)))].sort()).toEqual(["first_flight", "flawless", "warm_up"]);
  });

  it("awards a trial belt only for the fixed-seed trial of the next rung", async () => {
    const verifier = accepting({ ...emptyTally(), maxCombo: 4 });
    g = await startGame({ deps: { verifier } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    await metaDb(h.db.kysely)
      .insertInto("belts")
      .values(
        ["white", "yellow"].map((b) => ({ token_id: tok(MASK), belt_id: b, run_id: null, earned_at: new Date() })),
      )
      .execute();

    const wrongSeed = await call(h, "POST", "/api/runs", cookie, run({ beltTrial: "orange", seed: 1 }));
    expect(wrongSeed.statusCode).toBe(400);
    expect(wrongSeed.json()).toMatchObject({ reason: "bad_trial" });
    const wrongIsland = await call(
      h,
      "POST",
      "/api/runs",
      cookie,
      run({ beltTrial: "orange", seed: beltTrialSeed("orange"), arena: "dusk" }),
    );
    expect(wrongIsland.json()).toMatchObject({ reason: "bad_trial" });
    expect(
      (await call(h, "POST", "/api/runs", cookie, run({ beltTrial: "white", seed: beltTrialSeed("white") }))).json(),
    ).toMatchObject({ reason: "bad_trial" });

    const ok = await call(h, "POST", "/api/runs", cookie, run({ beltTrial: "orange", seed: beltTrialSeed("orange") }));
    expect(ok.statusCode).toBe(200);
    await idle(g);
    expect(await passedBelts(h.db.kysely, tok(MASK))).toContain("orange");
    const row = await metaDb(h.db.kysely)
      .selectFrom("belts")
      .select("run_id")
      .where("token_id", "=", tok(MASK))
      .where("belt_id", "=", "orange")
      .executeTakeFirstOrThrow();
    expect(row.run_id).toBe((ok.json() as RunAck).runId);
  });
});

describe("care and Gold hooks", () => {
  it("counts a Mend for both Friends (First Stitch for the payer)", async () => {
    g = await startGame();
    const { h, alice, bob } = g;
    const a = await owner(h, alice, MASK);
    await owner(h, bob, SKELETON);
    const [p] = toIndices(frontMask(await art(h, SKELETON)));
    const pixels = fromIndices([p ?? 0]);
    await setFriend(h, SKELETON, { lost: pixels });
    const r = await call(h, "POST", "/api/economy/mend", a, {
      action: { kind: "mend", payer: tok(MASK), target: tok(SKELETON), pixels },
    });
    expect(r.statusCode).toBe(200);
    expect(await heldStamps(h.db.kysely, tok(MASK))).toEqual(new Set(["first_stitch"]));
    expect((await readStats(h.db.kysely, tok(MASK))).mendTargets).toEqual([tok(SKELETON)]);
    expect((await readStats(h.db.kysely, tok(SKELETON))).menders).toEqual([tok(MASK)]);
  });

  it("awards Gold Keeper when a Seed Pack grows a Gold", async () => {
    g = await startGame({ deps: { seedpackDraw: () => 9850 } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const post = (op: string, body: object) => call(h, "POST", `/api/seedpack/${op}`, cookie, body);
    expect((await post("buy", { quantity: "1" })).statusCode).toBe(200);
    const plays = (await post("play", {})).json();
    const settled = (await post("settle", { playId: plays.plays[0].id })).json();
    expect(settled.outcomeId).toBe(GOLD_PIXEL_OUTCOME_ID);
    expect(await heldStamps(h.db.kysely, tok(MASK))).toEqual(new Set(["gold_keeper"]));
  });

  it("awards Gold Keeper to a market buyer, and retires its bought leaf when it redeems the Gold", async () => {
    g = await startGame();
    const { h, alice, bob } = g;
    const seller = await owner(h, alice, MASK);
    const buyer = await owner(h, bob, SKELETON);
    await setFriend(h, SKELETON, { simMicro: 500 * RF });
    await h.db.kysely
      .insertInto("seedpack_friend")
      .values({ token_id: tok(MASK), inventory: JSON.stringify([0, 0, 0, 1]) })
      .execute();
    const listed = await call(h, "POST", "/api/market/list", seller, { priceMicro: 50 * RF });
    expect(listed.statusCode).toBe(200);
    const leafId = listed.json().event.leafId as number;
    const bought = await call(h, "POST", "/api/market/buy", buyer, { leafId, expectedPriceMicro: 50 * RF });
    expect(bought.statusCode).toBe(200);
    expect(await heldStamps(h.db.kysely, tok(SKELETON))).toEqual(new Set(["gold_keeper"]));

    // The sale reached the seller's inbox through the shared InboxItem union.
    const inbox = (await call(h, "GET", "/api/inbox", seller)).json();
    expect(inbox.items[0]).toMatchObject({ kind: "market_sold", leafId });

    // Redeeming that Gold through the Seed Pack takes the leaf off the market's books.
    await h.db.kysely
      .insertInto("seedpack_house")
      .values({ id: 1, stake_micro: 10_000 * RF, reserved_micro: 0, liability_micro: 1_000 * RF })
      .onConflict((oc) => oc.column("id").doUpdateSet({ liability_micro: 1_000 * RF }))
      .execute();
    const redeemed = await call(h, "POST", "/api/seedpack/redeem", buyer, {
      outcomeId: GOLD_PIXEL_OUTCOME_ID,
      quantity: "1",
    });
    expect(redeemed.statusCode, redeemed.body).toBe(200);
    const leaf = await withMarket(h.db.kysely)
      .selectFrom("market_leaves")
      .select(["state", "holder_token"])
      .where("id", "=", leafId)
      .executeTakeFirstOrThrow();
    expect(leaf).toEqual({ state: "redeemed", holder_token: null });
    expect((await call(h, "GET", "/api/market/mine", buyer)).json()).toMatchObject({ goldHeld: 0, boughtLeafIds: [] });
  });
});

describe("whole streak", () => {
  it("awards Whole Week from /api/me after 7 whole days, and a scarring run restarts the streak", async () => {
    g = await startGame({ deps: { verifier: accepting(null) } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    // Whole since the restoring write 8 days ago.
    await h.db.kysely
      .updateTable("friends")
      .set({ lost: EMPTY_MASK, scar_updated_at: new Date(h.clock.now().getTime() - 8 * DAY), whole_since: null })
      .where("token_id", "=", tok(MASK))
      .execute();
    expect((await call(h, "GET", "/api/me", cookie)).statusCode).toBe(200);
    expect(await heldStamps(h.db.kysely, tok(MASK))).toEqual(new Set(["whole_week"]));
    expect((await readStats(h.db.kysely, tok(MASK))).wholeDays).toBe(8);

    // Past the newbie runs, a run that loses pixels breaks the streak.
    for (let i = 0; i < 3; i++) {
      await h.db.kysely
        .insertInto("runs")
        .values({
          id: `old_${i}`,
          token_id: tok(MASK),
          guest_id: null,
          kind: "free",
          day: null,
          seed: i,
          inputs: Buffer.from([0]),
          score: 0,
          lost_delta: EMPTY_MASK,
          final_hash: "x",
          created_at: new Date(h.clock.now().getTime() - 2 * DAY),
        })
        .execute();
    }
    const [p1, p2] = toIndices(frontMask(await art(h, MASK)));
    const lost = or(fromIndices([p1 ?? 0]), fromIndices([p2 ?? 1]));
    const ack = (await call(h, "POST", "/api/runs", cookie, run({ claimed: claimed({ lostDelta: lost }) }))).json();
    expect(ack.applied).toBe(true);
    const row = await h.db.kysely
      .selectFrom("friends")
      .select("whole_since")
      .where("token_id", "=", tok(MASK))
      .executeTakeFirstOrThrow();
    expect(row.whole_since).toBeNull();
  });
});

describe("Bits-only venues (bump-sumo, pixel-putt)", () => {
  const venueRun = (venueId: string, over: Partial<RunSubmitReq> = {}) =>
    run({ venueId, claimed: claimed({ score: 99_999 }), ...over });

  async function ownerBits(h: Harness, cookie: string): Promise<number> {
    return ((await call(h, "GET", "/api/me", cookie)).json() as { bits: number }).bits;
  }

  it("credits base Bits (plus the first-run bonus), never scars, stamps or replays", async () => {
    const verifier = accepting(emptyTally());
    g = await startGame({ deps: { verifier } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const first = (await call(h, "POST", "/api/runs", cookie, venueRun("bump-sumo"))).json() as RunAck;
    expect(first).toMatchObject({ applied: false, reason: "no_scars", scars: null, bits: BITS.runBase + 50 });
    const second = (await call(h, "POST", "/api/runs", cookie, venueRun("pixel-putt"))).json() as RunAck;
    expect(second.bits).toBe(BITS.runBase);
    await idle(g);
    expect(verifier.calls).toBe(0);
    expect(await heldStamps(h.db.kysely, tok(MASK))).toEqual(new Set());
    expect(await ownerBits(h, cookie)).toBe(BITS.runBase * 2 + 50);
    const row = await h.db.kysely
      .selectFrom("runs")
      .select(["venue_id", "sim_friend", "verified", "bits"])
      .where("id", "=", first.runId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ venue_id: "bump-sumo", sim_friend: null, verified: 0, bits: BITS.runBase + 50 });
  });

  it("caps each venue's Bits per day and refuses runs past the venue's daily limit", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    let total = 0;
    for (let i = 0; i < 12; i++) {
      total += ((await call(h, "POST", "/api/runs", cookie, venueRun("bump-sumo"))).json() as RunAck).bits ?? 0;
    }
    expect(total).toBe(VENUE_DAILY_BITS_CAP);
    // Another venue still has its own room (the first-run bonus was already used today).
    expect(((await call(h, "POST", "/api/runs", cookie, venueRun("pixel-putt"))).json() as RunAck).bits).toBe(
      BITS.runBase,
    );
    await h.db.kysely
      .updateTable("bits_venue_days")
      .set({ runs: VENUE_DAILY_RUNS_MAX })
      .where("venue_id", "=", "bump-sumo")
      .execute();
    const limited = await call(h, "POST", "/api/runs", cookie, venueRun("bump-sumo"));
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ reason: "venue_daily_limit" });
    // Next UTC day: fresh caps.
    h.clock.advance(DAY);
    expect(((await call(h, "POST", "/api/runs", cookie, venueRun("bump-sumo"))).json() as RunAck).bits).toBe(
      BITS.runBase + 50,
    );
  });

  it("uses a cooldown lane per venue, refuses daily runs and unknown venues, and takes guest runs without Bits", async () => {
    g = await startGame({ limits: { runSubmit: { capacity: 1, windowMs: 40_000 } } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    expect((await call(h, "POST", "/api/runs", cookie, run())).statusCode).toBe(200);
    expect((await call(h, "POST", "/api/runs", cookie, venueRun("bump-sumo"))).statusCode).toBe(200);
    expect((await call(h, "POST", "/api/runs", cookie, venueRun("bump-sumo"))).json()).toMatchObject({
      reason: "run_cooldown",
    });
    const daily = await call(
      h,
      "POST",
      "/api/runs",
      cookie,
      venueRun("pixel-putt", { kind: "daily", day: "2026-10-01" }),
    );
    expect(daily.json()).toMatchObject({ reason: "bad_kind" });
    const unknown = await call(h, "POST", "/api/runs", cookie, venueRun("seed-pack"));
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ reason: "unknown_venue" });

    const gc = await guest(h);
    const ack = (await call(h, "POST", "/api/runs", gc, venueRun("pixel-putt"))).json() as RunAck;
    expect(ack).toMatchObject({ applied: false, reason: "guest" });
    expect(ack.bits).toBeUndefined();
  });
});

describe("GUEST_MODE kill switch (D-15)", () => {
  it("refuses new guests and ignores old guest cookies when off", async () => {
    g = await startGame();
    const cookie = await guest(g.h);
    await g.h.close();
    g = await startGame({ env: { GUEST_MODE: "off" } });
    const { h, alice } = g;
    const issued = await call(h, "POST", "/api/guest");
    expect(issued.statusCode).toBe(403);
    expect(issued.json()).toMatchObject({ error: "guest_forbidden", reason: "guest_mode_off" });
    expect((await call(h, "GET", "/api/me")).json()).toMatchObject({ identity: { kind: "anon" }, guestMode: false });
    // A cookie signed with the same secret no longer counts as an identity.
    expect((await call(h, "POST", "/api/runs", cookie, run())).statusCode).toBe(401);
    expect((await call(h, "GET", "/api/me", cookie)).json().identity).toEqual({ kind: "anon" });
    // Owners are unaffected.
    const owned = await owner(h, alice, ASYMMETRY);
    expect((await call(h, "POST", "/api/runs", owned, run())).statusCode).toBe(200);
  });
});
