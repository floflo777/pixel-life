/**
 * `/play[?venue=<id>][&mode=daily]`: the venue manager's native path. Ensures someone is playing (guest with a loaner
 * if nobody is) and mounts the chosen native venue (default: Loose Pixels) with a `VenueHost`. The venue owns its run
 * and results screens; the shell credits Bits and stamps when a run is reported and walks back into The Sky when the
 * venue exits. First-run coachmarks sit over the venue (the `.play` wrapper is `position: relative`).
 *
 * The venue is keyed by who plays (mode + token id), the venue, the mode and an explicit restart counter, never by the
 * identity revision: a scar or balance update after a run must not remount a venue that is showing its results.
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
import { Coachmarks } from "../onboarding/index.js";
import { Card, ErrorState, LinkButton, Loading } from "../ui/index.js";
import type { ReportedRun } from "./host.js";
import { NativeVenueView } from "./NativeVenueView.js";
import { nativeVenue, type VenueMode } from "./registry.js";

/** Toast text for a reported run (Bits, new stamps, and any verification problem, stated plainly). */
export function runToast(run: ReportedRun, reward: { bits: number; newStamps: readonly string[] }): string {
  const parts = [`+${reward.bits} bits`];
  if (reward.newStamps.length) parts.push(`new stamp${reward.newStamps.length > 1 ? "s" : ""}!`);
  if (run.problem) parts.push(run.problem);
  return parts.join(" · ");
}

/** The play screen. */
export default function PlayScreen({ search }: PageProps) {
  const s = useServices();
  const { identity } = useStore(s.identity.store);
  const [bootError, setBootError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const entry = nativeVenue(search.get("venue"));
  const mode: VenueMode = search.get("mode") === "daily" ? "daily" : "quick";

  useEffect(() => {
    if (identity.mode !== "none") return;
    ensureGuest(s).catch((e: unknown) => setBootError(e));
  }, [identity.mode, s, attempt]);

  const player = identity.mode === "none" ? null : `${identity.mode}:${identity.view.appearance.tokenId}`;
  const venueIdentity = useMemo<VenueIdentity | null>(() => {
    if (identity.mode === "none") return null;
    return { mode: identity.mode, friend: identity.view, loaned: identity.mode === "guest" };
    // A run starts from the identity at mount; later scar/balance updates must not remount the venue.
  }, [player, attempt]);

  if (!entry)
    return (
      <div className="page">
        <Card title="No such game">
          <p>This door leads nowhere yet.</p>
          <LinkButton to="/sky">back to the sky</LinkButton>
        </Card>
      </div>
    );
  if (bootError)
    return (
      <div className="page">
        <ErrorState
          message={`Couldn't load a loaned Friend: ${errorMessage(bootError)}`}
          onRetry={() => {
            setBootError(null);
            setAttempt((a) => a + 1);
          }}
        />
      </div>
    );
  if (!venueIdentity || identity.mode === "none") return <Loading label="your Friend is on its way" />;

  const progressKey = identity.mode === "owner" ? identity.view.appearance.tokenId : "guest";
  return (
    <div className="play" data-testid="play" data-venue={entry.manifest.id}>
      <NativeVenueView
        key={`${player}:${entry.manifest.id}:${mode}:${attempt}`}
        entry={entry}
        mode={mode}
        identity={venueIdentity}
        onReported={(run) => {
          const reward = s.progress.recordRun(
            progressKey,
            { score: run.result.claimed.score, lost: popcount(run.result.claimed.lostDelta) },
            Date.now(),
          );
          s.toast(runToast(run, reward), run.problem ? "bad" : "good");
        }}
        onExit={() => navigate("/sky")}
      />
      {/* First-run hints, fed by the venue's `pl:coach` window events; never blocks the game. */}
      <Coachmarks />
    </div>
  );
}
