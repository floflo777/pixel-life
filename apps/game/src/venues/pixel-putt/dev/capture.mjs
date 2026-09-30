// Captures Pixel Putt with headless Chromium (SwiftShader): stills of the key beats and a short GIF.
// Usage: node apps/game/src/venues/pixel-putt/dev/capture.mjs [--only=<name>] [--gif]
// Output: apps/game/src/venues/pixel-putt/dev/shots/*.png (+ putt.gif when ffmpeg is available).
import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const here = fileURLToPath(new URL(".", import.meta.url));
const outDir = `${here}shots/`;
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const gif = process.argv.includes("--gif");
const want = (n) => !only || n.includes(only);

const server = await createServer({ configFile: `${here}vite.config.ts`, server: { port: 0 }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) throw new Error("vite did not report a URL");
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
await mkdir(outDir, { recursive: true });

async function open(query, viewport = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("fonts.g") && errors.push(m.text()));
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => window.__pp?.ready === true, null, { timeout: 120_000 });
  return { page, errors };
}
const shot = async (page, name) => {
  await page.screenshot({ path: `${outDir}${name}.png` });
  console.log("shot", name);
};
const dbg = (page, fn, arg) => page.evaluate(([f, a]) => window.__pp.instance.debug[f](a), [fn, arg]);
const fling = (page, ang, p) => page.evaluate(([a, q]) => window.__pp.instance.debug.fling(a, q), [ang, p]);
const view = (page) => page.evaluate(() => window.__pp.instance.debug.view());
const course = (page) => page.evaluate(() => window.__pp.instance.debug.course());
/** Angle (0..4095) from the ball toward the cup of the current hole. */
const cupAngle = async (page) => {
  const v = await view(page);
  const c = await course(page);
  const h = c.holes[v.hole];
  const a = Math.atan2(h.cup.z - v.ball.z, h.cup.x - v.ball.x);
  return Math.round((a / (2 * Math.PI)) * 4096 + 4096) % 4096;
};
const holeIndex = async (page, name) => (await course(page)).holes.findIndex((h) => h.name === name);

try {
  if (want("start")) {
    const { page, errors } = await open("quality=high&seed=7");
    await page.waitForTimeout(800);
    await shot(page, "start");
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  if (want("tee") || want("aim") || want("flight")) {
    const { page, errors } = await open("quality=high&seed=7&auto=free");
    await page.waitForTimeout(2200);
    if (want("tee")) await shot(page, "tee");
    await dbg(page, "aim", { ang: await cupAngle(page), p: 0.62 });
    await page.waitForTimeout(300);
    if (want("aim")) await shot(page, "aim");
    await fling(page, await cupAngle(page), 0.62);
    await page.waitForTimeout(260);
    if (want("flight")) await shot(page, "flight");
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  for (const [name, file] of [
    ["windmill", "windmill"],
    ["the gap", "gap"],
    ["sliding bridge", "bridge"],
    ["pinball", "pinball"],
    ["the ferry", "ferry"],
    ["nib patrol", "nibs"],
    ["island hop", "island-hop"],
  ]) {
    if (!want(file)) continue;
    let seed = 1;
    let page;
    let errors;
    // Find a seed whose course has this hole.
    for (; seed < 40; seed++) {
      ({ page, errors } = await open(`quality=high&seed=${seed}&auto=free&mute=1`));
      if ((await holeIndex(page, name)) >= 0) break;
      await page.close();
    }
    const idx = await holeIndex(page, name);
    await page.evaluate((i) => window.__pp.instance.debug.skipTo(i), idx);
    await page.waitForTimeout(1900);
    await dbg(page, "aim", { ang: await cupAngle(page), p: 0.55 });
    await page.waitForTimeout(250);
    await shot(page, `hole-${file}`);
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  if (want("sink") || want("results")) {
    const { page, errors } = await open("quality=high&seed=7&auto=free&mute=1&owner=1");
    await page.waitForTimeout(1500);
    await dbg(page, "autoplay", true);
    // Catch the first sink banner.
    await page.waitForFunction(() => document.querySelector(".pp-banner")?.textContent?.includes("stroke"), null, {
      timeout: 60_000,
    });
    await page.waitForTimeout(250);
    if (want("sink")) await shot(page, "sink");
    await page.evaluate(() => window.__pp.instance.debug.skipTo(8));
    await page.waitForFunction(() => window.__pp.instance.debug.state() === "results", null, { timeout: 120_000 });
    await page.waitForTimeout(600);
    if (want("results")) await shot(page, "results");
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  if (want("phone")) {
    const { page, errors } = await open("quality=medium&seed=7&auto=free&mute=1", { width: 360, height: 740 });
    await page.waitForTimeout(2200);
    await dbg(page, "aim", { ang: await cupAngle(page), p: 0.5 });
    await page.waitForTimeout(300);
    await shot(page, "phone");
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  if (gif) {
    const { page, errors } = await open("quality=high&seed=7&auto=free&mute=1", { width: 800, height: 450 });
    await page.waitForTimeout(1500);
    await rm(`${outDir}gif`, { recursive: true, force: true });
    await mkdir(`${outDir}gif`, { recursive: true });
    await dbg(page, "autoplay", true);
    for (let f = 0; f < 150; f++) {
      await page.screenshot({ path: `${outDir}gif/f${String(f).padStart(3, "0")}.png` });
      await page.waitForTimeout(40);
    }
    if (errors.length) console.log("errors", errors);
    await page.close();
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
        `${outDir}putt.gif`,
      ]);
      console.log("gif", `${outDir}putt.gif`);
    } catch (e) {
      console.log("ffmpeg unavailable, frames left in", `${outDir}gif`, String(e).slice(0, 80));
    }
    await rm(`${outDir}gif`, { recursive: true, force: true });
  }
} finally {
  await browser.close();
  await server.close();
}
