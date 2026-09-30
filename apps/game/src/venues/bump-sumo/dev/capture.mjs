// Captures Bump Sumo with headless Chromium (SwiftShader): stills of the key beats, a phone-width shot and a GIF.
// Usage: node apps/game/src/venues/bump-sumo/dev/capture.mjs [--only=<name>] [--gif]
// Output: apps/game/src/venues/bump-sumo/dev/shots/*.png (+ bout.gif when ffmpeg is available).
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

async function open(query, viewport = { width: 1280, height: 720 }, extra = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, ...extra });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("fonts.g") && errors.push(m.text()));
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => window.__bs?.ready === true, null, { timeout: 120_000 });
  return { page, errors };
}
const shot = async (page, name) => {
  await page.screenshot({ path: `${outDir}${name}.png` });
  console.log("shot", name);
};

/** In-page autopilot: walk to the nearest rival, charge, release close. Returns a short status. */
const pilot = (page, chargeTicks = 34) =>
  page.evaluate((ct) => {
    const bs = window.__bs;
    const v = bs.instance.debug.view();
    if (!v) return "none";
    const me = v.fighters[0];
    const st = (window.__pilot ??= { charging: 0 });
    let best = null;
    let bd = Infinity;
    v.fighters.forEach((f, i) => {
      if (i === 0 || f.state > 1) return;
      const d = Math.hypot(f.x - me.x, f.z - me.z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    });
    if (!best || me.state > 1) {
      bs.instance.debug.drive(null);
      return "idle";
    }
    const dir = Math.round(((Math.atan2(best.z - me.z, best.x - me.x) / (2 * Math.PI)) * 4096 + 4096) % 4096);
    // Stay off the edge: steer toward the centre when close to the rope.
    const edge = Math.hypot(me.x, me.z) > v.ringR - 7;
    const home = Math.round(((Math.atan2(-me.z, -me.x) / (2 * Math.PI)) * 4096 + 4096) % 4096);
    if (st.charging > 0) {
      st.charging--;
      bs.instance.debug.drive({ move: false, dir, charge: st.charging > 0 });
      return "charge";
    }
    if (edge) {
      bs.instance.debug.drive({ move: true, dir: home, charge: false });
      return "home";
    }
    if (bd < 22) {
      st.charging = ct;
      bs.instance.debug.drive({ move: false, dir, charge: true });
      return "charge";
    }
    bs.instance.debug.drive({ move: true, dir, charge: false });
    return "walk";
  }, chargeTicks);

/** Plays frames of ~1 tick of wall time each via the autopilot until `until(view)` or `max` iterations. */
async function play(page, max, until) {
  for (let i = 0; i < max; i++) {
    await pilot(page);
    await page.waitForTimeout(50);
    if (until && (await page.evaluate(until))) return true;
  }
  return false;
}

try {
  if (want("start")) {
    const { page, errors } = await open("quality=high&seed=11");
    await page.waitForTimeout(800);
    await shot(page, "start");
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  if (want("fight") || want("hit") || want("ringout") || want("results")) {
    const { page, errors } = await open("quality=high&seed=11&auto=1");
    await page.waitForTimeout(1300);
    if (want("fight")) await shot(page, "fight");
    await play(page, 120, () => window.__bs.instance.debug.view().fighters[0].charge > 0.3);
    await shot(page, "charge");
    const hit = await play(page, 300, () => window.__bs.instance.debug.view().debris.length >= 3);
    if (hit) await shot(page, "hit");
    const ro = await play(page, 600, () => document.querySelector(".bs-banner")?.textContent?.startsWith("ring out"));
    if (ro) await shot(page, "ringout");
    if (want("results")) {
      await page.evaluate(() => window.__bs.instance.debug.advance(20000));
      await page.waitForTimeout(1500);
      await shot(page, "results");
    }
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  if (want("phone")) {
    const { page, errors } = await open(
      "quality=medium&seed=5&auto=1",
      { width: 360, height: 740 },
      { hasTouch: true, isMobile: true },
    );
    await page.waitForTimeout(1300);
    await play(page, 200, () => window.__bs.instance.debug.view().debris.length >= 2);
    await shot(page, "phone");
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
  if (gif) {
    const { page, errors } = await open("quality=high&seed=11&auto=1", { width: 960, height: 540 });
    await mkdir(`${outDir}gif`, { recursive: true });
    await page.waitForTimeout(400);
    for (let f = 0; f < 150; f++) {
      await pilot(page);
      await page.screenshot({ path: `${outDir}gif/f${String(f).padStart(3, "0")}.png` });
    }
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
        `${outDir}bout.gif`,
      ]);
      console.log("gif bout.gif");
    } catch (e) {
      console.log("ffmpeg unavailable; frames kept in shots/gif", String(e));
    }
    await rm(`${outDir}gif`, { recursive: true, force: true });
    if (errors.length) console.log("errors", errors);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
