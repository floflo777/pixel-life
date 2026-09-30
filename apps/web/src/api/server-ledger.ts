/**
 * `ServerLedgerClient`: the SDK `GameClient` (preview mode) backed by `POST /api/seedpack/*` (architecture §1.5, D4).
 * Handed to the patched `ConnectedGameHost` as `previewClient`, which calls the factory only after the SDK's fresh
 * eligibility gate passes, so the gate stays authoritative and Seed Packs survive reloads in the server ledger.
 */
import { snapshotFromDto } from "@pl/shared";
import type { ChanceGameDefinition, GameClient, GamePlay, GameSnapshot } from "@rarefriends/friendsdk/game";
import type { PreviewClientContext, PreviewClientFactory } from "@rarefriends/friendsdk/runtime";
import type { Api } from "./client.js";

/** The subset of the API the ledger needs (injectable in tests). */
export type SeedPackTransport = Pick<Api, "seedpack">;

/** Thrown when the SDK hands us a Friend the server session is not bound to. */
export class LedgerIdentityError extends Error {
  constructor(expected: string | null, got: string) {
    super(
      expected === null
        ? "Your Friend is not signed in on the server. Pick it again."
        : `This booth is open for #${got}, but you are signed in with #${expected}. Pick your Friend again.`,
    );
    this.name = "LedgerIdentityError";
  }
}

const qty = (q: bigint): string => {
  if (q < 1n || q > 99n) throw new RangeError("Quantity must be 1-99.");
  return q.toString(10);
};

/** A `GameClient` over the server ledger for `definition`. Snapshots are decoded with the shared codecs. */
export function createServerLedgerClient(api: SeedPackTransport, definition: ChanceGameDefinition): GameClient {
  return Object.freeze({
    mode: "preview" as const,
    definition,
    async read(): Promise<GameSnapshot> {
      return snapshotFromDto(await api.seedpack("read", {}));
    },
    async canBuy(quantity: bigint): Promise<boolean> {
      return (await api.seedpack("canBuy", { quantity: qty(quantity) })).ok;
    },
    async buy(quantity: bigint): Promise<void> {
      await api.seedpack("buy", { quantity: qty(quantity) });
    },
    async play(quantity?: bigint): Promise<readonly GamePlay[]> {
      const res = await api.seedpack("play", quantity === undefined ? {} : { quantity: qty(quantity) });
      return res.plays.map((p) => ({ id: BigInt(p.id), outcomeId: p.outcomeId }));
    },
    async settle(playId: bigint): Promise<GamePlay> {
      const p = await api.seedpack("settle", { playId: playId.toString(10) });
      return { id: BigInt(p.id), outcomeId: p.outcomeId };
    },
    async redeem(outcomeId: number, quantity: bigint): Promise<void> {
      await api.seedpack("redeem", { outcomeId, quantity: qty(quantity) });
    },
  });
}

/** A client whose every call rejects: used when the verified SDK identity and the server binding disagree. */
function refusingClient(definition: ChanceGameDefinition, error: Error): GameClient {
  const fail = () => Promise.reject(error);
  return Object.freeze({
    mode: "preview" as const,
    definition,
    read: fail,
    canBuy: fail,
    buy: fail,
    play: fail,
    settle: fail,
    redeem: fail,
  });
}

/**
 * The `previewClient` factory for `ConnectedGameHost`. The server keys the ledger by the session's bound Friend, so a
 * Friend the SDK verified but the server has not bound gets a refusing client (and `onMismatch` asks for a re-pick).
 */
export function serverLedgerFactory(
  api: SeedPackTransport,
  boundTokenId: () => string | null,
  onMismatch?: (ctx: PreviewClientContext) => void,
): PreviewClientFactory {
  return (ctx) => {
    const bound = boundTokenId();
    const got = ctx.friendId.toString(10);
    if (bound !== got) {
      onMismatch?.(ctx);
      return refusingClient(ctx.definition, new LedgerIdentityError(bound, got));
    }
    return createServerLedgerClient(api, ctx.definition);
  };
}
