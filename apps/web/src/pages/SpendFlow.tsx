/**
 * Regrow and Mend (GDD §5.3): select missing pixels on the portrait → server quote → confirm showing exactly where
 * every RF goes (burn / stream / to-Friend) → receipt. Nothing is deducted in the UI until the server's receipt arrives,
 * and failures stay inline with a retry (GDD §6.10). The server recomputes every price; the local `quote()` preview is
 * the same pure function, so what the player sees while selecting is what the server will charge.
 */
import {
  and,
  andNot,
  ECON,
  type EconomyAction,
  type EconomyMode,
  type EconomyReceipt,
  type EconomyRequestReq,
  effectiveLost,
  EMPTY_MASK,
  frontMask,
  fromIndices,
  type FriendView,
  getBit,
  type Hex64,
  nextRegrowthAt,
  or,
  popcount,
  quote as pureQuote,
  type QuoteRes,
  regrowthOrder,
  setBit,
  type TokenIdStr,
  wholeAt,
} from "@pl/shared";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  formatClock,
  formatDuration,
  formatRf,
  FriendPortrait,
  PixelNumber,
  shortHash,
  SimulatedBadge,
  SplitBar,
  useNow,
} from "../ui/index.js";
import { quoteParts } from "./economy.js";

/** Props shared by {@link RegrowFlow} and {@link MendFlow}. */
export interface SpendFlowProps {
  /** The Friend whose scars are filled (own Friend for Regrow, the target for Mend). */
  view: FriendView;
  mode: EconomyMode;
  /** Payer's balance in micro-RF (sim), or null when unknown (live: the wallet checks). */
  balanceMicro: number | null;
  /** `POST /api/economy/quote`. */
  getQuote: (action: EconomyAction) => Promise<QuoteRes>;
  /** `POST /api/economy/regrow` or `/mend` (live mode: after the wallet signed, with `txHash`). */
  submit: (req: EconomyRequestReq) => Promise<EconomyReceipt>;
  /** Called from the receipt screen. */
  onDone?: (receipt: EconomyReceipt) => void;
  onCancel?: () => void;
  /** When set, spending is not possible and this sentence says why (e.g. guests: "Use your own Friend"). */
  blockedReason?: string | null;
  /** Maps a thrown error to a user-facing sentence (the shell's `errorMessage`). */
  errorMessage?: (e: unknown) => string;
  /** Pixels preselected (e.g. from the results card). */
  initialSelection?: Hex64;
  /** Pinned clock for tests. */
  now?: number;
}

/** Props of {@link MendFlow}: Mend also needs the paying Friend. */
export interface MendFlowProps extends SpendFlowProps {
  /** The payer's own Friend (its RF pays; it cannot be the target). */
  payer: TokenIdStr;
}

type Step =
  | { name: "select" }
  | { name: "quoting" }
  | { name: "confirm"; quote: QuoteRes }
  | { name: "paying"; quote: QuoteRes }
  | { name: "receipt"; receipt: EconomyReceipt; stitched: Hex64 };

const defaultError = (e: unknown): string => (e instanceof Error && e.message ? e.message : "Something went wrong.");

/** The first `k` pixels of `mask` in the Friend's regrowth order (quick picks). */
export function firstPixels(mask: Hex64, k: number, tokenId: TokenIdStr): Hex64 {
  const out: number[] = [];
  for (const i of regrowthOrder(tokenId)) {
    if (out.length >= k) break;
    if (getBit(mask, i)) out.push(i);
  }
  return fromIndices(out);
}

function SpendFlow({
  kind,
  payer,
  view,
  mode,
  balanceMicro,
  getQuote,
  submit,
  onDone,
  onCancel,
  blockedReason,
  errorMessage = defaultError,
  initialSelection,
  now: fixedNow,
}: SpendFlowProps & { kind: "regrow" | "mend"; payer: TokenIdStr }) {
  const now = useNow(1000, fixedNow);
  const tokenId = view.appearance.tokenId;
  const goldHeld = view.loaned ? 0 : view.pub.goldHeld;
  const front = useMemo(() => frontMask(view.appearance), [view.appearance]);
  const lost = useMemo(
    () => and(effectiveLost(view.pub.scars, now, tokenId, { goldHeld }), front),
    [view.pub.scars, now, tokenId, goldHeld, front],
  );
  const missing = popcount(lost);
  const n0 = popcount(front);
  const cap = kind === "mend" ? Math.min(ECON.mendReceivedDailyPxCap, ECON.maxPxPerAction) : ECON.maxPxPerAction;

  const [rawSel, setRawSel] = useState<Hex64>(initialSelection ?? EMPTY_MASK);
  // A pixel that healed for free while the player was choosing drops out of the selection by itself.
  const selected = and(rawSel, lost);
  const count = popcount(selected);
  const [step, setStep] = useState<Step>({ name: "select" });
  const [error, setError] = useState<string | null>(null);

  const action: EconomyAction | null =
    count === 0
      ? null
      : kind === "regrow"
        ? { kind: "regrow", tokenId, pixels: selected }
        : { kind: "mend", payer, target: tokenId, pixels: selected };
  const preview = action ? pureQuote(action, mode) : null;
  const unit = kind === "regrow" ? ECON.regrowMicroPerPx : ECON.mendMicroPerPx;
  const verb = kind === "regrow" ? "regrow" : "mend";

  const title = `${verb} #${tokenId}`;

  if (blockedReason) {
    return (
      <Card title={title}>
        <EmptyState glyph="✋" title="not with this Friend">
          {blockedReason}
        </EmptyState>
        {onCancel && <Button onClick={onCancel}>back</Button>}
      </Card>
    );
  }
  if (kind === "mend" && payer === tokenId) {
    return (
      <Card title={title}>
        <EmptyState glyph="↺" title="this is your own Friend">
          Use Regrow for your own Friend: Mend is a gift to someone else.
        </EmptyState>
        {onCancel && <Button onClick={onCancel}>back</Button>}
      </Card>
    );
  }

  const toggle = (i: number): void => {
    setError(null);
    setRawSel((s) => setBit(and(s, lost), i, !getBit(s, i)));
  };
  const pick = (k: number): void => {
    setError(null);
    setRawSel(firstPixels(lost, Math.min(k, cap), tokenId));
  };

  const requestQuote = async (): Promise<void> => {
    if (!action) return;
    setError(null);
    setStep({ name: "quoting" });
    try {
      const q = await getQuote(action);
      setStep({ name: "confirm", quote: q });
    } catch (e) {
      setError(errorMessage(e));
      setStep({ name: "select" });
    }
  };

  const pay = async (q: QuoteRes): Promise<void> => {
    setError(null);
    setStep({ name: "paying", quote: q });
    try {
      const req: EconomyRequestReq = { action: q.action, ...(q.quoteId ? { quoteId: q.quoteId } : {}) };
      const receipt = await submit(req);
      const filled = q.action.pixels;
      const stitched =
        kind === "mend" ? or(view.pub.stitched ?? EMPTY_MASK, filled) : (view.pub.stitched ?? EMPTY_MASK);
      setStep({ name: "receipt", receipt, stitched });
    } catch (e) {
      setError(errorMessage(e));
      setStep({ name: "confirm", quote: q });
    }
  };

  // ── Receipt ──
  if (step.name === "receipt") {
    const r = step.receipt;
    const q = r.quote;
    const px = popcount(q.action.pixels);
    const after = and(r.scars.lost, front);
    return (
      <Card title={`${verb} done`} variant="hero" actions={<SimulatedBadge mode={q.mode} />} aria-live="polite">
        <div className="pl-grid-2">
          <FriendPortrait view={view} lost={after} stitched={step.stitched} scale={10} framed />
          <div className="pl-stack">
            <p className="pl-display pl-h2" role="status">
              +{px} px · #{tokenId} at {n0 - popcount(after)}/{n0}
            </p>
            <dl className="pl-dl">
              <dt>paid</dt>
              <dd className="pl-num">{formatRf(q.totalMicro)}</dd>
              {r.balanceMicro !== undefined && (
                <>
                  <dt>balance now</dt>
                  <dd className="pl-num">{formatRf(r.balanceMicro)}</dd>
                </>
              )}
              <dt>receipt</dt>
              <dd className="pl-mono">{shortHash(r.id)}</dd>
              {r.txHash && (
                <>
                  <dt>transaction</dt>
                  <dd className="pl-mono">{shortHash(r.txHash)}</dd>
                </>
              )}
            </dl>
            <SplitBar parts={quoteParts(q)} label="where it went" />
            {kind === "mend" && (
              <p className="pl-sub">Your stitches show on its pixels for 7 days. Its owner gets a note.</p>
            )}
            {onDone && (
              <Button variant="now" onClick={() => onDone(r)}>
                done
              </Button>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // ── Confirm ──
  if (step.name === "confirm" || step.name === "paying") {
    const q = step.quote;
    const px = popcount(q.action.pixels);
    const short = balanceMicro !== null && balanceMicro < q.totalMicro;
    const paying = step.name === "paying";
    return (
      <Card title={`confirm ${verb}`} variant="hero" actions={<SimulatedBadge mode={q.mode} />}>
        <div className="pl-grid-2">
          <FriendPortrait
            view={view}
            lost={lost}
            scale={8}
            framed
            highlight={q.action.pixels}
            label={`#${tokenId}, ${px} pixels to fill`}
          />
          <div className="pl-stack">
            <p className="pl-display pl-h2">
              {px} px × {formatRf(unit)} = {formatRf(q.totalMicro)}
            </p>
            <SplitBar parts={quoteParts(q)} label="where every RF goes" />
            <dl className="pl-dl">
              {kind === "mend" && (
                <>
                  <dt>paid by</dt>
                  <dd>#{payer}</dd>
                </>
              )}
              {balanceMicro !== null && (
                <>
                  <dt>balance</dt>
                  <dd className="pl-num">
                    {formatRf(balanceMicro)} → {formatRf(Math.max(0, balanceMicro - q.totalMicro))}
                  </dd>
                </>
              )}
              {q.lockedUntil !== undefined && q.lockedUntil > now && (
                <>
                  <dt>price held</dt>
                  <dd className="pl-mono">{formatClock(q.lockedUntil - now)}</dd>
                </>
              )}
            </dl>
            <p className="pl-sub" style={{ margin: 0 }}>
              {q.mode === "sim"
                ? "SIMULATED RF: no transaction is sent and no real tokens move."
                : "Live RF: your wallet will ask you to confirm the transaction."}
            </p>
            {short && <p className="pl-inline-error">Not enough RF on this Friend for this {verb}.</p>}
            {error && (
              <p className="pl-inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="pl-row">
              <Button onClick={() => setStep({ name: "select" })} disabled={paying}>
                back
              </Button>
              <Button variant="now" busy={paying} disabled={short} onClick={() => void pay(q)}>
                {error ? "retry" : verb} · {formatRf(q.totalMicro)}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // ── Select ──
  if (missing === 0) {
    return (
      <Card title={title}>
        <div className="pl-grid-2">
          <FriendPortrait view={view} lost={lost} scale={8} framed />
          <EmptyState glyph="✓" title="whole">
            #{tokenId} has every pixel. Nothing to {verb}.
          </EmptyState>
        </div>
        {onCancel && <Button onClick={onCancel}>back</Button>}
      </Card>
    );
  }
  const next = nextRegrowthAt(view.pub.scars, now, tokenId, { goldHeld });
  const whole = wholeAt(view.pub.scars, now, tokenId, { goldHeld });
  const quoting = step.name === "quoting";
  const full = count >= cap;
  const remainingAfter = popcount(andNot(lost, selected));

  return (
    <Card title={title} actions={<SimulatedBadge mode={mode} />}>
      <div className="pl-grid-2">
        <div className="pl-stack" style={{ justifyItems: "start" }}>
          <FriendPortrait view={view} lost={lost} scale={10} framed selection={{ selected, onToggle: toggle, full }} />
          <p className="pl-label" style={{ margin: 0 }}>
            tap the dotted slots to choose pixels · arrows move, space toggles
          </p>
        </div>
        <div className="pl-stack">
          <dl className="pl-dl">
            <dt>missing</dt>
            <dd className="pl-num">{missing} px</dd>
            <dt>free</dt>
            <dd>
              {next !== null ? `next in ${formatClock(next - now)}` : "no free regrowth"}
              {whole !== null && ` · whole in ${formatDuration(whole - now)}`}
            </dd>
            <dt>selected</dt>
            <dd>
              <PixelNumber value={count} size={16} />{" "}
              {kind === "mend" && <span className="pl-sub">(up to {cap}/day)</span>}
            </dd>
          </dl>
          <div className="pl-row" role="group" aria-label="quick select">
            {kind === "mend" ? (
              <>
                <Button size="small" onClick={() => pick(1)}>
                  1
                </Button>
                <Button size="small" onClick={() => pick(3)} disabled={missing < 3}>
                  3
                </Button>
                <Button size="small" onClick={() => pick(missing)}>
                  all{missing > cap ? ` (${cap})` : ""}
                </Button>
              </>
            ) : (
              <Button size="small" onClick={() => pick(missing)}>
                all {missing}
              </Button>
            )}
            <Button size="small" variant="quiet" onClick={() => setRawSel(EMPTY_MASK)} disabled={count === 0}>
              clear
            </Button>
          </div>
          <hr className="pl-divider" />
          <p className="pl-display pl-h2" aria-live="polite">
            {count} × {formatRf(unit)} = {formatRf(preview?.totalMicro ?? 0)}
          </p>
          {preview && <SplitBar parts={quoteParts(preview)} label="where every RF goes" />}
          {count > 0 && remainingAfter > 0 && (
            <p className="pl-sub" style={{ margin: 0 }}>
              {remainingAfter} px still heal for free.
            </p>
          )}
          {kind === "mend" && (
            <p className="pl-sub" style={{ margin: 0 }}>
              <Badge>gift</Badge> half goes straight into #{tokenId}'s own wallet.
            </p>
          )}
          {error && <ErrorState message={error} onRetry={() => void requestQuote()} />}
          <div className="pl-row">
            {onCancel && <Button onClick={onCancel}>cancel</Button>}
            <Button variant="now" disabled={count === 0} busy={quoting} onClick={() => void requestQuote()}>
              {verb} {count} px
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Regrow your own Friend: 0.5 RF/px, 50 % burned · 50 % to the active-Friends stream. */
export function RegrowFlow(props: SpendFlowProps) {
  return <SpendFlow {...props} kind="regrow" payer={props.view.appearance.tokenId} />;
}

/** Mend someone else's Friend: 1 RF/px, 50 % burned · 50 % into that Friend's wallet; your stitches show 7 days. */
export function MendFlow(props: MendFlowProps) {
  return <SpendFlow {...props} kind="mend" />;
}
