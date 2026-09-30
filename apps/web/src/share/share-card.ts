/**
 * Results share card (GDD §6.4): a 1200×630 PNG with the Friend's silhouette (scars as coral-dotted paper slots), the
 * token id, the score, the rule line and the deep link to its Friend page. Drawn on a canvas in the art-bible look:
 * paper, 2 px ink borders, hard offset shadow, Silkscreen type, no gradients.
 */
import { frontMask, getBit, type Hex64, type FriendAppearance, pixelXY, toIndices } from "@pl/shared";

/** Card size (Open Graph 1.91:1). */
export const SHARE_W = 1200;
export const SHARE_H = 630;

const INK = "#111111";
const PAPER = "#eeeeee";
const CORAL = "#ed927e";
const DISPLAY = "Silkscreen, ui-monospace, monospace";
const MONO = "ui-monospace, 'Sometype Mono', monospace";

/** What the card shows. */
export interface ShareCardData {
  appearance: FriendAppearance;
  lost: Hex64;
  score: number;
  kept: number;
  total: number;
  loaned: boolean;
  /** Absolute link printed on the card (the Friend page or the site). */
  link: string;
}

/** Draws the card on `ctx` (exposed for tests; the canvas must be SHARE_W × SHARE_H). */
export function drawShareCard(ctx: CanvasRenderingContext2D, d: ShareCardData): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  // Card: hard 12 px offset shadow, 6 px ink border.
  ctx.fillStyle = INK;
  ctx.fillRect(56, 56, SHARE_W - 88, SHARE_H - 88);
  ctx.fillStyle = PAPER;
  ctx.fillRect(40, 40, SHARE_W - 88, SHARE_H - 88);
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.strokeRect(43, 43, SHARE_W - 94, SHARE_H - 94);

  // Silhouette: 16×16 at 26 px per sprite pixel.
  const cell = 26;
  const ox = 90;
  const oy = (SHARE_H - 16 * cell) / 2;
  const front = frontMask(d.appearance);
  for (const i of toIndices(front)) {
    const [x, y] = pixelXY(i);
    const px = ox + x * cell;
    const py = oy + y * cell;
    if (getBit(d.lost, i)) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(px, py, cell, cell);
      ctx.fillStyle = CORAL;
      // Coral dotted rim: 4 px dots every 8 px.
      for (let k = 2; k < cell - 2; k += 8) {
        ctx.fillRect(px + k, py + 2, 4, 4);
        ctx.fillRect(px + k, py + cell - 6, 4, 4);
        ctx.fillRect(px + 2, py + k, 4, 4);
        ctx.fillRect(px + cell - 6, py + k, 4, 4);
      }
    } else {
      ctx.fillStyle = INK;
      ctx.fillRect(px, py, cell, cell);
    }
  }

  const tx = ox + 16 * cell + 60;
  ctx.fillStyle = INK;
  ctx.textBaseline = "top";
  ctx.font = `700 34px ${DISPLAY}`;
  ctx.fillText("PIXEL LIFE", tx, 96);
  ctx.font = `700 30px ${DISPLAY}`;
  ctx.fillText(`#${d.appearance.tokenId}${d.loaned ? " · ON LOAN" : ""}`, tx, 150);
  ctx.font = `400 22px ${MONO}`;
  ctx.fillText("score", tx, 222);
  ctx.font = `700 76px ${DISPLAY}`;
  ctx.fillText(String(d.score), tx, 250);
  ctx.font = `400 26px ${MONO}`;
  ctx.fillText(`kept ${d.kept}/${d.total} px`, tx, 350);
  ctx.fillText("every hit knocks a pixel off.", tx, 410);
  ctx.fillText("grab it back, or regrow it.", tx, 444);
  // Ink chip with the link (inverted card).
  ctx.font = `400 20px ${MONO}`;
  const w = Math.min(SHARE_W - tx - 70, ctx.measureText(d.link).width + 28);
  ctx.fillRect(tx, 506, w, 40);
  ctx.fillStyle = PAPER;
  ctx.fillText(d.link, tx + 14, 516, w - 28);
}

/** Renders the card to a PNG blob (waits for the display font so the first share is not in a fallback face). */
export async function shareCardBlob(d: ShareCardData): Promise<Blob> {
  try {
    await document.fonts?.load(`700 34px Silkscreen`);
  } catch {
    // Font loading unsupported: the fallback monospace face is fine.
  }
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable.");
  drawShareCard(ctx, d);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the PNG."))), "image/png"),
  );
}

/** Shares the card with the OS share sheet when files are supported; otherwise downloads it. Returns what happened. */
export async function shareOrDownload(d: ShareCardData): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await shareCardBlob(d);
  const file = new File([blob], `pixel-life-${d.appearance.tokenId}.png`, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  const data: ShareData = {
    files: [file],
    title: "Pixel Life",
    text: `I scored ${d.score} in Pixel Life.`,
    url: d.link,
  };
  if (nav.share && nav.canShare?.(data)) {
    try {
      await nav.share(data);
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
