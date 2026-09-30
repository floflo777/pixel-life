import { cx } from "./cx.js";

/** Props of {@link ProgressBlocks}. */
export interface ProgressBlocksProps {
  value: number;
  max: number;
  /** Number of blocks drawn (default = max, capped at 24). */
  blocks?: number;
  /** Accessible name ("pixels", "time left"). */
  label: string;
  /** Human readout for assistive tech ("76 of 82 px"). */
  valueText?: string;
  /** `ink` default, `now` lime (only while the player must act), `coral`, `gold`. */
  tone?: "ink" | "now" | "coral" | "gold";
}

/** A bar that fills block by block (art bible §7: bars fill in steps), exposed as a `meter`. */
export function ProgressBlocks({ value, max, blocks, label, valueText, tone = "ink" }: ProgressBlocksProps) {
  const safeMax = Math.max(1, max);
  const v = Math.min(safeMax, Math.max(0, value));
  const n = Math.max(1, Math.min(blocks ?? Math.min(safeMax, 24), 64));
  const on = v >= safeMax ? n : Math.floor((v / safeMax) * n);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={v}
      aria-valuetext={valueText}
      className={cx("pl-blocks", tone !== "ink" && `pl-blocks--${tone}`)}
    >
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cx("pl-block", i < on && "pl-block--on")} />
      ))}
    </div>
  );
}
