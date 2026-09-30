import { describe, expect, it } from "vitest";
import corpus from "./golden-corpus.json";
import { BOT_CASES, buildCorpus, checkCorpus, type GoldenCase, RANDOM_CASES } from "./golden.js";
import { env, fullTests, HEAVY_TIMEOUT_MS, writeRepoFile } from "./testkit.js";

const REGEN = env("PL_REGEN_GOLDEN") === "1";
const FULL = fullTests();
/** On CI without PL_FULL_TESTS: every bot log plus every 4th random log (90 of 240). Locally: all of them. */
const sampled = (c: GoldenCase, i: number): boolean => FULL || !c.id.startsWith("random-") || i % 4 === 0;

describe("golden determinism corpus", () => {
  it.runIf(REGEN)("regenerates golden-corpus.json (PL_REGEN_GOLDEN=1, deliberate rule changes only)", async () => {
    await writeRepoFile("packages/shared/src/sim/golden-corpus.json", `${JSON.stringify(buildCorpus(), null, 2)}\n`);
  });

  it.skipIf(REGEN)(
    `replays ${FULL ? "all" : "a CI sample of the"} ${RANDOM_CASES} random + ${BOT_CASES} bot logs to their committed final hashes`,
    () => {
      const cases = corpus as unknown as GoldenCase[];
      expect(cases.length).toBe(RANDOM_CASES + BOT_CASES);
      const bad = checkCorpus(cases.filter(sampled)).filter((r) => !r.ok);
      expect(bad).toEqual([]);
      expect(new Set(cases.map((c) => c.finalHash)).size).toBe(cases.length);
    },
    HEAVY_TIMEOUT_MS,
  );
});
