/**
 * `/mend/:tokenId`: Mend another Friend. The target is read fresh (`/api/friends/:id/public`) so the scars shown are the
 * server's; half of every RF goes into that Friend's wallet.
 */
import { useMemo } from "react";
import { errorMessage } from "../../api/client.js";
import { type PageProps, useIdentity, useServices } from "../../app/hooks.js";
import { navigate } from "../../lib/router.js";
import { LinkButton, LoadingBlock, RemoteView } from "../../ui/index.js";
import { MendFlow } from "../SpendFlow.js";
import { OwnerGate, useFriendView } from "./common.js";
import { spendBlockedReason, spendTransport } from "./spend.js";

/** `/mend/:tokenId` */
export default function MendRoute({ params }: PageProps) {
  const tokenId = params.tokenId ?? "";
  const s = useServices();
  const id = useIdentity();
  const target = useFriendView(tokenId);
  const transport = useMemo(() => spendTransport(s, "mend"), [s]);
  if (id.mode !== "owner") {
    return (
      <OwnerGate title={`mend #${tokenId}`}>
        Mending pays real (or simulated) RF into another Friend's wallet, so it needs your own Friend. Guests can still
        browse the Mend board.
      </OwnerGate>
    );
  }
  return (
    <div className="pl-page">
      <header className="pl-page-head">
        <h1 className="pl-display pl-h1">mend #{tokenId}</h1>
        <LinkButton to="/mend" variant="quiet" size="small">
          ← mend board
        </LinkButton>
      </header>
      <RemoteView value={target.value} onRetry={target.retry} loading={<LoadingBlock label="reading its scars" />}>
        {(view) => (
          <MendFlow
            view={view}
            payer={id.view.appearance.tokenId}
            mode={id.economy}
            balanceMicro={id.balanceMicro}
            getQuote={transport.getQuote}
            submit={transport.submit}
            blockedReason={view.loaned ? "Loaned Friends can't be mended." : spendBlockedReason(id.economy)}
            errorMessage={errorMessage}
            onDone={() => navigate(`/f/${tokenId}`)}
            onCancel={() => navigate("/mend")}
          />
        )}
      </RemoteView>
    </div>
  );
}
