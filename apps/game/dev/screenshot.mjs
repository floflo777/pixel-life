// Captures the playground with headless Chromium (SwiftShader) for visual comparison with
// docs/design/art/frame2.png. Usage: npm run shots -w @pl/game [-- --only=hub]
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const outDir = fileURLToPath(new URL("./shots/", import.meta.url));

async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch {
    // Fallback for machines where the repo's e2e workspace isn't installed.
    const hint = process.env.PLAYWRIGHT_MODULE;
    if (!hint) throw new Error("playwright not found: npm ci at the repo root, or set PLAYWRIGHT_MODULE");
    const req = createRequire(pathToFileURL(hint));
    return (await import(pathToFileURL(req.resolve("playwright")).href)).chromium;
  }
}

const SHOTS = [
  { name: "hub-high", query: "quality=high", viewport: { width: 1280, height: 720 } },
  { name: "hub-medium", query: "quality=medium", viewport: { width: 1280, height: 720 } },
  { name: "hub-low", query: "quality=low", viewport: { width: 1280, height: 720 } },
  { name: "hub-burst", query: "quality=high&burst=330,150", viewport: { width: 1280, height: 720 }, wait: 330 },
  { name: "hub-impact", query: "quality=high", viewport: { width: 1280, height: 720 }, impact: true },
  { name: "phone-portrait", query: "quality=medium", viewport: { width: 360, height: 640 }, scale: 3 },
];

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const server = await createServer({ configFile: `${here}vite.config.ts`, server: { port: 0 }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (!base) throw new Error("vite did not report a URL");
const chromium = await loadChromium();
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
await mkdir(outDir, { recursive: true });
const report = {};
try {
  for (const s of SHOTS) {
    if (only && !s.name.includes(only)) continue;
    const page = await browser.newPage({ viewport: s.viewport, deviceScaleFactor: s.scale ?? 1 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${base}?${s.query}`);
    await page.waitForFunction(() => window.__pl?.ready === true, null, { timeout: 120_000 });
    if (s.impact) {
      // Freeze on the first impact frame: stop the loop, request, render exactly one frame.
      await page.evaluate(() => {
        const st = window.__pl.stage;
        st.stop();
        st.post.impacts.requestFrame(performance.now(), 2);
        st.renderOnce();
      });
    } else if (s.wait) {
      await page.evaluate(() => {
        const st = window.__pl.stage;
        st.stop();
      });
      await page.evaluate(() => {
        const st = window.__pl.stage;
        st.post.impacts.requestBurst(330, 150);
        st.post.impacts.next();
        st.post.impacts.next();
        st.renderOnce();
      });
    } else {
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__pl.stage.stop());
      await page.evaluate(() => window.__pl.stage.renderOnce());
    }
    report[s.name] = await page.evaluate(() => ({
      tier: window.__pl.stage.quality,
      ...window.__pl.stage.post.stats,
      sceneTrianglesBuilt: window.__pl.triangles,
    }));
    if (errors.length) report[s.name].errors = errors;
    await page.screenshot({ path: `${outDir}${s.name}.png` });
    await page.close();
    console.log(s.name, JSON.stringify(report[s.name]));
  }
} finally {
  await browser.close();
  await server.close();
}
await writeFile(`${outDir}stats.json`, `${JSON.stringify(report, null, 2)}\n`);
