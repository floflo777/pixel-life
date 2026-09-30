import { describe, expect, it } from "vitest";
import { angleDelta, angleOf, cosA, degToAngle, powerCurve, sinA, wrapAngle } from "./fixed-math.js";
import { POW_115, SIN_QUARTER } from "./tables.generated.js";
import { env, writeRepoFile } from "./testkit.js";

/** The one place the tables are generated (from this engine's Math.sin / Math.pow). */
function generateTables(): { sin: number[]; pow: number[] } {
  const sin: number[] = [];
  for (let i = 0; i <= 1024; i++) sin.push(Math.sin((i * 2 * Math.PI) / 4096));
  sin[0] = 0;
  sin[1024] = 1;
  const pow: number[] = [];
  for (let i = 0; i <= 1023; i++) pow.push(Math.pow(i / 1023, 1.15));
  return { sin, pow };
}

describe("committed tables", () => {
  it("match a fresh generation to within 1 ulp-ish (they are never recomputed at runtime)", () => {
    const { sin, pow } = generateTables();
    expect(SIN_QUARTER).toHaveLength(1025);
    expect(POW_115).toHaveLength(1024);
    sin.forEach((v, i) => expect(Math.abs((SIN_QUARTER[i] ?? NaN) - v)).toBeLessThan(1e-15));
    pow.forEach((v, i) => expect(Math.abs((POW_115[i] ?? NaN) - v)).toBeLessThan(1e-15));
  });

  it.runIf(env("PL_REGEN_TABLES") === "1")("regenerates tables.generated.ts on request", async () => {
    const { sin, pow } = generateTables();
    const body =
      `/**\n * Committed literal tables for the deterministic sim (architecture §3). Generated ONCE from Math.sin / Math.pow and never\n` +
      ` * computed at runtime. Regenerate only deliberately: \`PL_REGEN_TABLES=1 npx vitest run packages/shared/src/sim/fixed-math.test.ts\`\n` +
      ` * then run prettier and update the golden corpus in the same PR.\n */\n\n` +
      `/** sin(i · 2π / 4096) for i = 0..1024 (the first quarter wave; the rest follows by exact symmetry). */\n` +
      `export const SIN_QUARTER: readonly number[] = [${sin.join(", ")}];\n\n` +
      `/** (i / 1023) ^ 1.15 for i = 0..1023: the fling power curve (GDD §2.3 launch speed). */\n` +
      `export const POW_115: readonly number[] = [${pow.join(", ")}];\n`;
    await writeRepoFile("packages/shared/src/sim/tables.generated.ts", body);
  });
});

describe("table trigonometry", () => {
  it("is exact at the cardinal angles and symmetric", () => {
    expect([sinA(0), sinA(1024), sinA(2048), sinA(3072)]).toEqual([0, 1, -0, -1]);
    expect([cosA(0), cosA(2048)]).toEqual([1, -1]);
    for (let a = 0; a < 4096; a += 37) {
      expect(sinA(-a) + sinA(a)).toBe(0);
      expect(sinA(a + 4096)).toBe(sinA(a));
      expect(Math.abs(sinA(a) * sinA(a) + cosA(a) * cosA(a) - 1)).toBeLessThan(1e-15);
      expect(Math.abs(sinA(a) - Math.sin((a * 2 * Math.PI) / 4096))).toBeLessThan(1e-15);
    }
  });

  it("angleOf inverts the table to the nearest step in every quadrant", () => {
    for (let a = 0; a < 4096; a++) {
      expect(angleOf(cosA(a) * 13.7, sinA(a) * 13.7)).toBe(a);
    }
    expect(angleOf(0, 0)).toBe(0);
    expect(angleOf(-1, 0)).toBe(2048);
    expect(angleOf(0, -5)).toBe(3072);
  });

  it("angleDelta is the signed shortest turn", () => {
    expect(angleDelta(4000, 100)).toBe(196);
    expect(angleDelta(100, 4000)).toBe(-196);
    expect(angleDelta(0, 2048)).toBe(-2048);
    expect(wrapAngle(-1)).toBe(4095);
    expect(degToAngle(90)).toBe(1024);
  });

  it("the power curve is monotonic from 0 to 1 and clamps", () => {
    expect(powerCurve(0)).toBe(0);
    expect(powerCurve(1023)).toBe(1);
    expect(powerCurve(5000)).toBe(1);
    expect(powerCurve(-3)).toBe(0);
    for (let p = 1; p < 1024; p++) expect(powerCurve(p)).toBeGreaterThan(powerCurve(p - 1));
  });
});
