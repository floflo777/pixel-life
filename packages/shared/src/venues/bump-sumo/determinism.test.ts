import { describe, expect, it } from "vitest";

/**
 * The repo's ESLint determinism rule is scoped to `packages/shared/src/sim/**`; this venue sim lives next to it, so the
 * same bans are enforced here as a test until the lint glob is widened (see the PR note).
 */
const BANNED = [
  /\bMath\.(random|sin|cos|tan|asin|acos|atan2?|pow|exp|log(2|10|1p)?|cbrt|hypot|sinh|cosh|tanh|expm1)\b/,
  /\bDate\b/,
  /\bperformance\b/,
  /\*\*/,
];

/** Repo-relative folder (vitest runs from the repo root, like the golden-corpus regeneration). */
const DIR = "packages/shared/src/venues/bump-sumo/";

interface Fs {
  readdirSync(p: string): string[];
  readFileSync(p: string, enc: "utf8"): string;
}

describe("Bump Sumo determinism rules", () => {
  it("uses no engine-dependent math, wall clock or exponent operator in sim sources", async () => {
    // The shared package has no Node typings; tests run in Node.
    const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as Fs;
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(4);
    const hits: string[] = [];
    for (const f of files) {
      // Strip comments (doc comments mention `**` and API names freely), then scan the code.
      const code = fs
        .readFileSync(`${DIR}${f}`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const line of code.split("\n"))
        for (const re of BANNED) if (re.test(line)) hits.push(`${f}: ${line.trim()}`);
    }
    expect(hits).toEqual([]);
  });
});
