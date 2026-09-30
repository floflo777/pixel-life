/**
 * The four handheld screens drawn into an `Lcd`: boot, home (Tama: the Friend at 4× with its scars healing), run (the
 * sim view in 1-bit, frame 3) and results. Each takes a plain model so it renders identically in the browser, in tests
 * and in the headless GIF script. Layout numbers follow `docs/design/art/style.html` frame 3 and art bible §9.
 */
import { getBit, type Hex64 } from "@pl/shared";
import { ADVANCE, GLYPH_H, GLYPH_W, glyph, textWidth } from "./font.js";
import { LCD_SIZE, inEllipse, ditherOn, type Bit, type Lcd } from "./lcd.js";
import { ISLAND_CX, ISLAND_CY, PX_PER_U, PZ_PER_U, islandRadii, toScreen } from "./project.js";
import { creatureGlyph, drawFriend, glyphSize, maskPixels, type FriendPixel } from "./sprites.js";
import { PX, type HandheldView } from "./view.js";
import { AIM_STEPS } from "./input.js";

// ---------------------------------------------------------------------------------------------------------------------
// Shared bits

/** Draws `s` right-aligned so its last pixel column is `right`. */
export function textRight(lcd: Lcd, s: string, right: number, y: number, v: Bit = 1, scale = 1): void {
  lcd.text(s, right - textWidth(s, scale) + 1, y, v, scale);
}

/** Draws `s` centred on column `cx`. */
export function textCenter(lcd: Lcd, s: string, cx: number, y: number, v: Bit = 1, scale = 1): void {
  lcd.text(s, Math.round(cx - textWidth(s, scale) / 2), y, v, scale);
}

/** Ink text with the 1 px paper + 1 px ink halo (callouts over the play field). */
export function haloText(lcd: Lcd, s: string, x: number, y: number): void {
  const chars = [...s];
  lcd.stamp(
    (i, j) => {
      const ch = chars[Math.floor(i / ADVANCE)];
      const u = i % ADVANCE;
      if (ch === undefined || u >= GLYPH_W) return -1;
      return glyph(ch)[j * GLYPH_W + u] === "1" ? 1 : -1;
    },
    x,
    y,
    textWidth(s),
    GLYPH_H,
    { halo: true },
  );
}

/** The inverted top bar (y 0–8) with left / right labels. */
export function topBar(lcd: Lcd, left: string, right: string): void {
  lcd.rect(0, 0, LCD_SIZE, 9, 1);
  lcd.text(left, 2, 2, 0);
  textRight(lcd, right, 125, 2, 0);
}

/** The inverted bottom bar (y 119–127). */
export function bottomBar(lcd: Lcd, left: string, right: string): void {
  lcd.rect(0, 119, LCD_SIZE, 9, 1);
  lcd.text(left, 3, 121, 0);
  textRight(lcd, right, 124, 121, 0);
}

/** Friend pixel states for a run from the sim's per-pixel array (loose/lost/stitched/old scars are paper holes). */
export function runPixelAt(pixels: Uint8Array): (id: number) => FriendPixel {
  return (id) => {
    const p = pixels[id] ?? PX.none;
    return p === PX.none ? "empty" : p === PX.body ? "ink" : "hole";
  };
}

/** The floating island (art bible §9): paper top with grid dots every 8 px and an ink rim, then 50/75/100 % strata. */
export function drawIsland(lcd: Lcd, rx: number, ry: number, cx = ISLAND_CX, cy = ISLAND_CY, side = 9): void {
  const tail = 14;
  for (let y = -ry; y <= ry + side + tail; y++)
    for (let x = -rx; x <= rx; x++) {
      if (inEllipse(x, y, rx, ry)) continue;
      const yy = y - side;
      const inSide = y > 0 && inEllipse(x, Math.max(0, yy), rx, ry);
      const taper = rx * (1 - Math.max(0, y - ry) / (side + tail));
      // Hash-jittered taper edge so the underside hangs like a stalactite rather than a smooth cone.
      const jag = 1 - ((x * 7 + y * 3) & 7) / 40;
      if (!inSide && !(y > ry && Math.abs(x) < taper * jag)) continue;
      const level = y < ry + 4 ? 0.5 : y < ry + 10 ? 0.75 : 1;
      lcd.set(cx + x, cy + y, ditherOn(cx + x, cy + y, level) ? 1 : 0);
    }
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++) {
      if (!inEllipse(x, y, rx, ry)) continue;
      const dot = ((x + y) & 7) === 0 && ((x - y) & 7) === 0 && inEllipse(x, y, rx * 0.92, ry * 0.92);
      lcd.set(cx + x, cy + y, dot ? 1 : 0);
    }
  lcd.ellipse(cx, cy, rx, ry, 1);
  // Grass tufts (frame 3), placed proportionally so every arena size gets the same scatter.
  for (const [u, v] of TUFTS) {
    const x = Math.round(cx + u * rx);
    const y = Math.round(cy + v * ry);
    lcd.set(x, y);
    lcd.set(x + 2, y);
    lcd.set(x + 1, y - 1);
  }
}

/** Tuft positions as fractions of the island radii. */
const TUFTS: readonly (readonly [number, number])[] = [
  [-0.25, -0.36],
  [0.57, -0.18],
  [0.11, 0.82],
  [-0.43, 0.09],
  [0.71, 0.64],
  [0.36, 0.27],
];

/** A 10-ray starburst (frame 3 impact star) centred at (x, y); `grow` 0..1 scales the rays. */
export function starburst(lcd: Lcd, x: number, y: number, grow = 1): void {
  for (let k = 0; k < 10; k++) {
    const an = (k / 10) * Math.PI * 2;
    const len = Math.round((k % 2 ? 6 : 10) * (0.6 + 0.4 * grow));
    for (let r = 3; r < len; r++) lcd.set(x + Math.round(Math.cos(an) * r), y + Math.round(Math.sin(an) * r), 1);
  }
  lcd.rect(x - 1, y - 1, 3, 3, 0);
}

/**
 * The impact frame's "inverse video" (frame 3, middle screen): the whole screen inverts, and a 9-point star around the
 * contact point flips back, rimmed in ink.
 */
export function inverseVideo(lcd: Lcd, ix: number, iy: number): void {
  lcd.invert();
  for (let y = -34; y <= 34; y++)
    for (let x = -34; x <= 34; x++) {
      const an = Math.atan2(y, x);
      const tri = Math.abs((((((an / (Math.PI * 2)) * 9 + 0.25) % 1) + 1) % 1) - 0.5) * 2;
      const R = 14 + 18 * tri ** 1.6;
      const r = Math.hypot(x, y);
      if (r < R - 3) lcd.flip(ix + x, iy + y);
      else if (r < R) lcd.set(ix + x, iy + y, 1);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Boot

/** Boot screen model: `t` seconds since power-on. */
export interface BootModel {
  t: number;
  front: Hex64;
  frame: number;
}

/** Boot: a 2-frame inverse flash, the Friend's silhouette dithering in (12 → 100 %), the logo, then a blinking prompt. */
export function drawBoot(lcd: Lcd, m: BootModel): void {
  lcd.clear(0);
  if (m.t < 0.07) {
    lcd.clear(1);
    return;
  }
  lcd.dither(0, 0, LCD_SIZE, LCD_SIZE, 0.12);
  const levels = [0.12, 0.25, 0.5, 0.75, 1];
  const level = levels[Math.min(levels.length - 1, Math.floor((m.t - 0.07) / 0.12))] ?? 1;
  // Paper plate, then the silhouette at 3× filled with the current dither level.
  lcd.rect(28, 12, 72, 72, 0);
  lcd.frame(28, 12, 72, 72, 1);
  lcd.stamp(
    (i, j) => {
      const id = Math.floor(j / 4) * 16 + Math.floor(i / 4);
      if (!getBit(m.front, id)) return -1;
      return ditherOn(32 + i, 16 + j, level) ? 1 : 0;
    },
    32,
    16,
    64,
    64,
    { halo: false },
  );
  lcd.rect(0, 88, LCD_SIZE, 40, 0);
  lcd.line(0, 88, 127, 88, 1);
  if (m.t > 0.5) textCenter(lcd, "PIXEL LIFE", 64, 93, 1, 2);
  if (m.t > 0.8) textCenter(lcd, "128x128 . 1-BIT", 64, 107, 1);
  if (m.t > 1.1 && Math.floor(m.frame / 12) % 2 === 0) {
    lcd.rect(40, 116, 48, 9, 1);
    textCenter(lcd, "● START", 64, 118, 0);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Home (Tama)

/** A home menu entry: a label and a second line (price, mode). */
export interface MenuItem {
  id: string;
  label: string;
  sub: string;
}

/** Home screen model. */
export interface HomeModel {
  tokenId: string;
  /** The mask drawn this frame (an idle-down frame) and the scar holes on it. */
  mask: Hex64;
  holes: Hex64;
  sprout: number;
  growth: number;
  lostCount: number;
  nextInMs: number | null;
  wholeInMs: number | null;
  menu: readonly MenuItem[];
  selected: number;
  frame: number;
  /** Wander offset in px (the Friend drifts inside its window). */
  dx: number;
  dy: number;
  /** A short status line replacing the scar text (e.g. "HEALED 4 PX"), or null. */
  toast: string | null;
  loaned: boolean;
  /** Formatters injected so the screen stays pure. */
  fmtShort: (ms: number) => string;
  fmtClock: (ms: number) => string;
}

/** Home (art bible §9): the Friend at 4× in a paper window on a 12 % field, scar text, and an inverted menu button. */
export function drawHome(lcd: Lcd, m: HomeModel): void {
  lcd.clear(0);
  lcd.dither(0, 0, LCD_SIZE, LCD_SIZE, 0.12);
  topBar(lcd, `#${m.tokenId}`.slice(0, 16), m.nextInMs === null ? "WHOLE" : m.fmtClock(m.nextInMs));
  lcd.rect(26, 14, 76, 76, 0);
  lcd.frame(26, 14, 76, 76, 1);
  drawFriend(lcd, maskPixels(m.mask, m.holes, m.sprout), 32 + m.dx, 20 + m.dy, {
    scale: 4,
    halo: false,
    frame: Math.floor(m.frame / 8),
    sproutGrowth: m.growth,
  });
  // Re-draw the window frame so a wandering Friend never breaks it.
  lcd.frame(26, 14, 76, 76, 1);

  lcd.rect(0, 96, LCD_SIZE, 32, 0);
  if (m.toast) {
    lcd.text(m.toast.slice(0, 14), 4, 99, 1);
  } else if (m.lostCount === 0) {
    lcd.text("NO SCARS", 4, 99, 1);
    lcd.text("ALL WHOLE", 4, 106, 1);
  } else {
    lcd.text("SCARS HEAL", 4, 99, 1);
    lcd.text(`${m.lostCount} PX . ${m.wholeInMs === null ? "-" : m.fmtShort(m.wholeInMs)}`, 4, 106, 1);
  }
  if (m.loaned) lcd.text("LOANED", 4, 113, 1);
  lcd.text("◄ ● ►", 4, 121, 1);

  const item = m.menu[m.selected];
  if (item) {
    lcd.rect(64, 97, 60, 26, 1);
    lcd.rect(66, 99, 56, 1, 0);
    textCenter(lcd, item.label, 94, 102, 0);
    textCenter(lcd, item.sub, 94, 111, 0);
    if (m.menu.length > 1) {
      lcd.text("<", 66, 106, 0);
      lcd.text(">", 118, 106, 0);
    }
    // Page dots under the button.
    const n = m.menu.length;
    for (let i = 0; i < n; i++) {
      const x = 94 - (n - 1) * 2 + i * 4;
      lcd.set(x, 125, 1);
      if (i === m.selected) lcd.rect(x - 1, 124, 3, 3, 1);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Run

/** Transient juice for the run screen, owned by the app. */
export interface RunFx {
  /** Frames counter (30 fps) for blinking. */
  frame: number;
  aim: number;
  charge: number;
  timeLeftTicks: number;
  /** Last points gained and frames since (bottom bar shows `+N` for 30 frames). */
  lastGain: number;
  gainAge: number;
  impacts: readonly { x: number; y: number; age: number }[];
  callouts: readonly { x: number; y: number; text: string; age: number }[];
  /** "BONK!" chip frames left and where. */
  bonk: { x: number; y: number; left: number } | null;
  /** Invert this frame (impact), at contact (x, y). */
  inverse: { x: number; y: number } | null;
  /** Reduced motion: a 2 px ink border instead of the inversion. */
  reducedMotion: boolean;
  shake: { dx: number; dy: number };
  paused: boolean;
  /** Screen-space slingshot drag in progress (touch), from the Friend. */
  drag: { dx: number; dy: number } | null;
}

/** HUD time blocks: 10 blocks, one per 6 s left (rounded up). */
export function timeBlocks(timeLeftTicks: number, totalTicks: number): number {
  if (timeLeftTicks <= 0) return 0;
  return Math.min(10, Math.ceil((timeLeftTicks / totalTicks) * 10));
}

/** `M:SS` for ticks at 60 Hz (rounded up). */
export function clockTicks(ticks: number): string {
  const s = Math.max(0, Math.ceil(ticks / 60));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Present / total sprite pixels in a run view. */
export function pixelTally(pixels: Uint8Array): { present: number; total: number } {
  let present = 0;
  let total = 0;
  for (const p of pixels) {
    if (p !== PX.none) total++;
    if (p === PX.body) present++;
  }
  return { present, total };
}

/** The in-run screen (frame 3, left): HUD bars, island, creatures at 2×, the Friend at 2×, loose pixels, aim, juice. */
export function drawRun(lcd: Lcd, v: HandheldView, fx: RunFx, totalTicks: number): void {
  lcd.clear(0);
  const { rx, ry } = islandRadii(v.arena.a, v.arena.b);
  drawIsland(lcd, rx, ry);
  if (v.arena.pondA > 0) {
    const p = islandRadii(v.arena.pondA, v.arena.pondB);
    lcd.fillEllipse(ISLAND_CX, ISLAND_CY, p.rx, p.ry, 1);
    lcd.rect(ISLAND_CX - p.rx / 2, ISLAND_CY - 1, 3, 1, 0);
  }
  for (const b of v.arena.bumpers) {
    const s = toScreen(b.x, b.z);
    const r = Math.max(2, Math.round(b.r * PX_PER_U * 0.8));
    lcd.fillEllipse(s.sx, s.sy - 1, r, Math.max(1, Math.round(r * 0.7)), b.active ? 1 : 0);
    if (b.active) lcd.set(s.sx - 1, s.sy - 2, 0);
  }

  // Draw back-to-front by screen y so nearer things overlap farther ones.
  type Item = { y: number; draw: () => void };
  const items: Item[] = [];
  const body = v.friend.bodies[0];

  for (const c of v.creatures) {
    const s = toScreen(c.x, c.z, c.y);
    const g = creatureGlyph(c.kind);
    const { w, h } = glyphSize(g);
    items.push({
      y: toScreen(c.x, c.z).sy,
      draw: () => {
        if (c.spawning > 0) {
          const r = 3 + ((c.spawning >> 2) & 3);
          lcd.ellipse(s.sx, s.sy, r * 2, r, 1, true);
          return;
        }
        const ground = toScreen(c.x, c.z);
        if (c.y > 0.5) lcd.fillEllipse(ground.sx, ground.sy, 5, 2, 1, 0.5);
        // Telegraph = the glyph blinks inverted (no colour for "now").
        const inv = c.telegraph && Math.floor(fx.frame / 3) % 2 === 0;
        const bob = c.stun > 0 ? 0 : Math.floor(fx.frame / 6 + c.id) % 2;
        lcd.blit(g, s.sx - w, s.sy - 2 * h + 1 - bob, { scale: 2, invert: inv });
        if (c.stun > 0 && Math.floor(fx.frame / 5) % 2 === 0) lcd.text("x", s.sx - 1, s.sy - 2 * h - 6, 1);
      },
    });
  }

  if (body && v.friend.ringout === 0) {
    // A Mitosis Friend that has split draws each half from its own pixels (`half`); otherwise body 0 owns them all.
    const split = v.friend.bodies.length > 1 && v.friend.half !== undefined;
    const blinkOff = v.friend.invulnerable && Math.floor(fx.frame / 2) % 2 === 1;
    v.friend.bodies.forEach((b, bi) => {
      const g = toScreen(b.x, b.z);
      // A flung Friend arcs: its lift follows its speed, so it lands as it slows (frame 3's mid-air Friend).
      const hop = b.flying ? Math.round(Math.min(20, Math.hypot(b.vx, b.vz) * 0.4)) : 0;
      const all = runPixelAt(v.friend.pixels);
      const half = v.friend.half;
      const pixelAt = split && half ? (id: number) => ((half[id] ?? 0) === bi ? all(id) : "empty") : all;
      items.push({
        y: g.sy,
        draw: () => {
          lcd.fillEllipse(g.sx, g.sy, 12, 3, 1, 0.5);
          if (b.flying) speedLines(lcd, g.sx, g.sy - 14 - hop, b.vx, b.vz);
          if (!blinkOff) drawFriend(lcd, pixelAt, g.sx - 16, g.sy - 30 - hop, { scale: 2 });
        },
      });
    });
  } else if (body) {
    // Off the edge: a shrinking dotted ring where it fell.
    const g = toScreen(body.x, body.z);
    items.push({ y: g.sy, draw: () => lcd.ellipse(g.sx, g.sy, 8, 4, 1, true) });
  }

  for (const d of v.debris) {
    const s = toScreen(d.x, d.z, d.y);
    items.push({
      y: toScreen(d.x, d.z).sy,
      draw: () => {
        lcd.rect(s.sx, s.sy, 2, 2, 1);
        const lastCall = d.left < 36;
        if (lastCall && Math.floor(fx.frame / 4) % 2 === 1) return;
        // The bracket closes in 4 steps as the grab window runs out.
        const step = Math.max(0, Math.min(3, Math.ceil((d.left / Math.max(1, d.window)) * 4) - 1));
        brackets(lcd, s.sx, s.sy, 3 + step);
      },
    });
  }
  for (const c of v.crumbs ?? []) {
    const s = toScreen(c.x, c.z);
    if (c.left < 60 && Math.floor(fx.frame / 3) % 2 === 1) continue;
    items.push({ y: s.sy, draw: () => crumb(lcd, s.sx, s.sy - 2) });
  }
  if (v.gulp) drawGulp(lcd, v.gulp, v.arena.a, v.arena.b, fx.frame, items);
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();

  // Aim: stepped dots from the Friend (frame 3 trajectory), longer with charge.
  if (body && v.friend.ready && v.friend.ringout === 0 && !fx.paused) {
    const g = toScreen(body.x, body.z);
    if (fx.drag) {
      lcd.line(g.sx, g.sy - 14, g.sx + fx.drag.dx, g.sy - 14 + fx.drag.dy, 1, [1, 1]);
    } else {
      const an = (fx.aim / AIM_STEPS) * Math.PI * 2;
      const ux = Math.cos(an) * PX_PER_U;
      const uz = Math.sin(an) * PZ_PER_U;
      const n = Math.hypot(ux, uz) || 1;
      const dots = fx.charge > 0 ? 2 + fx.charge : 3;
      for (let i = 1; i <= dots; i++) {
        const x = Math.round(g.sx + (ux / n) * (10 + i * 6));
        const y = Math.round(g.sy - 4 + (uz / n) * (10 + i * 6));
        if (fx.charge > 0) lcd.rect(x, y, 2, 2, 1);
        else lcd.set(x, y, 1);
      }
    }
  }

  for (const im of fx.impacts) starburst(lcd, im.x, im.y, Math.min(1, im.age / 3));
  for (const c of fx.callouts)
    haloText(lcd, c.text, c.x - Math.round(textWidth(c.text) / 2), c.y - Math.floor(c.age / 3));

  // HUD.
  const t = pixelTally(v.friend.pixels);
  lcd.rect(0, 0, LCD_SIZE, 9, 1);
  lcd.text(`${t.present}/${t.total}PX`, 2, 2, 0);
  const blocks = timeBlocks(fx.timeLeftTicks, totalTicks);
  for (let i = 0; i < 10; i++) {
    if (i < blocks) lcd.rect(46 + i * 4, 2, 3, 5, 0);
    else lcd.set(47 + i * 4, 4, 0);
  }
  textRight(lcd, clockTicks(fx.timeLeftTicks), 125, 2, 0);
  const lastCall = v.debris.some((d) => d.left < 36);
  const left =
    v.debris.length > 0
      ? lastCall && Math.floor(fx.frame / 4) % 2 === 1
        ? ""
        : `GRAB ${v.debris.length}`
      : v.friend.chain > 10
        ? `CHAIN x${(v.friend.chain / 10).toFixed(1)}`
        : `POPS ${v.stats.smashed}`;
  bottomBar(lcd, left, fx.gainAge < 30 && fx.lastGain > 0 ? `+${fx.lastGain}` : String(v.score));

  if (fx.bonk && fx.bonk.left > 0) {
    const bx = Math.max(1, Math.min(LCD_SIZE - 27, fx.bonk.x));
    lcd.rect(bx, fx.bonk.y, 26, 9, 0);
    lcd.frame(bx - 1, fx.bonk.y - 1, 28, 11, 1);
    lcd.text("BONK!", bx + 2, fx.bonk.y + 2, 1);
  }
  if (fx.paused) {
    lcd.rect(36, 56, 56, 15, 1);
    textCenter(lcd, "PAUSED", 64, 61, 0);
  }
  if (fx.inverse) {
    if (fx.reducedMotion) {
      lcd.frame(0, 0, LCD_SIZE, LCD_SIZE, 1);
      lcd.frame(1, 1, LCD_SIZE - 2, LCD_SIZE - 2, 1);
    } else inverseVideo(lcd, fx.inverse.x, fx.inverse.y);
  }
  if (!fx.reducedMotion) lcd.shift(fx.shake.dx, fx.shake.dy, 0);
}

/** A Gulp star crumb: a 5 px plus with a paper centre. */
export function crumb(lcd: Lcd, x: number, y: number): void {
  lcd.rect(x - 2, y, 5, 1, 1);
  lcd.rect(x, y - 2, 1, 5, 1);
  lcd.set(x, y, 0);
}

/**
 * Old Gulp in 1-bit: the telegraph is a dotted mouth ring; its bite is two dashed cut lines from the centre to the rim
 * with the wedge between them hatched; teeth are 2× fangs (a lit tooth blinks inverted, a hit tooth is hollow).
 * Items are pushed into the depth-sorted list so teeth overlap correctly with the Friend and creatures.
 */
export function drawGulp(
  lcd: Lcd,
  g: NonNullable<HandheldView["gulp"]>,
  a: number,
  b: number,
  frame: number,
  items: { y: number; draw: () => void }[],
): void {
  if (g.phase === 0 || g.phase >= 5) return;
  /** Rim point of the island along world heading `ang` (0..4095). */
  const rim = (ang: number) => {
    const t = (ang / 4096) * Math.PI * 2;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const k = 1 / Math.sqrt((c / a) ** 2 + (sn / b) ** 2);
    return toScreen(c * k, sn * k);
  };
  if (g.shadow) {
    const m = toScreen(g.mouthX, g.mouthZ);
    lcd.ellipse(m.sx, m.sy, 10, 5, 1, true);
    if (Math.floor(frame / 4) % 2 === 0) lcd.ellipse(m.sx, m.sy, 6, 3, 1, true);
  }
  if (g.wedgeOn) {
    // The bitten-out wedge reads as a hole: 50 % dither over the ground inside it, cut lines on its two edges.
    const { rx, ry } = islandRadii(a, b);
    const half = (g.wedgeHalf / 4096) * Math.PI * 2;
    const dir = (g.wedgeDir / 4096) * Math.PI * 2;
    for (let y = -ry; y <= ry; y++)
      for (let x = -rx; x <= rx; x++) {
        if (!inEllipse(x, y, rx, ry)) continue;
        const ang = Math.atan2(y / PZ_PER_U, x / PX_PER_U);
        const d = Math.abs(((ang - dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d > half) continue;
        const sx = ISLAND_CX + x;
        const sy = ISLAND_CY + y;
        lcd.set(sx, sy, ditherOn(sx, sy, 0.5) ? 1 : 0);
      }
    const c = toScreen(0, 0);
    for (const side of [-1, 1]) {
      const e = rim(g.wedgeDir + side * g.wedgeHalf);
      lcd.line(c.sx, c.sy, e.sx, e.sy, 1);
    }
  }
  for (const t of g.teeth) {
    const s = toScreen(t.x, t.z);
    items.push({
      y: s.sy,
      draw: () => {
        const inv = t.lit && Math.floor(frame / 3) % 2 === 0;
        // A 7 × 8 fang: filled triangle, hollow once hit.
        for (let j = 0; j < 8; j++) {
          const half = Math.floor((8 - j) / 2);
          for (let i = -half; i <= half; i++) {
            const edge = i === -half || i === half || j === 0;
            const on = t.hit ? edge : true;
            if (on) lcd.set(s.sx + i, s.sy - 8 + j, inv ? 0 : 1);
            else lcd.set(s.sx + i, s.sy - 8 + j, 0);
          }
        }
        if (inv) lcd.frame(s.sx - 5, s.sy - 10, 11, 11, 1);
      },
    });
  }
}

/** Four L-shaped corner brackets around a 2×2 loose pixel at (x, y), `d` px out. */
export function brackets(lcd: Lcd, x: number, y: number, d: number): void {
  for (const [dx, dy] of [
    [-d, -d],
    [d + 1, -d],
    [-d, d + 1],
    [d + 1, d + 1],
  ] as const) {
    lcd.set(x + dx, y + dy);
    lcd.set(x + dx + (dx < 0 ? 1 : -1), y + dy);
    lcd.set(x + dx, y + dy + (dy < 0 ? 1 : -1));
  }
}

/** Frame 3 speed ticks: 3 dashes (5 on, 2 off, 2 on) trailing behind a flying Friend. */
export function speedLines(lcd: Lcd, x: number, y: number, vx: number, vz: number): void {
  const sx = vx * PX_PER_U;
  const sy = vz * PZ_PER_U;
  const n = Math.hypot(sx, sy);
  if (n < 1e-6) return;
  const ux = sx / n;
  const uy = sy / n;
  for (const off of [-8, 0, 8]) {
    const bx = x - ux * 20 - uy * off;
    const by = y - uy * 20 + ux * off;
    lcd.line(bx, by, bx - ux * 8, by - uy * 8, 1, [5, 2, 2, 20]);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Results

/** Where the result report stands (drives the status line and retry). */
export type ReportState = "sending" | "saved" | "guest" | "practice" | "unverified" | "error";

/** Results screen model. */
export interface ResultsModel {
  score: number;
  front: Hex64;
  /** Holes (all scars now) and the ones new this run (blink). */
  holes: Hex64;
  fresh: Hex64;
  smashed: number;
  recovered: number;
  lost: number;
  report: ReportState;
  frame: number;
  /** Top-bar title: "TIME UP" (default) or "CRUMBLED" when the Friend ran out of pixels. */
  title?: string;
  /** Run kind shown top right ("DAILY" runs rank on the shared daily board). */
  kind?: "free" | "daily";
}

/** Results: big score, the Friend at 2× with this run's new scars blinking, run counters, report status, next steps. */
export function drawResults(lcd: Lcd, m: ResultsModel): void {
  lcd.clear(0);
  lcd.dither(0, 9, LCD_SIZE, 110, 0.12);
  topBar(lcd, m.title ?? "TIME UP", m.kind === "daily" ? "▣ DAILY" : "▣ FREE");
  lcd.rect(4, 13, 120, 24, 0);
  lcd.frame(4, 13, 120, 24, 1);
  lcd.text("SCORE", 8, 16, 1);
  textRight(lcd, String(m.score), 119, 20, 1, 3);

  lcd.rect(4, 41, 48, 48, 0);
  lcd.frame(4, 41, 48, 48, 1);
  const blinkOn = Math.floor(m.frame / 8) % 2 === 0;
  drawFriend(
    lcd,
    (id) => {
      if (!getBit(m.front, id)) return "empty";
      if (getBit(m.fresh, id)) return blinkOn ? "ink" : "hole";
      return getBit(m.holes, id) ? "hole" : "ink";
    },
    12,
    49,
    { scale: 2, halo: false },
  );

  lcd.rect(56, 41, 68, 48, 0);
  lcd.frame(56, 41, 68, 48, 1);
  const rows: [string, number][] = [
    ["POPS", m.smashed],
    ["GRABS", m.recovered],
    ["LOST PX", m.lost],
  ];
  rows.forEach(([k, n], i) => {
    lcd.text(k, 60, 46 + i * 9, 1);
    textRight(lcd, String(n), 119, 46 + i * 9, 1);
  });
  lcd.line(60, 74, 119, 74, 1, [1, 1]);
  const status: Record<ReportState, string> = {
    sending: Math.floor(m.frame / 6) % 2 ? "SENDING." : "SENDING..",
    saved: "SAVED",
    guest: "GUEST RUN",
    practice: "PRACTICE",
    unverified: "UNVERIFIED",
    error: "OFFLINE",
  };
  lcd.text(status[m.report], 60, 78, 1);

  lcd.rect(4, 93, 120, 22, 0);
  lcd.frame(4, 93, 120, 22, 1);
  if (m.report === "error") {
    lcd.text("NOT SENT: RETRY", 8, 97, 1);
    lcd.text("WITH ● OR SKIP ◄", 8, 105, 1);
  } else {
    lcd.text(m.lost > 0 ? `${m.lost} NEW SCAR${m.lost === 1 ? "" : "S"}` : "NO NEW SCARS", 8, 97, 1);
    lcd.text(m.lost > 0 ? "THEY HEAL AT HOME" : "CLEAN RUN!", 8, 105, 1);
  }
  bottomBar(lcd, "◄ HOME", m.report === "error" ? "● RETRY" : "● AGAIN");
}
