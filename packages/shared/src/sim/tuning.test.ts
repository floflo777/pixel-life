import { describe, expect, it } from "vitest";
import doc from "./TUNING.md?raw";
import * as T from "./tuning.js";

describe("TUNING.md", () => {
  it("documents every constant exported by tuning.ts", () => {
    const names = Object.keys(T).filter((k) => /^[A-Z][A-Z0-9_]*$/.test(k));
    expect(names.length).toBeGreaterThan(150);
    // A row may abbreviate a pair as `A` / `B` (e.g. `MAGNET_PREY` / `MAGNET_FLY`, `MASS_FACTOR_MIN` / `MAX`).
    const missing = names.filter((n) => !doc.includes(n) && !doc.includes(n.replace(/_(MIN|MAX|FLY|K)$/, "")));
    expect(missing).toEqual([]);
  });

  it("keeps the sec() conversion exact for every duration used", () => {
    expect(T.sec(0.25)).toBe(15);
    expect(T.sec(0.45)).toBe(27);
    expect(T.GRAB_WINDOW).toBe(120);
  });
});
