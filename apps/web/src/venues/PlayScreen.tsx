/**
 * `/play`: the venue manager's native path. Ensures someone is playing (guest with a loaner if nobody is), mounts the
 * Loose Pixels venue slot with a `VenueHost`, then shows the results card. The venue remounts whenever the identity
 * revision changes (loaner swap, owner bound or dropped).
 */
import { popcount } from "@pl/shared";
import type { VenueIdentity } from "@pl/venue-kit";
import { useEffect, useMemo, useState } from "react";
import type { PageProps } from "../app/routes.js";
import { useServices } from "../app/services.js";
import { ensureGuest } from "../identity/bootstrap.js";
import { errorMessage } from "../api/client.js";
import { navigate } from "../lib/router.js";
import { useStore } from "../lib/store.js";
import type { RunReward } from "../meta/progress.js";
import { ErrorBox, Loading } from "../ui/kit.js";
import type { ReportedRun } from "./host.js";
import { NativeVenueView } from "./NativeVenueView.js";
import { PIXEL_LIFE } from "./registry.js";
import { Results } from "./Results.js";

/** The play screen. */
export default function PlayScreen(_props: PageProps) {
  const s = useServices();
  const { identity, revision } = useStore(s.identity.store);
  const [bootError, setBootError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<{ run: ReportedRun; reward: RunReward } | null>(null);

  useEffect(() => {
    if (identity.mode !== "none") return;
    ensureGuest(s).catch((e: unknown) => setBootError(e));
  }, [identity.mode, s, attempt]);

  // A new identity means a new run.
  useEffect(() => setDone(null), [revision]);

  const venueIdentity = useMemo<VenueIdentity | null>(() => {
    if (identity.mode === "none") return null;
    return { mode: identity.mode, friend: identity.view, loaned: identity.mode === "guest" };
    // Each run starts from the current identity; scar updates during a run must not remount it.
  }, [revision, attempt, identity.mode === "none"]);

  if (bootError)
    return (
      <div className="page">
        <ErrorBox
          message={`Couldn't load a loaned Friend: ${errorMessage(bootError)}`}
          onRetry={() => {
            setBootError(null);
            setAttempt((a) => a + 1);
          }}
        />
      </div>
    );
  if (!venueIdentity || identity.mode === "none") return <Loading label="your Friend is on its way" />;

  if (done)
    return (
      <div className="page page-results">
        <Results
          run={done.run}
          view={identity.view}
          reward={done.reward}
          onPlayAgain={() => {
            setDone(null);
            setAttempt((a) => a + 1);
          }}
        />
      </div>
    );

  const player = identity.mode === "owner" ? identity.view.appearance.tokenId : "guest";
  return (
    <div className="play" data-testid="play">
      <NativeVenueView
        key={`${revision}:${attempt}`}
        entry={PIXEL_LIFE}
        identity={venueIdentity}
        onReported={(run) => {
          const reward = s.progress.recordRun(
            player,
            { score: run.result.claimed.score, lost: popcount(run.result.claimed.lostDelta) },
            Date.now(),
          );
          setDone({ run, reward });
        }}
        onExit={(reason) => {
          if (reason === "quit") navigate("/sky");
        }}
      />
    </div>
  );
}
