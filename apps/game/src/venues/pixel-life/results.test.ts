import { describe, expect, it } from "vitest";
import { BITS, EMPTY_MASK, fromIndices, popcount, type RunSummary } from "@pl/shared";
import { bitsLabel, buildResults, replayNote, runSkill, scarNote, type ResultsInput } from "./results";

const front = fromIndices(Array.from({ length: 82 }, (_, i) => i + 20));
const summary = (lost: number[], score = 3410): RunSummary => ({
  score,
  lostDelta: fromIndices(lost),
  recovered: 11,
  smashed: 20,
  ticks: 3600,
  finalHash: "x",
});
const base = (over: Partial<ResultsInput> = {}): ResultsInput => ({
  tokenId: "344030",
  mode: "owner",
  loaned: false,
  kind: "free",
  arena: "meadow",
  gulpMood: 0,
  endReason: "time",
  front,
  startLost: EMPTY_MASK,
  summary: summary([20, 21, 22, 23]),
  bestCombo: 5,
  gulpBurped: true,
  ...over,
});

describe("results", () => {
  it("counts kept pixels against the start scars", () => {
    const r = buildResults(base({ startLost: fromIndices([30, 31]) }));
    expect(r.total).toBe(82);
    expect(r.lostThisRun).toBe(4);
    expect(r.kept).toBe(76);
    expect(popcount(r.share.lost)).toBe(6);
    expect(r.share.link).toBe("/f/344030");
  });
  it("offers regrow to owners and connect to guests", () => {
    expect(buildResults(base()).cta).toBe("regrow");
    expect(popcount(buildResults(base()).regrowPixels)).toBe(4);
    expect(buildResults(base({ summary: summary([]) })).cta).toBe("none");
    const guest = buildResults(base({ mode: "guest", loaned: true }));
    expect(guest.cta).toBe("connect");
    expect(guest.regrowPixels).toBe(EMPTY_MASK);
  });
  it("pays Bits from base + skill (+ first run of day)", () => {
    expect(runSkill(0, 82)).toBe(BITS.runSkillMax);
    expect(runSkill(12, 82)).toBe(0);
    expect(runSkill(6, 82)).toBe(10);
    expect(buildResults(base({ summary: summary([]) })).bits).toBe(BITS.runBase + BITS.runSkillMax);
    expect(buildResults(base({ summary: summary([]), firstRunOfDay: true })).bits).toBe(
      BITS.runBase + BITS.runSkillMax + BITS.firstRunOfDay,
    );
  });
  it("explains what happened to the scars", () => {
    const m = buildResults(base());
    expect(scarNote(m, null, false)).toMatch(/saving/);
    expect(scarNote(m, null, true)).toMatch(/not applied/);
    expect(scarNote(m, { runId: "r", verified: "pending", applied: true, scars: null }, false)).toMatch(
      /4 scars applied/,
    );
    expect(
      scarNote(m, { runId: "r", verified: "pending", applied: false, reason: "guest", scars: null }, false),
    ).toMatch(/loaner/);
  });
});

describe("replayNote", () => {
  const ack = (verified: "pending" | "ok" | "mismatch") => ({ runId: "r", verified, applied: false, scars: null });
  it("is silent for free runs", () => {
    expect(replayNote("free", undefined, ack("ok"), false)).toBeNull();
  });
  it("tracks the server replay of a daily run", () => {
    expect(replayNote("daily", "2026-10-01", null, false)).toBe("daily 2026-10-01 · server replay pending…");
    expect(replayNote("daily", "2026-10-01", ack("ok"), false)).toBe("daily 2026-10-01 · replay verified ✓");
    expect(replayNote("daily", undefined, ack("mismatch"), false)).toBe("daily · replay mismatch: not ranked");
    expect(replayNote("daily", undefined, null, true)).toBe("daily · not submitted");
  });
  it("labels belt trials", () => {
    expect(replayNote("free", undefined, ack("ok"), false, "lime")).toBe("belt trial lime · replay verified ✓");
  });
});

describe("results card bits (#32)", () => {
  const ack = { runId: "r", verified: "pending", applied: true, scars: null } as const;
  it("waits for the host's ack, then shows exactly the credited Bits", () => {
    expect(bitsLabel(null, false)).toBe("…");
    expect(bitsLabel({ ...ack, bits: 60 }, false)).toBe("+60");
    expect(bitsLabel({ ...ack, bits: 0 }, false)).toBe("+0");
  });
  it("never shows a local estimate when the host credits nothing or the report failed", () => {
    expect(bitsLabel(ack, false)).toBe("—");
    expect(bitsLabel(null, true)).toBe("not saved");
  });
});
