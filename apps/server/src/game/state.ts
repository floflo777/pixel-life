import {
  EMPTY_MASK,
  GOLD_PIXEL_OUTCOME_ID,
  STITCH_VISIBLE_MS,
  or,
  type Hex64,
  type ScarState,
  type StitchRecord,
  type TokenIdStr,
} from "@pl/shared";
import type { Selectable } from "kysely";
import type { FriendsTable, Json } from "../db/schema.js";
import type { Executor } from "../repos/index.js";

/** A `friends` row. */
export type FriendRow = Selectable<FriendsTable>;

/** Gold Pixels held, read live from a seed-pack inventory (D-13; SDK inventory index = outcome id − 1). */
export function goldFromInventory(inventory: Json | undefined): number {
  if (!Array.isArray(inventory)) return 0;
  const held = inventory[GOLD_PIXEL_OUTCOME_ID - 1];
  const n = typeof held === "string" ? Number(held) : typeof held === "number" ? held : 0;
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** Gold Pixels the Friend holds right now. */
export async function goldHeldOf(db: Executor, tokenId: TokenIdStr): Promise<number> {
  const row = await db
    .selectFrom("seedpack_friend")
    .select("inventory")
    .where("token_id", "=", tokenId)
    .executeTakeFirst();
  return goldFromInventory(row?.inventory);
}

/** Union of pixels locked by open (unconsumed, unexpired) paid quotes: free regrowth skips them (tokenomics §5.3). */
export async function activeLocks(db: Executor, tokenId: TokenIdStr, now: Date): Promise<Hex64> {
  const rows = await db
    .selectFrom("economy_quotes")
    .select("pixels")
    .where("subject_token", "=", tokenId)
    .where("consumed_at", "is", null)
    .where("locked_until", ">", now)
    .execute();
  return rows.reduce<Hex64>((m, r) => or(m, r.pixels), EMPTY_MASK);
}

/** Mend stitch records young enough to still show (`visibleStitches` filters them again by presence). */
export async function stitchRecords(db: Executor, tokenId: TokenIdStr, now: Date): Promise<StitchRecord[]> {
  const rows = await db
    .selectFrom("stitches")
    .select(["pixels", "at"])
    .where("target_token", "=", tokenId)
    .where("at", ">", new Date(now.getTime() - STITCH_VISIBLE_MS))
    .execute();
  return rows.map((r) => ({ pixels: r.pixels, at: r.at.getTime() }));
}

/** The stored (unsettled) scar state of a row. */
export function storedScars(row: Pick<FriendRow, "lost" | "scar_updated_at" | "scar_version">): ScarState {
  return { lost: row.lost, updatedAt: row.scar_updated_at.getTime(), version: row.scar_version };
}

/** Reads a Friend row, optionally locking it for the rest of the transaction. */
export async function readFriend(db: Executor, tokenId: TokenIdStr, forUpdate = false): Promise<FriendRow | null> {
  let q = db.selectFrom("friends").selectAll().where("token_id", "=", tokenId);
  if (forUpdate) q = q.forUpdate();
  return (await q.executeTakeFirst()) ?? null;
}

/**
 * Compare-and-swap write of a Friend's scars (architecture §4.2): succeeds only if nobody wrote since `expectedVersion`
 * was read. `next.version` must be `expectedVersion + 1` (the shared scar functions guarantee it).
 */
export async function casWriteScars(
  db: Executor,
  tokenId: TokenIdStr,
  expectedVersion: number,
  next: ScarState,
): Promise<boolean> {
  if (next.version !== expectedVersion + 1) throw new Error("scar versions advance by exactly one per write");
  const result = await db
    .updateTable("friends")
    .set({ lost: next.lost, scar_version: next.version, scar_updated_at: new Date(next.updatedAt) })
    .where("token_id", "=", tokenId)
    .where("scar_version", "=", expectedVersion)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
