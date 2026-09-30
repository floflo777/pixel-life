/** Streak halo tiers (GDD §5.6): the Friend's paper halo is tinted by consecutive Daily Run days. */

/** Halo tier names, in order (they match the stage's `HaloTint` names). */
export type StreakTier = "halo" | "sun" | "coral" | "lilac" | "goldWhite";

/** The halo tier for a streak of `days`: 0–2 paper, 3–6 sun, 7–13 coral, 14–29 lilac, 30+ gold-white. */
export function streakTier(days: number): StreakTier {
  if (days >= 30) return "goldWhite";
  if (days >= 14) return "lilac";
  if (days >= 7) return "coral";
  if (days >= 3) return "sun";
  return "halo";
}

/** Human label for a tier ("coral halo"). */
export function streakLabel(days: number): string {
  const t = streakTier(days);
  return t === "halo" ? "paper halo" : t === "goldWhite" ? "gold-white halo" : `${t} halo`;
}
