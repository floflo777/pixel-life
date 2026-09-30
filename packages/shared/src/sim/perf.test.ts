import { describe, expect, it } from "vitest";
import { inputsFromBase64 } from "./codec.js";
import corpus from "./golden-corpus.json";
import type { GoldenCase } from "./golden.js";
import { replay } from "./sim.js";
import { env, nowMs } from "./testkit.js";

type ReplayFn = typeof replay;

/**
 * Architecture §4.6 budget: ≤ 15 ms median on warm V8. It only holds on a quiet machine, so it is enforced when
 * `PERF_STRICT` is set; shared CI runners get a generous bound that still catches order-of-magnitude regressions.
 */
const STRICT = Boolean(env("PERF_STRICT"));
const BOUND_MS = STRICT ? 15 : 200;

/** This file's directory (the package compiles without DOM/Node typings, so URL is reached through globalThis). */
function here(): string {
  const U = (globalThis as unknown as { URL: new (u: string, base: string) => { pathname: string } }).URL;
  return decodeURIComponent(new U(".", (import.meta as unknown as { url: string }).url).pathname);
}

/**
 * The sim as the server and the browser run it: one esbuild bundle (no per-module test transform in the hot path).
 * Falls back to the in-process module if esbuild cannot be loaded.
 */
async function bundledReplay(): Promise<{ fn: ReplayFn; bundled: boolean }> {
  try {
    const { build } = await import("esbuild");
    const out = await build({
      stdin: {
        contents: `export { replay } from "./sim.ts";`,
        resolveDir: here(),
        loader: "ts",
      },
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      write: false,
      logLevel: "silent",
    });
    const code = out.outputFiles[0]?.text;
    if (!code) throw new Error("empty bundle");
    const mod = (await import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`)) as {
      replay: ReplayFn;
    };
    return { fn: mod.replay, bundled: true };
  } catch {
    return { fn: replay, bundled: false };
  }
}

describe(`replay performance (architecture §4.6: ≤ 15 ms median on warm V8; enforced ≤ ${BOUND_MS} ms)`, () => {
  it("replays full 3600-tick runs within the bound (median over corpus runs)", async () => {
    const { fn, bundled } = await bundledReplay();
    // Every 8th corpus log that lasts the whole run (random logs keep up to 14 creatures alive: the worst case).
    const cases = (corpus as unknown as GoldenCase[])
      .filter((_, i) => i % 8 === 0)
      .map((c) => ({ cfg: c.cfg, inputs: inputsFromBase64(c.log) }))
      .filter((c) => fn(c.cfg, c.inputs).ticks === 3600);
    expect(cases.length).toBeGreaterThan(10);
    // Warm-up: let the JIT settle on the hot paths before timing.
    for (let k = 0; k < 2; k++) for (const c of cases) fn(c.cfg, c.inputs);
    const medians: number[] = [];
    for (const c of cases) {
      const times: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = nowMs();
        fn(c.cfg, c.inputs);
        times.push(nowMs() - t0);
      }
      times.sort((a, b) => a - b);
      medians.push(times[1] ?? Infinity);
    }
    medians.sort((a, b) => a - b);
    const median = medians[Math.floor(medians.length / 2)] ?? Infinity;
    (globalThis as { console?: { log(...a: unknown[]): void } }).console?.log(
      `sim replay median ${median.toFixed(2)} ms over ${medians.length} runs (${bundled ? "bundled" : "in-process"}, bound ${BOUND_MS} ms)`,
    );
    expect(median).toBeLessThanOrEqual(BOUND_MS);
  }, 60_000);
});
