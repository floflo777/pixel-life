/**
 * "Where your RF goes": an animated split diagram for Regrow, Mend, the Gold Pixel market and the Seed Pack.
 *
 * Reusable in two shapes: the full explainer (tabs + an amount slider, for the Economy page) and a locked single flow
 * with exact amounts (`only` + `input`, for Regrow / Mend confirm dialogs). Every number comes from `rfFlow()`, i.e.
 * from `quote()` / `MARKET` / `SEED_PACK` in `@pl/shared`. Every RF figure carries the SIMULATED (or LIVE) label.
 * The travelling "packets" are stepped and disappear under reduced motion; the legend rows carry all the information.
 */
import { ECON, type EconomyMode, MARKET, MICRO_PER_RF } from "@pl/shared";
import { type RefObject, useId, useLayoutEffect, useRef, useState } from "react";
import { cx, formatBps, formatRf, SimulatedBadge, type TabItem, Tabs, useReducedMotion } from "../ui/index.js";
import { bands, diagramHeight, packetsFor, type RowBox } from "./diagram.js";
import { FLOW_KINDS, type FlowInput, type FlowKind, rfFlow, type RfFlow, seedOdds } from "./flows.js";

/** Props of {@link RfFlowExplainer}. */
export interface RfFlowExplainerProps {
  /** First flow shown (default "regrow"). */
  initial?: FlowKind;
  /** Lock to one flow: no tabs, no slider (confirm dialogs). */
  only?: FlowKind;
  /** Exact inputs (pixels, price, packs, names). With `only`, these are the amounts being paid. */
  input?: FlowInput;
  /** Economy mode for the label (default sim). */
  mode?: EconomyMode;
  /** Heading (default "Where your RF goes"; null hides it, e.g. inside a dialog that has its own title). */
  title?: string | null;
  className?: string;
}

const TAB_LABEL: Record<FlowKind, string> = {
  regrow: "Regrow",
  mend: "Mend",
  market: "Market",
  seed: "Seed Pack",
};

const ROW_H = 64;
const GAP = 8;
const SRC_W = 16;
const BAND_W = 52;
/** Stepped motion (art bible §6): packets hop in 8 steps instead of gliding. */
const STEPS = "0;0.125;0.25;0.375;0.5;0.625;0.75;0.875;1";
const LAYOUT = { rowH: ROW_H, gap: GAP, width: BAND_W, minSlice: 4 } as const;

/** The band + packets drawing (decorative: the rows beside it are the accessible content). */
function FlowBands({ flow, rows }: { flow: RfFlow; rows: readonly RowBox[] | null }) {
  const reduced = useReducedMotion();
  const layout = rows ? { ...LAYOUT, rows } : LAYOUT;
  const bs = bands(
    flow.legs.map((l) => l.bps),
    layout,
  );
  const h = diagramHeight(flow.legs.length, layout);
  return (
    <svg
      className="pl-onb-bands"
      width={SRC_W + BAND_W}
      height={h}
      viewBox={`0 0 ${SRC_W + BAND_W} ${h}`}
      aria-hidden="true"
      focusable="false"
    >
      {bs.map((b, i) => {
        const leg = flow.legs[i];
        if (!leg) return null;
        const n = reduced ? 0 : packetsFor(leg.bps);
        return (
          <g key={leg.key} className={`pl-onb-fill--${leg.kind}`}>
            <rect className="pl-onb-src" x={0} y={b.y0} width={SRC_W} height={Math.max(0, b.y1 - b.y0)} />
            <g transform={`translate(${SRC_W} 0)`}>
              <path className="pl-onb-band" d={b.d} />
              {Array.from({ length: n }, (_, k) => (
                <rect key={k} className="pl-onb-packet" x={-3} y={-3} width={6} height={6}>
                  <animateMotion
                    path={b.centre}
                    dur="1.6s"
                    begin={`${((k * 1.6) / n).toFixed(2)}s`}
                    repeatCount="indefinite"
                    calcMode="discrete"
                    keyPoints={STEPS}
                    keyTimes={STEPS}
                  />
                </rect>
              ))}
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Measures the legend rows (they grow when text wraps on narrow screens) so each band lands on its real row. Returns
 * null until measured or where layout is unavailable (tests), and the fixed-row layout is used instead.
 */
function useRowBoxes(list: RefObject<HTMLUListElement | null>, flow: RfFlow): RowBox[] | null {
  const [rows, setRows] = useState<RowBox[] | null>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = (): void => {
      const items = Array.from(el.children) as HTMLElement[];
      const boxes = items.map((li) => ({ top: li.offsetTop, height: li.offsetHeight }));
      const valid = boxes.length > 0 && boxes.every((b) => b.height > 0);
      setRows((prev) => {
        if (!valid) return null;
        const same =
          prev?.length === boxes.length &&
          prev.every((p, i) => p.top === boxes[i]?.top && p.height === boxes[i]?.height);
        return same ? prev : boxes;
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [list, flow]);
  return rows;
}

/** Slider for the example amount (pixels, price or packs). */
function AmountControl({
  kind,
  input,
  onChange,
}: {
  kind: FlowKind;
  input: FlowInput;
  onChange: (next: FlowInput) => void;
}) {
  const id = useId();
  let label: string;
  let min: number;
  let max: number;
  let value: number;
  let set: (v: number) => FlowInput;
  switch (kind) {
    case "regrow":
    case "mend":
      label = "pixels";
      min = 1;
      max = ECON.mendReceivedDailyPxCap;
      value = input.pixels ?? 10;
      set = (v) => ({ ...input, pixels: v });
      break;
    case "market":
      label = "price (RF)";
      min = MARKET.minPriceMicro / MICRO_PER_RF;
      max = 200;
      value = Math.round((input.priceMicro ?? MARKET.backingMicro) / MICRO_PER_RF);
      set = (v) => ({ ...input, priceMicro: v * MICRO_PER_RF });
      break;
    case "seed":
      label = "packs";
      min = 1;
      max = 10;
      value = input.packs ?? 1;
      set = (v) => ({ ...input, packs: v });
      break;
  }
  return (
    <div className="pl-onb-amount">
      <label htmlFor={id} className="pl-label">
        try another amount · {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(set(Number(e.currentTarget.value)))}
      />
      <output htmlFor={id} className="pl-mono">
        {value}
      </output>
    </div>
  );
}

/** The Seed Pack's published odds, with what each outcome is worth. */
function SeedOddsTable({ mode }: { mode: EconomyMode }) {
  const odds = seedOdds();
  return (
    <div className="pl-table-wrap">
      <table className="pl-table pl-onb-odds">
        <caption className="pl-label">
          published odds, fixed on-chain table <SimulatedBadge mode={mode} />
        </caption>
        <thead>
          <tr>
            <th scope="col">outcome</th>
            <th scope="col">chance</th>
            <th scope="col">worth</th>
            <th scope="col">use</th>
          </tr>
        </thead>
        <tbody>
          {odds.map((o) => (
            <tr key={o.name}>
              <th scope="row">{o.name}</th>
              <td className="pl-num-cell">{formatBps(o.chanceBps)}</td>
              <td className="pl-num-cell">{formatRf(o.rewardMicro, 0)}</td>
              <td>{o.plantPx > 0 ? `plant: +${o.plantPx} px` : "keep: +25 % free healing, or sell"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The flow panel: summary, bands + destination rows, note. */
function FlowPanel({ flow, mode }: { flow: RfFlow; mode: EconomyMode }) {
  const list = useRef<HTMLUListElement>(null);
  const rows = useRowBoxes(list, flow);
  return (
    <div className="pl-onb-flow" data-flow={flow.kind}>
      <p className="pl-onb-pay">
        <span className="pl-label">{flow.expected ? "you pay, on average per" : "you pay for"}</span>{" "}
        <span>{flow.what}</span>
        <span className="pl-num pl-onb-total">{formatRf(flow.totalMicro)}</span>
        <SimulatedBadge mode={mode} />
      </p>
      <div className="pl-onb-diagram" key={flow.kind}>
        <FlowBands flow={flow} rows={rows} />
        <ul ref={list} className="pl-onb-legs" style={{ gridAutoRows: `minmax(${ROW_H}px, auto)`, rowGap: GAP }}>
          {flow.legs.map((l) => (
            <li key={l.key} className="pl-onb-leg" data-leg={l.key}>
              <span className="pl-onb-leg-head">
                <span className={`pl-swatch pl-seg-${l.kind}`} aria-hidden="true" />
                <strong className="pl-onb-leg-label">{l.label}</strong>
                <span className="pl-mono pl-onb-leg-amt">
                  {formatRf(l.micro)} <span className="pl-sub">· {formatBps(l.bps)}</span>
                </span>
              </span>
              <span className="pl-sub pl-onb-leg-hint">{l.hint}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="pl-sub pl-onb-note">{flow.note}</p>
    </div>
  );
}

/** "Where your RF goes" explainer (full, or locked to one flow with exact amounts). */
export function RfFlowExplainer({
  initial = "regrow",
  only,
  input: fixed,
  mode = "sim",
  title = "Where your RF goes",
  className,
}: RfFlowExplainerProps) {
  const [kind, setKind] = useState<FlowKind>(only ?? initial);
  const [inputs, setInputs] = useState<Partial<Record<FlowKind, FlowInput>>>({});
  const active = only ?? kind;
  const input = only ? (fixed ?? {}) : { ...fixed, ...inputs[active] };
  const flow = rfFlow(active, input);
  const tabs: TabItem<FlowKind>[] = FLOW_KINDS.map((k) => ({ id: k, label: TAB_LABEL[k] }));

  const body = (
    <>
      <FlowPanel flow={flow} mode={mode} />
      {!only && (
        <AmountControl kind={active} input={input} onChange={(v) => setInputs((m) => ({ ...m, [active]: v }))} />
      )}
      {active === "seed" && <SeedOddsTable mode={mode} />}
    </>
  );

  return (
    <section className={cx("pl-root pl-onb-explainer", only && "pl-onb-explainer--locked", className)}>
      {title !== null && (
        <header className="pl-card-head">
          <h2 className="pl-display pl-h2">{title}</h2>
          <SimulatedBadge mode={mode} />
        </header>
      )}
      {only ? (
        body
      ) : (
        <Tabs tabs={tabs} value={kind} onChange={setKind} label="Payment type">
          {body}
        </Tabs>
      )}
      {mode === "sim" && (
        <p className="pl-label pl-onb-simnote">
          simulated: the same split the contracts use, run on a demo ledger. no real RF moves.
        </p>
      )}
    </section>
  );
}
