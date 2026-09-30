import { formatMicroRf } from "@pl/shared";

/** "3h 10m", "12m", "45s" — coarse duration for heal timers. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** "12:04" (mm:ss) or "1:02:03" (h:mm:ss) — countdown clocks. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "1.50 RF" from micro-RF (rounded down, like the ledger). */
export function formatRf(micro: number, decimals = 2): string {
  return `${formatMicroRf(micro, decimals)} RF`;
}

/** "0x12ab…cdef" */
export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** "3 410" — thin grouping for scores (the brand uses spaces, not commas). */
export function formatScore(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Percent with 2 decimals from basis points: 5600 → "56.00 %". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)} %`;
}

/** Today's UTC day `YYYY-MM-DD`. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
