// Browser screenshots of the handheld playground (device frame, desktop + 360 px phone) with headless Chromium.
//   node apps/game/src/handheld/dev/shots.mjs      (headless renders + GIF: npx tsx apps/game/src/handheld/dev/render.ts)
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const outDir = fileURLToPath(new URL("./shots/", import.meta.url));
await mkdir(outDir, { recursive: true });
const server = await createServer({ configFile: `${here}vite.config.ts`, server: { port: 0 }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) throw new Error("vite did not report a URL");
const browser = await chromium.launch();
const SHOTS = [
  { name: "device-home", query: "skipBoot&heal=1800", viewport: { width: 900, height: 900 } },
  { name: "device-run", query: "skipBoot", viewport: { width: 900, height: 900 }, play: true },
  { name: "device-phone", query: "skipBoot", viewport: { width: 360, height: 640 }, scale: 2, play: true },
];
try {
  for (const s of SHOTS) {
    const page = await browser.newPage({ viewport: s.viewport, deviceScaleFactor: s.scale ?? 1 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${base}?${s.query}`);
    await page.waitForFunction(() => window.__hh?.ready === true, null, { timeout: 60_000 });
    await page.waitForTimeout(1200);
    if (s.play) {
      await page.keyboard.press("Space");
      await page.waitForTimeout(1500);
      // Aim, charge for 0.6 s and fling; let the juice play out.
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.down("Space");
      await page.waitForTimeout(600);
      await page.keyboard.up("Space");
      await page.waitForTimeout(700);
    }
    await page.locator(".plhh").screenshot({ path: `${outDir}${s.name}.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(s.name, overflow ? "HORIZONTAL OVERFLOW" : "fits", errors.length ? errors : "no errors");
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
