/** `/regrow`: Regrow the owner's own Friend (select → server quote → confirm with the split → receipt). */
import { useMemo } from "react";
import { errorMessage } from "../../api/client.js";
import { type PageProps, useIdentity, useServices } from "../../app/hooks.js";
import { navigate } from "../../lib/router.js";
import { RegrowFlow } from "../SpendFlow.js";
import { OwnerGate } from "./common.js";
import { spendBlockedReason, spendTransport } from "./spend.js";

/** `/regrow` */
export default function RegrowRoute(_props: PageProps) {
  const s = useServices();
  const id = useIdentity();
  const transport = useMemo(() => spendTransport(s, "regrow"), [s]);
  if (id.mode !== "owner") {
    return (
      <OwnerGate title="regrow">
        Regrow fills your own Friend's scars. Loaned Friends heal for free on this device, so there is nothing to pay.
      </OwnerGate>
    );
  }
  const tokenId = id.view.appearance.tokenId;
  return (
    <div className="pl-page">
      <RegrowFlow
        view={id.view}
        mode={id.economy}
        balanceMicro={id.balanceMicro}
        getQuote={transport.getQuote}
        submit={transport.submit}
        blockedReason={spendBlockedReason(id.economy)}
        errorMessage={errorMessage}
        onDone={() => navigate(`/f/${tokenId}`)}
        onCancel={() => navigate(`/f/${tokenId}`)}
      />
    </div>
  );
}
