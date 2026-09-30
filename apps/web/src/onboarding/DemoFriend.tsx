/**
 * A real Friend portrait playing a short scripted loop (knock-off, heal, mend). Frames step on a timer (stepped motion,
 * art bible §6); under reduced motion it holds one representative frame instead.
 */
import type { FriendView } from "@pl/shared";
import { useEffect, useState } from "react";
import { FriendPortrait, portraitGeometry, useReducedMotion } from "../ui/index.js";
import { type DemoFrame, outward } from "./demo.js";

/** Props of {@link DemoFriend}. */
export interface DemoFriendProps {
  view: FriendView;
  frames: readonly DemoFrame[];
  /** Frame held under reduced motion (default the last). */
  still?: number;
  /** CSS px per sprite pixel (default 10). */
  scale?: number;
  /** Accessible description of the whole illustration. */
  label: string;
  /** Pause the loop (e.g. the card is not visible). */
  paused?: boolean;
}

/** Draws `view` running through `frames`, with knocked-off pixels flying beside it. */
export function DemoFriend({ view, frames, still, scale = 10, label, paused = false }: DemoFriendProps) {
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const animate = !reduced && !paused && frames.length > 1;

  useEffect(() => {
    if (!animate) return;
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const next = (): void => {
      t = setTimeout(
        () => {
          i = (i + 1) % frames.length;
          setIdx(i);
          next();
        },
        Math.max(100, frames[i]?.ms ?? 1000),
      );
    };
    setIdx(0);
    next();
    return () => clearTimeout(t);
  }, [animate, frames]);

  const shown = animate ? idx : Math.min(frames.length - 1, Math.max(0, still ?? frames.length - 1));
  const f = frames[shown];
  if (!f) return null;
  const { scale: s, margin } = portraitGeometry(scale);
  return (
    <figure className="pl-onb-demo">
      <div className="pl-onb-demo-stage">
        <FriendPortrait
          view={view}
          scale={s}
          lost={f.lost}
          stitched={f.stitched}
          highlight={f.highlight}
          showNextHeal={false}
          halo
          label={label}
        />
        {f.loose.map((i) => {
          const [dx, dy] = outward(i);
          const x = i % 16;
          const y = i >> 4;
          return (
            <span
              key={i}
              aria-hidden="true"
              className="pl-onb-loose"
              style={{
                width: s,
                height: s,
                left: margin + x * s + Math.round(dx * s * 3.2),
                top: margin + y * s + Math.round(dy * s * 3.2),
              }}
            />
          );
        })}
      </div>
      <figcaption className="pl-label pl-onb-demo-cap" aria-hidden="true">
        {f.caption}
      </figcaption>
    </figure>
  );
}
