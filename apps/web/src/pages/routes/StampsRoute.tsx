/**
 * `/stamps` (the owner's book) and `/stamps/:tokenId` (anyone's): held stamps, XP and the Fling Belt ladder from
 * `GET /api/home/:tokenId`; the owner also sees progress toward the counting stamps (`GET /api/meta/me`).
 */
import { isTokenIdStr } from "@pl/shared";
import { errorMessage } from "../../api/client.js";
import { type PageProps, useMeta, useRemote, useServices } from "../../app/hooks.js";
import { ErrorState, LinkButton, LoadingBlock, RemoteView } from "../../ui/index.js";
import { StampBook } from "../StampBook.js";
import { OwnerGate, useOwnerToken } from "./common.js";

/** `/stamps` and `/stamps/:tokenId` */
export default function StampsRoute({ params }: PageProps) {
  const s = useServices();
  const own = useOwnerToken();
  const meta = useMeta();
  const tokenId = params.tokenId ?? own;
  const mine = tokenId !== null && tokenId === own;
  const home = useRemote(async () => {
    if (tokenId === null || mine) return null;
    if (!isTokenIdStr(tokenId)) throw new Error(`"${tokenId}" is not a Friend number.`);
    return s.api.home(tokenId);
  }, [tokenId, mine]);

  if (tokenId === null) {
    return (
      <OwnerGate title="stamp book">Stamps and belts are earned by your own Friend and kept on its isle.</OwnerGate>
    );
  }
  const head = (
    <header className="pl-page-head">
      <h1 className="pl-display pl-h1">stamps #{tokenId}</h1>
      <LinkButton to={mine ? "/home" : `/home/${tokenId}`} size="small">
        {mine ? "my isle" : "visit isle"}
      </LinkButton>
    </header>
  );
  if (mine) {
    return (
      <div className="pl-page">
        {head}
        {meta.me ? (
          <StampBook home={meta.me.home} stats={meta.me.stats} own />
        ) : meta.status === "error" ? (
          <ErrorState message={errorMessage(meta.error)} onRetry={() => void s.meta.refresh()} />
        ) : (
          <LoadingBlock label="opening your stamp book" />
        )}
      </div>
    );
  }
  return (
    <div className="pl-page">
      {head}
      <RemoteView value={home.value} onRetry={home.retry}>
        {(h) => (h ? <StampBook home={h} stats={null} own={false} /> : <LoadingBlock />)}
      </RemoteView>
    </div>
  );
}
