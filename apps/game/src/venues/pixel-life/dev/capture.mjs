// Captures the Loose Pixels venue on the real sim with headless Chromium (SwiftShader). Time is driven by Playwright's
// fake clock, so every still and GIF frame is taken at an exact game time (12 fps GIF = 83 ms of game per frame).
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
const want = (n) => !only || only.split(",").some((o) => n.includes(o));

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
  await page.evaluate(() => document.fonts.ready);
  // Record the coachmark events the venue dispatches (web onboarding listens for them).
  await page.evaluate(() => {
    window.__coach = [];
    addEventListener("pl:coach", (e) => window.__coach.push(e.detail));
  });
  // From here on the page runs on a fake clock we advance explicitly.
  // install() alone lets time keep flowing in real time; pausing makes screenshots free (no game time passes).
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  await page.clock.runFor(100);
  return { page, errors };
}
const shot = async (page, name) => {
  await page.screenshot({ path: `${outDir}${name}.png` });
  console.log("shot", name);
};
const run = (page, ms) => page.clock.runFor(ms);
const dbg = (page, fn, arg) => page.evaluate(([f, a]) => window.__lp.instance.debug[f](...(a ?? [])), [fn, arg]);
const view = (page) =>
  page.evaluate(() => {
    const v = window.__lp.instance.debug.view();
    const b = v.friend.bodies[0];
    return {
      tick: v.tick,
      loose: v.debris.length,
      ready: v.friend.ready,
      gulp: v.gulp.phase,
      lit: v.gulp.teeth.findIndex((t) => t.lit),
      b: b ? { x: b.x, z: b.z } : null,
      creatures: v.creatures.map((c) => ({ x: c.x, z: c.z, kind: c.kind })),
    };
  });
/** Steps the game in 1/12 s frames until `pred(view)` holds (or `maxMs` of game time passed). */
async function until(page, pred, maxMs = 20_000, stepMs = 83) {
  for (let t = 0; t < maxMs; t += stepMs) {
    const v = await view(page);
    if (pred(v)) return v;
    await run(page, stepMs);
  }
  return view(page);
}

try {
  if (want("start")) {
    const { page, errors } = await open("quality=high&seed=7");
    await run(page, 600);
    await shot(page, "start");
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  if (want("fling") || want("bite") || want("gulp") || want("results")) {
    const { page, errors } = await open("quality=high&seed=7&auto=free");
    await dbg(page, "autopilot", ["expert", 3]);
    await run(page, 7000);
    if (want("fling")) {
      // A real drag: press, pull back (slingshot), hold on the aim preview, release.
      await dbg(page, "autopilot", [null]);
      const v = await until(page, (q) => q.ready && q.creatures.length > 0, 4000);
      const c = v.creatures[0];
      const dx = c && v.b ? Math.sign(c.x - v.b.x) || 1 : 1;
      await page.mouse.move(640, 380);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) {
        await page.mouse.move(640 - dx * i * 22, 380 + i * 6);
        await run(page, 16);
      }
      await run(page, 120);
      await shot(page, "aim");
      await page.mouse.up();
      await run(page, 140);
      await shot(page, "fling");
      await dbg(page, "autopilot", ["expert", 3]);
    }
    if (want("bite")) {
      await dbg(page, "autopilot", ["novice", 5]);
      await until(page, (q) => q.loose >= 2, 20_000, 50);
      await run(page, 250);
      await shot(page, "bite");
      await dbg(page, "autopilot", ["expert", 3]);
    }
    if (want("gulp")) {
      const t = (await view(page)).tick;
      await dbg(page, "advance", [Math.max(0, 2395 - t)]);
      await run(page, 1300);
      await shot(page, "gulp-shadow");
      await until(page, (q) => q.gulp === 2 && q.lit >= 0, 8000);
      await run(page, 700);
      await shot(page, "gulp");
    }
    if (want("results")) {
      const t = (await view(page)).tick;
      await dbg(page, "advance", [Math.max(0, 3590 - t)]);
      await run(page, 3500);
      await shot(page, "results");
      const reported = await page.evaluate(() => {
        const r = window.__lp.harness.log.results.at(-1);
        return r ? { ...r, inputs: r.inputs.length } : null;
      });
      console.log("reported", JSON.stringify(reported));
      console.log("coach", JSON.stringify(await page.evaluate(() => [...new Set(window.__coach)])));
      await page.evaluate(() => {
        const c = window.__lp.instance.debug.shareCanvas();
        if (c) {
          c.style.cssText = "position:fixed;left:0;top:0;width:1200px;height:630px;z-index:99";
          document.body.append(c);
        }
      });
      await page.setViewportSize({ width: 1200, height: 630 });
      await run(page, 50);
      await shot(page, "share-card");
    }
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  if (gif) {
    // 7 s at 12 fps of a clumsy autopilot (bites, loose pixels, sweeps and pops), starting in the first wave.
    const { page, errors } = await open("quality=high&seed=11&auto=free");
    await dbg(page, "autopilot", ["novice", 8]);
    await run(page, 21000);
    await mkdir(`${outDir}gif`, { recursive: true });
    for (let f = 0; f < 84; f++) {
      await page.screenshot({ path: `${outDir}gif/f${String(f).padStart(3, "0")}.png` });
      await run(page, 83);
    }
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  if (want("phone")) {
    const { page, errors } = await open("quality=medium&seed=3&auto=free", { width: 360, height: 640 }, 2);
    await dbg(page, "autopilot", ["expert", 3]);
    await run(page, 9000);
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
