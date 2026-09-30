/**
 * In-game coachmarks overlay. Mount it over the venue canvas with a {@link Coach}; it shows the current hint (drag to
 * fling, grab them back) and never blocks the game: the overlay ignores pointers except its small "got it" button.
 * Hints are announced politely to screen readers. The ghost-hand / returning-pixel animations stop under reduced motion.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Button, cx } from "../ui/index.js";
import { bindCoachToWindow, type Coach, type CoachmarkDef, createCoach } from "./coach.js";

/** Props of {@link Coachmarks}. */
export interface CoachmarksProps {
  /** The coach to render. Default: a coach of its own, fed by `pl:coach` window events. */
  coach?: Coach;
  /** Also listen to `pl:coach` window events (default true). */
  listenWindow?: boolean;
  /** Where the hint sits over the game (default bottom). */
  placement?: "top" | "bottom";
  className?: string;
}

/** Small looping drawing for a hint (pure CSS, decorative). */
function CoachArt({ art }: { art: CoachmarkDef["art"] }) {
  if (art === "fling") {
    return (
      <span className="pl-coach-art pl-coach-art--fling" aria-hidden="true">
        <span className="pl-coach-friend" />
        <span className="pl-coach-band" />
        <span className="pl-coach-hand" />
      </span>
    );
  }
  return (
    <span className="pl-coach-art pl-coach-art--sweep" aria-hidden="true">
      <span className="pl-coach-friend" />
      <span className="pl-coach-px pl-coach-px--a" />
      <span className="pl-coach-px pl-coach-px--b" />
      <span className="pl-coach-px pl-coach-px--c" />
    </span>
  );
}

/** Renders the active coachmark of `coach` (or of an internal, window-fed coach). */
export function Coachmarks({ coach, listenWindow = true, placement = "bottom", className }: CoachmarksProps) {
  const own = useMemo(() => coach ?? createCoach(), [coach]);
  useEffect(() => (listenWindow ? bindCoachToWindow(own) : undefined), [own, listenWindow]);
  const state = useSyncExternalStore(own.subscribe, own.getSnapshot, own.getSnapshot);
  const def = state.active ? own.current() : null;

  return (
    <div className={cx("pl-root pl-coach-layer", `pl-coach-layer--${placement}`, className)}>
      <div role="status" aria-live="polite" className="pl-coach-live">
        {def && (
          <div className="pl-coach" key={def.id} data-coach={def.id}>
            <CoachArt art={def.art} />
            <span className="pl-coach-text">
              <strong className="pl-display pl-h3">{def.title}</strong>
              <span>{def.body}</span>
            </span>
            <Button variant="quiet" size="small" onClick={() => own.dismiss()}>
              got it
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
