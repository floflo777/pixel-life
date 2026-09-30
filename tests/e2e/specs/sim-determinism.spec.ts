/**
 * Cross-engine determinism of the Pixel Life sim (architecture §5): bundles the sim (`checkCorpus` from
 * packages/shared/src/sim/golden.ts) for the browser, loads it into a blank page in Chromium, WebKit and Firefox, replays
 * the whole golden corpus there and requires every final hash (and score) to equal the committed Node values.
 *
 * It launches the three engines itself, so it runs once (in the desktop-chromium project) regardless of the device
 * projects. An engine that is not installed (`npx playwright install firefox`) is skipped with a message.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type BrowserType, chromium, firefox, webkit } from "@playwright/test";
import { build } from "esbuild";
import { expect, test } from "../fixtures/index.js";

const SIM_DIR = fileURLToPath(new URL("../../../packages/shared/src/sim/", import.meta.url));

interface Result {
  id: string;
  ok: boolean;
  expected: string;
  got: string;
}

async function bundleSim(): Promise<string> {
  const out = await build({
    stdin: { contents: `export { checkCorpus } from "./golden.ts";`, resolveDir: SIM_DIR, loader: "ts" },
    bundle: true,
    format: "iife",
    globalName: "PixelLifeSim",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  const file = out.outputFiles[0];
  if (!file) throw new Error("esbuild produced no bundle");
  return file.text;
}

const ENGINES: readonly [string, BrowserType][] = [
  ["chromium", chromium],
  ["webkit", webkit],
  ["firefox", firefox],
];

test.describe("sim determinism across engines", () => {
  let bundle = "";
  let corpus: unknown[] = [];

  test.beforeAll(async () => {
    bundle = await bundleSim();
    corpus = JSON.parse(readFileSync(`${SIM_DIR}golden-corpus.json`, "utf8")) as unknown[];
  });

  for (const [name, engine] of ENGINES) {
    test(`golden corpus hashes match Node in ${name}`, async ({ browserName: _projectBrowser }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-chromium", "launches its own engines once");
      test.skip(!existsSync(engine.executablePath()), `${name} is not installed (npx playwright install ${name})`);
      test.setTimeout(180_000);
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        await page.setContent("<!doctype html><title>sim determinism</title>");
        await page.addScriptTag({ content: bundle });
        const results = await page.evaluate(
          (cases) =>
            (window as unknown as { PixelLifeSim: { checkCorpus(c: unknown[]): Result[] } }).PixelLifeSim.checkCorpus(
              cases,
            ),
          corpus,
        );
        expect(results.length).toBeGreaterThanOrEqual(200);
        expect(results.filter((r) => !r.ok)).toEqual([]);
      } finally {
        await browser.close();
      }
    });
  }
});
