import { createHmac } from "node:crypto";

const DAY_MS = 86_400_000;

/** UTC calendar day `YYYY-MM-DD` of `at`. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The day `n` days after `day` (negative for before), UTC. */
export function addDays(day: string, n: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
}

/** Next 00:00 UTC after `at`, in ms since epoch (`DailySeed.endsAt`). */
export function nextMidnightUtc(at: Date): number {
  return Date.parse(`${utcDay(at)}T00:00:00Z`) + DAY_MS;
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * Daily Run seed (architecture §4.3): the first 4 bytes of HMAC-SHA256(DAILY_SECRET, day), big-endian uint32.
 * Same for everyone on a given UTC day, unpredictable before it starts without the secret.
 */
export function dailySeed(day: string, secret: string): number {
  return createHmac("sha256", secret).update(`pixel-life/daily/${day}`).digest().readUInt32BE(0);
}

/** Lower bounds of the streak halo tiers (GDD §5.6: 0–2, 3–6, 7–13, 14–29, 30+). */
const STREAK_TIERS = [0, 3, 7, 14, 30] as const;

/** Streak after missing a day: drops exactly one tier, to that tier's lower bound (GDD §5.6: "not a reset"). */
export function streakAfterMiss(streak: number): number {
  let tier = 0;
  for (let i = 0; i < STREAK_TIERS.length; i++) if (streak >= (STREAK_TIERS[i] ?? 0)) tier = i;
  return STREAK_TIERS[Math.max(0, tier - 1)] ?? 0;
}

/**
 * Streak after a ranked Daily Run on `today`, given the stored streak and the last day it counted.
 * Same day: unchanged. Consecutive day: +1. Each fully missed day drops one tier first, then today counts.
 */
export function nextStreak(streak: number, lastDay: string | null, today: string): number {
  if (lastDay === null) return 1;
  const gap = daysBetween(lastDay, today);
  if (gap <= 0) return streak;
  let s = streak;
  for (let missed = 1; missed < gap && s > 0; missed++) s = streakAfterMiss(s);
  return s + 1;
}

/** Streak as shown today (public state): a stored streak whose days were missed has already dropped tiers. */
export function currentStreak(streak: number, lastDay: string | null, today: string): number {
  if (lastDay === null) return 0;
  const gap = daysBetween(lastDay, today);
  let s = streak;
  for (let missed = 1; missed < gap && s > 0; missed++) s = streakAfterMiss(s);
  return s;
}
