/**
 * Art-bible palette (§1.1) and the few derived rules the UI needs as data: streak halo tiers (GDD §5.6) and the canvas
 * colours of the 2D Friend card. CSS mirrors these as `--pl-*` custom properties in `ui.css`.
 */

/** Exact palette hexes (colour management is off, so these are the pixels on screen). */
export const COLORS = Object.freeze({
  ink: "#111111",
  body: "#1D1B24",
  paper: "#EEEEEE",
  halo: "#F4F2EA",
  signal: "#CCFF00",
  meadow: "#B9D984",
  pond: "#7DB4DB",
  sun: "#F2CE68",
  gold: "#E8B530",
  goldSpec: "#FFF8E4",
  coral: "#ED927E",
  coralDark: "#D67A68",
  lilac: "#B3A0D8",
  tile: "#E6E1D2",
} as const);

/** A streak halo tier (GDD §5.6): paper 0–2, sun 3–6, coral 7–13, lilac 14–29, gold-white 30+. */
export interface StreakTier {
  /** 0..4, lowest to highest. */
  tier: 0 | 1 | 2 | 3 | 4;
  name: "paper" | "sun" | "coral" | "lilac" | "gold-white";
  /** Halo colour for the 2D portrait. */
  color: string;
  /** Day count at which this tier starts. */
  from: number;
}

const TIERS: readonly StreakTier[] = [
  { tier: 0, name: "paper", color: COLORS.halo, from: 0 },
  { tier: 1, name: "sun", color: COLORS.sun, from: 3 },
  { tier: 2, name: "coral", color: COLORS.coral, from: 7 },
  { tier: 3, name: "lilac", color: COLORS.lilac, from: 14 },
  { tier: 4, name: "gold-white", color: COLORS.goldSpec, from: 30 },
];

/** The halo tier for a Daily Run streak of `days` (negative or non-finite counts as 0). */
export function streakTier(days: number): StreakTier {
  const d = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  let out = TIERS[0] as StreakTier;
  for (const t of TIERS) if (d >= t.from) out = t;
  return out;
}

/** The next tier above `days`, or null at the top tier. */
export function nextStreakTier(days: number): StreakTier | null {
  const cur = streakTier(days);
  return TIERS[cur.tier + 1] ?? null;
}
