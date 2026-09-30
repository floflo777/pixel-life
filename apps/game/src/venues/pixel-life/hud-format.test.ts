import { describe, expect, it } from "vitest";
import {
  chainLabel,
  chainPips,
  formatClock,
  formatEta,
  formatPx,
  formatRf,
  formatScore,
  formatSeconds,
  grabCallout,
  lossCallout,
  looseLabel,
  phaseBanner,
  popCallout,
  resultsHeadline,
  sweepBlocks,
  timerBlocks,
} from "./hud-format";

describe("HUD formatting", () => {
  it("groups the score like the style frame", () => {
    expect(formatScore(0)).toBe("0");
    expect(formatScore(1240)).toBe("1 240");
    expect(formatScore(1234567)).toBe("1 234 567");
    expect(formatScore(-50)).toBe("−50");
  });
  it("counts the clock down from 1:00 and rounds up", () => {
    expect(formatClock(0)).toBe("1:00");
    expect(formatClock(1)).toBe("1:00");
    expect(formatClock(60)).toBe("0:59");
    expect(formatClock(3599)).toBe("0:01");
    expect(formatClock(3600)).toBe("0:00");
    expect(formatClock(9999)).toBe("0:00");
    expect(timerBlocks(0)).toBe(60);
    expect(timerBlocks(3540)).toBe(1);
  });
  it("shows the health readout and loose pill", () => {
    expect(formatPx(76, 82)).toBe("76/82 px");
    expect(looseLabel(0)).toBe("");
    expect(looseLabel(4)).toBe("4 loose · grab!");
  });
  it("empties the sweep bar one block per 0.2 s", () => {
    expect(sweepBlocks(null)).toBe(0);
    expect(sweepBlocks(120)).toBe(10);
    expect(sweepBlocks(109)).toBe(10);
    expect(sweepBlocks(108)).toBe(9);
    expect(sweepBlocks(1)).toBe(1);
    expect(sweepBlocks(0)).toBe(0);
    expect(formatSeconds(87)).toBe("1.45");
    expect(formatSeconds(null)).toBe("0.00");
  });
  it("labels the chain", () => {
    expect(chainLabel(10)).toBe("×1");
    expect(chainLabel(13)).toBe("×1.3");
    expect(chainLabel(20)).toBe("×2");
    expect(chainLabel(50)).toBe("×5");
    expect(chainPips(10)).toBe(0);
    // One popping fling (+0.3) already lights a pip; the bar fills at the ×5.0 cap.
    expect(chainPips(13)).toBe(1);
    expect(chainPips(30)).toBe(5);
    expect(chainPips(50)).toBe(10);
    expect(chainPips(80)).toBe(10);
  });
  it("writes callouts in the right tone", () => {
    expect(lossCallout(4)).toEqual({ text: "−4 px", tone: "coral" });
    expect(popCallout(10)).toEqual({ text: "+10", tone: "paper" });
    expect(popCallout(120).text).toBe("bonk! +120");
    expect(popCallout(30, "air pop").text).toBe("air pop +30");
    expect(grabCallout(true)).toEqual({ text: "clutch +25", tone: "lime" });
    expect(grabCallout(false).text).toBe("+1 px");
  });
  it("names phases and results", () => {
    expect(phaseBanner(0)).toBeNull();
    expect(phaseBanner(3)).toBe("frenzy");
    expect(resultsHeadline("time", "meadow", 0)).toBe("run over · meadow · gulp: hungry");
    expect(resultsHeadline("crumble", "snow", 2)).toBe("needs a nap · snow · gulp: grumpy");
  });
  it("formats money and ETAs", () => {
    expect(formatRf(2_000_000)).toBe("2.00 RF");
    expect(formatEta(2 * 3_600_000)).toBe("2h 00m");
    expect(formatEta(61_000)).toBe("0h 02m");
  });
});
