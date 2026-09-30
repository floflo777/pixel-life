/**
 * Screenshots the creature gallery with headless Chromium (SwiftShader WebGL) for review against style frame 1.
 *
 *   npx tsx apps/game/src/creatures/dev/shoot.ts [--only grid|frame|gulp]
 *
 * Writes PNGs + a stats JSON next to this file under `screenshots/`. Fails on any page or console error.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { createServer } from "vite";
import "./creature-gallery-types";

const { values } = parseArgs({ options: { only: { type: "string" } } });
const repo = fileURLToPath(new URL("../../../../../", import.meta.url));
const root = fileURLToPath(new URL("./", import.meta.url));
const outDir = fileURLToPath(new URL("./screenshots/", import.meta.url));

const SHOTS = [
  { name: "grid", query: "view=grid", viewport: { width: 1600, height: 900 } },
  ...(["nib", "pogo", "clank", "snatch", "slurp", "fizz"] as const).map((k) => ({
    name: `row-${k}`,
    query: `view=grid&kind=${k}`,
    viewport: { width: 1600, height: 500 },
  })),
  { name: "frame", query: "view=frame", viewport: { width: 1280, height: 720 } },
  { name: "gulp", query: "view=gulp", viewport: { width: 1280, height: 720 } },
  { name: "gulp-rising", query: "view=gulp&phase=rising&t=1.6&mood=grumpy", viewport: { width: 1280, height: 720 } },
  {
    name: "gulp-inhale",
    query: "view=gulp&phase=inhale&t=0.3&mood=sleepy&wedge=-1",
    viewport: { width: 1280, height: 720 },
  },
];

const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  server: { port: 0, fs: { allow: [repo] } },
});
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) throw new Error("vite did not report a URL");
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
mkdirSync(outDir, { recursive: true });
const report: Record<string, unknown> = {};
let failed = false;
try {
  for (const s of SHOTS) {
    if (values.only && !s.name.startsWith(values.only)) continue;
    const page = await browser.newPage({ viewport: s.viewport });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("fonts.g")) errors.push(m.text());
    });
    await page.goto(`${base}creature-gallery.html?${s.query}`);
    await page.waitForFunction(() => window.__creatures?.ready === true, undefined, { timeout: 120_000 });
    await page.evaluate(() => {
      const st = window.__creatures?.stage;
      st?.stop();
      st?.renderOnce();
    });
    report[s.name] = await page.evaluate(() => window.__creatures?.stats);
    await page.screenshot({ path: `${outDir}${s.name}.png` });
    if (errors.length) {
      failed = true;
      console.error(`${s.name}: page errors\n${errors.join("\n")}`);
    }
    console.log(s.name, JSON.stringify(report[s.name]));
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(`${outDir}stats.json`, `${JSON.stringify(report, null, 2)}\n`);
if (failed) process.exitCode = 1;
