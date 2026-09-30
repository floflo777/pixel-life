import { describe, expect, it } from "vitest";
import { manifestProblems } from "@pl/venue-kit";
import { PIXEL_PUTT_ID, PIXEL_PUTT_MANIFEST } from "./venue";

describe("pixel putt manifest", () => {
  it("is a valid, scarless native venue ranked by score", () => {
    expect(manifestProblems(PIXEL_PUTT_MANIFEST)).toEqual([]);
    expect(PIXEL_PUTT_MANIFEST).toMatchObject({
      id: PIXEL_PUTT_ID,
      kind: "native",
      requires: { ownedFriend: false },
      economy: { sinks: [] },
      results: { leaderboard: "score-desc", affectsScars: false },
    });
  });

  it("has a 16×16 1-bit door icon", () => {
    const rows = PIXEL_PUTT_MANIFEST.thumbnail.split("\n");
    expect(rows).toHaveLength(16);
    for (const r of rows) expect(r).toMatch(/^[.#]{16}$/);
  });
});
