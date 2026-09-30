/**
 * The 1200×630 share card (GDD §6.4): the Friend's silhouette with its holes, token id, score, the rule line and the
 * deep link. Drawn with Canvas 2D so it works without the renderer (and on the 1-bit fallback).
 */
import { getBit } from "@pl/shared";
import type { ShareCardData } from "./results";
import { formatScore } from "./hud-format";

const INK = "#111111";
const PAPER = "#eeeeee";
const CORAL = "#ED927E";
const SIGNAL = "#CCFF00";

/** Draws a 16×16 silhouette at `cell` px per pixel: ink present, coral dotted scars. */
export function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  cell: number,
  front: string,
  lost: string,
  loose?: ReadonlySet<number>,
  blink = false,
): void {
  for (let i = 0; i < 256; i++) {
    if (!getBit(front, i)) continue;
    const x = x0 + (i % 16) * cell;
    const y = y0 + (i >> 4) * cell;
    if (loose?.has(i)) {
      if (!blink) {
        ctx.fillStyle = SIGNAL;
        ctx.fillRect(x, y, cell, cell);
      }
    } else if (getBit(lost, i)) {
      // Dotted coral rim: a checker of 1/4-cell dots around the slot.
      ctx.fillStyle = CORAL;
      const d = Math.max(1, Math.floor(cell / 4));
      for (let k = 0; k < cell; k += d * 2) {
        ctx.fillRect(x + k, y, d, d);
        ctx.fillRect(x + k, y + cell - d, d, d);
        ctx.fillRect(x, y + k, d, d);
        ctx.fillRect(x + cell - d, y + k, d, d);
      }
    } else {
      ctx.fillStyle = INK;
      ctx.fillRect(x, y, cell, cell);
    }
  }
}

/** Renders the share card to a canvas (1200×630). Fonts fall back to monospace when Silkscreen isn't loaded. */
export function renderShareCard(card: ShareCardData, canvas?: HTMLCanvasElement): HTMLCanvasElement {
  const c = canvas ?? document.createElement("canvas");
  c.width = 1200;
  c.height = 630;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, 1200, 630);
  // Grid dots (construction surface).
  ctx.fillStyle = "#B0B0B0";
  for (let y = 8; y < 630; y += 16) for (let x = 8; x < 1200; x += 16) ctx.fillRect(x, y, 2, 2);
  // Silhouette card with a hard shadow.
  ctx.fillStyle = INK;
  ctx.fillRect(70, 86, 460, 460);
  ctx.fillStyle = PAPER;
  ctx.fillRect(60, 76, 460, 460);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(62, 78, 456, 456);
  drawSilhouette(ctx, 98, 114, 24, card.front, card.lost);
  const display = "Silkscreen, 'Courier New', monospace";
  const mono = "'Sometype Mono', 'Courier New', monospace";
  ctx.fillStyle = INK;
  ctx.font = `700 44px ${display}`;
  ctx.fillText("LOOSE PIXELS", 580, 130);
  ctx.font = `400 26px ${mono}`;
  ctx.fillText(`#${card.tokenId}${card.day ? ` · daily ${card.day}` : ""}`, 580, 180);
  ctx.font = `700 96px ${display}`;
  ctx.fillText(formatScore(card.score), 580, 300);
  ctx.font = `400 28px ${mono}`;
  ctx.fillText(`kept ${card.kept}/${card.total} px · best combo x${card.bestCombo}`, 580, 360);
  ctx.font = `400 24px ${mono}`;
  wrap(ctx, card.rule, 580, 430, 560, 32);
  // Deep link chip (ink backed lime: "act now").
  ctx.fillStyle = INK;
  ctx.fillRect(580, 500, 560, 52);
  ctx.fillStyle = SIGNAL;
  ctx.font = `700 24px ${mono}`;
  ctx.fillText(`${card.link}  →`, 598, 534);
  return c;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number): void {
  let line = "";
  let yy = y;
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > w && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}
