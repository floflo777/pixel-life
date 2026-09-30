/**
 * The 2D Friend portrait: the on-chain 16×16 sprite drawn on a canvas with its scar, gold and stitch layers and the
 * streak-tinted halo. The on-chain art is never altered: "whole" is exactly the canonical sprite.
 *
 * With `selection`, every selectable scar becomes a keyboard-reachable checkbox laid over the canvas (roving tabindex,
 * arrow keys move between scars, Space/Enter toggles), so Regrow and Mend can be driven without a pointer.
 */
import { EMPTY_MASK, familyName, type FriendView, getBit, type Hex64, pixelXY } from "@pl/shared";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "./hooks.js";
import { paintPortrait, portraitGeometry, portraitLayers, type PortraitLayers } from "./portrait.js";
import { streakTier } from "./tokens.js";
import { cx } from "./cx.js";

/** Scar selection for Regrow / Mend. */
export interface PortraitSelection {
  /** Currently selected pixels. */
  selected: Hex64;
  /** Pixels that may be toggled (default: every scar). */
  selectable?: Hex64;
  onToggle: (pixel: number) => void;
  /** Blocks further selection (e.g. a cap reached); already-selected cells stay toggleable off. */
  full?: boolean;
}

/** Props of {@link FriendPortrait}. */
export interface FriendPortraitProps {
  view: FriendView;
  /** CSS px per sprite pixel (default 8; ≥ 6 keeps eyes and holes readable). */
  scale?: number;
  /** Override the scar mask (e.g. live `effectiveLost` or a post-receipt preview). */
  lost?: Hex64;
  /** Override the stitch mask. */
  stitched?: Hex64;
  /** Draw the streak halo (default true). */
  halo?: boolean;
  /** Mark the next free-regrowth pixel (default true). */
  showNextHeal?: boolean;
  selection?: PortraitSelection;
  /** Scars drawn as "about to be filled" without being interactive (confirm screens). */
  highlight?: Hex64;
  /** Accessible name override; `""` hides a decorative portrait (the surrounding control names it). */
  label?: string;
  /** Draw inside a paper frame with an ink border. */
  framed?: boolean;
  className?: string;
}

/** A one-sentence description of the portrait for assistive tech. */
export function describePortrait(view: FriendView, layers: PortraitLayers): string {
  const scars = layers.n0 - layers.n;
  const bits = [
    `Friend #${view.appearance.tokenId}, ${familyName(view.appearance.familyId)}`,
    `${layers.n} of ${layers.n0} pixels`,
    scars > 0 ? `${scars} missing` : "whole",
  ];
  let gold = 0;
  let stitched = 0;
  for (const c of layers.cells) {
    if (c === "gold") gold++;
    else if (c === "stitch") stitched++;
  }
  if (gold > 0) bits.push(`${gold} gold`);
  if (stitched > 0) bits.push(`${stitched} stitched`);
  if (view.loaned) bits.push("on loan");
  return bits.join(", ");
}

/** Index of the nearest selectable cell from `from` in an arrow direction, or `from` if none. */
function stepCell(cells: readonly number[], from: number, key: string): number {
  const [fx, fy] = pixelXY(from);
  let best = from;
  let bestScore = Infinity;
  for (const i of cells) {
    if (i === from) continue;
    const [x, y] = pixelXY(i);
    const dx = x - fx;
    const dy = y - fy;
    const along = key === "ArrowRight" ? dx : key === "ArrowLeft" ? -dx : key === "ArrowDown" ? dy : -dy;
    const across = key === "ArrowRight" || key === "ArrowLeft" ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0) continue;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Draws a Friend's portrait on a canvas, with optional scar selection. */
export function FriendPortrait({
  view,
  scale = 8,
  lost,
  stitched,
  halo = true,
  showNextHeal = true,
  selection,
  highlight,
  label,
  framed = false,
  className,
}: FriendPortraitProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const layers = useMemo(
    () =>
      portraitLayers(view, {
        ...(lost !== undefined ? { lost } : {}),
        ...(stitched !== undefined ? { stitched } : {}),
        showNextHeal,
      }),
    [view, lost, stitched, showNextHeal],
  );
  const geo = useMemo(() => portraitGeometry(scale), [scale]);
  const tier = streakTier(view.pub.streak);
  const selected = selection?.selected ?? highlight ?? EMPTY_MASK;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let ctx: CanvasRenderingContext2D | null;
    try {
      ctx = el.getContext("2d");
    } catch {
      ctx = null;
    }
    // No 2D context (very old browsers, test DOMs): the accessible label and the cell buttons still work.
    if (!ctx) return;
    const dpr = Math.max(1, Math.round(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1));
    el.width = geo.size * dpr;
    el.height = geo.size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    paintPortrait(ctx, layers, geo, { haloColor: halo ? tier.color : null, selected });
  }, [layers, geo, halo, tier.color, selected]);

  const selectable = useMemo(() => {
    if (!selection) return [];
    const mask = selection.selectable ?? layers.lost;
    const out: number[] = [];
    for (let i = 0; i < 256; i++) if (getBit(mask, i) && getBit(layers.lost, i)) out.push(i);
    return out;
  }, [selection, layers.lost]);

  const [focusCell, setFocusCell] = useState<number>(-1);
  const active = selectable.includes(focusCell) ? focusCell : (selectable[0] ?? -1);
  const cellRefs = useRef(new Map<number, HTMLButtonElement>());

  const onCellKey = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const next = stepCell(selectable, i, e.key);
      setFocusCell(next);
      cellRefs.current.get(next)?.focus();
    }
  };

  const name = label ?? describePortrait(view, layers);
  const haloAnimated = halo && tier.tier === 4 && !reduced;

  const body = (
    <div
      className={cx("pl-portrait", haloAnimated && "pl-halo-anim", !framed && className)}
      style={{ width: geo.size, height: geo.size }}
      {...(selection
        ? { role: "group", "aria-label": `${name}. Choose missing pixels.` }
        : name === ""
          ? { "aria-hidden": true }
          : { role: "img", "aria-label": name })}
    >
      <canvas
        ref={canvas}
        width={geo.size}
        height={geo.size}
        style={{ width: geo.size, height: geo.size }}
        aria-hidden="true"
      />
      {selection &&
        selectable.map((i) => {
          const [x, y] = pixelXY(i);
          const on = getBit(selected, i);
          const blocked = !on && selection.full === true;
          return (
            <button
              key={i}
              ref={(el) => {
                if (el) cellRefs.current.set(i, el);
                else cellRefs.current.delete(i);
              }}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={`missing pixel column ${x + 1}, row ${y + 1}`}
              aria-disabled={blocked || undefined}
              tabIndex={i === active ? 0 : -1}
              className="pl-portrait-cell"
              style={{
                left: geo.margin + x * geo.scale,
                top: geo.margin + y * geo.scale,
                width: geo.scale,
                height: geo.scale,
              }}
              onFocus={() => setFocusCell(i)}
              onKeyDown={(e) => onCellKey(e, i)}
              onClick={() => {
                if (!blocked) selection.onToggle(i);
              }}
            />
          );
        })}
    </div>
  );

  return framed ? <div className={cx("pl-portrait-frame", className)}>{body}</div> : body;
}
