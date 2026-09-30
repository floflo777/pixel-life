import { describe, expect, it } from "vitest";
import type { PixelPutt } from "@pl/shared";
import { cuesFor, formatToPar, PUTT_RULE, roundHeadline, scorecardCells, scoreName, scoreTone } from "./format";

describe("pixel putt format", () => {
  it("names hole results like golfers do", () => {
    expect(scoreName(1, 3)).toBe("hole in one!");
    expect(scoreName(1, 2)).toBe("hole in one!");
    expect(scoreName(2, 4)).toBe("eagle!");
    expect(scoreName(2, 3)).toBe("birdie!");
    expect(scoreName(3, 3)).toBe("par");
    expect(scoreName(4, 3)).toBe("bogey");
    expect(scoreName(5, 3)).toBe("double bogey");
    expect(scoreName(7, 3)).toBe("+4");
    expect(scoreName(8, 3, true)).toBe("picked up");
  });

  it("writes to-par with a true minus sign and E for even", () => {
    expect(formatToPar(27, 27)).toBe("E");
    expect(formatToPar(30, 27)).toBe("+3");
    expect(formatToPar(25, 27)).toBe("−2");
  });

  it("tones under/at/over par", () => {
    expect(scoreTone(2, 3)).toBe("lime");
    expect(scoreTone(3, 3)).toBe("paper");
    expect(scoreTone(4, 3)).toBe("coral");
  });

  it("headlines a round", () => {
    expect(roundHeadline(20, 27, 1)).toBe("ace round!");
    expect(roundHeadline(25, 27, 0)).toBe("under par!");
    expect(roundHeadline(27, 27, 0)).toBe("right on par");
    expect(roundHeadline(40, 27, 0)).toBe("round complete");
  });

  it("keeps the door rule within 12 words", () => {
    expect(PUTT_RULE.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it("maps every event to known cues, with a fanfare for aces", () => {
    const at = { t: 0, hole: 0, x: 0, z: 0 };
    const events: PixelPutt.PuttEvent[] = [
      { ...at, type: "tee" },
      { ...at, type: "launch", pow: 1023 },
      { ...at, type: "bounce", kind: "rail", speed: 5 },
      { ...at, type: "bounce", kind: "bumper", speed: 5 },
      { ...at, type: "bounce", kind: "blade", speed: 5 },
      { ...at, type: "bounce", kind: "nib", speed: 5 },
      { ...at, type: "land", speed: 8 },
      { ...at, type: "lip" },
      { ...at, type: "fall" },
      { t: 0, hole: 0, type: "penalty", reason: "fall", strokes: 2 },
      { ...at, type: "reset" },
      { t: 0, hole: 0, type: "pickup", strokes: 8, par: 3 },
      { t: 0, type: "end", total: 30, par: 27 },
    ];
    for (const e of events) for (const c of cuesFor(e)) expect(c.cue).toMatch(/^[a-z]+(\.[a-z]+)?$/);
    expect(cuesFor({ ...at, type: "sink", strokes: 1, par: 3 }).map((c) => c.cue)).toContain("gold.reveal");
    expect(cuesFor({ ...at, type: "sink", strokes: 2, par: 3 }).map((c) => c.cue)).toContain("regrow.sparkle");
    expect(cuesFor({ ...at, type: "sink", strokes: 4, par: 3 }).map((c) => c.cue)).toEqual(["pixel.clutch"]);
    expect(cuesFor({ ...at, type: "land", speed: 1 })).toEqual([]);
  });

  it("builds scorecard cells with nulls for unplayed holes", () => {
    expect(scorecardCells([2, 5], [3, 3, 4])).toEqual([
      { strokes: 2, par: 3, tone: "lime" },
      { strokes: 5, par: 3, tone: "coral" },
      null,
    ]);
  });
});
