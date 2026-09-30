/**
 * First-run coachmarks, driven by named game events.
 *
 * The venue (or the host that wraps it) reports what just happened with a plain event name: `coach.emit("run:start")`,
 * or, from code that cannot import the web app, `window.dispatchEvent(new CustomEvent("pl:coach", { detail: name }))`.
 * A small pure reducer decides which hint shows. A hint is "done" once the player performs its action (a fling, a
 * grab-back), not merely when it was displayed, so a player who never flung still gets the hint next run.
 */
import { readProgress, writeProgress } from "./progress.js";

/** The event names the coachmarks understand. Unknown names are ignored, so venues may emit more. */
export const COACH_EVENTS = Object.freeze({
  /** A run started and the Friend can be flung. */
  runStart: "run:start",
  /** The player released a fling. */
  fling: "fling",
  /** A hit knocked pixels off; they are loose on the ground for ~2 s. */
  pixelsLoose: "pixels:loose",
  /** The player swept at least one loose pixel back. */
  pixelsGrabbed: "pixels:grabbed",
  /** The loose pixels timed out and became scars. */
  pixelsScarred: "pixels:scarred",
  /** The run is paused (menus, tab hidden): hide every hint. */
  pause: "pause",
  /** The run ended. */
  runEnd: "run:end",
} as const);

/** A known coach event name. */
export type CoachEventName = (typeof COACH_EVENTS)[keyof typeof COACH_EVENTS];

/** One coachmark: when it appears, what completes it, what merely hides it. */
export interface CoachmarkDef {
  id: string;
  /** Event that shows it (if not done yet). */
  showOn: CoachEventName;
  /** Events that complete it for good. */
  doneOn: readonly CoachEventName[];
  /** Events that hide it without completing it. */
  hideOn: readonly CoachEventName[];
  /** Big line (≤ 4 words). */
  title: string;
  /** One short sentence. */
  body: string;
  /** Which illustration to draw. */
  art: "fling" | "sweep";
}

/** The first-run coachmarks (GDD §1: "drag to fling", then "grab them back"). */
export const COACHMARKS: readonly CoachmarkDef[] = Object.freeze([
  {
    id: "fling",
    showOn: COACH_EVENTS.runStart,
    doneOn: [COACH_EVENTS.fling],
    hideOn: [COACH_EVENTS.pause, COACH_EVENTS.runEnd],
    title: "Drag to fling",
    body: "Press anywhere, pull back, let go. Your Friend flies the other way.",
    art: "fling",
  },
  {
    id: "sweep",
    showOn: COACH_EVENTS.pixelsLoose,
    doneOn: [COACH_EVENTS.pixelsGrabbed],
    hideOn: [COACH_EVENTS.pixelsScarred, COACH_EVENTS.pause, COACH_EVENTS.runEnd],
    title: "Grab them back",
    body: "Fling through your loose pixels within 2 s. Missed ones become scars.",
    art: "sweep",
  },
]);

/** Coach state: the visible hint (or null) and the completed ids. */
export interface CoachState {
  active: string | null;
  done: readonly string[];
}

/**
 * Pure transition. Completing events mark their hint done (and hide it if visible); hiding events clear the visible
 * hint; a show event opens its hint only when it is not done. Returns the same object when nothing changes.
 */
export function coachReduce(state: CoachState, event: string, defs: readonly CoachmarkDef[] = COACHMARKS): CoachState {
  let { active, done } = state;
  for (const d of defs) {
    if ((d.doneOn as readonly string[]).includes(event) && !done.includes(d.id)) done = [...done, d.id];
  }
  const current = defs.find((d) => d.id === active);
  if (current && (done.includes(current.id) || (current.hideOn as readonly string[]).includes(event))) active = null;
  const show = defs.find((d) => d.showOn === event && !done.includes(d.id));
  if (show) active = show.id;
  return active === state.active && done === state.done ? state : { active, done };
}

/** A live coach: an event sink plus a subscribable snapshot (for `useSyncExternalStore`). */
export interface Coach {
  /** Reports a game event by name. */
  emit(event: string): void;
  getSnapshot(): CoachState;
  subscribe(listener: () => void): () => void;
  /** Hides the visible hint without completing it (the "got it" button completes it instead: see `dismiss`). */
  hide(): void;
  /** Completes the visible hint ("got it"). */
  dismiss(): void;
  /** The definition of the visible hint, or null. */
  current(): CoachmarkDef | null;
}

/** Options of {@link createCoach}. */
export interface CoachOptions {
  defs?: readonly CoachmarkDef[];
  /** Persist completed ids to localStorage (default true). */
  persist?: boolean;
}

/** Creates a coach. Completed ids are loaded from and saved to the onboarding progress unless `persist` is false. */
export function createCoach(opts: CoachOptions = {}): Coach {
  const defs = opts.defs ?? COACHMARKS;
  const persist = opts.persist !== false;
  let state: CoachState = { active: null, done: persist ? readProgress().coachDone : [] };
  const listeners = new Set<() => void>();
  const set = (next: CoachState): void => {
    if (next === state) return;
    if (persist && next.done !== state.done) writeProgress({ coachDone: [...next.done] });
    state = next;
    for (const l of [...listeners]) l();
  };
  const current = (): CoachmarkDef | null => defs.find((d) => d.id === state.active) ?? null;
  return {
    emit: (event) => set(coachReduce(state, event, defs)),
    getSnapshot: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    hide: () => set(state.active === null ? state : { ...state, active: null }),
    dismiss() {
      const c = current();
      if (c) set({ active: null, done: state.done.includes(c.id) ? state.done : [...state.done, c.id] });
    },
    current,
  };
}

/** Name of the DOM event venues dispatch on `window` (`detail` = the coach event name). */
export const COACH_DOM_EVENT = "pl:coach";

/** Dispatches a coach event on `window` (for code that cannot import the coach instance). No-op without a window. */
export function emitCoachEvent(name: CoachEventName | (string & {})): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COACH_DOM_EVENT, { detail: name }));
}

/** Forwards `pl:coach` window events into `coach`; returns the unsubscribe. */
export function bindCoachToWindow(coach: Coach, target: Window = window): () => void {
  const on = (e: Event): void => {
    const d = (e as CustomEvent<unknown>).detail;
    if (typeof d === "string") coach.emit(d);
  };
  target.addEventListener(COACH_DOM_EVENT, on);
  return () => target.removeEventListener(COACH_DOM_EVENT, on);
}
