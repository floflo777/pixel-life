/**
 * Geometry of the "where your RF goes" diagram: the payment is a column on the left, sliced by share; each slice flows
 * as a band into its destination row on the right. Pure so the maths (slices tile the column, bands land centred on
 * their rows, tiny shares stay visible) is unit-tested apart from React.
 */
import { BPS } from "@pl/shared";

/** One band from a source slice to a destination row. */
export interface Band {
  /** Top and bottom of the slice on the source column. */
  y0: number;
  y1: number;
  /** Top and bottom where the band meets its row. */
  t0: number;
  t1: number;
  /** SVG path of the filled band (in a `width` × `height` box). */
  d: string;
  /** SVG path of the band's centre line (for travelling packets). */
  centre: string;
}

/** A destination row's vertical extent (px, from the top of the diagram). */
export interface RowBox {
  top: number;
  height: number;
}

/** Layout options. */
export interface DiagramLayout {
  /** Height of one destination row (px), used when `rows` is not given. */
  rowH: number;
  /** Gap between rows (px), used when `rows` is not given. */
  gap: number;
  /** Measured rows (the legend's real boxes, which grow when text wraps on phones). Must match the share count. */
  rows?: readonly RowBox[];
  /** Width of the band area (px). */
  width: number;
  /** Minimum drawn thickness of a slice, so a 1 % share is still visible (px). */
  minSlice?: number;
}

/** The `n` row boxes: the measured ones when they match `n`, else fixed rows of `rowH` separated by `gap`. */
export function rowBoxes(n: number, l: Pick<DiagramLayout, "rowH" | "gap" | "rows">): RowBox[] {
  if (l.rows && l.rows.length === n) return l.rows.map((b) => ({ top: b.top, height: Math.max(0, b.height) }));
  return Array.from({ length: Math.max(0, n) }, (_, i) => ({ top: i * (l.rowH + l.gap), height: l.rowH }));
}

/** Total height of `n` rows (bottom of the last row box). */
export function diagramHeight(n: number, l: Pick<DiagramLayout, "rowH" | "gap" | "rows">): number {
  const last = rowBoxes(n, l).at(-1);
  return last ? last.top + last.height : 0;
}

const r = (v: number): number => Math.round(v * 100) / 100;

/**
 * Bands for shares `bps` (any order; normally summing to 10 000). Slices tile the full source column top to bottom in
 * order; each is at least `minSlice` thick (the others shrink to make room), and lands centred on its row with the
 * same thickness, capped to the row height.
 */
export function bands(bps: readonly number[], l: DiagramLayout): Band[] {
  const n = bps.length;
  const rows = rowBoxes(n, l);
  const height = diagramHeight(n, l);
  if (n === 0 || height <= 0) return [];
  const min = Math.max(0, l.minSlice ?? 3);
  const total = bps.reduce((s, b) => s + Math.max(0, b), 0);
  // Reserve the minimum for every slice, share the rest by weight: slices sum to `height` exactly. With no weight at
  // all (every share 0) the rest is shared evenly, so the column is still tiled.
  const spare = Math.max(0, height - min * n);
  const thick = bps.map((b) => min + (total > 0 ? (spare * Math.max(0, b)) / total : spare / n));
  const out: Band[] = [];
  let y = 0;
  const w = l.width;
  const c = w / 2;
  for (let i = 0; i < n; i++) {
    const t = thick[i] ?? 0;
    const y0 = y;
    const y1 = y + t;
    y = y1;
    const row = rows[i] ?? { top: 0, height: l.rowH };
    const mid = row.top + row.height / 2;
    const half = Math.max(0, Math.min(t, row.height - 8)) / 2;
    const t0 = mid - half;
    const t1 = mid + half;
    const d =
      `M0 ${r(y0)} C${r(c)} ${r(y0)} ${r(c)} ${r(t0)} ${r(w)} ${r(t0)} ` +
      `L${r(w)} ${r(t1)} C${r(c)} ${r(t1)} ${r(c)} ${r(y1)} 0 ${r(y1)} Z`;
    const ys = (y0 + y1) / 2;
    const centre = `M0 ${r(ys)} C${r(c)} ${r(ys)} ${r(c)} ${r(mid)} ${r(w)} ${r(mid)}`;
    out.push({ y0: r(y0), y1: r(y1), t0: r(t0), t1: r(t1), d, centre });
  }
  return out;
}

/** Travelling packets per band: 1 to 4, by share, so bigger flows look busier. */
export function packetsFor(bps: number): number {
  if (bps <= 0) return 0;
  return Math.min(4, Math.max(1, Math.round((bps / BPS) * 6)));
}
