import { describe, expect, it } from "vitest";
import { assertNever, fnv1a32, mulberry32 } from "./util.js";

describe("util", () => {
  it("fnv1a32 matches the reference vectors", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("mulberry32 is deterministic, seed-sensitive and 32-bit", () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    const c = mulberry32(2);
    const xs = Array.from({ length: 100 }, () => a());
    expect(Array.from({ length: 100 }, () => b())).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) expect(Number.isInteger(x) && x >= 0 && x < 2 ** 32).toBe(true);
  });

  it("assertNever throws", () => {
    expect(() => assertNever("x" as never)).toThrow("Unhandled case");
  });
});
