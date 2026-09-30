/**
 * "Bring your own Friend" (GDD §6.8): 1 connect wallet (SDK session, EIP-6963 list) → 2 pick your Friend (our picker on
 * the SDK `GameMenu`) → 3 sign in (no gas) → 4 bound, scars and all. Every state from the GDD is covered: no wallet,
 * wrong chain, no playable Friend, gate failed (retry), and "keep playing on loan" is always one tap away.
 */
import type { OwnedFriend } from "@rarefriends/friendsdk/owned";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import { useOwnerFlow } from "../app/hooks.js";
import type { PageProps } from "../app/routes.js";
import { useServices } from "../app/services.js";
import { errorMessage } from "../api/client.js";
import { shortAddress } from "../lib/format.js";
import { useStore } from "../lib/store.js";
import { Button, Card, ErrorState, LinkButton, Loading } from "../ui/index.js";
import { ROBINHOOD_CHAIN_ID, type OwnerFlow, type OwnerStep } from "./owner-flow.js";
import { SIWE_STATEMENT } from "./siwe.js";

const STEPS = ["connect wallet", "pick your Friend", "sign in (no gas)", "it rains in, scars and all"] as const;

function stepIndex(f: OwnerStep): number {
  switch (f.step) {
    case "idle":
    case "unavailable":
    case "connecting":
    case "wrong-chain":
      return 0;
    case "discovering":
    case "picking":
    case "empty":
    case "checking":
      return 1;
    case "signing":
    case "binding":
      return 2;
    case "bound":
      return 3;
    case "error":
      return f.at === "connect" ? 0 : f.at === "sign" || f.at === "bind" ? 2 : 1;
  }
}

function Picker({ flow, friends, busy }: { flow: OwnerFlow; friends: readonly OwnedFriend[]; busy: string | null }) {
  return (
    <div className="menu-host menu-inline">
      <GameMenu title="Choose your Friend">
        <p>Pick an owned, hardwired Friend (generation 1 or higher). Its scars and gold come with it.</p>
        <div className="rf-frame-friends">
          {friends.map((f) => {
            const id = f.id.toString(10);
            return (
              <button
                key={id}
                type="button"
                onClick={() => void flow.select(id)}
                disabled={busy !== null}
                aria-busy={busy === id}
                data-testid={`pick-${id}`}
              >
                <strong>#{id}</strong>
                <small>generation {f.generation}</small>
              </button>
            );
          })}
        </div>
      </GameMenu>
    </div>
  );
}

function FlowView({ flow }: { flow: OwnerFlow }) {
  const s = useServices();
  const st = useStore(flow.store);
  const { identity } = useStore(s.identity.store);
  const f = st.flow;
  const at = stepIndex(f);
  const busy = f.step === "checking" || f.step === "signing" || f.step === "binding" ? f.tokenId : null;

  return (
    <Card title="bring your own Friend">
      <ol className="steps mono">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === at ? "step" : undefined} className={i < at ? "done" : ""}>
            {i + 1} {label}
            {i < at ? " ✓" : ""}
          </li>
        ))}
      </ol>
      {st.wallet.account && (
        <p className="mono">
          wallet {shortAddress(st.wallet.account)} · chain {st.wallet.chainId ?? "?"}
        </p>
      )}

      <div className="connect-state" aria-live="polite">
        {f.step === "idle" && (
          <>
            <p>Connecting only reads which Friends you own. It never signs or spends.</p>
            {st.wallet.wallets.length > 1 ? (
              <div className="wallet-list">
                {st.wallet.wallets.map((w, i) => (
                  <Button
                    key={w.id}
                    variant={i === 0 ? "now" : "paper"}
                    onClick={() => void flow.connect(w.id)}
                    data-testid={i === 0 ? "connect-wallet" : undefined}
                  >
                    connect {w.name}
                  </Button>
                ))}
              </div>
            ) : (
              <Button variant="now" size="big" onClick={() => void flow.connect()} data-testid="connect-wallet">
                connect wallet
              </Button>
            )}
          </>
        )}
        {f.step === "unavailable" && (
          <p>
            No browser wallet found. Keep playing on loan, or{" "}
            <a href="https://ethereum.org/wallets" target="_blank" rel="noreferrer">
              get a wallet ↗
            </a>
            .
          </p>
        )}
        {f.step === "connecting" && <Loading label="waiting for your wallet" />}
        {f.step === "wrong-chain" && (
          <>
            <p role="alert">Your wallet is on another network. Rare Friends live on Robinhood Chain.</p>
            <Button variant="now" onClick={() => void flow.switchNetwork()} data-testid="switch-chain">
              switch to Robinhood Chain ({ROBINHOOD_CHAIN_ID})
            </Button>
          </>
        )}
        {f.step === "discovering" && <Loading label="finding your Friends" />}
        {f.step === "empty" && (
          <p role="alert" data-testid="no-friends">
            No playable Friend found in this wallet.
            {st.hiddenCount > 0 &&
              ` ${st.hiddenCount} hidden: generation-0 Friends need hardwiring (from 1 RF) before they can play.`}{" "}
            Keep playing on loan.
          </p>
        )}
        {f.step === "checking" && <Loading label={`checking you own #${f.tokenId} at the latest block`} />}
        {f.step === "signing" && (
          <div>
            <Loading label="sign in with your wallet" />
            <p className="mono">"{SIWE_STATEMENT}" This is a signature, not a transaction.</p>
          </div>
        )}
        {f.step === "binding" && <Loading label="the server re-checks ownership" />}
        {f.step === "bound" && identity.mode === "owner" && (
          <div data-testid="bound">
            <p className="display">#{identity.view.appearance.tokenId} is yours. It rains in, scars and all ✓</p>
            <div className="row">
              <LinkButton to="/play" variant="now" size="big">
                ▶ play
              </LinkButton>
              <LinkButton to="/sky">enter the sky</LinkButton>
              <LinkButton to={`/f/${identity.view.appearance.tokenId}`}>Friend page</LinkButton>
            </div>
          </div>
        )}
        {f.step === "error" && <ErrorState message={f.message} onRetry={() => void flow.retry()} />}
      </div>

      {(f.step === "picking" ||
        (st.friends.length > 0 && (f.step === "checking" || f.step === "signing" || f.step === "binding"))) && (
        <Picker flow={flow} friends={st.friends} busy={busy} />
      )}
      {f.step === "error" && f.at !== "connect" && f.at !== "discover" && st.friends.length > 1 && (
        <Picker flow={flow} friends={st.friends} busy={null} />
      )}

      <div className="row connect-footer">
        <LinkButton to="/play">keep playing on loan →</LinkButton>
        {st.wallet.account && (
          <Button variant="quiet" onClick={() => void flow.disconnect()}>
            disconnect
          </Button>
        )}
      </div>
    </Card>
  );
}

/** `/connect` */
export default function ConnectScreen(_props: PageProps) {
  const { flow, error } = useOwnerFlow();
  return (
    <div className="page page-connect">
      {error ? (
        <ErrorState message={`The wallet module failed to load: ${errorMessage(error)}`} />
      ) : flow ? (
        <FlowView flow={flow} />
      ) : (
        <Loading label="loading the wallet" />
      )}
    </div>
  );
}
