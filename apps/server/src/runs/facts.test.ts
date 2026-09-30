import { EMPTY_MASK, SimEvents, beltEarnedBy, fromIndices, newStamps, applyMetaEvent, EMPTY_STATS } from "@pl/shared";
import { describe, expect, it } from "vitest";
import { emptyTally, metaVenueOf, runFacts, tallyEvents, type VerifiedRun } from "./facts.js";

const front = fromIndices([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

const base = (over: Partial<VerifiedRun> = {}): VerifiedRun => ({
  venueId: "pixel-life",
  kind: "free",
  arena: "meadow",
  beltTrial: null,
  score: 1500,
  lostDelta: EMPTY_MASK,
  friend: { front, lost: EMPTY_MASK },
  ...over,
});

describe("tallyEvents", () => {
  it("counts grabs, clutch grabs, combos, banked fizz, player pops, traits and burps", () => {
    const t = tallyEvents([
      { t: 1, type: "pixelBack", a: 3, b: 0 },
      { t: 2, type: "pixelBack", a: 4, b: 1 },
      { t: 3, type: "combo", a: 2, b: 10 },
      { t: 4, type: "combo", a: 5, b: 50 },
      { t: 5, type: "combo", a: 3, b: 30 },
      { t: 6, type: "explode", a: 9, b: 1 },
      { t: 7, type: "explode", a: 9, b: 0 },
      { t: 8, type: "smash", a: 1, b: 100 },
      { t: 9, type: "smash", a: 2, b: 0 },
      { t: 10, type: "trait", a: 3, b: 0 },
      { t: 11, type: "gulp", a: SimEvents.GULP_EV_RUMBLE },
      { t: 12, type: "hit", a: 1, b: 0 },
    ]);
    expect(t).toEqual({
      grabbedBack: 2,
      clutchGrabs: 1,
      maxCombo: 5,
      fizzBank: 1,
      pops: 1,
      traitTriggers: 1,
      gulpBurped: false,
    });
    expect(tallyEvents([{ t: 1, type: "gulp", a: SimEvents.GULP_EV_BURP }]).gulpBurped).toBe(true);
    expect(tallyEvents([])).toEqual(emptyTally());
  });
});

describe("runFacts", () => {
  it("derives the mode, kept share and flawless flag from the stored run", () => {
    expect(runFacts(base(), null)).toEqual({
      venueId: "pixel-life",
      score: 1500,
      island: "meadow",
      mode: "quick",
      keptBps: 10_000,
      flawless: true,
    });
    // 2 of the 8 pixels present at the start were lost (pixels already lost before the run do not count).
    const scarred = runFacts(
      base({
        kind: "daily",
        friend: { front, lost: fromIndices([0, 1]) },
        lostDelta: fromIndices([0, 2, 3]),
      }),
      null,
    );
    expect(scarred).toMatchObject({ mode: "daily", keptBps: 7500, flawless: false });
  });

  it("counts handheld runs as Pixel Life runs and ignores unknown belt trials", () => {
    expect(metaVenueOf("handheld")).toBe("pixel-life");
    expect(metaVenueOf("bump-sumo")).toBe("bump-sumo");
    const facts = runFacts(base({ venueId: "handheld", beltTrial: "nope" }), emptyTally());
    expect(facts).toMatchObject({ venueId: "pixel-life", mode: "quick", maxCombo: 0 });
    expect(facts).not.toHaveProperty("beltTrial");
  });

  it("feeds the shared stamp and belt rules: a tallied trial run earns its stamps and the belt", () => {
    const tally = { ...emptyTally(), grabbedBack: 1, maxCombo: 4 };
    const facts = runFacts(base({ beltTrial: "orange" }), tally);
    expect(facts).toMatchObject({ mode: "trial", beltTrial: "orange", maxCombo: 4 });
    const event = { kind: "run_finished" as const, run: facts };
    expect(newStamps(applyMetaEvent(EMPTY_STATS, event), event, new Set())).toEqual(
      expect.arrayContaining(["first_flight", "first_grab", "warm_up", "triple", "flawless"]),
    );
    expect(beltEarnedBy(["white", "yellow"], facts)).toBe("orange");
    expect(beltEarnedBy([], facts)).toBe("white");
  });
});
