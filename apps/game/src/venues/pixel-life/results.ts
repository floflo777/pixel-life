/**
 * Results card model (GDD §6.4): what the run cost, what it earned, and what the owner can do about it. Pure, so the
 * numbers on the card (kept pixels, scars, Bits, the regrow CTA) are unit-tested against `@pl/shared` rules.
 */
import {
  BITS,
  EMPTY_MASK,
  isEmpty,
  or,
  popcount,
  runBits,
  runScarCap,
  type Hex64,
  type RunAck,
  type RunKind,
  type RunSummary,
} from "@pl/shared";
import { resultsHeadline, type EndReason } from "./hud-format";

/** The rule line printed on the share card. */
export const RULE_LINE = "every hit knocks a pixel off. grab it back — or regrow it.";

/** Everything the results screen needs besides the host. */
export interface ResultsInput {
  readonly tokenId: string;
  readonly mode: "guest" | "owner";
  readonly loaned: boolean;
  readonly kind: RunKind;
  readonly arena: string;
  readonly gulpMood: number;
  readonly endReason: EndReason;
  /** The Friend's front mask and the scars it started the run with. */
  readonly front: Hex64;
  readonly startLost: Hex64;
  readonly summary: RunSummary;
  readonly bestCombo: number;
  readonly gulpBurped: boolean;
  /** First run of the UTC day for this account (the shell knows; default false). */
  readonly firstRunOfDay?: boolean;
  /** Daily seed day, for the share card. */
  readonly day?: string;
}

/** Share card payload (1200×630 PNG renderer + deep link). */
export interface ShareCardData {
  readonly tokenId: string;
  readonly score: number;
  readonly kept: number;
  readonly total: number;
  /** Scars after the run (holes on the silhouette). */
  readonly lost: Hex64;
  readonly front: Hex64;
  readonly rule: string;
  readonly link: string;
  readonly kind: RunKind;
  readonly day?: string;
  readonly bestCombo: number;
}

/** The results card. */
export interface ResultsModel {
  readonly headline: string;
  readonly score: number;
  readonly kept: number;
  readonly total: number;
  readonly lostThisRun: number;
  readonly recovered: number;
  readonly smashed: number;
  readonly bestCombo: number;
  readonly gulpBurped: boolean;
  /**
   * Estimated Bits, for reference only: the card shows the host's ack (`RunAck.bits`, see {@link bitsLabel}) so it
   * matches the shell's toast and balance.
   */
  readonly bits: number;
  /** Pixels the owner can regrow right now (empty for guests and when nothing was lost). */
  readonly regrowPixels: Hex64;
  /** Whether the CTA is "regrow" (owner) or "bring your own friend" (guest/loaner). */
  readonly cta: "regrow" | "connect" | "none";
  readonly share: ShareCardData;
}

/** Skill 0..20 for the Bits formula: full when nothing was lost, 0 at the per-run scar cap. */
export function runSkill(lost: number, n0: number): number {
  const cap = runScarCap(Math.max(0, Math.min(256, Math.round(n0))));
  return Math.round(BITS.runSkillMax * (1 - Math.min(1, Math.max(0, lost) / cap)));
}

/** Builds the card from the finished run. */
export function buildResults(r: ResultsInput): ResultsModel {
  const total = popcount(r.front);
  const lostAfter = or(r.startLost, r.summary.lostDelta);
  const lostThisRun = popcount(r.summary.lostDelta);
  const kept = total - popcount(lostAfter);
  const owner = r.mode === "owner" && !r.loaned;
  const regrowPixels = owner ? r.summary.lostDelta : EMPTY_MASK;
  const cta = owner ? (isEmpty(regrowPixels) ? "none" : "regrow") : "connect";
  return {
    headline: resultsHeadline(r.endReason, r.arena, r.gulpMood),
    score: r.summary.score,
    kept,
    total,
    lostThisRun,
    recovered: r.summary.recovered,
    smashed: r.summary.smashed,
    bestCombo: r.bestCombo,
    gulpBurped: r.gulpBurped,
    bits: runBits(runSkill(lostThisRun, total), r.firstRunOfDay ?? false),
    regrowPixels,
    cta,
    share: {
      tokenId: r.tokenId,
      score: r.summary.score,
      kept,
      total,
      lost: lostAfter,
      front: r.front,
      rule: RULE_LINE,
      link: `/f/${r.tokenId}`,
      kind: r.kind,
      ...(r.day ? { day: r.day } : {}),
      bestCombo: r.bestCombo,
    },
  };
}

/**
 * The results card's "bits" value: "…" until the host acknowledges the run, then the Bits the host credited
 * (`RunAck.bits`, the same figure the shell toasts). "—" when the host credits none, "not saved" if reporting failed.
 */
export function bitsLabel(ack: RunAck | null, failed: boolean): string {
  if (failed) return "not saved";
  if (!ack) return "…";
  return typeof ack.bits === "number" ? `+${ack.bits}` : "—";
}

/** One line about what happened to the scars, from the server's ack (null = still submitting). */
export function scarNote(model: ResultsModel, ack: RunAck | null, failed: boolean): string {
  if (failed) return "couldn't save this run. scars were not applied.";
  if (!ack) return "saving run…";
  if (ack.applied) {
    return model.lostThisRun === 0
      ? "flawless: no new scars."
      : `${model.lostThisRun} scars applied. they heal over time.`;
  }
  switch (ack.reason) {
    case "guest":
      return "these were loaner pixels. your friend's scars stick — and heal.";
    case "practice":
      return "practice run: scars don't stick.";
    case "newbie":
      return "practice stitches: your first runs don't scar.";
    case "floor":
      return "resting run: your friend is at its floor.";
    case "unverified":
      return "run not verified: scars were not applied.";
    default:
      return "scars were not applied.";
  }
}

/**
 * The replay line under a daily result or a Fling Belt trial: the server re-runs the input log through the same sim
 * (`replay`) and only then ranks / grades it. Null for plain free runs.
 */
export function replayNote(
  kind: RunKind,
  day: string | undefined,
  ack: RunAck | null,
  failed: boolean,
  beltTrial?: string,
): string | null {
  if (kind !== "daily" && !beltTrial) return null;
  const head = beltTrial ? `belt trial ${beltTrial}` : `daily${day ? ` ${day}` : ""}`;
  if (failed) return `${head} · not submitted`;
  if (!ack || ack.verified === "pending") return `${head} · server replay pending…`;
  return ack.verified === "ok" ? `${head} · replay verified ✓` : `${head} · replay mismatch: not ranked`;
}
