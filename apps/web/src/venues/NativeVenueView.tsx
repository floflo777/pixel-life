/**
 * Mounts a native venue on its own stage with a shell-built `VenueHost`. The venue is paused while the tab is hidden or
 * a shell dialog is open, and unmounted (releasing every stage resource) when the view goes away. The parent keys this
 * view by the identity revision, so an identity change always remounts the venue with the new Friend.
 */
import type { VenueIdentity, VenueInstance } from "@pl/venue-kit";
import { createSignal } from "@pl/venue-kit";
import { useEffect, useMemo, useState } from "react";
import { useServices } from "../app/services.js";
import { LiveStage } from "../stage/LiveStage.js";
import { ErrorState, FriendPortrait } from "../ui/index.js";
import { createVenueHost, type ReportedRun } from "./host.js";
import type { NativeVenueEntry, VenueMode } from "./registry.js";

/** Props of {@link NativeVenueView}. */
export interface NativeVenueViewProps {
  entry: NativeVenueEntry;
  /** Free run or today's Daily (from the door). */
  mode: VenueMode;
  identity: VenueIdentity;
  onReported(run: ReportedRun): void;
  onExit(reason: "done" | "quit"): void;
}

/** A native venue on a live stage. */
export function NativeVenueView({ entry, mode, identity, onReported, onExit }: NativeVenueViewProps) {
  const services = useServices();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const paused = useMemo(() => createSignal(false), []);

  useEffect(() => {
    const update = (): void => paused.set(document.hidden || services.confirmations.get() !== null);
    update();
    document.addEventListener("visibilitychange", update);
    const off = services.confirmations.subscribe(update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      off();
    };
  }, [paused, services]);

  if (error)
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          setError(null);
          setAttempt((a) => a + 1);
        }}
      />
    );

  return (
    <LiveStage
      key={attempt}
      className="venue-stage"
      label={`${entry.manifest.name}: your Friend on a floating island`}
      fallback={
        <div className="stage-fallback-card">
          <FriendPortrait view={identity.friend} scale={8} />
          <p>This device can't run the 3D stage (WebGL2). The 1-bit mode is on its way.</p>
        </div>
      }
      mount={(stage) => {
        let instance: VenueInstance | null = null;
        let gone = false;
        const host = createVenueHost({ services, identity, stage, paused: paused.signal, onReported, onExit });
        entry
          .load({ mode })
          .then((venue) => venue.mount(host))
          .then(
            (inst) => {
              if (gone) void inst.unmount();
              else instance = inst;
            },
            (e: unknown) => {
              if (!gone)
                setError(`${entry.manifest.name} failed to start: ${e instanceof Error ? e.message : String(e)}`);
            },
          );
        const offPause = paused.signal.subscribe((p) => instance?.pause(p));
        return () => {
          gone = true;
          offPause();
          void instance?.unmount();
        };
      }}
    />
  );
}
