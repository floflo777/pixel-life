import { fromSdkFrames, isHex64, parseFamilyId, type FriendAppearance, type Hex64, type TokenIdStr } from "@pl/shared";
import { GENERATION_SPRITE_MANIFEST, createGenerationSpriteReader } from "@rarefriends/friendsdk/sprites";
import { BaseError, ContractFunctionRevertedError, parseAbi, type Address } from "viem";
import type { ChainClient } from "../chain/eligibility.js";
import type { Executor } from "../repos/index.js";
import { HttpError } from "../http/errors.js";

/** Immutable Friend art, cached in-process, then in Postgres, then read from the registry (architecture §4.3). */
export interface AppearanceStore {
  /** The Friend's art; 404 `not_found` for a token the registry does not know, 503 `unavailable` on RPC failure. */
  get(tokenId: TokenIdStr): Promise<FriendAppearance>;
  /** Cached art only (never touches the chain): for batch views such as the Sky. */
  peek(tokenIds: readonly TokenIdStr[]): Promise<Map<TokenIdStr, FriendAppearance>>;
}

const MEMORY_MAX = 2048;
const OWNER_OF_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

const isRevert = (error: unknown) =>
  error instanceof BaseError && error.walk((e) => e instanceof ContractFunctionRevertedError) !== null;

function fromRow(row: { token_id: string; family_id: number; seed: number; frames: unknown }): FriendAppearance | null {
  if (!Array.isArray(row.frames) || !row.frames.every(isHex64)) return null;
  return {
    tokenId: row.token_id,
    familyId: parseFamilyId(row.family_id),
    seed: row.seed,
    frames: row.frames as Hex64[],
  };
}

/** Creates the store. Art is keyed by token and registry address: a registry change would be a new cache space. */
export function createAppearanceStore(deps: {
  readonly db: Executor;
  readonly chain: ChainClient;
  readonly now: () => Date;
  /** Generations collection: a token must exist (ownerOf does not revert) before its art is cached forever. */
  readonly generations: Address;
}): AppearanceStore {
  const reader = createGenerationSpriteReader(deps.chain);
  const registry = GENERATION_SPRITE_MANIFEST.registry.toLowerCase();
  const memory = new Map<TokenIdStr, FriendAppearance>();
  const inflight = new Map<TokenIdStr, Promise<FriendAppearance>>();

  const remember = (a: FriendAppearance) => {
    memory.set(a.tokenId, a);
    if (memory.size > MEMORY_MAX) {
      const oldest = memory.keys().next();
      if (!oldest.done) memory.delete(oldest.value);
    }
  };

  const load = async (tokenId: TokenIdStr): Promise<FriendAppearance> => {
    const row = await deps.db
      .selectFrom("friend_appearance")
      .select(["token_id", "family_id", "seed", "frames"])
      .where("token_id", "=", tokenId)
      .where("registry", "=", registry)
      .executeTakeFirst();
    const cached = row ? fromRow(row) : null;
    if (cached) return cached;

    let sprites: Awaited<ReturnType<typeof reader.read>>;
    try {
      // The registry answers for any id; only minted Friends have art worth caching.
      await deps.chain.readContract({
        address: deps.generations,
        abi: OWNER_OF_ABI,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      });
      sprites = await reader.read(BigInt(tokenId));
    } catch (error) {
      if (isRevert(error))
        throw new HttpError(404, "not_found", "No Friend with that id.", { reason: "unknown_friend" });
      throw new HttpError(503, "unavailable", "Could not read this Friend's art on chain. Try again.", {
        reason: "rpc_error",
      });
    }
    const art: FriendAppearance = {
      tokenId,
      familyId: parseFamilyId(sprites.familyId),
      seed: sprites.seed,
      frames: fromSdkFrames(sprites.frames),
    };
    await deps.db
      .insertInto("friend_appearance")
      .values({
        token_id: tokenId,
        registry,
        family_id: art.familyId,
        seed: art.seed,
        frames: JSON.stringify(art.frames),
        fetched_at: deps.now(),
      })
      .onConflict((oc) => oc.column("token_id").doNothing())
      .execute();
    return art;
  };

  return {
    async get(tokenId) {
      const hit = memory.get(tokenId);
      if (hit) return hit;
      let pending = inflight.get(tokenId);
      if (!pending) {
        // Coalesce concurrent misses: one registry read per token.
        pending = load(tokenId).finally(() => inflight.delete(tokenId));
        inflight.set(tokenId, pending);
      }
      const art = await pending;
      remember(art);
      return art;
    },
    async peek(tokenIds) {
      const out = new Map<TokenIdStr, FriendAppearance>();
      const missing: TokenIdStr[] = [];
      for (const id of tokenIds) {
        const hit = memory.get(id);
        if (hit) out.set(id, hit);
        else missing.push(id);
      }
      if (missing.length > 0) {
        const rows = await deps.db
          .selectFrom("friend_appearance")
          .select(["token_id", "family_id", "seed", "frames"])
          .where("token_id", "in", missing)
          .where("registry", "=", registry)
          .execute();
        for (const row of rows) {
          const art = fromRow(row);
          if (art) {
            remember(art);
            out.set(art.tokenId, art);
          }
        }
      }
      return out;
    },
  };
}
