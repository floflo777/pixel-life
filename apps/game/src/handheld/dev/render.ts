/**
 * Headless capture of the handheld (no browser: the rasteriser is pure). Drives the real app with the venue-kit test
 * host and a small bot through boot → home (scars healing, time-lapsed) → run → results, and writes to `dev/shots/`:
 * stills of every screen at ×4, a frame-3-style contact sheet, and `handheld.gif` (needs `ffmpeg` on PATH).
 *
 *   npx tsx apps/game/src/handheld/dev/render.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HandheldApp } from "../app.js";
import { createFakeSim } from "../fake-sim.js";
import { RUN_TICKS } from "@pl/shared";
import { LCD_SIZE, INK_RGB, PAPER_RGB, Lcd } from "../lcd.js";
import { drawRun } from "../screens.js";
import { frame3Scene } from "./frame3-scene.js";
import { jsonInputEncoder } from "../mount.js";
import { toScreen } from "../project.js";
import { devHost } from "./fixture.js";

const out = fileURLToPath(new URL("./shots/", import.meta.url));
const tmp = `${out}frames/`;
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

// ---- image helpers (grey PGM, converted to PNG by ffmpeg)
interface Img {
  w: number;
  h: number;
  px: Uint8Array;
}
const img = (w: number, h: number, v = PAPER_RGB): Img => ({ w, h, px: new Uint8Array(w * h).fill(v) });
function lcdImg(buf: Uint8Array, scale: number): Img {
  const o = img(LCD_SIZE * scale, LCD_SIZE * scale);
  for (let y = 0; y < o.h; y++)
    for (let x = 0; x < o.w; x++)
      o.px[y * o.w + x] = buf[Math.floor(y / scale) * LCD_SIZE + Math.floor(x / scale)] ? INK_RGB : PAPER_RGB;
  return o;
}
function blit(dst: Img, src: Img, x: number, y: number): void {
  for (let j = 0; j < src.h; j++)
    for (let i = 0; i < src.w; i++) {
      const X = x + i;
      const Y = y + j;
      if (X >= 0 && Y >= 0 && X < dst.w && Y < dst.h) dst.px[Y * dst.w + X] = src.px[j * src.w + i] ?? 0;
    }
}
function fill(dst: Img, x: number, y: number, w: number, h: number, v: number): void {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) if (x + i < dst.w && y + j < dst.h) dst.px[(y + j) * dst.w + x + i] = v;
}
/** A screen with the style-frame card treatment: 3 px ink border and a hard ink shadow. */
function card(dst: Img, src: Img, x: number, y: number, shadow: number): void {
  fill(dst, x - 3 + shadow, y - 3 + shadow, src.w + 6, src.h + 6, INK_RGB);
  fill(dst, x - 3, y - 3, src.w + 6, src.h + 6, INK_RGB);
  blit(dst, src, x, y);
}
function writePng(name: string, im: Img): void {
  const pgm = `${tmp}${name}.pgm`;
  writeFileSync(pgm, Buffer.concat([Buffer.from(`P5\n${im.w} ${im.h}\n255\n`), Buffer.from(im.px)]));
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", pgm, `${out}${name}.png`]);
}

// ---- drive the app
const harness = devHost();
const app = new HandheldApp({
  host: harness.host,
  now: () => harness.now,
  createSim: createFakeSim,
  encodeInputs: jsonInputEncoder,
  newRunId: () => "dev-run",
});

// Frame 3 restaged through the real renderer (before any healing), plus its impact frame.
const f3 = frame3Scene(harness.host.identity.friend);
const f3lcd = new Lcd();
drawRun(f3lcd, f3.view, f3.fx, RUN_TICKS);
const frame3Run = f3lcd.buf.slice();
drawRun(f3lcd, f3.view, { ...f3.fx, inverse: { x: 40, y: 58 }, bonk: { x: 78, y: 100, left: 5 } }, RUN_TICKS);
const frame3Impact = f3lcd.buf.slice();

const gif: Uint8Array[] = [];
let recording = true;
const stills: Record<string, Uint8Array> = {};
const inkShare = (b: Uint8Array) => b.reduce((a, v) => a + v, 0) / b.length;

function tick(ms: number): boolean {
  const fresh = app.update(ms / 1000);
  if (fresh && recording) gif.push(app.lcd.buf.slice());
  return fresh;
}
function wait(ms: number, each?: () => void): void {
  for (let t = 0; t < ms; t += 1000 / 60) {
    each?.();
    tick(1000 / 60);
  }
}
function tap(b: "left" | "ok" | "right" | "back", holdMs = 60): void {
  app.pad.press(b, app.time);
  wait(holdMs);
  app.pad.release(b, app.time);
}
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

// Boot.
wait(1600);
stills.boot = app.lcd.buf.slice();
tap("ok");
wait(400);
// Home: time-lapse the healing (8 min of wall clock per rendered frame).
for (let i = 0; i < 70; i++) {
  harness.advance(3 * 60_000);
  tick(1000 / 30);
  if (i === 20) stills.home = app.lcd.buf.slice();
}
tap("right");
wait(500);
stills.homeRegrow = app.lcd.buf.slice();
tap("left");
wait(300);
tap("ok");

// Run with a bot: slingshot at the nearest creature (or loose pixel) whenever the Friend is ready.
let cooldown = 0;
let flings = 0;
let bestScore = -1;
function bot(): void {
  const v = app.runView;
  if (!v || app.screen !== "run") return;
  if (cooldown-- > 0 || !v.friend.ready) return;
  const b = v.friend.bodies[0];
  if (!b) return;
  const targets = [
    ...v.debris.map((d) => ({ x: d.x, z: d.z })),
    ...v.creatures.filter((c) => c.spawning === 0).map((c) => ({ x: c.x, z: c.z })),
  ];
  if (!targets.length) return;
  targets.sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z));
  const t = targets[0];
  if (!t) return;
  const g = toScreen(b.x, b.z);
  const s = toScreen(t.x, t.z);
  // A human-ish bot: aims with some error, so creatures get their bites in and pixels fly.
  const err = Math.sin(flings++ * 2.7) * 0.6;
  const dx0 = s.sx - g.sx;
  const dy0 = s.sy - g.sy;
  const dx = dx0 * Math.cos(err) - dy0 * Math.sin(err);
  const dy = dx0 * Math.sin(err) + dy0 * Math.cos(err);
  const n = Math.hypot(dx, dy) || 1;
  const len = Math.min(40, Math.max(10, n * 0.55));
  app.pointer("down", 64, 64);
  app.pointer("up", 64 - (dx / n) * len, 64 - (dy / n) * len);
  cooldown = 100;
}
for (let i = 0; i < 60 * 9; i++) {
  bot();
  if (tick(1000 / 60)) {
    const v = app.runView;
    const buf = app.lcd.buf;
    if (inkShare(buf) > 0.5 && !stills.impact) stills.impact = buf.slice();
    if (v && inkShare(buf) < 0.5) {
      // The most frame-3-like moment: loose pixels in the air, a crowd, and the Friend mid-fling.
      const score =
        Math.min(4, v.debris.length) * 10 + Math.min(4, v.creatures.length) * 3 + (v.friend.bodies[0]?.flying ? 5 : 0);
      if (score > bestScore) {
        bestScore = score;
        stills.run = buf.slice();
      }
    }
  }
}
// Fast-forward (unrecorded) to the last 2 s of the run.
recording = false;
while (app.screen === "run" && (app.runView?.tick ?? 0) < 3600 - 120) {
  bot();
  tick(1000 / 60);
}
recording = true;
for (let i = 0; i < 60 * 4 && app.screen === "run"; i++) {
  bot();
  tick(1000 / 60);
}
await settle();
wait(1800);
await settle();
wait(200);
stills.results = app.lcd.buf.slice();
if (!stills.run) stills.run = stills.results;
if (!stills.impact) stills.impact = stills.run;

// ---- stills + contact sheet (frame 3 layout: run ×4, impact ×2, home ×2, on the grid-dot construction page)
for (const [k, b] of Object.entries(stills)) writePng(k, lcdImg(b, 4));
const sheet = img(1280, 720);
for (let y = 8; y < sheet.h; y += 16) for (let x = 8; x < sheet.w; x += 16) fill(sheet, x, y, 2, 2, 0xb0);
card(sheet, lcdImg(frame3Run, 4), 72, 120, 8);
card(sheet, lcdImg(frame3Impact, 2), 664, 120, 6);
card(sheet, lcdImg(stills.home ?? stills.run, 2), 952, 120, 6);
card(sheet, lcdImg(stills.run, 2), 664, 420, 6);
card(sheet, lcdImg(stills.results, 2), 952, 420, 6);
writePng("sheet", sheet);
writePng("frame3-restaged", lcdImg(frame3Run, 4));
writePng("frame3-impact", lcdImg(frame3Impact, 4));
// Side by side with the art-bible target (its main screen is the 512 px square at (72, 120) of frame3.png).
const target = fileURLToPath(new URL("../../../../../docs/design/art/frame3.png", import.meta.url));
execFileSync("ffmpeg", [
  "-loglevel",
  "error",
  "-y",
  "-i",
  target,
  "-i",
  `${out}frame3-restaged.png`,
  "-filter_complex",
  "[0:v]crop=512:512:72:120,format=gray[a];[1:v]format=gray[b];[a][b]hstack=inputs=2",
  `${out}frame3-compare.png`,
]);

// ---- GIF (×3, 30 fps), via ffmpeg with a 2-colour palette.
gif.forEach((b, i) => {
  const im = lcdImg(b, 3);
  writeFileSync(
    `${tmp}g${String(i).padStart(5, "0")}.pgm`,
    Buffer.concat([Buffer.from(`P5\n${im.w} ${im.h}\n255\n`), Buffer.from(im.px)]),
  );
});
execFileSync("ffmpeg", [
  "-loglevel",
  "error",
  "-y",
  "-framerate",
  "30",
  "-i",
  `${tmp}g%05d.pgm`,
  "-vf",
  "split[a][b];[a]palettegen=max_colors=2:reserve_transparent=0[p];[b][p]paletteuse=dither=none",
  "-loop",
  "0",
  `${out}handheld.gif`,
]);
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${Object.keys(stills).length} stills, sheet.png and handheld.gif (${gif.length} frames) to ${out}`);
console.log("run log:", harness.log.results.length, "results,", harness.log.cues.length, "cues");
