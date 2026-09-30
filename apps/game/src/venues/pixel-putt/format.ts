/**
 * Pixel Putt presentation rules as pure functions: golf names for a hole result, to-par strings, tones, the results
 * headline and the sim-event → audio-cue table. The venue and HUD only render what these return.
 */
import type { PixelPutt } from "@pl/shared";

/** HUD tone of a callout or scorecard cell (art bible: lime = good, paper = neutral, coral = over). */
export type PuttTone = "lime" | "paper" | "coral";

/** Golf name for a hole result ("hole in one!", "birdie!", "par", "bogey", …). `picked` = hit the stroke cap. */
export function scoreName(strokes: number, par: number, picked = false): string {
  if (picked) return "picked up";
  if (strokes === 1) return "hole in one!";
  const d = strokes - par;
  if (d <= -3) return "albatross!";
  if (d === -2) return "eagle!";
  if (d === -1) return "birdie!";
  if (d === 0) return "par";
  if (d === 1) return "bogey";
  if (d === 2) return "double bogey";
  return `+${d}`;
}

/** Tone of a hole result: under par lime, par paper, over coral. */
export function scoreTone(strokes: number, par: number): PuttTone {
  return strokes < par ? "lime" : strokes === par ? "paper" : "coral";
}

/** Strokes relative to par as golfers write it: "E", "+2", "−1" (true minus sign). */
export function formatToPar(strokes: number, par: number): string {
  const d = strokes - par;
  if (d === 0) return "E";
  return d > 0 ? `+${d}` : `−${-d}`;
}

/** Results headline for a finished round. */
export function roundHeadline(total: number, par: number, holeInOnes: number): string {
  if (holeInOnes > 0 && total < par) return "ace round!";
  if (total < par) return "under par!";
  if (total === par) return "right on par";
  if (total <= par + 5) return "nice round";
  return "round complete";
}

/** Short rule on the door (≤ 12 words, GDD §12.1). */
export const PUTT_RULE = "fling your friend into the hole in the fewest shots.";

/** One audio cue to play (names from `@pl/audio`'s CUES). */
export interface PuttCue {
  readonly cue: string;
  readonly gain?: number;
  readonly step?: number;
}

/** Cues for one sim event. `holeInOne` and `par` refine the sink fanfare. */
export function cuesFor(e: PixelPutt.PuttEvent): PuttCue[] {
  switch (e.type) {
    case "tee":
      return [{ cue: "run.count" }];
    case "launch":
      return [{ cue: "fling.release", gain: 0.5 + (e.pow / 1023) * 0.6 }];
    case "bounce": {
      const gain = Math.min(1, 0.35 + e.speed / 16);
      if (e.kind === "rail") return [{ cue: "bonk.rim", gain }];
      if (e.kind === "bumper") return [{ cue: "bonk.shell", gain }];
      if (e.kind === "blade") return [{ cue: "crack.shell", gain }];
      return [{ cue: "tele.nib", gain }];
    }
    case "land":
      return e.speed > 4 ? [{ cue: "pixel.tick", gain: Math.min(1, e.speed / 12) }] : [];
    case "lip":
      return [{ cue: "pixel.pop" }];
    case "fall":
      return [{ cue: "pixel.fall" }];
    case "penalty":
      return [{ cue: "ui.error", gain: 0.6 }];
    case "reset":
      return [{ cue: "hub.step" }];
    case "rest":
      return [];
    case "sink": {
      if (e.strokes === 1) return [{ cue: "pixel.clutch" }, { cue: "gold.reveal" }];
      if (e.strokes < e.par) return [{ cue: "pixel.clutch" }, { cue: "regrow.sparkle" }];
      return [{ cue: "pixel.clutch" }];
    }
    case "pickup":
      return [{ cue: "ui.back" }];
    case "end":
      return [{ cue: "run.end" }];
  }
}

/** Scorecard cells for the HUD strip: one per hole, `null` for holes not yet played. */
export function scorecardCells(
  card: readonly number[],
  pars: readonly number[],
): ({ strokes: number; par: number; tone: PuttTone } | null)[] {
  return pars.map((par, i) => {
    const s = card[i];
    return s === undefined ? null : { strokes: s, par, tone: scoreTone(s, par) };
  });
}
