/**
 * The venue manager's SDK path (architecture §1.3 / §1b.2): a stock FriendSDK game mounted unmodified through the
 * patched `ConnectedGameHost`, fed the shell's own wallet session, selected Friend and read client. `previewClient` is
 * the `ServerLedgerClient` so Seed Packs persist in the server ledger. The SDK's fresh eligibility gate still runs
 * before the child mounts; `revision` (wallet revision + identity revision) closes the bridge on any identity change.
 * This module (and the SDK runtime + CSS) loads only when a booth opens.
 */
import "@rarefriends/friendsdk/frame.css";
import "@rarefriends/friendsdk/runtime.css";
import { parseChanceGame } from "@rarefriends/friendsdk/game";
import { ConnectedGameHost } from "@rarefriends/friendsdk/runtime";
import type { SdkFrameVenue } from "@pl/venue-kit";
import { type CSSProperties, useMemo } from "react";
import { serverLedgerFactory } from "../api/server-ledger.js";
import { useOwnerFlow } from "../app/hooks.js";
import { useServices } from "../app/services.js";
import { errorMessage } from "../api/client.js";
import { useStore } from "../lib/store.js";
import { ROBINHOOD_CHAIN_ID, type OwnerFlow } from "../identity/owner-flow.js";
import { Button, ErrorState, Loading } from "../ui/index.js";

function Booth({ venue, flow }: { venue: SdkFrameVenue; flow: OwnerFlow }) {
  const s = useServices();
  const { identity, revision } = useStore(s.identity.store);
  const { wallet } = useStore(flow.store);
  const definition = useMemo(() => parseChanceGame(venue.definition), [venue.definition]);
  const tokenId = identity.mode === "owner" ? identity.view.appearance.tokenId : null;
  const previewClient = useMemo(
    () =>
      serverLedgerFactory(
        s.api,
        () => {
          const id = s.identity.store.get().identity;
          return id.mode === "owner" ? id.view.appearance.tokenId : null;
        },
        () => s.identity.dropOwner("The booth and your signed-in Friend disagree. Pick your Friend again."),
      ),
    [s],
  );

  if (identity.mode !== "owner" || tokenId === null) return null;
  const connected = wallet.status === "connected" && wallet.account !== null;
  const style = { ...(venue.hostCss ?? {}) } as CSSProperties;
  return (
    <div className="sdk-venue" style={style} data-testid="sdk-venue">
      {!connected && (
        <div className="sdk-venue-connect">
          <p>
            The booth runs in the FriendSDK sandbox, which checks your wallet itself. Reconnect the wallet that owns #
            {tokenId}.
          </p>
          {wallet.status === "wrong-network" ? (
            <Button variant="now" onClick={() => void flow.switchNetwork()}>
              switch to Robinhood Chain ({ROBINHOOD_CHAIN_ID})
            </Button>
          ) : (
            <Button variant="now" onClick={() => void flow.connect()}>
              connect wallet
            </Button>
          )}
        </div>
      )}
      <ConnectedGameHost
        definition={definition}
        frameUrl={venue.frameUrl}
        selectedFriend={{ id: BigInt(tokenId), label: `Friend #${tokenId}`, kind: "owned" }}
        account={wallet.account}
        chainId={wallet.chainId}
        publicClient={flow.publicClient}
        revision={wallet.revision + revision}
        previewClient={previewClient}
      />
    </div>
  );
}

/** Mounts `venue` for the bound owner (the caller shows the guest CTA). */
export default function SdkVenueView({ venue }: { venue: SdkFrameVenue }) {
  const { flow, error } = useOwnerFlow();
  if (error) return <ErrorState message={`The wallet module failed to load: ${errorMessage(error)}`} />;
  if (!flow) return <Loading label="opening the booth" />;
  return <Booth venue={venue} flow={flow} />;
}
