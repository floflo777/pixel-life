/**
 * Serves the voxel Friend gallery (`apps/game/src/friend/dev/friend-gallery.html`) with Vite.
 *
 *   npm run gallery -w @pl/assets                → dev server, prints the URL
 *   npm run gallery:shot -w @pl/assets [-- --out <png>] → headless Chromium (SwiftShader WebGL) screenshot + stats JSON
 *
 * The shot fails on any page error or console error, so it doubles as a smoke test of the renderer in a real GL context.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { createServer } from "vite";

const { values } = parseArgs({
  options: { shot: { type: "boolean" }, out: { type: "string" }, port: { type: "string" } },
});
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = fileURLToPath(new URL("../../../apps/game/src/friend/dev/", import.meta.url));
const out = values.out ?? fileURLToPath(new URL("../out/gallery.png", import.meta.url));

const server = await createServer({
  root,
  configFile: false,
  logLevel: values.shot ? "error" : "info",
  server: { port: Number(values.port ?? 5199), strictPort: false, fs: { allow: [repo] } },
});
await server.listen();
const base = server.resolvedUrls?.local[0] ?? "http://localhost:5199/";
const url = `${base}friend-gallery.html`;

if (!values.shot) {
  console.log(`friend gallery: ${url}`);
} else {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__galleryReady === true, undefined, { timeout: 120_000 });
    const stats = await page.evaluate(() => window.__galleryStats);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, fullPage: true });
    writeFileSync(out.replace(/\.png$/, ".stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
    console.log(JSON.stringify(stats, null, 2));
    console.log(`wrote ${out}`);
    if (errors.length) {
      console.error("page errors:\n" + errors.join("\n"));
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

declare global {
  interface Window {
    __galleryReady?: boolean;
    __galleryStats?: unknown;
  }
}
