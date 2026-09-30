/**
 * Pixel Life rules shown as copy inside the booth.
 *
 * MIRROR of `@pl/shared` (ECON, plantPixelsForOutcome): the FriendSDK checker rejects sources outside the game
 * directory, so the sandboxed child cannot import the workspace package. tests/shared-parity.test.ts asserts every
 * value here (and game.json) equals @pl/shared, so a change there fails CI until this copy is updated.
 */

/** Pixels planted by redeeming outcome N (1-based) and spending it on Regrow, +20 % bonus rounded down. */
export const PLANT_PX: Readonly<Record<number, number>> = Object.freeze({ 1: 4, 2: 12, 3: 19 });

/** Free-regrowth speed-up per held Gold Pixel, in bps (2,500 = +25 %). */
export const GOLD_REGROWTH_BONUS_BPS = 2_500;

/** Held Gold Pixels that count towards the regrowth bonus. */
export const GOLD_REGROWTH_MAX_COUNT = 2;

/** The regrowth multiplier for one held Gold Pixel as display text ("1.25"). */
export function goldMultiplierText(): string {
  const value = 10_000 + GOLD_REGROWTH_BONUS_BPS;
  return `${Math.floor(value / 10_000)}.${(value % 10_000).toString().padStart(4, "0").replace(/0+$/, "")}`;
}
