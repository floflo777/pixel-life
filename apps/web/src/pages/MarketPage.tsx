/**
 * The Gold Pixel market (tokenomics §6 phase 1) over the server's SIMULATED market (`/api/market/*`): the order book
 * (asks cheapest first, floor, 24 h stats), recent fills, and for owners their Golds, asks and royalties with list /
 * cancel. Buying sends the exact price seen (`expectedPriceMicro`), so a relisted ask can never charge more. Every
 * sale pays a 5 % fee: 2 % burned, 2 % royalty to the Friend that grew the Gold, 1 % to the creator.
 */
import {
  MARKET,
  type MarketBookRes,
  type MarketListing,
  type MarketMineRes,
  marketPriceProblem,
  marketSplit,
  type TokenIdStr,
} from "@pl/shared";
import { type FormEvent, useId, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  formatAgo,
  formatInt,
  formatRf,
  type Remote,
  RemoteView,
  SimulatedBadge,
  Sheet,
  SplitBar,
  Tabs,
  useNow,
} from "../ui/index.js";
import { GOLD_FLOOR_MICRO, marketParts } from "./economy.js";

/** Props of {@link MarketPage}. */
export interface MarketPageProps {
  /** `GET /api/market/book`. */
  book: Remote<MarketBookRes>;
  onRetry?: () => void;
  /** `GET /api/market/mine` for owners, null for guests (browse only). */
  mine: Remote<MarketMineRes> | null;
  onMineRetry?: () => void;
  viewerTokenId: TokenIdStr | null;
  /** Buyer's simulated balance. */
  balanceMicro: number | null;
  /** Buys `listing` at its shown price; rejects with a user-facing error. Absent = browse only. */
  onBuy?: (listing: MarketListing) => Promise<void>;
  /** Lists one Gold at `priceMicro` (`leafId` for a bought Gold, omitted for one this Friend grew). */
  onList?: (priceMicro: number, leafId?: number) => Promise<void>;
  /** Takes an ask down. */
  onCancel?: (leafId: number) => Promise<void>;
  errorMessage?: (e: unknown) => string;
  now?: number;
}

type Tab = "asks" | "fills" | "mine";

const defaultError = (e: unknown): string => (e instanceof Error && e.message ? e.message : "Something went wrong.");

/** Parses "52.5" RF into micro-RF (null when not a number). */
export function parseRf(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{0,6})?$/.test(t)) return null;
  const [whole = "0", frac = ""] = t.split(".");
  return Number(whole) * 1_000_000 + Number(frac.padEnd(6, "0"));
}

const PROBLEM_COPY = {
  not_integer: "Enter a price in RF, like 52.50.",
  below_min: `The lowest ask is ${formatRf(MARKET.minPriceMicro, 0)}: below that, redeeming the Gold pays more.`,
  above_max: `The highest ask is ${formatRf(MARKET.maxPriceMicro, 0)}.`,
  off_tick: "Prices go in 0.01 RF steps.",
} as const;

/** Browse, buy, list and cancel Gold Pixels (simulated). */
export function MarketPage({
  book,
  onRetry,
  mine,
  onMineRetry,
  viewerTokenId,
  balanceMicro,
  onBuy,
  onList,
  onCancel,
  errorMessage = defaultError,
  now: fixedNow,
}: MarketPageProps) {
  const now = useNow(60_000, fixedNow);
  const [tab, setTab] = useState<Tab>("asks");
  const [buying, setBuying] = useState<MarketListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (l: MarketListing): Promise<void> => {
    if (!onBuy) return;
    setBusy(true);
    setError(null);
    try {
      await onBuy(l);
      setBuying(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "asks", label: "for sale" },
    { id: "fills", label: "recent sales" },
    ...(mine ? [{ id: "mine" as const, label: "my gold" }] : []),
  ];

  return (
    <div className="pl-page">
      <header className="pl-page-head">
        <h1 className="pl-display pl-h1">gold market</h1>
        <SimulatedBadge mode="sim" />
      </header>
      <Card variant="ink" aria-label="about the market">
        <p style={{ margin: 0 }}>
          <strong>Trading is simulated.</strong> The market contract is written but not deployed, so no Gold Pixel or RF
          changes hands on-chain. Floor {formatRf(GOLD_FLOOR_MICRO, 0)}: anyone can redeem a Gold for that, so the price
          above it pays for the regrowth perk, the look and who grew it.
        </p>
      </Card>

      <RemoteView value={book} {...(onRetry ? { onRetry } : {})}>
        {(b) => (
          <Card title="today" aria-label="market stats">
            <dl className="pl-dl">
              <dt>floor ask</dt>
              <dd className="pl-num">{b.floorMicro === null ? "none listed" : formatRf(b.floorMicro)}</dd>
              <dt>last sale</dt>
              <dd className="pl-num">{b.lastPriceMicro === null ? "none yet" : formatRf(b.lastPriceMicro)}</dd>
              <dt>24 h volume</dt>
              <dd>
                {formatRf(b.volume24hMicro)} · {formatInt(b.fills24h)} sale{b.fills24h === 1 ? "" : "s"}
              </dd>
              <dt>24 h burned</dt>
              <dd>{formatRf(b.burned24hMicro)}</dd>
              <dt>open asks</dt>
              <dd>{formatInt(b.openListings)}</dd>
            </dl>
          </Card>
        )}
      </RemoteView>

      <Card title="every sale">
        <SplitBar parts={marketParts()} label="5 % fee on the listing price" />
      </Card>

      <Tabs label="market" tabs={tabs} value={tab} onChange={setTab}>
        {tab === "asks" && (
          <RemoteView value={book} {...(onRetry ? { onRetry } : {})}>
            {(b) =>
              b.listings.length === 0 ? (
                <EmptyState glyph="◆" title="no gold for sale">
                  Gold Pixels come from Seed Packs (1 in 50). Listings show up here.
                </EmptyState>
              ) : (
                <ul className="pl-cards" aria-label={`${b.listings.length} listings`}>
                  {b.listings.map((l) => {
                    const own = viewerTokenId !== null && l.seller === viewerTokenId;
                    return (
                      <Card
                        key={l.leafId}
                        as="li"
                        level={3}
                        title={formatRf(l.priceMicro)}
                        actions={<Badge tone="gold">gold</Badge>}
                      >
                        <dl className="pl-dl">
                          <dt>grown by</dt>
                          <dd>#{l.originFriendId}</dd>
                          <dt>seller</dt>
                          <dd>#{l.seller}</dd>
                          <dt>listed</dt>
                          <dd className="pl-label">{formatAgo(l.listedAt, now)}</dd>
                          <dt>over floor</dt>
                          <dd>{formatRf(Math.max(0, l.priceMicro - GOLD_FLOOR_MICRO))}</dd>
                        </dl>
                        <div className="pl-row" style={{ marginTop: 8 }}>
                          {own && onCancel ? (
                            <CancelButton leafId={l.leafId} onCancel={onCancel} errorMessage={errorMessage} />
                          ) : (
                            <Button
                              size="small"
                              disabled={!onBuy || viewerTokenId === null}
                              onClick={() => {
                                setError(null);
                                setBuying(l);
                              }}
                              aria-label={`buy gold pixel ${l.leafId} for ${formatRf(l.priceMicro)}`}
                            >
                              buy
                            </Button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </ul>
              )
            }
          </RemoteView>
        )}
        {tab === "fills" && (
          <RemoteView value={book} {...(onRetry ? { onRetry } : {})}>
            {(b) =>
              b.recentFills.length === 0 ? (
                <EmptyState glyph="◇" title="no sales yet" />
              ) : (
                <div className="pl-table-wrap">
                  <table className="pl-table">
                    <caption className="pl-sr-only">recent Gold Pixel sales</caption>
                    <thead>
                      <tr>
                        <th scope="col">price</th>
                        <th scope="col">seller → buyer</th>
                        <th scope="col">burned</th>
                        <th scope="col">when</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.recentFills.map((f) => (
                        <tr key={`${f.leafId}-${f.at}`}>
                          <td className="pl-num-cell">{formatRf(f.priceMicro)}</td>
                          <td>
                            #{f.seller} → #{f.buyer}
                          </td>
                          <td className="pl-num-cell">{formatRf(f.burnedMicro)}</td>
                          <td className="pl-label">{formatAgo(f.at, now)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </RemoteView>
        )}
        {tab === "mine" && mine && (
          <RemoteView value={mine} {...(onMineRetry ? { onRetry: onMineRetry } : {})}>
            {(m) => (
              <MyGold
                mine={m}
                errorMessage={errorMessage}
                {...(onList ? { onList } : {})}
                {...(onCancel ? { onCancel } : {})}
              />
            )}
          </RemoteView>
        )}
      </Tabs>
      {viewerTokenId === null && <p className="pl-sub">Browse freely; buying and selling need your own Friend.</p>}

      <Sheet
        open={buying !== null}
        title="buy gold pixel"
        dismissible={!busy}
        onClose={() => setBuying(null)}
        footer={
          buying && (
            <>
              <Button onClick={() => setBuying(null)} disabled={busy}>
                cancel
              </Button>
              <Button
                variant="now"
                busy={busy}
                disabled={balanceMicro !== null && balanceMicro < buying.priceMicro}
                onClick={() => void confirm(buying)}
              >
                {error ? "retry" : "buy"} · {formatRf(buying.priceMicro)}
              </Button>
            </>
          )
        }
      >
        {buying && (
          <div className="pl-stack">
            <SimulatedBadge mode="sim" />
            <SplitBar
              parts={marketParts(buying.priceMicro, buying.originFriendId)}
              label={`where ${formatRf(buying.priceMicro)} goes`}
            />
            {balanceMicro !== null && (
              <p style={{ margin: 0 }}>
                balance {formatRf(balanceMicro)} → {formatRf(Math.max(0, balanceMicro - buying.priceMicro))}
              </p>
            )}
            {balanceMicro !== null && balanceMicro < buying.priceMicro && (
              <p className="pl-inline-error">Not enough simulated RF on this Friend.</p>
            )}
            <p className="pl-sub" style={{ margin: 0 }}>
              You pay exactly {formatRf(buying.priceMicro)}; if the seller changed the price meanwhile, nothing is
              charged. The seller gets {formatRf(marketSplit(buying.priceMicro).toSellerMicro)}. SIMULATED: no
              transaction is sent.
            </p>
            {error && (
              <p className="pl-inline-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

function CancelButton({
  leafId,
  onCancel,
  errorMessage,
}: {
  leafId: number;
  onCancel: (leafId: number) => Promise<void>;
  errorMessage: (e: unknown) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        size="small"
        variant="danger"
        busy={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          onCancel(leafId).then(
            () => setBusy(false),
            (e: unknown) => {
              setBusy(false);
              setError(errorMessage(e));
            },
          );
        }}
        aria-label={`take gold pixel ${leafId} off the market`}
      >
        {error ? "retry cancel" : "cancel ask"}
      </Button>
      {error && (
        <p className="pl-inline-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </>
  );
}

/** The owner's Golds: counts, royalties, open asks and the list form. */
function MyGold({
  mine,
  onList,
  onCancel,
  errorMessage,
}: {
  mine: MarketMineRes;
  onList?: (priceMicro: number, leafId?: number) => Promise<void>;
  onCancel?: (leafId: number) => Promise<void>;
  errorMessage: (e: unknown) => string;
}) {
  const formId = useId();
  const grown = mine.goldHeld - mine.boughtLeafIds.length;
  const [source, setSource] = useState<string>(grown > 0 ? "grown" : String(mine.boughtLeafIds[0] ?? "grown"));
  const [price, setPrice] = useState("50.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const micro = parseRf(price);
  const problem = micro === null ? "not_integer" : marketPriceProblem(micro);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!onList || micro === null || problem) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const leaf = source === "grown" ? undefined : Number(source);
    onList(micro, leaf).then(
      () => {
        setBusy(false);
        setDone(`Listed for ${formatRf(micro)} (simulated).`);
      },
      (err: unknown) => {
        setBusy(false);
        setError(errorMessage(err));
      },
    );
  };

  return (
    <div className="pl-stack">
      <dl className="pl-dl">
        <dt>gold held</dt>
        <dd className="pl-num">{mine.goldHeld}</dd>
        <dt>royalties earned</dt>
        <dd>
          {formatRf(mine.royaltiesMicro)} <SimulatedBadge mode="sim" />
        </dd>
      </dl>
      {mine.listings.length > 0 && (
        <ul className="pl-list" aria-label="my asks">
          {mine.listings.map((l) => (
            <li key={l.leafId} className="pl-row" style={{ justifyContent: "space-between" }}>
              <span>
                leaf {l.leafId} · <span className="pl-num">{formatRf(l.priceMicro)}</span>
              </span>
              {onCancel && <CancelButton leafId={l.leafId} onCancel={onCancel} errorMessage={errorMessage} />}
            </li>
          ))}
        </ul>
      )}
      {mine.goldHeld === 0 ? (
        <EmptyState glyph="◆" title="no gold to sell">
          Gold Pixels come from Seed Packs. A held Gold also speeds your Friend's free healing; a listed one does not.
        </EmptyState>
      ) : (
        onList && (
          <form className="pl-stack" onSubmit={submit} aria-labelledby={`${formId}-h`}>
            <h3 id={`${formId}-h`} className="pl-display pl-h3">
              list one gold
            </h3>
            <label className="pl-stack" style={{ gap: 4 }}>
              <span className="pl-label">which gold</span>
              <select value={source} onChange={(e) => setSource(e.target.value)} className="pl-input">
                {grown > 0 && <option value="grown">one I grew ({grown})</option>}
                {mine.boughtLeafIds.map((id) => (
                  <option key={id} value={String(id)}>
                    bought leaf {id}
                  </option>
                ))}
              </select>
            </label>
            <label className="pl-stack" style={{ gap: 4 }}>
              <span className="pl-label">price (RF, simulated)</span>
              <input
                className="pl-input"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                aria-invalid={problem !== null}
                aria-describedby={`${formId}-hint`}
              />
            </label>
            <p id={`${formId}-hint`} className={problem ? "pl-inline-error" : "pl-sub"} style={{ margin: 0 }}>
              {problem
                ? PROBLEM_COPY[problem]
                : `You receive ${formatRf(marketSplit(micro ?? 0).toSellerMicro)} if it sells (after the 5 % fee).`}
            </p>
            {error && (
              <p className="pl-inline-error" role="alert" style={{ margin: 0 }}>
                {error}
              </p>
            )}
            {done && (
              <p role="status" style={{ margin: 0 }}>
                {done}
              </p>
            )}
            <div className="pl-row">
              <Button type="submit" variant="now" busy={busy} disabled={problem !== null}>
                list · {micro === null ? "?" : formatRf(micro)}
              </Button>
            </div>
          </form>
        )
      )}
    </div>
  );
}
