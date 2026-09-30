import { describe, expect, it } from "vitest";
import { createDuckState, requestDuck } from "./duck";

describe("requestDuck", () => {
  it("starts, deepens, extends, and ignores covered requests", () => {
    const s = createDuckState();
    expect(requestDuck(s, 0, 4, 1)).toBe(true);
    expect(s).toEqual({ depthDb: 4, until: 1 });
    expect(requestDuck(s, 0.2, 3, 0.5)).toBe(false);
    expect(requestDuck(s, 0.2, 8, 0.1)).toBe(true);
    expect(s).toEqual({ depthDb: 8, until: 1 });
    expect(requestDuck(s, 0.5, 2, 2)).toBe(true);
    expect(s.until).toBe(2.5);
    expect(s.depthDb).toBe(8);
  });

  it("an expired duck is replaced, not merged", () => {
    const s = createDuckState();
    requestDuck(s, 0, 9, 0.1);
    expect(requestDuck(s, 1, 3, 0.2)).toBe(true);
    expect(s).toEqual({ depthDb: 3, until: 1.2 });
  });
});
