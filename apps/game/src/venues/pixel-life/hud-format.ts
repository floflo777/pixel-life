/**
 * HUD copy and number formatting (GDD §6.3, art bible §6). Pure, so every string the HUD shows is unit-tested.
 * UI rule: labels lowercase mono, numbers Silkscreen; the CSS handles the case of display text.
 */
import { RUN_TICKS, SIM_HZ } from "@pl/shared";

/** Blocks in the top timer bar (one per second). */
export const TIMER_BLOCKS = 60;
/** Blocks in the sweep-back bar (one per 0.2 s of the 2.0 s grab window). */
export const SWEEP_BLOCKS = 10;
/** Ticks per sweep block. */
export const SWEEP_BLOCK_TICKS = Math.round(0.2 * SIM_HZ);

/** "1 240": digits grouped by three with a space (the frame-1 score card). Negative scores keep their sign. */
export function formatScore(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return v < 0 ? `−${s}` : s;
}

/** Remaining run time as "m:ss", from the sim tick. Rounds up so "0:01" shows until the last tick. */
export function formatClock(tick: number, runTicks: number = RUN_TICKS): string {
  const left = Math.max(0, Math.ceil((runTicks - Math.max(0, tick)) / SIM_HZ));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

/** Filled timer blocks (seconds left, stepped). */
export function timerBlocks(tick: number, runTicks: number = RUN_TICKS): number {
  return Math.max(0, Math.min(TIMER_BLOCKS, Math.ceil((runTicks - Math.max(0, tick)) / SIM_HZ)));
}

/** "76/82 px". */
export function formatPx(present: number, total: number): string {
  return `${Math.max(0, present)}/${Math.max(0, total)} px`;
}

/** Filled sweep blocks for the most urgent loose pixel (0 when none). Empties one block per 0.2 s. */
export function sweepBlocks(leftTicks: number | null): number {
  if (leftTicks === null || !(leftTicks > 0)) return 0;
  return Math.min(SWEEP_BLOCKS, Math.ceil(leftTicks / SWEEP_BLOCK_TICKS));
}

/** Seconds left as "1.45" (the sweep bar's readout). */
export function formatSeconds(ticks: number | null): string {
  if (ticks === null || !(ticks > 0)) return "0.00";
  return (ticks / SIM_HZ).toFixed(2);
}

/** "4 loose · grab!" (the lime pill); empty when nothing is loose. */
export function looseLabel(n: number): string {
  return n > 0 ? `${n} loose · grab!` : "";
}

/** Chain multiplier from tenths: 13 → "×1.3", 20 → "×2". */
export function chainLabel(tenths: number): string {
  const t = Math.max(10, Math.round(tenths));
  return `×${t % 10 === 0 ? String(t / 10) : (t / 10).toFixed(1)}`;
}

/** Chain pips lit (10 pips from ×1.0 to ×2.0). */
export function chainPips(tenths: number): number {
  return Math.max(0, Math.min(10, Math.round(tenths) - 10));
}

/** Callout tones: coral = loss, paper = points, lime = act now. */
export type CalloutTone = "coral" | "paper" | "lime" | "ink";

/** A stepped pop-up at a world point. */
export interface Callout {
  readonly text: string;
  readonly tone: CalloutTone;
  /** Size multiplier (combo growth). */
  readonly scale?: number;
}

/** "−4 px" for a bite. */
export function lossCallout(px: number): Callout {
  return { text: `−${Math.max(1, px)} px`, tone: "coral" };
}

/** Pop points: "bonk! +120" for a big hit, "+10" otherwise; "air pop" etc. are passed as `label`. */
export function popCallout(points: number, label?: string): Callout {
  const p = Math.max(0, Math.round(points));
  if (label) return { text: `${label} +${p}`, tone: "paper" };
  return { text: p >= 100 ? `bonk! +${p}` : `+${p}`, tone: "paper" };
}

/** Grab-back: "+1 px", or "clutch +25". */
export function grabCallout(clutch: boolean): Callout {
  return clutch ? { text: "clutch +25", tone: "lime" } : { text: "+1 px", tone: "paper" };
}

/** Where the results-screen headline comes from. */
export type EndReason = "time" | "crumble";

/** Results headline (GDD §6.4). */
export function resultsHeadline(reason: EndReason, arena: string, gulpMood: number): string {
  const mood = ["hungry", "sleepy", "grumpy"][gulpMood] ?? "hungry";
  const head = reason === "crumble" ? "needs a nap" : "run over";
  return `${head} · ${arena} · gulp: ${mood}`;
}

/** Wave phase names for the phase banner. */
export const PHASE_NAMES = ["drop-in", "snack time", "rush", "frenzy", "last light"] as const;

/** Phase banner text, or null for the silent drop-in. */
export function phaseBanner(phase: number): string | null {
  if (phase <= 0) return null;
  return PHASE_NAMES[phase] ?? null;
}

/** Micro-RF as "2.00 RF". */
export function formatRf(micro: number): string {
  return `${(Math.max(0, micro) / 1_000_000).toFixed(2)} RF`;
}

/** Free-regrowth ETA as "2h 00m" (from ms). */
export function formatEta(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60_000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
