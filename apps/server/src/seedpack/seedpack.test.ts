import { ECON, GOLD_PIXEL_OUTCOME_ID, SEED_OUTCOME, snapshotToDto, type GameSnapshotDto } from "@pl/shared";
import { RF, createGamePreview } from "@rarefriends/friendsdk/game";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { MASK, call, guest, owner, startGame, type Game } from "../test/game.js";
import { signIn } from "../test/harness.js";
import {
  LedgerError,
  SEED_PACK_GAME,
  buy,
  canBuy,
  play,
  redeem,
  settle,
  snapshot,
  type LedgerState,
} from "./ledger.js";

let g: Game | undefined;
afterEach(async () => {
  await g?.h.close();
  g = undefined;
});

/** One player action, as both the SDK preview client and our ledger take it. */
type Op =
  | { op: "canBuy"; quantity: bigint }
  | { op: "buy"; quantity: bigint }
  | { op: "play"; quantity: bigint | undefined }
  | { op: "settle"; playId: bigint }
  | { op: "redeem"; outcomeId: number; quantity: bigint };

/** A roll source replaying a fixed script (both sides consume the same sequence). */
const scriptedDraw = (rolls: readonly number[]) => {
  let i = 0;
  return () => rolls[i++ % rolls.length] ?? 0;
};

const initial = (stake: bigint, rfBalance: bigint, friendId: bigint): LedgerState => ({
  friendId,
  rfBalance,
  consumables: 0n,
  stake,
  reservedPlays: 0n,
  rewardLiability: 0n,
  inventory: SEED_PACK_GAME.outcomes.map(() => 0n),
  plays: [],
});

type Outcome = { ok: true; value: unknown } | { ok: false; message: string };

async function sdkStep(client: ReturnType<typeof createGamePreview>["client"], o: Op): Promise<Outcome> {
  try {
    switch (o.op) {
      case "canBuy":
        return { ok: true, value: await client.canBuy(o.quantity) };
      case "buy":
        await client.buy(o.quantity);
        return { ok: true, value: null };
      case "play":
        return { ok: true, value: await client.play(o.quantity) };
      case "settle":
        return { ok: true, value: await client.settle(o.playId) };
      case "redeem":
        await client.redeem(o.outcomeId, o.quantity);
        return { ok: true, value: null };
    }
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

function ourStep(state: LedgerState, o: Op, draw: () => number): { state: LedgerState; outcome: Outcome } {
  try {
    switch (o.op) {
      case "canBuy":
        return { state, outcome: { ok: true, value: canBuy(state, o.quantity) } };
      case "buy":
        return { state: buy(state, o.quantity), outcome: { ok: true, value: null } };
      case "play": {
        const r = play(state, o.quantity);
        return { state: r.state, outcome: { ok: true, value: r.added } };
      }
      case "settle": {
        const r = settle(state, o.playId, draw);
        return { state: r.state, outcome: { ok: true, value: r.play } };
      }
      case "redeem":
        return { state: redeem(state, o.outcomeId, o.quantity), outcome: { ok: true, value: null } };
    }
  } catch (error) {
    if (!(error instanceof LedgerError)) throw error;
    return { state, outcome: { ok: false, message: error.message } };
  }
}

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant("canBuy" as const), quantity: fc.bigInt({ min: -1n, max: 6n }) }),
  fc.record({ op: fc.constant("buy" as const), quantity: fc.bigInt({ min: -1n, max: 5n }) }),
  fc.record({
    op: fc.constant("play" as const),
    quantity: fc.option(fc.bigInt({ min: 0n, max: 3n }), { nil: undefined }),
  }),
  fc.record({ op: fc.constant("settle" as const), playId: fc.bigInt({ min: 0n, max: 8n }) }),
  fc.record({
    op: fc.constant("redeem" as const),
    outcomeId: fc.integer({ min: 0, max: 5 }),
    quantity: fc.bigInt({ min: 0n, max: 3n }),
  }),
);

describe("seed-pack ledger core ≡ SDK createGamePreview", () => {
  it("produces identical results, errors and snapshots for random action sequences", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(opArb, { maxLength: 40 }),
        fc.array(fc.integer({ min: 0, max: 9999 }), { minLength: 1, maxLength: 16 }),
        fc.bigInt({ min: 0n, max: 400n }),
        fc.bigInt({ min: 0n, max: 60n }),
        async (ops, rolls, stakeRf, balanceRf) => {
          const friendId = 344030n;
          const preview = createGamePreview(SEED_PACK_GAME, {
            stake: stakeRf * RF,
            rfBalance: balanceRf * RF,
            friendId,
            draw: scriptedDraw(rolls),
          });
          const ours = scriptedDraw(rolls);
          let state = initial(stakeRf * RF, balanceRf * RF, friendId);
          for (const o of ops) {
            const expected = await sdkStep(preview.client, o);
            const got = ourStep(state, o, ours);
            state = got.state;
            expect(got.outcome).toEqual(expected);
            expect(snapshot(state)).toEqual(await preview.client.read());
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("POST /api/seedpack/* ≡ SDK createGamePreview (HTTP, Postgres)", () => {
  /** Plays a scripted session against both, comparing every response and snapshot. */
  it("mirrors the SDK operation by operation, including its refusals", async () => {
    const rolls = [9850, 0, 6000, 9000, 5599, 9799, 9800, 42];
    g = await startGame({ env: { SEEDPACK_STAKE_RF: "140" }, deps: { seedpackDraw: scriptedDraw(rolls) } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const preview = createGamePreview(SEED_PACK_GAME, {
      stake: 140n * RF,
      rfBalance: BigInt(ECON.simStartMicro) * 10n ** 12n,
      friendId: MASK,
      draw: scriptedDraw(rolls),
    });
    const sdkSnap = async (): Promise<GameSnapshotDto> => snapshotToDto(await preview.client.read());
    const post = (op: string, body: object) => call(h, "POST", `/api/seedpack/${op}`, cookie, body);

    expect((await post("read", {})).json()).toEqual(await sdkSnap());

    const script: Op[] = [
      { op: "canBuy", quantity: 1n },
      { op: "canBuy", quantity: 3n }, // 140 free + 15 < 135? no: reserve 135 ≤ 155 → true
      { op: "canBuy", quantity: 4n }, // 140 + 20 < 180 → false
      { op: "buy", quantity: 4n }, // reserve refusal
      { op: "buy", quantity: 2n },
      { op: "play", quantity: 3n }, // more than held
      { op: "play", quantity: undefined },
      { op: "play", quantity: 1n },
      { op: "settle", playId: 1n }, // Gold Pixel
      { op: "settle", playId: 1n }, // already settled
      { op: "settle", playId: 9n }, // unknown play
      { op: "settle", playId: 2n }, // Sprout
      { op: "redeem", outcomeId: SEED_OUTCOME.bloom, quantity: 1n }, // not held
      { op: "redeem", outcomeId: 9, quantity: 1n }, // unknown outcome
      { op: "redeem", outcomeId: SEED_OUTCOME.sprout, quantity: 1n },
      { op: "buy", quantity: 1n },
      { op: "redeem", outcomeId: GOLD_PIXEL_OUTCOME_ID, quantity: 1n },
    ];
    for (const o of script) {
      const expected = await sdkStep(preview.client, o);
      const body =
        o.op === "canBuy" || o.op === "buy"
          ? { quantity: o.quantity.toString() }
          : o.op === "play"
            ? o.quantity === undefined
              ? {}
              : { quantity: o.quantity.toString() }
            : o.op === "settle"
              ? { playId: o.playId.toString() }
              : { outcomeId: o.outcomeId, quantity: o.quantity.toString() };
      const r = await post(o.op, body);
      if (expected.ok) {
        expect(r.statusCode, `${o.op} ${r.body}`).toBe(200);
        if (o.op === "canBuy") expect(r.json()).toEqual({ ok: expected.value });
        if (o.op === "play") {
          expect(r.json()).toEqual({
            plays: (expected.value as { id: bigint; outcomeId: null }[]).map((p) => ({
              id: p.id.toString(),
              outcomeId: null,
            })),
          });
        }
        if (o.op === "settle") {
          const p = expected.value as { id: bigint; outcomeId: number };
          expect(r.json()).toEqual({ id: p.id.toString(), outcomeId: p.outcomeId });
        }
        if (o.op === "buy" || o.op === "redeem") expect(r.json()).toEqual(await sdkSnap());
      } else {
        expect(r.statusCode, `${o.op} should fail like the SDK: ${expected.message}`).toBeGreaterThanOrEqual(400);
        expect(r.json().message).toBe(expected.message);
      }
      expect((await post("read", {})).json()).toEqual(await sdkSnap());
    }

    // Inventory order = outcome id − 1, persisted; Gold drove the hub and the public perk while held.
    const row = await h.db.kysely.selectFrom("seedpack_friend").selectAll().executeTakeFirstOrThrow();
    expect(row.inventory).toEqual([0, 0, 0, 0]);
    expect(g.events.updateToken).toHaveBeenCalledWith(MASK.toString(), expect.objectContaining({ goldHeld: 1 }));
    expect(g.events.updateToken).toHaveBeenLastCalledWith(MASK.toString(), { goldHeld: 0 });
    const stats = (await call(h, "GET", "/api/stats/economy")).json();
    expect(stats.counts.seedPacks).toBe(3);
  });

  it("maps refusals to HTTP codes: reserve 409 seedpack_reserve, balance 402 insufficient_funds, unknown play 404", async () => {
    g = await startGame({ env: { SEEDPACK_STAKE_RF: "40" } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const reserve = await call(h, "POST", "/api/seedpack/buy", cookie, { quantity: "1" });
    expect(reserve.statusCode).toBe(409);
    expect(reserve.json()).toMatchObject({ error: "seedpack_reserve" });
    await call(h, "POST", "/api/seedpack/read", cookie, {}); // creates the house row (a refused buy rolls back)
    await h.db.kysely.updateTable("seedpack_house").set({ stake_micro: 10_000_000_000 }).execute();
    const poor = await call(h, "POST", "/api/seedpack/buy", cookie, { quantity: "5" });
    expect(poor.statusCode).toBe(402);
    expect(poor.json()).toMatchObject({ error: "insufficient_funds", message: "Insufficient RF." });
    const unknown = await call(h, "POST", "/api/seedpack/settle", cookie, { playId: "1" });
    expect(unknown.statusCode).toBe(404);
    expect((await call(h, "POST", "/api/seedpack/buy", cookie, { quantity: "-1" })).statusCode).toBe(400);
    expect((await call(h, "POST", "/api/seedpack/read", cookie, { extra: 1 })).statusCode).toBe(400);
  });

  it("shows a held Gold Pixel in the public state and speeds regrowth only from the moment it is won", async () => {
    g = await startGame({ deps: { seedpackDraw: () => 9999 } });
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    await call(h, "POST", "/api/seedpack/buy", cookie, { quantity: "1" });
    await call(h, "POST", "/api/seedpack/play", cookie, {});
    await call(h, "POST", "/api/seedpack/settle", cookie, { playId: "1" });
    const pub = (await call(h, "GET", `/api/friends/${MASK}/public`)).json();
    expect(pub.goldHeld).toBe(1);
    expect(pub.scars.version).toBe(1); // regrowth materialised at the old rate when the Gold arrived
    await call(h, "POST", "/api/seedpack/redeem", cookie, { outcomeId: GOLD_PIXEL_OUTCOME_ID, quantity: "1" });
    expect((await call(h, "GET", `/api/friends/${MASK}/public`)).json().goldHeld).toBe(0);
  });

  it("requires a session with a bound Friend, and a fresh ownership check on buy/play/redeem", async () => {
    g = await startGame();
    const { h, alice } = g;
    expect((await call(h, "POST", "/api/seedpack/read", undefined, {})).json()).toMatchObject({ error: "no_session" });
    expect((await call(h, "POST", "/api/seedpack/read", await guest(h), {})).statusCode).toBe(401);
    expect((await call(h, "POST", "/api/seedpack/read", await signIn(h, alice), {})).json()).toMatchObject({
      reason: "no_binding",
    });
    const cookie = await owner(h, alice, MASK);
    expect((await call(h, "POST", "/api/seedpack/read", cookie, {})).statusCode).toBe(200);
    h.rpc.world.transfer(MASK, "0x9999999999999999999999999999999999999999");
    const buyNow = await call(h, "POST", "/api/seedpack/buy", cookie, { quantity: "1" });
    expect(buyNow.statusCode).toBe(403);
    expect(buyNow.json()).toMatchObject({ error: "not_owner" });
  });
});
