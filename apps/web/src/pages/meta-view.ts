/**
 * Pure helpers for the meta pages (catalog, home isle, stamp book, belts). The server is authoritative for every rule;
 * these only explain on screen what it will say (a locked item, a stamp's progress, what is left to place).
 */
import {
  beltDef,
  beltRank,
  type BeltId,
  type CatalogItem,
  type HomeLayout,
  type MetaStats,
  type StampDef,
  stampDef,
} from "@pl/shared";

/** Why `item` can't be bought yet (its stamp or belt is missing), or null when it is unlocked. */
export function unlockProblem(item: CatalogItem, heldStamps: ReadonlySet<string>, belt: BeltId | null): string | null {
  if (!item.unlock) return null;
  if ("stamp" in item.unlock) {
    if (heldStamps.has(item.unlock.stamp)) return null;
    return `earn the ${stampDef(item.unlock.stamp)?.name ?? item.unlock.stamp} stamp`;
  }
  if (belt !== null && beltRank(belt) >= beltRank(item.unlock.belt)) return null;
  return `earn the ${beltDef(item.unlock.belt)?.name.toLowerCase() ?? item.unlock.belt} belt`;
}

/** Progress toward a cumulative-stat stamp (`have` capped at `need`), or null for single-run stamps. */
export function stampProgress(def: StampDef, stats: MetaStats): { have: number; need: number } | null {
  if (!("stat" in def.rule)) return null;
  const v = stats[def.rule.stat];
  const have = Array.isArray(v) ? v.length : typeof v === "number" ? v : 0;
  return { have: Math.min(have, def.rule.atLeast), need: def.rule.atLeast };
}

/** A belt colour (0xRRGGBB) as CSS. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Copies of each item still free to place: owned minus already placed (never negative). */
export function unplaced(owned: Readonly<Record<string, number>>, layout: HomeLayout): Record<string, number> {
  const left: Record<string, number> = { ...owned };
  for (const p of layout.items) left[p.item] = Math.max(0, (left[p.item] ?? 0) - 1);
  return left;
}
