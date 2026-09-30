import {
  ECON,
  EMPTY_MASK,
  frontMask,
  settleScars,
  visibleStitches,
  type FriendAppearance,
  type FriendPublic,
  type FriendView,
  type TokenIdStr,
} from "@pl/shared";
import { sql } from "kysely";
import type { ChainClient } from "../chain/eligibility.js";
import type { ServerConfig } from "../config.js";
import { currentStreak, utcDay } from "../game/daily.js";
import { activeLocks, goldHeldOf, stitchRecords, storedScars, type FriendRow } from "../game/state.js";
import type { Executor } from "../repos/index.js";
import type { FriendBinding } from "../repos/index.js";
import { createAppearanceStore, type AppearanceStore } from "./appearance.js";

/** Builds the shared `FriendView` / `FriendPublic` DTOs (bind, `/api/me`, `/api/friends/:id/public`, sky). */
export interface FriendViews {
  /** Immutable art (in-process → Postgres → registry). 404 for unknown tokens, 503 on RPC failure. */
  appearance(tokenId: TokenIdStr): Promise<FriendAppearance>;
  /** The appearance cache itself (batch peeks). */
  readonly art: AppearanceStore;
  /**
   * Upserts the `friends` row for a freshly bound Friend (first sight starts whole, anchored now, with the simulated
   * starting balance) and returns its view. Called only after the fresh-block eligibility check passed.
   */
  onBound(binding: FriendBinding): Promise<FriendView>;
  /** Public state of a known Friend at `now`, or null if the server has never seen it. */
  publicState(tokenId: TokenIdStr): Promise<FriendPublic | null>;
  /** Public state from an already loaded row (and optionally its art, for stitches). */
  toPublic(row: FriendRow, art?: FriendAppearance | null): Promise<FriendPublic>;
  /** Full view of a known Friend, or null if unknown. */
  view(tokenId: TokenIdStr): Promise<FriendView | null>;
}

/** Creates the Friend view builder over the DB and chain. */
export function createFriendViews(deps: {
  readonly db: Executor;
  readonly chain: ChainClient;
  readonly config: Pick<ServerConfig, "economyMode" | "generationsAddress">;
  readonly now: () => Date;
  readonly art?: AppearanceStore;
}): FriendViews {
  const art = deps.art ?? createAppearanceStore({ ...deps, generations: deps.config.generationsAddress });

  /**
   * Effective public state: free regrowth settled with the live Gold count (D-13) and the open quote locks
   * (tokenomics §5.3); stitches via `visibleStitches` over the settled mask (needs the art's front mask).
   */
  const toPublic = async (row: FriendRow, appearance?: FriendAppearance | null): Promise<FriendPublic> => {
    const now = deps.now();
    const [goldHeld, locked, records] = await Promise.all([
      goldHeldOf(deps.db, row.token_id),
      activeLocks(deps.db, row.token_id, now),
      stitchRecords(deps.db, row.token_id, now),
    ]);
    const scars = settleScars(storedScars(row), now.getTime(), row.token_id, { goldHeld, locked });
    const pub: FriendPublic = {
      tokenId: row.token_id,
      scars,
      goldHeld,
      glowCracks: row.glow_cracks,
      streak: currentStreak(row.streak, row.streak_day, utcDay(now)),
      lastSeen: row.last_seen.getTime(),
      economy: deps.config.economyMode,
    };
    if (records.length > 0) {
      const a = appearance === undefined ? await art.get(row.token_id).catch(() => null) : appearance;
      if (a) {
        const stitched = visibleStitches(records, frontMask(a), scars.lost, now.getTime());
        if (stitched !== EMPTY_MASK) pub.stitched = stitched;
      }
    }
    return pub;
  };

  const readRow = (tokenId: TokenIdStr) =>
    deps.db.selectFrom("friends").selectAll().where("token_id", "=", tokenId).executeTakeFirst();

  return {
    art,
    appearance: (tokenId) => art.get(tokenId),
    toPublic,
    async onBound(binding) {
      const appearance = await art.get(binding.tokenId);
      const now = deps.now();
      const sim = deps.config.economyMode === "sim";
      const row = await deps.db
        .insertInto("friends")
        .values({
          token_id: binding.tokenId,
          family_id: appearance.familyId,
          seed: appearance.seed,
          tba: binding.tba,
          last_owner: binding.address,
          scar_updated_at: now,
          last_seen: now,
          created_at: now,
          // Simulated wallet: the starting balance counts as the first day's grant (ECON.simStartMicro).
          sim_rf_micro: sim ? ECON.simStartMicro : 0,
          sim_granted_day: sim ? utcDay(now) : null,
        })
        .onConflict((oc) =>
          oc.column("token_id").doUpdateSet({
            tba: binding.tba,
            last_owner: binding.address,
            last_seen: sql`GREATEST(friends.last_seen, excluded.last_seen)`,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      return { appearance, pub: await toPublic(row, appearance), loaned: false };
    },
    async publicState(tokenId) {
      const row = await readRow(tokenId);
      return row ? toPublic(row) : null;
    },
    async view(tokenId) {
      const row = await readRow(tokenId);
      if (!row) return null;
      const appearance = await art.get(tokenId);
      return { appearance, pub: await toPublic(row, appearance), loaned: false };
    },
  };
}
