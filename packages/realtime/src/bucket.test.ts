import { CLIENT_RATES } from "@pl/shared";
import { describe, expect, it } from "vitest";
import { TokenBucket } from "./bucket.js";

describe("TokenBucket", () => {
  it("allows the burst, then refills at the sustained rate", () => {
    const b = new TokenBucket(CLIENT_RATES.move, 0);
    for (let i = 0; i < 16; i++) expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
    expect(b.take(124)).toBe(false); // 8/s → one token per 125 ms
    expect(b.take(125)).toBe(true);
    expect(b.take(125)).toBe(false);
  });

  it("refills say exactly after 2 s despite floating point", () => {
    const b = new TokenBucket(CLIENT_RATES.say, 0);
    expect(b.take(0)).toBe(true);
    expect(b.take(1999)).toBe(false);
    expect(b.take(2000)).toBe(true);
  });

  it("never exceeds the burst however long it idles", () => {
    const b = new TokenBucket(CLIENT_RATES.emote, 0);
    expect(b.available(3_600_000)).toBe(1);
  });

  it("sustains exactly the configured rate over a long run", () => {
    const b = new TokenBucket({ perSec: 8, burst: 16 }, 0);
    let ok = 0;
    for (let t = 0; t <= 10_000; t += 10) if (b.take(t)) ok++;
    expect(ok).toBe(16 + 80);
  });
});
