import { EMPTY_MASK, ECON, frontMask, fromIndices, microToWei, or, popcount, toIndices, type Hex64 } from "@pl/shared";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../config.js";
import { MASK, SKELETON, art, call, owner, setFriend, startGame, type Game } from "../test/game.js";
import { SINK_EVENTS_ABI, decodeSinkPayments } from "./live.js";

/**
 * LIVE MODE — exercised only against synthetic receipts shaped like `PixelLifeSink` events (contracts/README.md).
 * Nothing here touches a real chain; the contracts are not deployed.
 */

const SINK: Address = "0x5151515151515151515151515151515151515151";
const TX: Hex = `0x${"ab".repeat(32)}`;

let g: Game | undefined;
afterEach(async () => {
  await g?.h.close();
  g = undefined;
});

const receipts = new Map<string, TransactionReceipt>();

async function startLive(): Promise<Game> {
  receipts.clear();
  return startGame({
    env: { ECONOMY_MODE: "live", PIXEL_LIFE_SINK: SINK, LIVE_CONFIRMATIONS: "3" },
    wrapChain: (client) => ({
      ...client,
      getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
        const r = receipts.get(hash);
        if (!r) throw new Error("receipt not found");
        return r;
      },
    }),
  });
}

function regrewLog(args: {
  tokenId: bigint;
  quoteId: Hex;
  px: number;
  logIndex: number;
  block: bigint;
  emitter?: Address;
}): Log {
  const total = BigInt(microToWei(args.px * ECON.regrowMicroPerPx));
  return {
    address: args.emitter ?? SINK,
    topics: encodeEventTopics({
      abi: SINK_EVENTS_ABI,
      eventName: "Regrew",
      args: { tokenId: args.tokenId, quoteId: args.quoteId },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(parseAbiParameters("uint256, uint256, uint256, uint256"), [
      BigInt(args.px),
      total,
      total / 2n,
      total - total / 2n,
    ]),
    blockNumber: args.block,
    blockHash: `0x${"cd".repeat(32)}`,
    transactionHash: TX,
    transactionIndex: 0,
    logIndex: args.logIndex,
    removed: false,
  };
}

function mendedLog(args: { payer: bigint; target: bigint; quoteId: Hex; px: number; block: bigint }): Log {
  const total = BigInt(microToWei(args.px * ECON.mendMicroPerPx));
  return {
    address: SINK,
    topics: encodeEventTopics({
      abi: SINK_EVENTS_ABI,
      eventName: "Mended",
      args: { payerTokenId: args.payer, targetTokenId: args.target, quoteId: args.quoteId },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(parseAbiParameters("address, uint256, uint256, uint256, uint256"), [
      "0x0000000000000000000000000000000000000abc",
      BigInt(args.px),
      total,
      total / 2n,
      total - total / 2n,
    ]),
    blockNumber: args.block,
    blockHash: `0x${"cd".repeat(32)}`,
    transactionHash: TX,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}

function putReceipt(block: bigint, logs: Log[], status: "success" | "reverted" = "success"): void {
  receipts.set(TX, { status, blockNumber: block, logs, transactionHash: TX } as unknown as TransactionReceipt);
}

async function scar(game: Game, tokenId: bigint, n: number): Promise<number[]> {
  const idx = toIndices(frontMask(await art(game.h, tokenId))).slice(0, n);
  await setFriend(game.h, tokenId, { lost: fromIndices(idx) });
  return idx;
}

describe("live mode (untested on chain)", () => {
  it("refuses to start without the sink address", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://x/y",
        SESSION_SECRET: "s".repeat(32),
        DAILY_SECRET: "d".repeat(32),
        ECONOMY_MODE: "live",
      }),
    ).toThrow(ConfigError);
  });

  it("issues a quote id and locks its pixels against free regrowth for 15 min", async () => {
    g = await startLive();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const [a, b] = await scar(g, MASK, 2);
    const pixels = fromIndices([a ?? 0, b ?? 0]);
    // Scarred 1 h 59 min ago: the first free pixel is 1 min away.
    await h.db.kysely
      .updateTable("friends")
      .set({ scar_updated_at: new Date(h.clock.now().getTime() - 2 * 3_600_000 + 60_000) })
      .where("token_id", "=", MASK.toString())
      .execute();
    const q = await call(h, "POST", "/api/economy/quote", cookie, { kind: "regrow", tokenId: MASK.toString(), pixels });
    expect(q.statusCode).toBe(200);
    const body = q.json();
    expect(body.quoteId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.lockedUntil).toBe(h.clock.now().getTime() + ECON.quoteLockMs);
    expect(body.mode).toBe("live");
    // 10 min later one pixel would have regrown for free, but both are locked while the quote is open.
    h.clock.advance(10 * 60_000);
    expect((await call(h, "GET", `/api/friends/${MASK}/public`)).json().scars.lost).toBe(pixels);
    const again = await call(h, "POST", "/api/economy/quote", cookie, {
      kind: "regrow",
      tokenId: MASK.toString(),
      pixels,
    });
    expect(again.json()).toMatchObject({ error: "scar_conflict" });
    const guestQuote = await call(h, "POST", "/api/economy/quote", undefined, {
      kind: "regrow",
      tokenId: MASK.toString(),
      pixels,
    });
    expect(guestQuote.statusCode).toBe(401);
    // Once the lock lapses, regrowth resumes.
    h.clock.advance(6 * 60_000);
    expect(popcount((await call(h, "GET", `/api/friends/${MASK}/public`)).json().scars.lost)).toBeLessThan(2);
  });

  it("credits a confirmed Regrew event once, books it by (tx_hash, log_index) and consumes the quote", async () => {
    g = await startLive();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const [a, b] = await scar(g, MASK, 2);
    const pixels = fromIndices([a ?? 0, b ?? 0]);
    const action = { kind: "regrow", tokenId: MASK.toString(), pixels };
    const { quoteId } = (await call(h, "POST", "/api/economy/quote", cookie, action)).json() as { quoteId: Hex };
    const head = h.rpc.world.head;

    putReceipt(head, [regrewLog({ tokenId: MASK, quoteId, px: 2, logIndex: 4, block: head })]);
    const early = await call(h, "POST", "/api/economy/regrow", cookie, { action, quoteId, txHash: TX });
    expect(early.json()).toMatchObject({ error: "tx_unverified", reason: "tx_pending" });

    putReceipt(head - 5n, [
      regrewLog({
        tokenId: MASK,
        quoteId,
        px: 2,
        logIndex: 4,
        block: head - 5n,
        emitter: "0x0000000000000000000000000000000000000001",
      }),
      regrewLog({ tokenId: MASK, quoteId, px: 2, logIndex: 5, block: head - 5n }),
    ]);
    const ok = await call(h, "POST", "/api/economy/regrow", cookie, { action, quoteId, txHash: TX });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: `live:4663:${TX}:5`, txHash: TX, scars: { lost: EMPTY_MASK } });
    const ledger = await h.db.kysely.selectFrom("rf_ledger").selectAll().execute();
    expect(ledger).toEqual([
      expect.objectContaining({ mode: "live", tx_hash: TX, log_index: 5, kind: "regrow", pixels: 2, to_target: "0" }),
    ]);
    const replay = await call(h, "POST", "/api/economy/regrow", cookie, { action, quoteId, txHash: TX });
    expect(replay.statusCode).toBe(200);
    expect(await h.db.kysely.selectFrom("rf_ledger").selectAll().execute()).toHaveLength(1);
    const stats = (await call(h, "GET", "/api/stats/economy")).json();
    expect(stats).toMatchObject({ mode: "live", simulated: false, burnedMicro: 500_000, streamMicro: 500_000 });
  });

  it("refuses failed transactions, receipts that pay another quote, and requests without quote/tx", async () => {
    g = await startLive();
    const { h, alice } = g;
    const cookie = await owner(h, alice, MASK);
    const [a] = await scar(g, MASK, 1);
    const action = { kind: "regrow", tokenId: MASK.toString(), pixels: fromIndices([a ?? 0]) };
    const { quoteId } = (await call(h, "POST", "/api/economy/quote", cookie, action)).json() as { quoteId: Hex };
    const block = h.rpc.world.head - 10n;
    putReceipt(block, [regrewLog({ tokenId: MASK, quoteId, px: 1, logIndex: 0, block })], "reverted");
    expect(
      (await call(h, "POST", "/api/economy/regrow", cookie, { action, quoteId, txHash: TX })).json(),
    ).toMatchObject({
      reason: "tx_failed",
    });
    putReceipt(block, [regrewLog({ tokenId: MASK, quoteId: `0x${"11".repeat(32)}`, px: 1, logIndex: 0, block })]);
    expect(
      (await call(h, "POST", "/api/economy/regrow", cookie, { action, quoteId, txHash: TX })).json(),
    ).toMatchObject({
      error: "tx_unverified",
    });
    expect((await call(h, "POST", "/api/economy/regrow", cookie, { action })).statusCode).toBe(400);
    const wrong = await call(h, "POST", "/api/economy/regrow", cookie, {
      action,
      quoteId: `0x${"22".repeat(32)}`,
      txHash: TX,
    });
    expect(wrong.json()).toMatchObject({ reason: "unknown_quote" });
    expect((await call(h, "POST", "/api/seedpack/read", cookie, {})).json()).toMatchObject({
      error: "unavailable",
      reason: "sim_only",
    });
  });

  it("credits a Mended event: target healed, stitches, inbox and hub events", async () => {
    g = await startLive();
    const { h, alice, bob } = g;
    const a = await owner(h, alice, MASK);
    await owner(h, bob, SKELETON);
    const idx = await scar(g, SKELETON, 3);
    const pixels: Hex64 = or(fromIndices([idx[0] ?? 0]), fromIndices([idx[1] ?? 0]));
    const action = { kind: "mend", payer: MASK.toString(), target: SKELETON.toString(), pixels };
    const { quoteId } = (await call(h, "POST", "/api/economy/quote", a, action)).json() as { quoteId: Hex };
    const block = h.rpc.world.head - 3n;
    putReceipt(block, [mendedLog({ payer: MASK, target: SKELETON, quoteId, px: 2, block })]);
    const r = await call(h, "POST", "/api/economy/mend", a, { action, quoteId, txHash: TX });
    expect(r.statusCode).toBe(200);
    expect(popcount(r.json().scars.lost)).toBe(1);
    expect(g.events.mended).toHaveBeenCalledWith(SKELETON.toString(), MASK.toString(), 2);
    expect(g.events.notify).toHaveBeenCalledWith(
      bob.address.toLowerCase(),
      expect.objectContaining({ mode: "live", toTargetMicro: 1_000_000 }),
    );
  });

  it("decodes only the sink's events, mapping them 1:1 to rf_ledger columns", () => {
    const quoteId: Hex = `0x${"33".repeat(32)}`;
    const logs = [
      regrewLog({ tokenId: 7n, quoteId, px: 3, logIndex: 1, block: 9n }),
      regrewLog({
        tokenId: 7n,
        quoteId,
        px: 3,
        logIndex: 2,
        block: 9n,
        emitter: "0x0000000000000000000000000000000000000002",
      }),
    ];
    const payments = decodeSinkPayments(4663, SINK, logs);
    expect(payments).toEqual([
      {
        quoteId,
        entry: expect.objectContaining({
          id: `live:4663:${TX}:1`,
          kind: "regrow",
          payer: "7",
          target: "7",
          pixels: 3,
          totalWei: microToWei(1_500_000),
          burnWei: microToWei(750_000),
          streamWei: microToWei(750_000),
          toTargetWei: "0",
          logIndex: 1,
          block: 9,
        }),
      },
    ]);
  });
});
