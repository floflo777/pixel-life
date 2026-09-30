// Screenshots of the home isle dev page (headless Chromium, SwiftShader). Usage: node apps/game/src/home/dev/shot.mjs
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const out = process.env.HOME_SHOTS_DIR ?? `${here}screenshots/`;
const server = await createServer({
  root: here,
  configFile: false,
  server: { port: 0, fs: { allow: [repoRoot] } },
  logLevel: "error",
});
await server.listen();
const base = server.resolvedUrls?.local[0];
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
await mkdir(out, { recursive: true });
try {
  for (const s of [
    { name: "home", query: "", viewport: { width: 1280, height: 720 } },
    { name: "home-edit", query: "edit=1", viewport: { width: 1280, height: 720 } },
    { name: "home-phone", query: "edit=1&hat=hat_crown", viewport: { width: 360, height: 640 } },
  ]) {
    const page = await browser.newPage({ viewport: s.viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}home.html?${s.query}`);
    await page.waitForFunction(() => window.__homeReady === true, null, { timeout: 120_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}${s.name}.png` });
    if (errors.length) console.error(s.name, errors);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
