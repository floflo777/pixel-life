/**
 * The 2D Friend card silhouette (art bible §2.1 "2D card" column): ink = present, paper + coral dots = scar,
 * gold = worn Gold Pixel, ink + coral ring = stitched. The on-chain art is never altered; "whole" = the canonical sprite.
 * With `onToggle`, scar slots become keyboard-focusable checkboxes (Regrow/Mend selection).
 */
import { EMPTY_MASK, frontMask, getBit, goldSlots, type FriendView, type Hex64, pixelXY, toIndices } from "@pl/shared";
import type { KeyboardEvent } from "react";

/** Props of {@link FriendSprite}. */
export interface FriendSpriteProps {
  view: FriendView;
  /** Effective lost mask to draw (defaults to `view.pub.scars.lost`). */
  lost?: Hex64;
  /** CSS pixel size of one sprite pixel. */
  scale?: number;
  /** Selected scar slots (Regrow / Mend picker). */
  selected?: Hex64;
  onToggle?: (pixel: number) => void;
  label?: string;
  className?: string;
}

/** Renders a Friend's front sprite with scars as an SVG (crisp at any scale). */
export function FriendSprite({ view, lost, scale = 4, selected, onToggle, label, className }: FriendSpriteProps) {
  const front = frontMask(view.appearance);
  const lostMask = lost ?? view.pub.scars.lost;
  const gold = view.loaned ? EMPTY_MASK : goldSlots(front, lostMask, view.appearance.tokenId, view.pub.goldHeld);
  const stitched = view.pub.stitched ?? EMPTY_MASK;
  const size = 16 * scale;
  const cells = toIndices(front).map((i) => {
    const [x, y] = pixelXY(i);
    const isLost = getBit(lostMask, i);
    const isSel = selected !== undefined && getBit(selected, i);
    if (isLost) {
      const key = (e: KeyboardEvent<SVGRectElement>): void => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle?.(i);
        }
      };
      return (
        <rect
          key={i}
          x={x + 0.12}
          y={y + 0.12}
          width={0.76}
          height={0.76}
          className={`px-scar${isSel ? " px-selected" : ""}${onToggle ? " px-toggle" : ""}`}
          {...(onToggle
            ? {
                role: "checkbox",
                "aria-checked": isSel,
                "aria-label": `missing pixel ${x + 1},${y + 1}`,
                tabIndex: 0,
                onClick: () => onToggle(i),
                onKeyDown: key,
              }
            : {})}
        />
      );
    }
    const cls = getBit(gold, i) ? "px-gold" : getBit(stitched, i) ? "px-stitch" : "px-ink";
    return <rect key={i} x={x} y={y} width={1} height={1} className={cls} />;
  });
  return (
    <svg
      className={`friend-sprite ${className ?? ""}`}
      viewBox="-1 -1 18 18"
      width={size + 2 * scale}
      height={size + 2 * scale}
      shapeRendering="crispEdges"
      role={onToggle ? "group" : "img"}
      aria-label={label ?? `Friend #${view.appearance.tokenId}`}
    >
      {cells}
    </svg>
  );
}
