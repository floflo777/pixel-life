import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./hooks.js";
import { cx } from "./cx.js";

/** Steps a count-up takes (art bible §7: numbers count in 4 steps). */
export const COUNT_STEPS = 4;
const STEP_MS = 60;

/** Props of {@link PixelNumber}. */
export interface PixelNumberProps {
  value: number;
  /** Formats the displayed value (default: integer). */
  format?: (n: number) => string;
  /** Pixel size in CSS px (default 22). */
  size?: number;
  /** Accessible text override (default: formatted final value). */
  label?: string;
  className?: string;
}

/**
 * A Silkscreen 700 number that counts to a new value in 4 stepped frames (no easing); instant under reduced motion.
 * Screen readers always get the final value, never the intermediate frames.
 */
export function PixelNumber({
  value,
  format = (n) => String(Math.round(n)),
  size = 22,
  label,
  className,
}: PixelNumberProps) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (reduced || start === value) {
      setShown(value);
      return;
    }
    let step = 0;
    const t = setInterval(() => {
      step++;
      setShown(step >= COUNT_STEPS ? value : start + ((value - start) * step) / COUNT_STEPS);
      if (step >= COUNT_STEPS) clearInterval(t);
    }, STEP_MS);
    return () => clearInterval(t);
  }, [value, reduced]);

  return (
    <span className={cx("pl-num", className)} style={{ fontSize: size }}>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="pl-sr-only">{label ?? format(value)}</span>
    </span>
  );
}
