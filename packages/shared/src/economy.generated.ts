/**
 * Tunable economy numbers. Architecture §2 says `tools/econ-sim` (T10) regenerates this file; until it exists, these values
 * are transcribed by hand from docs/design/tokenomics/tokenomics.md §0 "Final prices" (2026-09-30).
 * Amounts are micro-RF (1 micro-RF = 1e-6 RF = 1e12 wei) so every balance stays a JS-safe integer.
 * Keep the exported names stable: `economy.ts` builds `ECON` from them and tests pin their relationships.
 */

/** Regrow price: 0.5 RF per pixel (tokenomics §0). */
export const REGROW_MICRO_PER_PX = 500_000;
/** Mend price: 1.0 RF per pixel, 2x Regrow so alt self-Mend is never cheaper (tokenomics §0, change 1). */
export const MEND_MICRO_PER_PX = 1_000_000;
/** Free regrowth base rate: 0.5 px/hour, i.e. one pixel every 2 hours (tokenomics §2). */
export const REGROWTH_MS_PER_PX = 7_200_000;
/** Gold Pixel perk: +25 % free regrowth speed per held Gold Pixel (tokenomics §4). */
export const GOLD_REGROWTH_BONUS_BPS = 2_500;
/** Gold Pixel perk counts at most this many held Gold Pixels (x1.5 max; tokenomics §4). */
export const GOLD_REGROWTH_MAX_COUNT = 2;
/**
 * Simulated-mode starting balance per Friend. Not specified by tokenomics.md: set to 20 RF, the same amount the
 * FriendSDK preview ledger starts with (`game-host.tsx:191-196`), so SDK previews and our ledger feel alike.
 */
export const SIM_START_MICRO = 20_000_000;
/** Simulated-mode daily grant per Friend. Not specified by tokenomics.md: 5 RF = one Seed Pack or 10 px of Regrow a day. */
export const SIM_DAILY_GRANT_MICRO = 5_000_000;
/** Seed Pack price: 5 RF (tokenomics §3, game.json). */
export const SEED_PACK_PRICE_MICRO = 5_000_000;
