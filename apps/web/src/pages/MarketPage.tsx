/**
 * The Gold Pixel market (tokenomics §6 phase 1): fixed-price RF listings with a 5 % fee (2 % burned, 2 % royalty to the
 * Friend that grew the Gold, 1 % to the creator). It is SIMULATED in the MVP whatever the economy mode, because
 * `GoldPixelMarket.sol` is spec only; the page says so everywhere a price appears.
 */
import { mulberry32, type TokenIdStr } from "@pl/shared";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  formatAgo,
  formatRf,
  type Remote,
  RemoteView,
  SimulatedBadge,
  Sheet,
  SplitBar,
  Tabs,
  useNow,
} from "../ui/index.js";
import { GOLD_FLOOR_MICRO, marketParts, marketSplit } from "./economy.js";

/** A fixed-price Gold Pixel listing. */
export interface GoldListing {
  id: string;
  /** The Friend that grew this Gold (receives the 2 % royalty on every sale). */
  originTokenId: TokenIdStr;
  sellerTokenId: TokenIdStr;
  priceMicro: number;
  listedAt: number;
}

/** Props of {@link MarketPage}. */
export interface MarketPageProps {
  listings: Remote<readonly GoldListing[]>;
  onRetry?: () => void;
  /** Buyer's own Friend, or null for guests (who can browse only). */
  viewerTokenId: TokenIdStr | null;
  /** Buyer's simulated balance. */
  balanceMicro: number | null;
  /** Executes a simulated purchase; rejects with a user-facing error. Absent = browse only. */
  onBuy?: (listing: GoldListing) => Promise<void>;
  errorMessage?: (e: unknown) => string;
  now?: number;
}

type Sort = "price" | "newest";

/** Deterministic sample listings for the simulated market (demo data until a market endpoint exists). */
export function demoListings(now: number, count = 6): GoldListing[] {
  const next = mulberry32(0x901d);
  const origins = ["344030", "63675", "65040", "1969", "65058", "344034", "64998", "65042"];
  return Array.from({ length: count }, (_, i) => {
    const premium = (next() % 30) * 500_000; // 0 .. 14.5 RF above the floor
    return {
      id: `sim-${i + 1}`,
      originTokenId: origins[i % origins.length] ?? "344030",
      sellerTokenId: origins[(i + 3) % origins.length] ?? "63675",
      priceMicro: GOLD_FLOOR_MICRO + premium,
      listedAt: now - (next() % 72) * 3600_000,
    };
  });
}

/** Browse and (simulated) buy Gold Pixels. */
export function MarketPage({
  listings,
  onRetry,
  viewerTokenId,
  balanceMicro,
  onBuy,
  errorMessage,
  now: fixedNow,
}: MarketPageProps) {
  const now = useNow(60_000, fixedNow);
  const [sort, setSort] = useState<Sort>("price");
  const [buying, setBuying] = useState<GoldListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bought, setBought] = useState<readonly string[]>([]);

  const confirm = async (l: GoldListing): Promise<void> => {
    if (!onBuy) return;
    setBusy(true);
    setError(null);
    try {
      await onBuy(l);
      setBought((b) => [...b, l.id]);
      setBuying(null);
    } catch (e) {
      setError(errorMessage ? errorMessage(e) : e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="pl-root pl-page" aria-label="Gold Pixel market">
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
      <Card title="every sale" level={2}>
        <SplitBar parts={marketParts()} label="5 % fee on the listing price" />
      </Card>

      <Tabs
        label="sort listings"
        value={sort}
        onChange={setSort}
        tabs={[
          { id: "price", label: "cheapest" },
          { id: "newest", label: "newest" },
        ]}
      >
        <RemoteView value={listings} {...(onRetry ? { onRetry } : {})}>
          {(list) => {
            const open = list.filter((l) => !bought.includes(l.id));
            if (open.length === 0) {
              return (
                <EmptyState glyph="◆" title="no gold for sale">
                  Gold Pixels come from Seed Packs (1 in 50). Listings show up here.
                </EmptyState>
              );
            }
            const sorted = [...open].sort((a, b) =>
              sort === "price" ? a.priceMicro - b.priceMicro : b.listedAt - a.listedAt,
            );
            return (
              <ul className="pl-cards" aria-label={`${sorted.length} listings`}>
                {sorted.map((l) => {
                  const own = viewerTokenId !== null && l.sellerTokenId === viewerTokenId;
                  return (
                    <Card
                      key={l.id}
                      as="li"
                      level={3}
                      title={formatRf(l.priceMicro)}
                      actions={<Badge tone="gold">gold</Badge>}
                    >
                      <dl className="pl-dl">
                        <dt>grown by</dt>
                        <dd>#{l.originTokenId}</dd>
                        <dt>seller</dt>
                        <dd>#{l.sellerTokenId}</dd>
                        <dt>listed</dt>
                        <dd className="pl-label">{formatAgo(l.listedAt, now)}</dd>
                        <dt>over floor</dt>
                        <dd>{formatRf(l.priceMicro - GOLD_FLOOR_MICRO)}</dd>
                      </dl>
                      <div className="pl-row" style={{ marginTop: 8 }}>
                        <Button
                          size="small"
                          disabled={!onBuy || viewerTokenId === null || own}
                          onClick={() => {
                            setError(null);
                            setBuying(l);
                          }}
                          aria-label={`buy gold pixel for ${formatRf(l.priceMicro)}`}
                        >
                          {own ? "your listing" : "buy"}
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </ul>
            );
          }}
        </RemoteView>
      </Tabs>
      {viewerTokenId === null && <p className="pl-sub">Browse freely; buying needs your own Friend.</p>}

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
              parts={marketParts(buying.priceMicro, buying.originTokenId)}
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
              The seller gets {formatRf(marketSplit(buying.priceMicro).seller)}. SIMULATED: no transaction is sent.
            </p>
            {error && (
              <p className="pl-inline-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </Sheet>
    </main>
  );
}
