import * as shared from "@pl/shared";
import {
  EMPTY_MASK,
  and,
  frontMask,
  fromIndices,
  maxPersistedLost,
  or,
  popcount,
  runScarCap,
  toIndices,
  type RunAck,
  type RunSubmitReq,
} from "@pl/shared";
import { afterEach, describe, expect, it } from "vitest";
import { dailySeed, utcDay } from "../game/daily.js";
import { ASYMMETRY, MASK, art, call, guest, owner, setFriend, skipNewbie, startGame, type Game } from "../test/game.js";
import type { ReplayOutcome } from "./replay-protocol.js";
import { clipPixels, skillBonus } from "./routes.js";
import { createReplayPool, type RunVerifier } from "./verifier.js";

let g: Game | undefined;
afterEach(async () => {
  await g?.h.close();
  g = undefined;
});

const summary = (over: Partial<RunSubmitReq["claimed"]> = {}): RunSubmitReq["claimed"] => ({
  score: 1200,
  lostDelta: EMPTY_MASK,
  recovered: 3,
  smashed: 7,
  ticks: 3600,
  finalHash: "abc123",
  ...over,
});

const run = (over: Partial<RunSubmitReq> = {}): RunSubmitReq => ({
  venueId: "pixel-life",
  kind: "free",
  seed: 42,
  inputs: Buffer.from([1, 2, 3, 4]).toString("base64"),
  claimed: summary(),
  ...over,
});

async function daily(game: Game, over: Partial<RunSubmitReq> = {}): Promise<RunSubmitReq> {
  const today = utcDay(game.h.clock.now());
  return run({ kind: "daily", day: today, seed: dailySeed(today, game.h.config.dailySecret), ...over });
}

/** A verifier whose answers the test scripts. */
function scripted(answer: (i: number) => ReplayOutcome): RunVerifier & { calls: number } {
  const v = {
    calls: 0,
    verify: async () => answer(v.calls++),
    close: async () => undefined,
  };
  return v;
}

describe("POST /api/runs — identity and limits", () => {
  it("refuses callers with no identity (401) and sessions without a Friend (403 no_binding)", async () => {
    g = await startGame();
    const { h, alice } = g;
    expect((await call(h, "POST", "/api/runs", undefined, run())).statusCode).toBe(401);
    const { signIn } = await import("../test/harness.js");
    const session = await signIn(h, alice);
    const r = await call(h, "POST", "/api/runs", session, run());
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ reason: "no_binding" });
  });

  it("stores a guest run without scars (reason guest) and puts daily guest runs on the visitors board", async () => {
    g = await startGame();
    const { h } = g;
    const cookie = await guest(h);
    const free = await call(h, "POST", "/api/runs", cookie, run());
    expect(free.statusCode).toBe(200);
    expect(free.json()).toMatchObject({ verified: "pending", applied: false, reason: "guest", scars: null });
    h.clock.advance(41_000);
    const d = await call(h, "POST", "/api/runs", cookie, await daily(g, { claimed: summary({ score: 900 }) }));
    expect(d.statusCode).toBe(200);
    const board = await call(h, "GET", `/api/daily/${utcDay(h.clock.now())}/board?board=visitors`, cookie);
    const body = board.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ rank: 1, score: 900, tokenId: null, verified: "pending" });
    expect(body.me).toMatchObject({ rank: 1, score: 900 });
  });

  it("limits submissions to 1 per 40 s per entrant (429 run_cooldown with Retry-After)", async () => {
    g = await startGame({ limits: { runSubmit: { capacity: 1, windowMs: 40_000 } } });
    const { h } = g;
    const cookie = await guest(h);
    expect((await call(h, "POST", "/api/runs", cookie, run())).statusCode).toBe(200);
    const limited = await call(h, "POST", "/api/runs", cookie, run());
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: "rate_limited", reason: "run_cooldown" });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(30);
    // Another guest is unaffected; the same one may go again after the window.
    expect((await call(h, "POST", "/api/runs", await guest(h), run())).statusCode).toBe(200);
    h.clock.advance(40_001);
    expect((await call(h, "POST", "/api/runs", cookie, run())).statusCode).toBe(200);
  });

  it("caps Daily Run submissions at 20 per entrant per day", async () => {
    g = await startGame();
    const { h } = g;
    const cookie = await guest(h);
    for (let i = 0; i < 20; i++) {
      expect((await call(h, "POST", "/api/runs", cookie, await daily(g))).statusCode).toBe(200);
    }
    const r = await call(h, "POST", "/api/runs", cookie, await daily(g));
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ reason: "daily_limit" });
  });

  it("rejects a Daily Run with another day or seed, and oversized or malformed input logs", async () => {
    g = await startGame();
    const { h } = g;
    const cookie = await guest(h);
    const wrongSeed = await call(h, "POST", "/api/runs", cookie, await daily(g, { seed: 1 }));
    expect(wrongSeed.json()).toMatchObject({ error: "bad_request", reason: "bad_seed" });
    const wrongDay = await call(h, "POST", "/api/runs", cookie, await daily(g, { day: "2020-01-01" }));
    expect(wrongDay.json()).toMatchObject({ error: "bad_request", reason: "wrong_day" });
    const big = Buffer.alloc(8 * 1024 + 1).toString("base64");
    expect((await call(h, "POST", "/api/runs", cookie, run({ inputs: big }))).statusCode).toBe(400);
    expect(
      (await call(h, "POST", "/api/runs", cookie, run({ claimed: summary({ lostDelta: "zz" }) }))).statusCode,
    ).toBe(400);
    expect((await call(h, "POST", "/api/runs", cookie, { ...run(), kind: "daily" })).statusCode).toBe(400);
  });

  it("re-checks ownership when the binding is older than 10 min and refuses a transferred Friend", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    expect((await call(h, "POST", "/api/runs", cookie, run())).statusCode).toBe(200);
    h.rpc.world.transfer(MASK, "0x9999999999999999999999999999999999999999");
    h.clock.advance(5 * 60_000);
    // Still within the 10 min window: accepted on the stored binding.
    expect((await call(h, "POST", "/api/runs", cookie, run())).statusCode).toBe(200);
    h.clock.advance(6 * 60_000);
    const stale = await call(h, "POST", "/api/runs", cookie, run());
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ error: "not_owner" });
    expect(await h.db.kysely.selectFrom("friend_bindings").selectAll().execute()).toEqual([]);
  });
});

describe("POST /api/runs — owner scars", () => {
  it("does not persist scars for the first 3 runs of a Friend (newbie), then applies them", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const front = frontMask(await art(h, MASK));
    const two = fromIndices(toIndices(front).slice(0, 2));
    for (let i = 0; i < 3; i++) {
      const r = (await call(h, "POST", "/api/runs", cookie, run({ claimed: summary({ lostDelta: two }) }))).json();
      expect(r).toMatchObject({ applied: false, reason: "newbie" });
      expect(r.scars.lost).toBe(EMPTY_MASK);
    }
    const fourth = (await call(h, "POST", "/api/runs", cookie, run({ claimed: summary({ lostDelta: two }) }))).json();
    expect(fourth).toMatchObject({ applied: true, verified: "pending", scars: { lost: two, version: 1 } });
    expect(g.events.updateToken).toHaveBeenCalledWith(MASK.toString(), { scarsHash: shared.scarsHash(fourth.scars) });
  });

  it("clips the claimed loss to the front mask and the per-run scar cap, in regrowth order", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    await skipNewbie(h, MASK);
    const front = frontMask(await art(h, MASK));
    const cap = runScarCap(popcount(front));
    const offFront = fromIndices(toIndices(shared.andNot("f".repeat(64), front)).slice(0, 5));
    const claimed = or(fromIndices(toIndices(front).slice(0, cap + 5)), offFront);
    const ack = (await call(h, "POST", "/api/runs", cookie, run({ claimed: summary({ lostDelta: claimed }) }))).json();
    expect(ack.applied).toBe(true);
    expect(popcount(ack.scars.lost)).toBe(cap);
    expect(and(ack.scars.lost, offFront)).toBe(EMPTY_MASK);
    expect(ack.scars.lost).toBe(clipPixels(and(claimed, front), cap, MASK.toString()));
    const row = await h.db.kysely.selectFrom("runs").selectAll().where("id", "=", ack.runId).executeTakeFirstOrThrow();
    expect(row.applied_lost).toBe(ack.scars.lost);
    expect(row.sim_friend).toMatchObject({ front, lost: EMPTY_MASK, goldHeld: 0 });
  });

  it("does not add scars at the 50 % floor (resting run)", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    await skipNewbie(h, MASK);
    const front = frontMask(await art(h, MASK));
    const floor = fromIndices(toIndices(front).slice(0, maxPersistedLost(popcount(front))));
    await setFriend(h, MASK, { lost: floor });
    const more = fromIndices(toIndices(front).slice(-3));
    const ack = (await call(h, "POST", "/api/runs", cookie, run({ claimed: summary({ lostDelta: more }) }))).json();
    expect(ack).toMatchObject({ applied: false, reason: "floor", scars: { lost: floor } });
  });

  it("credits Bits under the shared daily cap, with the first-run-of-day bonus once", async () => {
    g = await startGame();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const first = (await call(h, "POST", "/api/runs", cookie, run())).json() as RunAck;
    expect(first.bits).toBe(10 + 20 + 50);
    const second = (await call(h, "POST", "/api/runs", cookie, run())).json() as RunAck;
    expect(second.bits).toBe(30);
    let total = (first.bits ?? 0) + (second.bits ?? 0);
    for (let i = 0; i < 60; i++)
      total += ((await call(h, "POST", "/api/runs", cookie, run())).json() as RunAck).bits ?? 0;
    expect(total).toBe(shared.BITS.dailyHardCap);
    const me = (await call(h, "GET", "/api/me", cookie)).json();
    expect(me.bits).toBe(shared.BITS.dailyHardCap);
    expect(skillBonus(0, 12)).toBe(20);
    expect(skillBonus(12, 12)).toBe(0);
  });

  it("ranks owners' Daily Runs (best counts) and advances the streak once per day", async () => {
    g = await startGame();
    const { h, alice, bob } = g;
    const a = await owner(h, alice, MASK);
    const b = await owner(h, bob, 63675n);
    await call(h, "POST", "/api/runs", a, await daily(g, { claimed: summary({ score: 500 }) }));
    await call(h, "POST", "/api/runs", a, await daily(g, { claimed: summary({ score: 800 }) }));
    await call(h, "POST", "/api/runs", a, await daily(g, { claimed: summary({ score: 100 }) }));
    await call(h, "POST", "/api/runs", b, await daily(g, { claimed: summary({ score: 650 }) }));
    const day = utcDay(h.clock.now());
    const board = (await call(h, "GET", `/api/daily/${day}/board?board=owners`, b)).json();
    expect(board.entries.map((e: { entrant: string; score: number }) => [e.entrant, e.score])).toEqual([
      [MASK.toString(), 800],
      ["63675", 650],
    ]);
    expect(board.me).toMatchObject({ rank: 2, entrant: "63675" });
    expect((await call(h, "GET", `/api/friends/${MASK}/public`)).json().streak).toBe(1);
    h.clock.advance(86_400_000);
    await call(h, "POST", "/api/runs", a, await daily(g));
    expect((await call(h, "GET", `/api/friends/${MASK}/public`)).json().streak).toBe(2);
    expect((await call(h, "GET", `/api/daily/2020-13-45/board?board=owners`)).statusCode).toBe(400);
    expect((await call(h, "GET", `/api/daily/${day}/board?board=all`)).statusCode).toBe(400);
  });
});

describe("replay verification", () => {
  it("marks a run verified when the replay matches", async () => {
    const verifier = scripted(() => ({ status: "ok", summary: summary() }));
    g = await startGame({ deps: { verifier } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const ack = (await call(h, "POST", "/api/runs", cookie, await daily(g))).json() as RunAck;
    await waitIdle(g);
    const row = await h.db.kysely.selectFrom("runs").selectAll().where("id", "=", ack.runId).executeTakeFirstOrThrow();
    expect(row.verified).toBe(1);
    const board = (await call(h, "GET", `/api/daily/${utcDay(h.clock.now())}/board?board=owners`)).json();
    expect(board.entries[0]).toMatchObject({ runId: ack.runId, verified: "ok" });
  });

  it("drops a mismatching Daily Run from the board and falls back to the entrant's next best run", async () => {
    const verifier = scripted((i) =>
      i === 1 ? { status: "mismatch", summary: null, detail: "diverged" } : { status: "ok", summary: summary() },
    );
    g = await startGame({ deps: { verifier } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const low = (
      await call(h, "POST", "/api/runs", cookie, await daily(g, { claimed: summary({ score: 300 }) }))
    ).json();
    await waitIdle(g);
    const high = (
      await call(h, "POST", "/api/runs", cookie, await daily(g, { claimed: summary({ score: 9000 }) }))
    ).json();
    await waitIdle(g);
    const rows = await h.db.kysely.selectFrom("runs").select(["id", "verified"]).orderBy("created_at").execute();
    expect(rows.find((r) => r.id === high.runId)?.verified).toBe(-1);
    const board = (await call(h, "GET", `/api/daily/${utcDay(h.clock.now())}/board?board=owners`)).json();
    expect(board.entries).toEqual([expect.objectContaining({ runId: low.runId, score: 300, verified: "ok" })]);
  });

  it("leaves runs pending when this build has no replay() (sim not merged yet), through the real worker pool", async () => {
    const pool = createReplayPool({ size: 1 });
    g = await startGame({ deps: { verifier: pool } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const ack = (await call(h, "POST", "/api/runs", cookie, run())).json() as RunAck;
    await waitIdle(g);
    const outcome = await pool.verify({
      config: {
        seed: 1,
        kind: "free",
        arena: "meadow",
        friend: { front: EMPTY_MASK, lost: EMPTY_MASK, familyId: 1, goldHeld: 0 },
      },
      inputs: "AA==",
      claimed: summary(),
    });
    const row = await h.db.kysely.selectFrom("runs").selectAll().where("id", "=", ack.runId).executeTakeFirstOrThrow();
    if (typeof (shared as Record<string, unknown>)["replay"] === "function") {
      expect(["ok", "mismatch"]).toContain(outcome.status);
    } else {
      expect(outcome.status).toBe("unavailable");
      expect(row.verified).toBe(0);
    }
  });

  // TODO(T2 sim): becomes active automatically once @pl/shared exports replay/encodeInputs (feat/sim). A bot run
  // replayed by the pool must verify, and a tampered claim must not.
  it.skipIf(typeof (shared as Record<string, unknown>)["replay"] !== "function")(
    "verifies a genuine sim run end to end and rejects a tampered one",
    async () => {
      const api = shared as unknown as Record<string, (...args: unknown[]) => unknown>;
      g = await startGame();
      const front = frontMask(await art(g.h, MASK));
      const pool = createReplayPool({ size: 1 });
      const config = {
        seed: 7,
        kind: "free",
        arena: "meadow",
        friend: { front, lost: EMPTY_MASK, familyId: 1, goldHeld: 0 },
      };
      const inputs = [{ t: 30, k: 0, ang: 1024, pow: 800 }];
      const claimed = api["replay"]?.(config, inputs) as RunSubmitReq["claimed"];
      const b64 = Buffer.from(api["encodeInputs"]?.(inputs) as Uint8Array).toString("base64");
      expect((await pool.verify({ config: config as never, inputs: b64, claimed })).status).toBe("ok");
      const tampered = { ...claimed, score: claimed.score + 1 };
      expect((await pool.verify({ config: config as never, inputs: b64, claimed: tampered })).status).toBe("mismatch");
      await pool.close();
    },
  );

  it("does not replay guest runs (no server-side Friend to replay against)", async () => {
    const verifier = scripted(() => ({ status: "ok", summary: summary() }));
    g = await startGame({ deps: { verifier } });
    await call(g.h, "POST", "/api/runs", await guest(g.h), run());
    await waitIdle(g);
    expect(verifier.calls).toBe(0);
  });
});

describe("helpers", () => {
  it("clipPixels keeps exactly `cap` pixels, deterministically", () => {
    const m = fromIndices([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(popcount(clipPixels(m, 3, "344030"))).toBe(3);
    expect(clipPixels(m, 3, "344030")).toBe(clipPixels(m, 3, "344030"));
    expect(clipPixels(m, 20, "344030")).toBe(m);
    expect(ASYMMETRY).toBeGreaterThan(0n);
  });
});

/** Waits until every queued replay has been recorded. */
const waitIdle = (game: Game) => game.h.ctx.runs.idle();
