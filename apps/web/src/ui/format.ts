/** Display formatting for RF amounts, durations and ranks. Pure; mirrors the ledger's round-down rule. */
import { BPS, formatMicroRf } from "@pl/shared";

/** "1.50 RF" from micro-RF, rounded down like the ledger. */
export function formatRf(micro: number, decimals = 2): string {
  return `${formatMicroRf(micro, decimals)} RF`;
}

/** "3h 10m", "12m", "45s": coarse duration for heal timers. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** "12:04" (m:ss) or "1:02:03" (h:mm:ss): countdown clocks. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Percent from basis points with up to 2 decimals, trailing zeros trimmed: 5600 → "56 %", 1040 → "10.4 %". */
export function formatBps(bps: number): string {
  const v = (bps * 100) / BPS;
  return `${Number(v.toFixed(2))} %`;
}

/** "3 410": the brand groups thousands with spaces. */
export function formatInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** "0x12ab…cdef" for long hashes and addresses. */
export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

/** "5 min ago", "2 h ago", "3 d ago" relative to `now`. */
export function formatAgo(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
