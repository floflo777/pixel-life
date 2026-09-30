/**
 * The Seed Catalogue (GDD §12.3, tokenomics §7): Bits decor and hats, flex items unlocked by a stamp or a belt, and
 * RF decor (SIMULATED, 50 % burned · 50 % to the active-Friends stream; the 10 and 25 RF pieces also take a Bits
 * blueprint). Purchases go through a confirm sheet; nothing changes on screen until the server answers.
 */
import { type BeltId, type CatalogItem, type CatalogShelf, type EconomyMode, itemCost, itemOwner } from "@pl/shared";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  formatInt,
  formatRf,
  SimulatedBadge,
  Sheet,
  SplitBar,
  Tabs,
} from "../ui/index.js";
import { unlockProblem } from "./meta-view.js";

/** Props of {@link Catalog}. */
export interface CatalogProps {
  items: readonly CatalogItem[];
  /** Copies owned per item (null for guests). */
  owned: Readonly<Record<string, number>> | null;
  /** Server Bits balance (null when unknown or for guests). */
  bits: number | null;
  heldStamps: ReadonlySet<string>;
  belt: BeltId | null;
  mode: EconomyMode;
  /** Simulated RF balance for RF decor. */
  balanceMicro: number | null;
  /** Buys one copy; rejects with a user-facing error. Absent = browse only. */
  onBuy?: (item: CatalogItem) => Promise<void>;
  errorMessage?: (e: unknown) => string;
  /** Shelf to open on (default "basic"). */
  initialShelf?: CatalogShelf;
}

const SHELVES: readonly { id: CatalogShelf; label: string }[] = [
  { id: "basic", label: "basics" },
  { id: "rotating", label: "this week" },
  { id: "flex", label: "flex" },
  { id: "premium", label: "rf decor" },
];

const defaultError = (e: unknown): string => (e instanceof Error && e.message ? e.message : "Something went wrong.");

/** One price line: "300 bits", "5.00 RF", "10.00 RF + 1 000 bits blueprint". */
export function priceLabel(item: CatalogItem): string {
  const c = itemCost(item);
  if (c.rfMicro === 0) return `${formatInt(c.bits)} bits`;
  return c.bits > 0 ? `${formatRf(c.rfMicro)} + ${formatInt(c.bits)} bits blueprint` : formatRf(c.rfMicro);
}

/** Why the player can't afford `item` right now, or null. */
function shortfall(item: CatalogItem, bits: number | null, balanceMicro: number | null): string | null {
  const c = itemCost(item);
  if (c.bits > 0 && bits !== null && bits < c.bits) return `needs ${formatInt(c.bits - bits)} more bits`;
  if (c.rfMicro > 0 && balanceMicro !== null && balanceMicro < c.rfMicro) return "not enough simulated RF";
  return null;
}

/** The catalog shelves with buy buttons. */
export function Catalog({
  items,
  owned,
  bits,
  heldStamps,
  belt,
  mode,
  balanceMicro,
  onBuy,
  errorMessage = defaultError,
  initialShelf = "basic",
}: CatalogProps) {
  const [shelf, setShelf] = useState<CatalogShelf>(initialShelf);
  const [buying, setBuying] = useState<CatalogItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = items.filter((i) => i.shelf === shelf);

  const confirm = async (item: CatalogItem): Promise<void> => {
    if (!onBuy) return;
    setBusy(true);
    setError(null);
    try {
      await onBuy(item);
      setBuying(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tabs label="catalog shelf" tabs={SHELVES} value={shelf} onChange={setShelf}>
        {list.length === 0 ? (
          <EmptyState glyph="·" title="nothing on this shelf" />
        ) : (
          <ul className="pl-cards" aria-label={`${list.length} items`}>
            {list.map((item) => {
              const lock = unlockProblem(item, heldStamps, belt);
              const have = owned?.[item.id] ?? 0;
              const rf = itemCost(item).rfMicro > 0;
              return (
                <Card
                  key={item.id}
                  as="li"
                  level={3}
                  title={item.name}
                  actions={
                    <Badge tone={rf ? "gold" : item.kind === "hat" ? "lilac" : "paper"}>
                      {item.kind === "hat" ? "hat" : `${item.w}×${item.d}`}
                    </Badge>
                  }
                >
                  <div className="pl-stack">
                    <p className="pl-sub" style={{ margin: 0 }}>
                      {item.blurb}
                    </p>
                    <p style={{ margin: 0 }}>
                      <span className="pl-num">{priceLabel(item)}</span> {rf && <SimulatedBadge mode={mode} />}
                    </p>
                    {owned && (
                      <p className="pl-label" style={{ margin: 0 }}>
                        owned {have} · {itemOwner(item) === "friend" ? "travels with this Friend" : "in your wardrobe"}
                      </p>
                    )}
                    {lock && <Badge tone="ink">locked: {lock}</Badge>}
                    <Button
                      size="small"
                      disabled={!onBuy || lock !== null}
                      onClick={() => {
                        setError(null);
                        setBuying(item);
                      }}
                      aria-label={`buy ${item.name} for ${priceLabel(item)}`}
                    >
                      buy
                    </Button>
                  </div>
                </Card>
              );
            })}
          </ul>
        )}
      </Tabs>
      {!onBuy && (
        <p className="pl-sub" style={{ margin: 0 }}>
          Browse freely. Buying needs your own Friend: its Bits live on the server, not on this device.
        </p>
      )}

      <Sheet
        open={buying !== null}
        title={buying ? `buy ${buying.name}` : "buy"}
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
                disabled={shortfall(buying, bits, balanceMicro) !== null}
                onClick={() => void confirm(buying)}
              >
                {error ? "retry" : "buy"} · {priceLabel(buying)}
              </Button>
            </>
          )
        }
      >
        {buying && <BuyDetails item={buying} bits={bits} balanceMicro={balanceMicro} mode={mode} error={error} />}
      </Sheet>
    </>
  );
}

function BuyDetails({
  item,
  bits,
  balanceMicro,
  mode,
  error,
}: {
  item: CatalogItem;
  bits: number | null;
  balanceMicro: number | null;
  mode: EconomyMode;
  error: string | null;
}) {
  const c = itemCost(item);
  const short = shortfall(item, bits, balanceMicro);
  return (
    <div className="pl-stack">
      <p style={{ margin: 0 }}>{item.blurb}</p>
      <dl className="pl-dl">
        {c.bits > 0 && (
          <>
            <dt>bits</dt>
            <dd className="pl-num">
              {bits === null ? formatInt(c.bits) : `${formatInt(bits)} → ${formatInt(Math.max(0, bits - c.bits))}`}
            </dd>
          </>
        )}
        {c.rfMicro > 0 && (
          <>
            <dt>rf</dt>
            <dd className="pl-num">
              {balanceMicro === null
                ? formatRf(c.rfMicro)
                : `${formatRf(balanceMicro)} → ${formatRf(Math.max(0, balanceMicro - c.rfMicro))}`}
            </dd>
          </>
        )}
      </dl>
      {c.rfMicro > 0 && (
        <>
          <SimulatedBadge mode={mode} />
          <SplitBar
            label={`where ${formatRf(c.rfMicro)} goes`}
            parts={[
              { label: "burned", kind: "burn", bps: 5000, micro: c.burnMicro },
              { label: "active-Friends stream", kind: "stream", bps: 5000, micro: c.streamMicro },
            ]}
          />
          <p className="pl-sub" style={{ margin: 0 }}>
            SIMULATED RF: no transaction is sent. RF decor stays with this Friend if it changes hands.
          </p>
        </>
      )}
      <p className="pl-sub" style={{ margin: 0 }}>
        Cosmetic only: nothing here changes runs, scars or odds. Bits never convert to RF.
      </p>
      {short && <p className="pl-inline-error">{short[0]?.toUpperCase() + short.slice(1)}.</p>}
      {error && (
        <p className="pl-inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
