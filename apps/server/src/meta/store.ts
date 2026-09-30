import {
  currentBelt,
  EMPTY_LAYOUT,
  homeLayoutSchema,
  homeTerraces,
  stampsXp,
  type HeldStamp,
  type HomeLayout,
  type HomeView,
  type StampId,
  type TokenIdStr,
} from "@pl/shared";
import { sql } from "kysely";
import type { Executor } from "../repos/index.js";
import { passedBelts } from "./hooks.js";
import { metaDb } from "./tables.js";

/** Stored isle row, parsed. */
export interface IsleRow {
  readonly layout: HomeLayout;
  readonly hat: string | null;
  readonly open: boolean;
  readonly generation: number | null;
  readonly plots: number;
  readonly version: number;
}

const DEFAULT_ISLE: IsleRow = { layout: EMPTY_LAYOUT, hat: null, open: false, generation: null, plots: 0, version: 0 };

/** A stored layout, re-checked for shape; a corrupt row reads as empty rather than crashing the public page. */
function parseLayout(raw: unknown): HomeLayout {
  const parsed = homeLayoutSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_LAYOUT;
}

/** The Friend's isle row (defaults when never saved). `lock` takes a row lock (the row must exist to be locked). */
export async function readIsle(db: Executor, tokenId: TokenIdStr, lock = false): Promise<IsleRow> {
  let q = metaDb(db).selectFrom("home_isles").selectAll().where("token_id", "=", tokenId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) return DEFAULT_ISLE;
  return {
    layout: parseLayout(row.layout),
    hat: row.hat,
    open: row.open,
    generation: row.generation,
    plots: row.plots,
    version: row.version,
  };
}

/** Ensures the isle row exists (so it can be locked) and returns it locked. */
export async function lockIsle(db: Executor, tokenId: TokenIdStr, now: Date): Promise<IsleRow> {
  await metaDb(db)
    .insertInto("home_isles")
    .values({ token_id: tokenId, layout: JSON.stringify(EMPTY_LAYOUT), hat: null, generation: null, updated_at: now })
    .onConflict((oc) => oc.column("token_id").doNothing())
    .execute();
  return readIsle(db, tokenId, true);
}

/** Writes the isle fields given (the row must exist) and bumps its version. */
export async function writeIsle(
  db: Executor,
  tokenId: TokenIdStr,
  patch: Partial<Omit<IsleRow, "version">>,
  now: Date,
): Promise<void> {
  await metaDb(db)
    .updateTable("home_isles")
    .set({
      ...(patch.layout ? { layout: JSON.stringify(patch.layout) } : {}),
      ...(patch.hat !== undefined ? { hat: patch.hat } : {}),
      ...(patch.open !== undefined ? { open: patch.open } : {}),
      ...(patch.generation !== undefined ? { generation: patch.generation } : {}),
      ...(patch.plots !== undefined ? { plots: patch.plots } : {}),
      version: sql<number>`version + 1`,
      updated_at: now,
    })
    .where("token_id", "=", tokenId)
    .execute();
}

/** Copies owned per item: the account wardrobe plus the Friend's RF decor. */
export async function ownedItems(db: Executor, account: string, tokenId: TokenIdStr): Promise<Record<string, number>> {
  const m = metaDb(db);
  const [wardrobe, decor] = await Promise.all([
    m.selectFrom("wardrobe_items").select(["item_id", "qty"]).where("account", "=", account.toLowerCase()).execute(),
    m.selectFrom("friend_decor").select(["item_id", "qty"]).where("token_id", "=", tokenId).execute(),
  ]);
  const owned: Record<string, number> = {};
  for (const r of [...wardrobe, ...decor]) owned[r.item_id] = (owned[r.item_id] ?? 0) + r.qty;
  return owned;
}

/** The public view of a Friend's isle: layout, hat, belt and stamp book. */
export async function homeView(db: Executor, tokenId: TokenIdStr): Promise<HomeView> {
  const m = metaDb(db);
  const [isle, stampRows, belts] = await Promise.all([
    readIsle(db, tokenId),
    m
      .selectFrom("stamps")
      .select(["stamp_id", "earned_at"])
      .where("token_id", "=", tokenId)
      .orderBy("earned_at")
      .orderBy("stamp_id")
      .execute(),
    passedBelts(db, tokenId),
  ]);
  const stamps: HeldStamp[] = stampRows.map((r) => ({ id: r.stamp_id as StampId, at: r.earned_at.getTime() }));
  return {
    tokenId,
    generation: isle.generation,
    plots: isle.plots,
    terraces: homeTerraces(isle.generation ?? 0, isle.plots),
    layout: isle.layout,
    hat: isle.hat,
    open: isle.open,
    belt: currentBelt(belts),
    stamps,
    stampXp: stampsXp(stamps.map((s) => s.id)),
  };
}
