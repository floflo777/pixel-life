/**
 * `ServerLedgerClient` against a "server" that is the SDK's own preview ledger behind the JSON codecs: every action
 * sequence must give the same snapshots as calling the SDK directly, so the booth cannot tell the difference.
 */
import { SEED_PACK, snapshotToDto, playToDto, type SeedPackApi, type SeedPackOp } from "@pl/shared";
import { createGamePreview, parseChanceGame, RF } from "@rarefriends/friendsdk/game";
import { describe, expect, it, vi } from "vitest";
import {
  createServerLedgerClient,
  LedgerIdentityError,
  serverLedgerFactory,
  type SeedPackTransport,
} from "./server-ledger.js";

const definition = parseChanceGame(SEED_PACK);

function sequence(): () => number {
  const rolls = [9999, 0, 5700, 8700, 42];
  let i = 0;
  return () => rolls[i++ % rolls.length] ?? 0;
}

/** A JSON "server" backed by the SDK preview ledger (what apps/server mirrors). */
function jsonServer() {
  const { client } = createGamePreview(definition, {
    friendId: 7n,
    stake: 1000n * RF,
    rfBalance: 40n * RF,
    draw: sequence(),
  });
  const seen: string[] = [];
  const seedpack = async <O extends SeedPackOp>(op: O, req: SeedPackApi[O]["req"]): Promise<SeedPackApi[O]["res"]> => {
    seen.push(op);
    // Round-trip the request through JSON like the wire does.
    const r = JSON.parse(JSON.stringify(req)) as Record<string, string | number | undefined>;
    switch (op) {
      case "read":
        return snapshotToDto(await client.read()) as SeedPackApi[O]["res"];
      case "canBuy":
        return { ok: await client.canBuy(BigInt(r.quantity as string)) } as SeedPackApi[O]["res"];
      case "buy":
        await client.buy(BigInt(r.quantity as string));
        return snapshotToDto(await client.read()) as SeedPackApi[O]["res"];
      case "play": {
        const plays = await client.play(r.quantity === undefined ? undefined : BigInt(r.quantity as string));
        return { plays: plays.map(playToDto) } as SeedPackApi[O]["res"];
      }
      case "settle":
        return playToDto(await client.settle(BigInt(r.playId as string))) as SeedPackApi[O]["res"];
      case "redeem":
        await client.redeem(r.outcomeId as number, BigInt(r.quantity as string));
        return snapshotToDto(await client.read()) as SeedPackApi[O]["res"];
    }
    throw new Error(op);
  };
  return { transport: { seedpack } as SeedPackTransport, seen };
}

describe("ServerLedgerClient", () => {
  it("matches the SDK preview ledger step by step (buy → play → settle → redeem)", async () => {
    const server = jsonServer();
    const ours = createServerLedgerClient(server.transport, definition);
    const { client: sdk } = createGamePreview(definition, {
      friendId: 7n,
      stake: 1000n * RF,
      rfBalance: 40n * RF,
      draw: sequence(),
    });

    expect(ours.mode).toBe("preview");
    expect(await ours.read()).toEqual(await sdk.read());
    expect(await ours.canBuy(3n)).toBe(await sdk.canBuy(3n));
    await ours.buy(3n);
    await sdk.buy(3n);
    expect(await ours.read()).toEqual(await sdk.read());
    const a = await ours.play(2n);
    const b = await sdk.play(2n);
    expect(a).toEqual(b);
    for (const p of a) expect(await ours.settle(p.id)).toEqual(await sdk.settle(p.id));
    const snap = await ours.read();
    expect(snap).toEqual(await sdk.read());
    const held = snap.inventory.findIndex((n) => n > 0n);
    if (held >= 0) {
      await ours.redeem(held + 1, 1n);
      await sdk.redeem(held + 1, 1n);
    }
    expect(await ours.read()).toEqual(await sdk.read());
    expect(server.seen).toContain("settle");
  });

  it("rejects out-of-range quantities before calling the server", async () => {
    const seedpack = vi.fn();
    const c = createServerLedgerClient({ seedpack } as unknown as SeedPackTransport, definition);
    await expect(c.buy(0n)).rejects.toThrow(RangeError);
    await expect(c.buy(100n)).rejects.toThrow(RangeError);
    expect(seedpack).not.toHaveBeenCalled();
  });

  it("the factory refuses a Friend the server session is not bound to", async () => {
    const onMismatch = vi.fn();
    const seedpack = vi.fn();
    const factory = serverLedgerFactory({ seedpack } as unknown as SeedPackTransport, () => "1", onMismatch);
    const ctx = { friendId: 2n, walletAddress: "0x1", chainId: 4663, definition };
    const c = factory(ctx);
    await expect(c.read()).rejects.toBeInstanceOf(LedgerIdentityError);
    expect(onMismatch).toHaveBeenCalledWith(ctx);
    expect(seedpack).not.toHaveBeenCalled();
    const ok = factory({ ...ctx, friendId: 1n });
    seedpack.mockResolvedValue({ ok: true });
    await expect(ok.canBuy(1n)).resolves.toBe(true);
  });
});
