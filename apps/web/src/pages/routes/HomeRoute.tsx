/**
 * `/home` (the owner's isle, editable) and `/home/:tokenId` (a visit). The owner's isle comes from `GET /api/meta/me`
 * (with Bits and wardrobe), a visited one from `GET /api/home/:tokenId`; visiting an open isle as an owner counts
 * toward the Isle Hopper stamp (`POST /api/home/:tokenId/visit`). The Seed Catalogue sits under the owner's isle.
 */
import { CATALOG, isTokenIdStr, stampDef } from "@pl/shared";
import { useEffect, useRef } from "react";
import { errorMessage } from "../../api/client.js";
import { type PageProps, useIdentity, useMeta, useRemote, useServices } from "../../app/hooks.js";
import {
  Card,
  EmptyState,
  ErrorState,
  formatInt,
  LinkButton,
  LoadingBlock,
  RemoteView,
  SimulatedBadge,
} from "../../ui/index.js";
import { Catalog } from "../Catalog.js";
import { HomeIsle } from "../HomeIsle.js";
import { buyCatalogItem, buyIslePlot } from "./meta-actions.js";
import { OwnerGate, useFriendView, useOwnerToken } from "./common.js";

function OwnIsle() {
  const s = useServices();
  const id = useIdentity();
  const meta = useMeta();
  if (id.mode !== "owner") return null;
  const me = meta.me;
  if (!me) {
    return meta.status === "error" ? (
      <ErrorState message={errorMessage(meta.error)} onRetry={() => void s.meta.refresh()} />
    ) : (
      <LoadingBlock label="rowing out to your isle" />
    );
  }
  return (
    <>
      <HomeIsle
        home={me.home}
        view={id.view}
        owned={me.owned}
        bits={me.bits}
        errorMessage={errorMessage}
        onSave={async (req) => {
          const saved = await s.api.saveHome(req);
          s.meta.applyHome(saved);
          s.toast("Isle saved.", "good");
          // Saving can earn the Decorator stamp: the next book refresh shows it.
          void s.meta.refresh();
          return saved;
        }}
        onBuyPlot={() => buyIslePlot(s)}
      />
      <Card
        title="seed catalogue"
        actions={
          <span className="pl-row" style={{ gap: 6 }}>
            <span className="pl-label">{formatInt(me.bits)} bits</span>
            <SimulatedBadge mode={id.economy} />
          </span>
        }
      >
        <Catalog
          items={CATALOG}
          owned={me.owned}
          bits={me.bits}
          heldStamps={new Set(me.home.stamps.map((x) => x.id))}
          belt={me.home.belt}
          mode={id.economy}
          balanceMicro={me.simRfMicro ?? id.balanceMicro}
          errorMessage={errorMessage}
          onBuy={(item) => buyCatalogItem(s, item)}
        />
      </Card>
    </>
  );
}

function VisitIsle({ tokenId }: { tokenId: string }) {
  const s = useServices();
  const own = useOwnerToken();
  const friend = useFriendView(tokenId);
  const home = useRemote(async () => {
    if (!isTokenIdStr(tokenId)) throw new Error(`"${tokenId}" is not a Friend number.`);
    return s.api.home(tokenId);
  }, [tokenId]);
  const counted = useRef<string | null>(null);
  const open = home.value.status === "ready" && home.value.data.open;
  useEffect(() => {
    if (!open || own === null || counted.current === tokenId || !isTokenIdStr(tokenId)) return;
    counted.current = tokenId;
    s.api.visitHome(tokenId).then(
      (r) => r.stamps.forEach((st) => s.toast(`New stamp: ${stampDef(st)?.name ?? st}!`, "good")),
      () => undefined, // Counting a visit is a bonus; the isle shows either way.
    );
  }, [open, own, tokenId, s]);

  return (
    <RemoteView value={home.value} onRetry={home.retry} loading={<LoadingBlock label="rowing over" />}>
      {(h) =>
        !h.open ? (
          <Card>
            <EmptyState
              glyph="⌂"
              title="this isle is closed"
              action={<LinkButton to={`/f/${tokenId}`}>see #{tokenId}</LinkButton>}
            >
              Its owner has not opened it for visits.
            </EmptyState>
          </Card>
        ) : (
          <RemoteView value={friend.value} onRetry={friend.retry}>
            {(view) => <HomeIsle home={h} view={view} />}
          </RemoteView>
        )
      }
    </RemoteView>
  );
}

/** `/home` and `/home/:tokenId` */
export default function HomeRoute({ params }: PageProps) {
  const own = useOwnerToken();
  const tokenId = params.tokenId ?? own;
  if (tokenId === null) {
    return (
      <OwnerGate title="home isle">
        Every Friend has a floating home isle to decorate with what it earns. Bring your own Friend to get yours, or
        visit an open isle from a Friend's page.
      </OwnerGate>
    );
  }
  const mine = tokenId === own;
  return (
    <div className="pl-page">
      <header className="pl-page-head">
        <h1 className="pl-display pl-h1">{mine ? "my isle" : `#${tokenId}'s isle`}</h1>
        <span className="pl-row">
          <LinkButton to={mine ? "/stamps" : `/stamps/${tokenId}`} size="small">
            stamp book
          </LinkButton>
          {!mine && (
            <LinkButton to={`/f/${tokenId}`} size="small" variant="quiet">
              #{tokenId}
            </LinkButton>
          )}
        </span>
      </header>
      {mine ? <OwnIsle /> : <VisitIsle tokenId={tokenId} />}
    </div>
  );
}
