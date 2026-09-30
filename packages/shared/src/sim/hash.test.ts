import { describe, expect, it } from "vitest";
import { Hasher } from "./hash.js";

describe("Hasher", () => {
  it("is deterministic and 16 hex chars", () => {
    const a = new Hasher();
    const b = new Hasher();
    for (const h of [a, b]) {
      h.u32(1);
      h.f64(0.1 + 0.2);
      h.bool(true);
    }
    expect(a.hex()).toBe(b.hex());
    expect(a.hex()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes with any bit of any value, order and signed zero", () => {
    const hex = (fill: (h: Hasher) => void): string => {
      const h = new Hasher();
      fill(h);
      return h.hex();
    };
    const base = hex((h) => (h.f64(1), h.f64(2)));
    expect(hex((h) => (h.f64(2), h.f64(1)))).not.toBe(base);
    expect(hex((h) => (h.f64(1), h.f64(2 + Number.EPSILON * 2)))).not.toBe(base);
    expect(hex((h) => h.f64(0))).not.toBe(hex((h) => h.f64(-0)));
    expect(hex((h) => h.u32(0))).not.toBe(hex((h) => h.u32(1)));
  });
});
