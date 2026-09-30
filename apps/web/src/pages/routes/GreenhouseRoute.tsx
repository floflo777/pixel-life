/**
 * `/shop`: the Greenhouse (GDD §6.1, the Seed Booth room): Regrow, the Seed Pack booth, the Gold market and the Seed
 * Catalogue. Owners buy with their server Bits (and SIMULATED RF for RF decor); guests browse.
 */
import { and, CATALOG, ECON, effectiveLost, frontMask, popcount } from "@pl/shared";
import { errorMessage } from "../../api/client.js";
import { type PageProps, useBits, useIdentity, useMeta, useServices } from "../../app/hooks.js";
import { Card, ErrorState, formatInt, formatRf, LinkButton, SimulatedBadge, useNow } from "../../ui/index.js";
import { Catalog } from "../Catalog.js";
import { buyCatalogItem } from "./meta-actions.js";

/** `/shop` */
export default function GreenhouseRoute(_props: PageProps) {
  const s = useServices();
  const id = useIdentity();
  const meta = useMeta();
  const bits = useBits();
  const now = useNow(10_000);
  const owner = id.mode === "owner";
  const me = meta.me;
  const missing =
    id.mode === "none"
      ? 0
      : popcount(
          and(
            effectiveLost(id.view.pub.scars, now, id.view.appearance.tokenId, {
              goldHeld: id.view.loaned ? 0 : id.view.pub.goldHeld,
            }),
            frontMask(id.view.appearance),
          ),
        );

  return (
    <div className="pl-page">
      <header className="pl-page-head">
        <h1 className="pl-display pl-h1">greenhouse</h1>
        <span className="pl-row">
          <span className="pl-label">
            {bits.bits === null ? "…" : formatInt(bits.bits)} bits
            {bits.source === "device" ? " (this device)" : ""}
          </span>
          {owner && <SimulatedBadge mode={id.economy} />}
        </span>
      </header>

      <div className="pl-cards">
        <Card title="regrow" level={3}>
          <p style={{ marginTop: 0 }}>
            Fill your own Friend's scars now: {formatRf(ECON.regrowMicroPerPx)}/px, half burned, half to the
            active-Friends stream.
          </p>
          {owner ? (
            <LinkButton to="/regrow" variant={missing > 0 ? "now" : "paper"} size="small">
              {missing > 0 ? `regrow ${missing} px` : "whole: nothing to regrow"}
            </LinkButton>
          ) : (
            <p className="pl-sub" style={{ margin: 0 }}>
              Loaned Friends heal for free on this device.
            </p>
          )}
        </Card>
        <Card title="seed packs" level={3}>
          <p style={{ marginTop: 0 }}>The one chance game, with published odds. 1 in 50 packs holds a Gold Pixel.</p>
          <LinkButton to="/venue/seed-pack" size="small">
            open the booth
          </LinkButton>
        </Card>
        <Card title="gold market" level={3}>
          <p style={{ marginTop: 0 }}>Buy and sell Gold Pixels between Friends (simulated).</p>
          <LinkButton to="/market" size="small">
            see the asks
          </LinkButton>
        </Card>
        <Card title="your isle" level={3}>
          <p style={{ marginTop: 0 }}>Place what you buy on your Friend's home isle.</p>
          <LinkButton to="/home" size="small">
            go home
          </LinkButton>
        </Card>
      </div>

      <Card title="seed catalogue">
        {owner && meta.status === "error" && !me ? (
          <ErrorState message={errorMessage(meta.error)} onRetry={() => void s.meta.refresh()} />
        ) : (
          <Catalog
            items={CATALOG}
            owned={me?.owned ?? null}
            bits={owner ? (me?.bits ?? null) : null}
            heldStamps={new Set(me?.home.stamps.map((x) => x.id) ?? [])}
            belt={me?.home.belt ?? null}
            mode={owner ? id.economy : "sim"}
            balanceMicro={owner ? (me?.simRfMicro ?? id.balanceMicro) : null}
            errorMessage={errorMessage}
            {...(owner && me ? { onBuy: (item) => buyCatalogItem(s, item) } : {})}
          />
        )}
      </Card>
    </div>
  );
}
