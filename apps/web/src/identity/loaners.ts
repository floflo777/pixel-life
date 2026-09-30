/**
 * Loaned Friends for guests (D-11): the 12 real Friends baked at build time into `@pl/assets/loaners.json`. Loaded with a
 * dynamic import so the landing chunk stays small; guests never touch the SDK gated runtime or the chain.
 */
import type { LoanerFriend } from "@pl/assets";

export type { LoanerFriend };

let cache: Promise<LoanerFriend[]> | null = null;

/** Loads and validates the loaner roster once (throws `TypeError` if the baked file is malformed). */
export function loadLoaners(): Promise<LoanerFriend[]> {
  cache ??= Promise.all([import("@pl/assets/loaners.json"), import("@pl/assets")])
    .then(([json, { parseLoaners }]) => parseLoaners(json.default))
    .catch((e: unknown) => {
      cache = null;
      throw e;
    });
  return cache;
}

/** Days since the Unix epoch (UTC). */
export function dayNumber(now: number): number {
  return Math.floor(now / 86_400_000);
}

/** The loaner of the day ("rotated daily", GDD §6.2): a stable pick per UTC day. */
export function loanerOfTheDay(loaners: readonly LoanerFriend[], now: number): LoanerFriend {
  if (loaners.length === 0) throw new RangeError("No loaners.");
  const pick = loaners[dayNumber(now) % loaners.length];
  if (!pick) throw new RangeError("No loaners.");
  return pick;
}

/** Display name of a loaner: its label if it has one, else its token id. */
export function loanerName(l: LoanerFriend): string {
  return l.label ?? `#${l.appearance.tokenId}`;
}
