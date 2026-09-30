/**
 * Bump Sumo presentation rules, pure and unit-tested: which real Friends enter the ring, fighter colours and labels,
 * juice per beat, callout strings and the results card model (Bits estimate included).
 */
import { BITS, familyName, runBits, sumoTrait, type FriendAppearance, type SumoStats } from "@pl/shared";
import type { JuicePlan } from "../pixel-life/juice";

/** Ring colour per fighter slot: you (signal lime), then coral, pond blue, lilac (art bible accents). */
export const FIGHTER_COLORS = [0xccff00, 0xed927e, 0x7db4db, 0xb3a0d8] as const;
/** CSS versions of `FIGHTER_COLORS`. */
export const FIGHTER_CSS = ["#CCFF00", "#ED927E", "#7DB4DB", "#B3A0D8"] as const;

/**
 * Picks the three rivals from the loaner pool: never the player's own token, distinct families first (so traits
 * differ), deterministic for a seed. Throws `RangeError` when fewer than three candidates exist.
 */
export function pickRivals(
  pool: readonly FriendAppearance[],
  playerTokenId: string,
  seed: number,
): [FriendAppearance, FriendAppearance, FriendAppearance] {
  const seen = new Set<string>();
  const cands = pool.filter((a) => {
    if (a.tokenId === playerTokenId || seen.has(a.tokenId)) return false;
    seen.add(a.tokenId);
    return true;
  });
  if (cands.length < 3) throw new RangeError("Bump Sumo needs at least three rival Friends.");
  // Seeded rotation (cosmetic choice, not gameplay-critical): LCG over the candidate order.
  let s = seed >>> 0 || 1;
  const order = cands.map((a, i) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return { a, k: s, i };
  });
  order.sort((p, q) => p.k - q.k || p.i - q.i);
  const picked: FriendAppearance[] = [];
  const fams = new Set<number>();
  for (const o of order) {
    if (picked.length < 3 && !fams.has(o.a.familyId)) {
      picked.push(o.a);
      fams.add(o.a.familyId);
    }
  }
  for (const o of order) if (picked.length < 3 && !picked.includes(o.a)) picked.push(o.a);
  const [a, b, c] = picked;
  if (!a || !b || !c) throw new RangeError("Bump Sumo needs at least three rival Friends.");
  return [a, b, c];
}

/** Card label of a fighter: "you" or "#tokenId", plus family and its sumo trait. */
export function fighterLabel(slot: number, a: FriendAppearance): { name: string; family: string; trait: string } {
  return {
    name: slot === 0 ? "you" : `#${a.tokenId}`,
    family: familyName(a.familyId).toLowerCase(),
    trait: sumoTrait(a.familyId).name,
  };
}

/** A beat the venue reacts to. `mine` = the player is involved (only then do full-frame impact frames fire). */
export type SumoBeat =
  | { readonly kind: "hit"; readonly power: number; readonly mine: boolean }
  | { readonly kind: "clash"; readonly mine: boolean }
  | { readonly kind: "bump" }
  | { readonly kind: "parry"; readonly mine: boolean }
  | { readonly kind: "ringout"; readonly mine: boolean }
  | { readonly kind: "quake" }
  | { readonly kind: "roundEnd" };

/** Hit-stop / slow-mo / shake per beat (power 0..1). Stronger when it's your hit or your fall. */
export function sumoPlan(b: SumoBeat): JuicePlan {
  switch (b.kind) {
    case "hit": {
      const p = Math.max(0, Math.min(1, b.power));
      const full = p >= 0.85;
      return {
        hitStopMs: Math.round(55 + 55 * p),
        trauma: (b.mine ? 0.25 : 0.12) + 0.35 * p,
        ...(full && b.mine ? { impactFrames: 2, punch: true } : {}),
        ...(full ? { slow: [{ scale: 0.4, ms: 220 }] } : {}),
      };
    }
    case "clash":
      return { hitStopMs: 130, trauma: 0.5, ...(b.mine ? { impactFrames: 2, punch: true } : {}) };
    case "bump":
      return { trauma: 0.06 };
    case "parry":
      return { hitStopMs: 110, trauma: 0.3, ...(b.mine ? { impactFrames: 1 } : {}) };
    case "ringout":
      return {
        slow: [
          { scale: b.mine ? 0.3 : 0.45, ms: 420 },
          { scale: 0.7, ms: 140 },
        ],
        trauma: b.mine ? 0.8 : 0.45,
        ...(b.mine ? { impactFrames: 2, dipMs: 400 } : {}),
      };
    case "quake":
      return { hitStopMs: 70, trauma: 0.6 };
    case "roundEnd":
      return { slow: [{ scale: 0.5, ms: 500 }] };
  }
}

/** Banner for the end of a round. */
export function roundEndBanner(winner: number, round: number): { text: string; tone: "lime" | "coral" | "paper" } {
  if (winner === 0) return { text: round === 2 ? "you take it!" : "round yours!", tone: "lime" };
  if (winner < 0) return { text: "nobody stands!", tone: "paper" };
  return { text: "round lost", tone: "coral" };
}

/** "1st", "2nd", ... */
export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** The results card, computed from the player's stats. */
export interface SumoResults {
  readonly headline: string;
  readonly place: string;
  readonly score: number;
  readonly stats: readonly (readonly [string, string])[];
  /** Bits the Sky should credit (the server has the final word, after its daily cap). */
  readonly bitsEstimate: number;
  readonly scarNote: string;
}

/** Builds the results model. Bump Sumo is scarless, so the skill part of the Bits formula is always full. */
export function buildSumoResults(stats: SumoStats, score: number, firstRunOfDay = false): SumoResults {
  const headline =
    stats.place === 1 ? "yokozuna!" : stats.place === 2 ? "so close!" : stats.wins > 0 ? "good bout!" : "next bout!";
  return {
    headline,
    place: ordinal(stats.place),
    score,
    stats: [
      ["place", `${ordinal(stats.place)} of 4`],
      ["rounds won", `${stats.wins}/3`],
      ["ring-outs", String(stats.kos)],
      ["grabbed back", `${stats.grabbed} px`],
      ["knocked off you", `${stats.knockedOff} px`],
      ["score", String(score)],
    ],
    bitsEstimate: runBits(BITS.runSkillMax, firstRunOfDay),
    scarNote: "scarless bout: every knocked-off pixel is back on your friend.",
  };
}
