// Captures the Loose Pixels venue with headless Chromium (SwiftShader): stills of the key beats and a short GIF.
// Usage: node apps/game/src/venues/pixel-life/dev/capture.mjs [--only=<name>] [--gif]
// Output: apps/game/src/venues/pixel-life/dev/shots/*.png (+ run.gif when ffmpeg is available).
import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const here = fileURLToPath(new URL(".", import.meta.url));
const outDir = `${here}shots/`;
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const gif = process.argv.includes("--gif");

const server = await createServer({ configFile: `${here}vite.config.ts`, server: { port: 0 }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) throw new Error("vite did not report a URL");
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
await mkdir(outDir, { recursive: true });

async function open(query, viewport = { width: 1280, height: 720 }, scale = 1) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("fonts.g") && errors.push(m.text()));
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => window.__lp?.ready === true, null, { timeout: 120_000 });
  return { page, errors };
}
const shot = async (page, name) => {
  await page.screenshot({ path: `${outDir}${name}.png` });
  console.log("shot", name);
};
const fling = (page, ang, p) => page.evaluate(([a, q]) => window.__lp.instance.debug.fling(a, q), [ang, p]);
const advance = (page, t) => page.evaluate((n) => window.__lp.instance.debug.advance(n), t);
const want = (n) => !only || n.includes(only);

try {
  if (want("start")) {
    const { page, errors } = await open("quality=high&seed=7");
    await page.waitForTimeout(600);
    await shot(page, "start");
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  if (want("run") || want("bite") || want("gulp") || want("results") || gif) {
    const { page, errors } = await open("quality=high&seed=7&auto=free");
    await advance(page, 60 * 9);
    await page.waitForTimeout(400);
    if (want("run")) await shot(page, "run-early");
    // Play: fling toward creatures every ~0.6 s until a bite shows loose pixels.
    for (let i = 0; i < 40; i++) {
      const v = await page.evaluate(() => {
        const view = window.__lp.instance.debug.view();
        const b = view.friend.bodies[0];
        const c = view.creatures[0];
        return { loose: view.debris.length, ang: c ? Math.atan2(c.z - b.z, c.x - b.x) : 0, has: !!c };
      });
      if (v.loose > 0) break;
      if (v.has && i % 3 === 0) await fling(page, Math.round((v.ang / (2 * Math.PI)) * 4096 + 4096) % 4096, 0.5);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(120);
    if (want("bite")) await shot(page, "bite");
    if (gif) {
      await mkdir(`${outDir}gif`, { recursive: true });
      for (let f = 0; f < 45; f++) {
        if (f === 5 || f === 25) {
          const a = await page.evaluate(() => {
            const view = window.__lp.instance.debug.view();
            const b = view.friend.bodies[0];
            const c = view.creatures[0] ?? { x: 0, z: 0 };
            return Math.atan2(c.z - b.z, c.x - b.x);
          });
          await fling(page, Math.round((a / (2 * Math.PI)) * 4096 + 4096) % 4096, 0.9);
        }
        await page.screenshot({ path: `${outDir}gif/f${String(f).padStart(3, "0")}.png` });
      }
    }
    if (want("gulp")) {
      const t = await page.evaluate(() => window.__lp.instance.debug.view().tick);
      await advance(page, Math.max(0, 2530 - t));
      await page.waitForTimeout(900);
      await shot(page, "gulp");
    }
    if (want("results")) {
      const t = await page.evaluate(() => window.__lp.instance.debug.view().tick);
      await advance(page, 3600 - t);
      await page.waitForTimeout(1500);
      await shot(page, "results");
      await page.evaluate(() => {
        const c = window.__lp.instance.debug.shareCanvas();
        if (c) {
          c.style.cssText = "position:fixed;left:0;top:0;width:1200px;height:630px;z-index:99";
          document.body.append(c);
        }
      });
      await page.setViewportSize({ width: 1200, height: 630 });
      await shot(page, "share-card");
    }
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  if (want("phone")) {
    const { page, errors } = await open("quality=medium&seed=3&auto=free", { width: 360, height: 640 }, 2);
    await advance(page, 60 * 6);
    await page.waitForTimeout(500);
    await shot(page, "phone-portrait");
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (gif) {
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      "12",
      "-i",
      `${outDir}gif/f%03d.png`,
      "-vf",
      "scale=640:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none",
      `${outDir}run.gif`,
    ]);
    await rm(`${outDir}gif`, { recursive: true });
    console.log("gif", `${outDir}run.gif`);
  } catch (e) {
    console.log("ffmpeg unavailable; frames kept in shots/gif", String(e).slice(0, 120));
  }
}
