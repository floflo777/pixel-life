import { describe, expect, it } from "vitest";
import { inputsFromBase64 } from "./codec.js";
import corpus from "./golden-corpus.json";
import type { GoldenCase } from "./golden.js";
import { replay } from "./sim.js";
import { nowMs } from "./testkit.js";

describe("replay performance (architecture §4.6: ≤ 15 ms median on warm V8)", () => {
  it("replays full 3600-tick runs in ≤ 15 ms median", () => {
    // Every 8th corpus log that lasts the whole run (random logs keep up to 14 creatures alive: the worst case).
    const cases = (corpus as unknown as GoldenCase[]).filter((_, i) => i % 8 === 0);
    const medians: number[] = [];
    for (const c of cases) {
      const inputs = inputsFromBase64(c.log);
      if (replay(c.cfg, inputs).ticks !== 3600) continue;
      const times: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = nowMs();
        replay(c.cfg, inputs);
        times.push(nowMs() - t0);
      }
      times.sort((a, b) => a - b);
      medians.push(times[1] ?? Infinity);
    }
    medians.sort((a, b) => a - b);
    expect(medians.length).toBeGreaterThan(10);
    expect(medians[Math.floor(medians.length / 2)]).toBeLessThanOrEqual(15);
  });
});
