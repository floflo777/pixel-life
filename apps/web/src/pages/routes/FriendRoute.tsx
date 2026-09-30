/**
 * `/f/:tokenId`: the public Friend page wired to the API. The owner sees their live identity view, inbox and Regrow;
 * visitors get Mend; everyone sees the Friend's belt, stamps and isle (`GET /api/home/:tokenId`).
 */
import { and, beltDef, effectiveLost, frontMask, isTokenIdStr, popcount, STAMPS, type TokenIdStr } from "@pl/shared";
import { useCallback, useMemo } from "react";
import { errorMessage } from "../../api/client.js";
import { type PageProps, useIdentity, useRemote, useServices } from "../../app/hooks.js";
import { navigate } from "../../lib/router.js";
import { Badge, Card, EmptyState, LinkButton, RemoteView } from "../../ui/index.js";
import { FriendPage, type Viewer } from "../FriendPage.js";
import { MendFlow } from "../SpendFlow.js";
import { shareFriend, useFriendView } from "./common.js";
import { spendBlockedReason, spendTransport } from "./spend.js";

/** Belt, stamps and the isle link of any Friend. */
export function IsleStrip({ tokenId }: { tokenId: TokenIdStr }) {
  const { api } = useServices();
  const home = useRemote(() => api.home(tokenId), [tokenId]);
  return (
    <Card title="isle, belt & stamps">
      <RemoteView value={home.value} onRetry={home.retry}>
        {(h) => {
          const belt = h.belt ? beltDef(h.belt) : null;
          return (
            <div className="pl-stack">
              <dl className="pl-dl">
                <dt>fling belt</dt>
                <dd>
                  {belt ? (
                    <span className="pl-row" style={{ gap: 6 }}>
                      <span
                        className="pl-swatch"
                        aria-hidden="true"
                        style={{ background: `#${belt.color.toString(16).padStart(6, "0")}` }}
                      />
                      {belt.name}
                    </span>
                  ) : (
                    <span className="pl-sub">no belt yet</span>
                  )}
                </dd>
                <dt>stamps</dt>
                <dd>
                  {h.stamps.length}/{STAMPS.length} · {h.stampXp} xp
                </dd>
                <dt>isle</dt>
                <dd>
                  {h.terraces} terrace{h.terraces === 1 ? "" : "s"} · {h.layout.items.length} items{" "}
                  {h.open ? <Badge>open for visits</Badge> : <Badge tone="ink">closed</Badge>}
                </dd>
              </dl>
              <div className="pl-row">
                <LinkButton to={`/home/${tokenId}`} size="small">
                  visit isle
                </LinkButton>
                <LinkButton to={`/stamps/${tokenId}`} size="small">
                  stamp book
                </LinkButton>
              </div>
            </div>
          );
        }}
      </RemoteView>
    </Card>
  );
}

/** `/f/:tokenId` (`?action=mend` opens the Mend panel, e.g. from a hub tap on a scarred Friend). */
export default function FriendRoute({ params, search }: PageProps) {
  const tokenId = params.tokenId ?? "";
  const s = useServices();
  const id = useIdentity();
  const friend = useFriendView(tokenId);
  const transport = useMemo(() => spendTransport(s, "mend"), [s]);
  const owner = id.mode === "owner" && friend.mine;
  const viewer: Viewer = owner ? "owner" : id.mode === "owner" ? "visitor" : "guest";
  const inbox = useRemote(async () => (owner ? (await s.api.inbox()).items : []), [owner]);

  const markRead = useCallback(
    (ids: readonly string[] | "all") => {
      s.api.inboxRead(ids === "all" ? { all: true } : { ids: [...ids] }).then(
        (r) => {
          s.identity.updateOwner({ unread: r.unread });
          inbox.retry();
        },
        (e: unknown) => s.toast(errorMessage(e), "bad"),
      );
    },
    [s, inbox],
  );

  const share = (): void => {
    const view = friend.value.status === "ready" ? friend.value.data : null;
    const missing = view
      ? popcount(and(effectiveLost(view.pub.scars, Date.now(), tokenId), frontMask(view.appearance))) > 0
      : false;
    void shareFriend(tokenId, missing).then((msg) => s.toast(msg));
  };

  const isGuestLoaner = id.mode === "guest" && friend.mine;
  const closeMend = (): void => navigate(`/f/${tokenId}`, { replace: true });
  const mendPanel =
    search.get("action") !== "mend" || friend.mine ? null : id.mode !== "owner" ? (
      <Card title={`mend #${tokenId}`}>
        <EmptyState
          glyph="✋"
          title="bring your own Friend"
          action={
            <LinkButton to="/connect" variant="now">
              use my friend
            </LinkButton>
          }
        >
          Mending pays RF into this Friend's wallet, so it needs your own Friend.
        </EmptyState>
      </Card>
    ) : friend.value.status === "ready" ? (
      <MendFlow
        view={friend.value.data}
        payer={id.view.appearance.tokenId}
        mode={id.economy}
        balanceMicro={id.balanceMicro}
        getQuote={transport.getQuote}
        submit={transport.submit}
        blockedReason={friend.value.data.loaned ? "Loaned Friends can't be mended." : spendBlockedReason(id.economy)}
        errorMessage={errorMessage}
        onDone={() => {
          closeMend();
          friend.retry();
        }}
        onCancel={closeMend}
      />
    ) : null;
  return (
    <FriendPage
      friend={friend.value}
      onRetry={friend.retry}
      viewer={viewer}
      mode={id.mode === "owner" ? id.economy : friend.value.status === "ready" ? friend.value.data.pub.economy : "sim"}
      balanceMicro={owner && id.mode === "owner" ? id.balanceMicro : null}
      {...(owner ? { inbox: inbox.value, onInboxRetry: inbox.retry, onInboxRead: markRead } : {})}
      {...(owner ? { onRegrow: () => navigate("/regrow"), onSeedPack: () => navigate("/venue/seed-pack") } : {})}
      {...(!owner && !isGuestLoaner ? { onMend: () => navigate(`/f/${tokenId}?action=mend`) } : {})}
      onOpenFriend={(t) => navigate(`/f/${t}`)}
      onShare={share}
      lead={mendPanel}
      footer={isTokenIdStr(tokenId) && !isGuestLoaner ? <IsleStrip tokenId={tokenId} /> : null}
    />
  );
}
