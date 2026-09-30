import { BPS } from "@pl/shared";
import { formatBps, formatRf } from "./format.js";

/** Where a share of a payment goes. `kind` picks the swatch colour. */
export interface SplitPart {
  label: string;
  bps: number;
  kind: "burn" | "stream" | "friend" | "creator" | "seller" | "reward" | "gold";
  /** Exact amount when known (micro-RF); otherwise only the percentage is shown. */
  micro?: number;
}

/**
 * A stacked bar plus a legend showing where every RF of a payment goes. The legend is the accessible version (a list),
 * the bar is decorative. Parts must total 10 000 bps; a mismatch renders a visible warning (a wiring bug).
 */
export function SplitBar({ parts, label }: { parts: readonly SplitPart[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.bps, 0);
  return (
    <figure className="pl-split" style={{ margin: 0 }}>
      <figcaption className="pl-label">{label}</figcaption>
      <div className="pl-split-bar" aria-hidden="true">
        {parts.map((p) => (
          <span
            key={p.label}
            className={`pl-split-seg pl-seg-${p.kind}`}
            style={{ width: `${(p.bps * 100) / BPS}%` }}
          />
        ))}
      </div>
      <ul className="pl-split-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <span className="pl-row" style={{ gap: 6 }}>
              <span className={`pl-swatch pl-seg-${p.kind}`} aria-hidden="true" />
              {p.label}
            </span>
            <span className="pl-mono">
              {formatBps(p.bps)}
              {p.micro !== undefined && ` · ${formatRf(p.micro)}`}
            </span>
          </li>
        ))}
      </ul>
      {total !== BPS && <p className="pl-inline-error">split does not total 100 %</p>}
    </figure>
  );
}
