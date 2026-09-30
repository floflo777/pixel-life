/**
 * Pure layer maths for the 2D Friend portrait (art bible §2.1, "2D card" column), kept apart from the canvas so it is
 * unit-testable. Every layer is derived from public state with `@pl/shared`, so every client draws the same Friend.
 */
import {
  and,
  andNot,
  EMPTY_MASK,
  frontMask,
  getBit,
  goldSlots,
  type FriendView,
  type Hex64,
  popcount,
  regrowthOrder,
} from "@pl/shared";
import { COLORS } from "./tokens.js";

/** What one sprite cell shows. `heal-next` is the scar that regrows first for free. */
export type CellState = "empty" | "present" | "scar" | "heal-next" | "gold" | "stitch";

/** The derived layers of a portrait. */
export interface PortraitLayers {
  front: Hex64;
  lost: Hex64;
  gold: Hex64;
  stitched: Hex64;
  /** 256 cell states, index = pid (`y * 16 + x`). */
  cells: readonly CellState[];
  /** Canonical pixel count N0. */
  n0: number;
  /** Present pixels N. */
  n: number;
  /** The scar that heals next for free, or -1. */
  nextHeal: number;
}

/** Options that override the view's own state (e.g. a preview after a Regrow). */
export interface LayerOptions {
  lost?: Hex64;
  stitched?: Hex64;
  /** Mark the next free-regrowth pixel (default true). */
  showNextHeal?: boolean;
}

/**
 * Computes every layer for `view`. Scars are clipped to the front mask; gold never sits on a scar and loaned Friends
 * never show gold (their held rewards are not the guest's); stitches only show on present pixels.
 */
export function portraitLayers(view: FriendView, opts: LayerOptions = {}): PortraitLayers {
  const front = frontMask(view.appearance);
  const lost = and(front, opts.lost ?? view.pub.scars.lost);
  const gold = view.loaned ? EMPTY_MASK : goldSlots(front, lost, view.appearance.tokenId, view.pub.goldHeld);
  const present = andNot(front, lost);
  const stitched = and(present, andNot(opts.stitched ?? view.pub.stitched ?? EMPTY_MASK, gold));
  let nextHeal = -1;
  if (opts.showNextHeal !== false && popcount(lost) > 0) {
    for (const i of regrowthOrder(view.appearance.tokenId)) {
      if (getBit(lost, i)) {
        nextHeal = i;
        break;
      }
    }
  }
  const cells: CellState[] = [];
  for (let i = 0; i < 256; i++) {
    if (!getBit(front, i)) cells.push("empty");
    else if (getBit(lost, i)) cells.push(i === nextHeal ? "heal-next" : "scar");
    else if (getBit(gold, i)) cells.push("gold");
    else if (getBit(stitched, i)) cells.push("stitch");
    else cells.push("present");
  }
  const n0 = popcount(front);
  return { front, lost, gold, stitched, cells, n0, n: n0 - popcount(lost), nextHeal };
}

/** Geometry of a drawn portrait in CSS px. */
export interface PortraitGeometry {
  scale: number;
  /** Margin around the 16×16 grid, room for the halo + keyline. */
  margin: number;
  halo: number;
  keyline: number;
  size: number;
}

/** Portrait geometry for a sprite-pixel `scale` (CSS px per sprite pixel, integer ≥ 2). */
export function portraitGeometry(scale: number): PortraitGeometry {
  const s = Math.max(2, Math.round(scale));
  const halo = Math.max(2, Math.round(s / 4));
  const keyline = s >= 6 ? 2 : 1;
  const margin = halo + keyline + 1;
  return { scale: s, margin, halo, keyline, size: 16 * s + 2 * margin };
}

/** Minimal 2D context surface the painter needs (lets tests pass a recorder). */
export interface Paint2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
}

/** What to paint beyond the layers: halo colour and the selected (to-be-filled) cells. */
export interface PaintOptions {
  haloColor: string | null;
  selected: Hex64;
}

/**
 * Paints `layers` into `ctx` at `geo`: keyline + halo (the body mask dilated, scars count as body so the silhouette
 * stays whole), then cells. Scar = paper + coral dotted rim; heal-next = scar + centred ink dot; selected = scar +
 * centred ink block (the "healing" look, previewing the fill); gold = gold + near-white spec; stitch = ink + coral ring.
 */
export function paintPortrait(ctx: Paint2D, layers: PortraitLayers, geo: PortraitGeometry, opts: PaintOptions): void {
  const { scale: s, margin: m, halo, keyline } = geo;
  ctx.clearRect(0, 0, geo.size, geo.size);
  const body: number[] = [];
  layers.cells.forEach((c, i) => {
    if (c !== "empty") body.push(i);
  });
  if (opts.haloColor) {
    const grow = (g: number, color: string): void => {
      ctx.fillStyle = color;
      for (const i of body) ctx.fillRect(m + (i % 16) * s - g, m + (i >> 4) * s - g, s + 2 * g, s + 2 * g);
    };
    grow(halo + keyline, COLORS.ink);
    grow(halo, opts.haloColor);
  }
  const dot = Math.max(1, Math.round(s / 8));
  for (const i of body) {
    const x = m + (i % 16) * s;
    const y = m + (i >> 4) * s;
    const c = layers.cells[i];
    if (c === "scar" || c === "heal-next") {
      ctx.fillStyle = COLORS.paper;
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = COLORS.coral;
      // Dotted rim: one dot every 2 dots along each inner edge ("coral dotted, never black").
      for (let d = 0; d < s; d += 2 * dot) {
        ctx.fillRect(x + d, y, dot, dot);
        ctx.fillRect(x + d, y + s - dot, dot, dot);
        ctx.fillRect(x, y + d, dot, dot);
        ctx.fillRect(x + s - dot, y + d, dot, dot);
      }
      if (getBit(opts.selected, i)) {
        const b = Math.max(2, Math.round(s * 0.5));
        ctx.fillStyle = COLORS.ink;
        ctx.fillRect(x + (s - b) / 2, y + (s - b) / 2, b, b);
      } else if (c === "heal-next") {
        const b = Math.max(1, Math.round(s * 0.2));
        ctx.fillStyle = COLORS.ink;
        ctx.fillRect(x + (s - b) / 2, y + (s - b) / 2, b, b);
      }
    } else if (c === "gold") {
      ctx.fillStyle = COLORS.gold;
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = COLORS.goldSpec;
      ctx.fillRect(x, y, s, dot);
      ctx.fillRect(x, y, dot, Math.ceil(s / 2));
    } else if (c === "stitch") {
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = COLORS.coral;
      ctx.lineWidth = dot;
      const inset = Math.max(dot, Math.round(s / 4));
      ctx.strokeRect(x + inset - dot / 2, y + inset - dot / 2, s - 2 * inset + dot, s - 2 * inset + dot);
    } else {
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(x, y, s, s);
    }
  }
}
