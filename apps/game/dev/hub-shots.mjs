// Captures the The Sky playground (dev/hub.html) with headless Chromium (SwiftShader) for comparison with
// docs/design/art/frame2.png, records perf counters, and (with --gif) a short walking GIF via ffmpeg.
// Usage: npm run shots:hub -w @pl/game [-- --only=plaza --gif]
import { execFileSync } from "node:child_process";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const outDir = fileURLToPath(new URL("./shots/hub/", import.meta.url));

async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch {
    const hint = process.env.PLAYWRIGHT_MODULE;
    if (!hint) throw new Error("playwright not found: npm ci at the repo root, or set PLAYWRIGHT_MODULE");
    const req = createRequire(pathToFileURL(hint));
    return (await import(pathToFileURL(req.resolve("playwright")).href)).chromium;
  }
}

const HD = { width: 1280, height: 720 };
const SHOTS = [
  { name: "plaza", query: "n=24&quality=high", viewport: HD, click: [0.62, 0.8] },
  { name: "plaza-60", query: "n=59&quality=medium&stats=1", viewport: HD, settle: 4000 },
  { name: "plaza-rm", query: "n=24&quality=high&rm=1", viewport: HD },
  { name: "phone", query: "n=16&quality=medium", viewport: { width: 360, height: 640 }, scale: 3 },
  { name: "pixel-arena", query: "n=8&quality=high&room=pixel-arena", viewport: HD },
  { name: "seed-booth", query: "n=8&quality=high&room=seed-booth", viewport: HD },
  { name: "sky-docks", query: "n=8&quality=high&room=sky-docks", viewport: HD },
  { name: "daily-gate", query: "n=8&quality=high&room=daily-gate", viewport: HD },
];

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7);
const gif = args.includes("--gif");
const server = await createServer({ configFile: `${here}vite.config.ts`, server: { port: 0 }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) throw new Error("vite did not report a URL");
const chromium = await loadChromium();
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
await mkdir(outDir, { recursive: true });
const report = {};

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};

async function open(page, query) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("fonts.g") && errors.push(m.text()));
  await page.goto(`${base}hub.html?${query}`);
  await Promise.race([
    page.waitForFunction(() => window.__hub?.ready === true, null, { timeout: 180_000 }),
    new Promise((_, rej) => page.on("pageerror", (e) => rej(e))),
  ]);
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

try {
  for (const s of SHOTS) {
    if (only && !s.name.includes(only)) continue;
    const page = await browser.newPage({ viewport: s.viewport, deviceScaleFactor: s.scale ?? 1 });
    const errors = await open(page, s.query);
    if (s.click) await page.mouse.click(s.viewport.width * s.click[0], s.viewport.height * s.click[1]);
    await page.waitForTimeout(s.settle ?? 2500);
    report[s.name] = await page.evaluate(() => {
      const h = window.__hub;
      const ft = h.frameTimes;
      return { tier: h.stage.quality, scene: { ...h.scene.stats }, post: { ...h.stage.post.stats }, frameTimes: ft };
    });
    const ft = report[s.name].frameTimes;
    report[s.name].frameTimes = undefined;
    report[s.name].sceneJsMs = { p50: pct(ft, 50), p95: pct(ft, 95), max: pct(ft, 100) };
    if (errors.length) report[s.name].errors = errors;
    await page.screenshot({ path: `${outDir}${s.name}.png` });
    await page.close();
    console.log(s.name, JSON.stringify(report[s.name]));
  }

  if (gif) {
    const vidDir = `${outDir}video/`;
    await rm(vidDir, { recursive: true, force: true });
    const ctx = await browser.newContext({
      viewport: { width: 960, height: 540 },
      recordVideo: { dir: vidDir, size: { width: 960, height: 540 } },
    });
    const page = await ctx.newPage();
    await open(page, "n=24&quality=medium");
    await page.waitForTimeout(800);
    // A short tour: tap to walk (path preview), emote, walk with the keyboard.
    await page.mouse.click(700, 420);
    await page.waitForTimeout(1500);
    await page.click("button[data-emote=heart]");
    await page.waitForTimeout(900);
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(1200);
    await page.keyboard.up("ArrowLeft");
    await page.click("button[data-say='1']");
    await page.mouse.click(420, 470);
    await page.waitForTimeout(2200);
    await ctx.close();
    const [webm] = (await readdir(vidDir)).filter((f) => f.endsWith(".webm"));
    if (webm) {
      await rename(`${vidDir}${webm}`, `${outDir}hub.webm`);
      execFileSync("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        "1.5",
        "-i",
        `${outDir}hub.webm`,
        "-vf",
        "fps=10,scale=560:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=40[p];[b][p]paletteuse=dither=none",
        `${outDir}hub.gif`,
      ]);
      await rm(`${outDir}hub.webm`, { force: true });
      console.log("gif", `${outDir}hub.gif`);
    }
    await rm(vidDir, { recursive: true, force: true });
  }
} finally {
  await browser.close();
  await server.close();
}
if (!only) await writeFile(`${outDir}stats.json`, `${JSON.stringify(report, null, 2)}\n`);
