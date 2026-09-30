import { andNot, isSubset, popcount, regrowthMsPerPx, type Hex64 } from "@pl/shared";

/**
 * The Friend a run is replayed against (`SimConfig.friend.lost`). The client starts a run with the scars it saw at run
 * start; the server otherwise rebuilds them at submission, up to a minute later. A pixel that regrew during the run, or
 * a pixel the client showed as healed while a paid quote's lock kept it lost on the server, would make an honest run
 * replay as a mismatch. So a submission may carry `startLost` + `startedAt`, used for the replay only when plausible.
 * Scars are always applied against the server's own state, whatever the replay starts from.
 */

/** How old a run start may be (a run lasts about a minute; this leaves room for slow networks and retries). */
export const START_MAX_AGE_MS = 10 * 60_000;
/** Client clocks may run a little ahead of the server's. */
export const START_CLOCK_SKEW_MS = 30_000;

/** What the server knows at submission, to judge a claimed start. */
export interface StartCheck {
  /** Claimed scars at run start. */
  readonly startLost: Hex64;
  /** Claimed run start (epoch ms, client clock). */
  readonly startedAt: number;
  /** Server time of the submission (epoch ms). */
  readonly now: number;
  /** The Friend's front mask (scars never leave it). */
  readonly front: Hex64;
  /** The server's effective scars at submission. */
  readonly lostNow: Hex64;
  /** Pixels held lost by open paid-quote locks (regrowth skips them; the client cannot see them). */
  readonly locked: Hex64;
  /** Gold Pixels held (free-regrowth speed). */
  readonly goldHeld: number;
  /** Pixels restored by paid Regrows / Mends of this Friend since `startedAt`. */
  readonly paidRestoredPx: number;
}

/**
 * True when `startLost` could really have been the Friend's scars at `startedAt`:
 * - `startedAt` is within the last {@link START_MAX_AGE_MS} (and not in the future beyond clock skew);
 * - `startLost` stays inside the front mask;
 * - every pixel lost now was already lost at start (scars only grow through runs), except pixels under a lock, which
 *   the client may show as healed;
 * - the pixels that healed since start are no more than free regrowth over the window (+1 for a partial interval)
 *   plus the pixels paid Regrows / Mends restored in it.
 * Otherwise the server replays from its own state (the pre-existing behaviour).
 */
export function plausibleStartLost(c: StartCheck): boolean {
  if (!Number.isSafeInteger(c.startedAt)) return false;
  if (c.startedAt < c.now - START_MAX_AGE_MS || c.startedAt > c.now + START_CLOCK_SKEW_MS) return false;
  if (!isSubset(c.startLost, c.front)) return false;
  if (!isSubset(andNot(c.lostNow, c.locked), c.startLost)) return false;
  const healed = popcount(andNot(c.startLost, c.lostNow));
  const window = Math.max(0, c.now - c.startedAt);
  const freeBudget = Math.floor(window / regrowthMsPerPx(c.goldHeld)) + 1;
  return healed <= freeBudget + Math.max(0, c.paidRestoredPx);
}
