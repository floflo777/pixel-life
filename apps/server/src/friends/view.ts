import {
  GOLD_PIXEL_OUTCOME_ID,
  fromSdkFrames,
  parseFamilyId,
  settleScars,
  type FriendAppearance,
  type FriendPublic,
  type FriendView,
  type TokenIdStr,
} from "@pl/shared";
import { createGenerationSpriteReader } from "@rarefriends/friendsdk/sprites";
import type { Selectable } from "kysely";
import type { ChainClient } from "../chain/eligibility.js";
import type { ServerConfig } from "../config.js";
import { HttpError } from "../http/errors.js";
import type { FriendsTable, Json } from "../db/schema.js";
import type { Executor } from "../repos/index.js";
import type { FriendBinding } from "../repos/index.js";

/** Builds the shared `FriendView` DTO for bound Friends. T7b reuses it for `/api/me` and `/api/friends/:id/public`. */
export interface FriendViews {
  /** Immutable art, read from the families registry with the SDK reader (cached in-process: art never changes). */
  appearance(tokenId: TokenIdStr): Promise<FriendAppearance>;
  /**
   * Upserts the `friends` row for a freshly bound Friend (first sight starts whole, anchored now) and returns its view.
   * Called only after the fresh-block eligibility check passed.
   */
  onBound(binding: FriendBinding): Promise<FriendView>;
  /** Public state of a known Friend with scars settled at `now`, or null if the server has never seen it. */
  publicState(tokenId: TokenIdStr): Promise<FriendPublic | null>;
}

/** Gold Pixels held, read live from the seed-pack inventory (D-13; SDK inventory index = outcome id - 1). */
function goldFromInventory(inventory: Json | undefined): number {
  if (!Array.isArray(inventory)) return 0;
  const held = inventory[GOLD_PIXEL_OUTCOME_ID - 1];
  const n = typeof held === "string" ? Number(held) : typeof held === "number" ? held : 0;
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** Creates the Friend view builder over the DB and chain. */
export function createFriendViews(deps: {
  readonly db: Executor;
  readonly chain: ChainClient;
  readonly config: Pick<ServerConfig, "economyMode">;
  readonly now: () => Date;
}): FriendViews {
  const reader = createGenerationSpriteReader(deps.chain);

  const appearance = async (tokenId: TokenIdStr): Promise<FriendAppearance> => {
    let sprites: Awaited<ReturnType<typeof reader.read>>;
    try {
      sprites = await reader.read(BigInt(tokenId));
    } catch {
      throw new HttpError(503, "internal", "Could not read this Friend's art on chain. Try again.", {
        reason: "rpc_error",
      });
    }
    return {
      tokenId,
      familyId: parseFamilyId(sprites.familyId),
      seed: sprites.seed,
      frames: fromSdkFrames(sprites.frames),
    };
  };

  const toPublic = async (row: Selectable<FriendsTable>): Promise<FriendPublic> => {
    const seedpack = await deps.db
      .selectFrom("seedpack_friend")
      .select("inventory")
      .where("token_id", "=", row.token_id)
      .executeTakeFirst();
    const goldHeld = goldFromInventory(seedpack?.inventory);
    const now = deps.now().getTime();
    const stored = { lost: row.lost, updatedAt: row.scar_updated_at.getTime(), version: row.scar_version };
    return {
      tokenId: row.token_id,
      scars: settleScars(stored, now, row.token_id, { goldHeld }),
      goldHeld,
      glowCracks: row.glow_cracks,
      streak: row.streak,
      lastSeen: row.last_seen.getTime(),
      economy: deps.config.economyMode,
    };
  };

  return {
    appearance,
    async onBound(binding) {
      const art = await appearance(binding.tokenId);
      const now = deps.now();
      const row = await deps.db
        .insertInto("friends")
        .values({
          token_id: binding.tokenId,
          family_id: art.familyId,
          seed: art.seed,
          tba: binding.tba,
          last_owner: binding.address,
          scar_updated_at: now,
          last_seen: now,
          created_at: now,
        })
        .onConflict((oc) =>
          oc.column("token_id").doUpdateSet({ tba: binding.tba, last_owner: binding.address, last_seen: now }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      return { appearance: art, pub: await toPublic(row), loaned: false };
    },
    async publicState(tokenId) {
      const row = await deps.db.selectFrom("friends").selectAll().where("token_id", "=", tokenId).executeTakeFirst();
      return row ? toPublic(row) : null;
    },
  };
}
