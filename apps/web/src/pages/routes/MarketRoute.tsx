/**
 * `/market`: the SIMULATED Gold market wired to `/api/market/*`. Every write refreshes the book and the owner's Golds;
 * a stale ask (`price_changed`) refreshes the book so the buyer sees the new price before trying again.
 */
import { useCallback } from "react";
import { errorMessage } from "../../api/client.js";
import { type PageProps, useIdentity, useRemote, useServices } from "../../app/hooks.js";
import { formatRf } from "../../ui/index.js";
import { MarketPage } from "../MarketPage.js";

/** `/market` */
export default function MarketRoute(_props: PageProps) {
  const s = useServices();
  const id = useIdentity();
  const owner = id.mode === "owner" ? id.view.appearance.tokenId : null;
  const book = useRemote(() => s.api.marketBook(), []);
  const mine = useRemote(async () => (owner ? s.api.marketMine() : null), [owner]);

  const refresh = useCallback(() => {
    book.retry();
    mine.retry();
  }, [book, mine]);

  const mineValue =
    owner === null
      ? null
      : mine.value.status === "ready"
        ? mine.value.data
          ? { status: "ready" as const, data: mine.value.data }
          : { status: "loading" as const }
        : mine.value;

  return (
    <MarketPage
      book={book.value}
      onRetry={book.retry}
      mine={mineValue}
      onMineRetry={mine.retry}
      viewerTokenId={owner}
      balanceMicro={id.mode === "owner" ? id.balanceMicro : null}
      errorMessage={errorMessage}
      {...(owner
        ? {
            onBuy: async (l) => {
              try {
                const res = await s.api.marketBuy(l.leafId, l.priceMicro);
                s.identity.updateOwner({ balanceMicro: res.balanceMicro });
                s.toast(`Bought a Gold Pixel for ${formatRf(res.fill.priceMicro)} (simulated).`, "good");
              } finally {
                // Success or a stale ask (`price_changed`): either way the book on screen is out of date.
                refresh();
              }
            },
            onList: async (priceMicro, leafId) => {
              await s.api.marketList(priceMicro, leafId);
              refresh();
            },
            onCancel: async (leafId) => {
              await s.api.marketCancel(leafId);
              s.toast("Ask cancelled: the Gold is back with your Friend.", "good");
              refresh();
            },
          }
        : {})}
    />
  );
}
