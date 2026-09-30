/**
 * RF economy: constants, actions, quotes and receipts, plus the Bits soft-currency rules.
 *
 * Units: all RF amounts are integer micro-RF (1e-6 RF). On-chain amounts are 18-decimal wei, so 1 micro-RF = 1e12 wei;
 * `microToWei` / `weiToMicro` convert exactly. Splits round exactly like `PixelSplitter.sol` so the simulated ledger and
 * a live deployment agree to the wei.
 */
import { popcount } from "./bitmap.js";
import {
  GOLD_REGROWTH_BONUS_BPS,
  GOLD_REGROWTH_MAX_COUNT,
  MEND_MICRO_PER_PX,
  REGROW_MICRO_PER_PX,
  REGROWTH_MS_PER_PX,
  SEED_PACK_PRICE_MICRO,
  SIM_DAILY_GRANT_MICRO,
  SIM_START_MICRO,
} from "./economy.generated.js";
import type { ScarState } from "./friend.js";
import { type Hex64, isTokenIdStr, parseHex64, type TokenIdStr } from "./ids.js";
import { assertNever } from "./util.js";

/** Basis points in 100 %. */
export const BPS = 10_000;

/** Economy constants (architecture §2.1 shape, plus the Mend, Gold perk and cap values tokenomics.md fixes). */
export const ECON = Object.freeze({
  /** Regrow price per pixel (micro-RF). */
  regrowMicroPerPx: REGROW_MICRO_PER_PX,
  /** Mend price per pixel (micro-RF); always >= 2x Regrow. */
  mendMicroPerPx: MEND_MICRO_PER_PX,
  /** Share of every Regrow and Mend that is burned. */
  burnBps: 5000,
  /** Share of a Regrow forwarded to the protocol active-Friends stream. */
  streamBps: 5000,
  /** Share of a Mend paid to the target Friend's ERC-6551 wallet. */
  targetBps: 5000,
  /** Base free-regrowth interval per pixel (ms), before the Gold perk. */
  regrowthMsPerPx: REGROWTH_MS_PER_PX,
  /** Free-regrowth speed bonus per held Gold Pixel (bps). */
  goldRegrowthBonusBps: GOLD_REGROWTH_BONUS_BPS,
  /** Held Gold Pixels beyond this count add no further bonus. */
  goldRegrowthMaxCount: GOLD_REGROWTH_MAX_COUNT,
  /** Simulated-mode starting balance per Friend (micro-RF). */
  simStartMicro: SIM_START_MICRO,
  /** Simulated-mode daily grant per Friend (micro-RF). */
  simDailyGrantMicro: SIM_DAILY_GRANT_MICRO,
  /** Seed Pack price (micro-RF). */
  seedPackPriceMicro: SEED_PACK_PRICE_MICRO,
  /** Upper bound of pixels in one Regrow/Mend (PixelSplitter `MAX_PX`). */
  maxPxPerAction: 256,
  /** Pixels a Friend may receive from strangers' Mends per UTC day (tokenomics F2, <= 12 RF/day). */
  mendReceivedDailyPxCap: 24,
  /** Individually delivered Mend notifications per recipient per day; the rest are batched (GDD §5.3). */
  mendNotifyDailyCap: 20,
  /** A quote locks its pixels against free regrowth for this long (tokenomics §5.3). */
  quoteLockMs: 15 * 60 * 1000,
  /** Planting a seed regrows +20 % bonus pixels, rounded down (tokenomics §0). */
  plantBonusBps: 2000,
} as const);

// Invariants tokenomics depends on; checked once at module load so a bad regeneration fails loudly.
if (ECON.burnBps + ECON.streamBps !== BPS || ECON.burnBps + ECON.targetBps !== BPS) {
  throw new Error("Economy splits must total 100 %.");
}
if (ECON.mendMicroPerPx < 2 * ECON.regrowMicroPerPx) throw new Error("Mend must cost at least 2x Regrow.");

/** 1 micro-RF in wei (18-decimal base units). */
export const WEI_PER_MICRO = 1_000_000_000_000n;
/** 1 RF in micro-RF. */
export const MICRO_PER_RF = 1_000_000;

/** Where an amount is accounted: the server's simulated ledger or real on-chain RF. */
export type EconomyMode = "sim" | "live";

/** An RF spend. `pixels` names the exact missing pixels to fill; its popcount is the billed pixel count. */
export type EconomyAction =
  | { kind: "regrow"; tokenId: TokenIdStr; pixels: Hex64 }
  | { kind: "mend"; payer: TokenIdStr; target: TokenIdStr; pixels: Hex64 };

/** A priced action. `burnMicro + streamMicro + toTargetMicro === totalMicro`, all non-negative integers. */
export interface EconomyQuote {
  action: EconomyAction;
  totalMicro: number;
  burnMicro: number;
  streamMicro: number;
  toTargetMicro: number;
  mode: EconomyMode;
}

/** The server's record of an executed action: the quote it recomputed, the resulting scars and the payer's balance. */
export interface EconomyReceipt {
  id: string;
  quote: EconomyQuote;
  scars: ScarState;
  /** Payer's simulated balance after the debit (sim mode only). */
  balanceMicro?: number;
  /** Verified transaction hash (live mode only). */
  txHash?: `0x${string}`;
}

/** Why an action cannot be quoted; thrown as `EconomyError.code`. */
export type EconomyErrorCode = "no_pixels" | "too_many_pixels" | "bad_token" | "bad_mask" | "self_mend";

/** Error thrown by `quote()` for an unquotable action. */
export class EconomyError extends Error {
  /** Machine-readable reason, safe to return to the client. */
  readonly code: EconomyErrorCode;
  constructor(code: EconomyErrorCode, message: string) {
    super(message);
    this.name = "EconomyError";
    this.code = code;
  }
}

/** Number of pixels an action bills, after validating the mask (throws `EconomyError`). */
export function actionPixelCount(action: EconomyAction): number {
  let mask: Hex64;
  try {
    mask = parseHex64(action.pixels);
  } catch {
    throw new EconomyError("bad_mask", "Pixels must be a 64-char hex mask.");
  }
  const px = popcount(mask);
  if (px === 0) throw new EconomyError("no_pixels", "Select at least one missing pixel.");
  if (px > ECON.maxPxPerAction) throw new EconomyError("too_many_pixels", "Too many pixels in one action.");
  return px;
}

/**
 * Prices an action. Pure and deterministic: the server always recomputes it and never trusts a client quote.
 * Regrow: 50 % stream (rounded down) / rest burned. Mend: 50 % burned (rounded down) / rest to the target Friend.
 * Throws `EconomyError` for 0 or > 256 pixels, a malformed mask or token id, or a Mend whose payer is its target.
 */
export function quote(action: EconomyAction, mode: EconomyMode = "sim"): EconomyQuote {
  const px = actionPixelCount(action);
  switch (action.kind) {
    case "regrow": {
      if (!isTokenIdStr(action.tokenId)) throw new EconomyError("bad_token", "Invalid token id.");
      const totalMicro = px * ECON.regrowMicroPerPx;
      const streamMicro = Math.floor((totalMicro * ECON.streamBps) / BPS);
      return { action, totalMicro, burnMicro: totalMicro - streamMicro, streamMicro, toTargetMicro: 0, mode };
    }
    case "mend": {
      if (!isTokenIdStr(action.payer) || !isTokenIdStr(action.target)) {
        throw new EconomyError("bad_token", "Invalid token id.");
      }
      if (action.payer === action.target) throw new EconomyError("self_mend", "Use Regrow for your own Friend.");
      const totalMicro = px * ECON.mendMicroPerPx;
      const burnMicro = Math.floor((totalMicro * ECON.burnBps) / BPS);
      return { action, totalMicro, burnMicro, streamMicro: 0, toTargetMicro: totalMicro - burnMicro, mode };
    }
    default:
      return assertNever(action);
  }
}

/** The token whose RF pays for an action (the Regrow owner or the Mend payer). */
export function payerOf(action: EconomyAction): TokenIdStr {
  switch (action.kind) {
    case "regrow":
      return action.tokenId;
    case "mend":
      return action.payer;
    default:
      return assertNever(action);
  }
}

/** The token whose scars an action heals (the Regrow owner or the Mend target). */
export function subjectOf(action: EconomyAction): TokenIdStr {
  switch (action.kind) {
    case "regrow":
      return action.tokenId;
    case "mend":
      return action.target;
    default:
      return assertNever(action);
  }
}

/**
 * Free-regrowth interval per pixel for a Friend holding `goldHeld` Gold Pixels: base / (1 + 0.25 * min(gold, 2)),
 * floored to whole ms. Non-integer or negative `goldHeld` counts as 0 whole Golds below it (floored, clamped at 0).
 */
export function regrowthMsPerPx(goldHeld: number): number {
  const gold = Math.min(Math.max(0, Math.floor(Number.isFinite(goldHeld) ? goldHeld : 0)), ECON.goldRegrowthMaxCount);
  return Math.floor((ECON.regrowthMsPerPx * BPS) / (BPS + gold * ECON.goldRegrowthBonusBps));
}

/** Pixels a redeemed seed reward of `rewardMicro` plants: floor(reward / Regrow price) plus a floored +20 % bonus. */
export function plantPixels(rewardMicro: number): number {
  if (!Number.isSafeInteger(rewardMicro) || rewardMicro < 0)
    throw new RangeError("Reward must be a non-negative integer.");
  const paid = Math.floor(rewardMicro / ECON.regrowMicroPerPx);
  return Math.min(ECON.maxPxPerAction, paid + Math.floor((paid * ECON.plantBonusBps) / BPS));
}

/** Converts micro-RF to an exact 18-decimal wei decimal string (the SDK / `rf_ledger` audit format). */
export function microToWei(micro: number): string {
  if (!Number.isSafeInteger(micro) || micro < 0) throw new RangeError("Micro-RF must be a non-negative safe integer.");
  return (BigInt(micro) * WEI_PER_MICRO).toString(10);
}

/** Converts a wei decimal string (or bigint) to micro-RF; throws `RangeError` if not a whole micro-RF or not JS-safe. */
export function weiToMicro(wei: string | bigint): number {
  let v: bigint;
  if (typeof wei === "bigint") v = wei;
  else if (/^[0-9]+$/.test(wei)) v = BigInt(wei);
  else throw new RangeError("Wei amounts must be decimal base-unit strings.");
  if (v < 0n || v % WEI_PER_MICRO !== 0n) throw new RangeError("Wei amount is not a whole micro-RF.");
  const micro = v / WEI_PER_MICRO;
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Amount exceeds the safe micro-RF range.");
  return Number(micro);
}

/** Formats micro-RF as a decimal RF string with `decimals` fraction digits, rounding down (e.g. 1_500_000 -> "1.50"). */
export function formatMicroRf(micro: number, decimals = 2): string {
  if (!Number.isSafeInteger(micro)) throw new RangeError("Micro-RF must be a safe integer.");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) throw new RangeError("Decimals must be 0..6.");
  const sign = micro < 0 ? "-" : "";
  const abs = Math.abs(micro);
  const whole = Math.floor(abs / MICRO_PER_RF);
  const frac = String(abs % MICRO_PER_RF)
    .padStart(6, "0")
    .slice(0, decimals);
  return decimals === 0 ? `${sign}${whole}` : `${sign}${whole}.${frac}`;
}

// ── Bits (soft currency, tokenomics §7). Account-bound, never bought with or converted to RF. ──

/** Bits earning rules, catalog price points and caps, as data (tokenomics §7). */
export const BITS = Object.freeze({
  /** Bits for any completed venue run. */
  runBase: 10,
  /** Maximum skill bonus per run (fewer pixels lost earns more). */
  runSkillMax: 20,
  /** Bonus for the account's first run of the UTC day. */
  firstRunOfDay: 50,
  /** Earned Bits per account per UTC day are paid at 100 % up to this total... */
  dailyFullRateCap: 250,
  /** ...then at this rate (bps)... */
  dailyTaperRateBps: 2500,
  /** ...up to this total, and 0 after. Shared by all venues; adding venues never raises it. */
  dailyHardCap: 500,
  /** Catalog items cost between these bounds. */
  catalogMin: 150,
  catalogMax: 2500,
  /** Island plot prices, in purchase order. */
  islandPlots: [1000, 2000, 4000, 8000, 16000],
  /** Bits blueprints required for the 10 RF and 25 RF crafted decor pieces. */
  craftedBlueprints: { rf10: 1000, rf25: 2500 },
  /** One-time guest-to-owner Bits claim on first wallet connect. */
  guestClaimCap: 500,
} as const);

/** RF decor price tiers in micro-RF (2 / 5 / 10 / 25 RF), split 50/50 burn/stream like Regrow. */
export const RF_DECOR_TIERS_MICRO = Object.freeze([2_000_000, 5_000_000, 10_000_000, 25_000_000] as const);

/** Raw Bits for one completed run before the daily cap: base + clamped skill + first-run bonus. */
export function runBits(skill: number, firstRunOfDay: boolean): number {
  const s = Math.min(BITS.runSkillMax, Math.max(0, Math.floor(Number.isFinite(skill) ? skill : 0)));
  return BITS.runBase + s + (firstRunOfDay ? BITS.firstRunOfDay : 0);
}

/**
 * Bits actually credited for `raw` new Bits when the account already earned `earnedToday` (credited) Bits today.
 * Full rate up to 250/day, 25 % (floored) up to 500/day, 0 after. Monotone, never negative, never exceeds `raw`.
 */
export function capBits(earnedToday: number, raw: number): number {
  let today = Math.max(0, Math.floor(earnedToday));
  let left = Math.max(0, Math.floor(raw));
  let credited = 0;
  // Full-rate tier.
  const full = Math.min(left, Math.max(0, BITS.dailyFullRateCap - today));
  credited += full;
  today += full;
  left -= full;
  // Tapered tier: every raw Bit is worth 0.25; the credited total may not pass the hard cap.
  if (left > 0 && today < BITS.dailyHardCap) {
    credited += Math.min(Math.floor((left * BITS.dailyTaperRateBps) / BPS), BITS.dailyHardCap - today);
  }
  return credited;
}
