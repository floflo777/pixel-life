import {
  SimEvents,
  and,
  andNot,
  beltDef,
  popcount,
  type BeltId,
  type Hex64,
  type RunFacts,
  type RunKind,
  type SimEvent,
} from "@pl/shared";

/**
 * Turning a verified replay into the meta layer's `RunFacts` (stamps and belts, GDD §12.4–12.5). The replay worker
 * re-runs a verified log with events on and folds them into a {@link RunTally}; the verification step adds what the
 * stored run knows (venue, arena, kind, belt trial, starting scars). Everything here is pure.
 */

/** Per-run metrics counted from sim events (structured-clone safe: it crosses the worker boundary). */
export interface RunTally {
  /** Pixels grabbed back (`pixelBack`). */
  grabbedBack: number;
  /** Grabs flagged clutch (`pixelBack.b === 1`). */
  clutchGrabs: number;
  /** Highest fling combo seen (`combo.a`). */
  maxCombo: number;
  /** Fizz blasts banked by the Friend (`explode.b === 1`). */
  fizzBank: number;
  /** Creatures popped by the player (`smash` with points > 0). */
  pops: number;
  /** Family-trait actions fired (`trait`). */
  traitTriggers: number;
  /** Old Gulp burped at least once (`gulp.a === GULP_EV_BURP`). */
  gulpBurped: boolean;
}

/** A tally with nothing counted. */
export function emptyTally(): RunTally {
  return { grabbedBack: 0, clutchGrabs: 0, maxCombo: 0, fizzBank: 0, pops: 0, traitTriggers: 0, gulpBurped: false };
}

/** Folds one sim event into `tally` (mutates it: the worker folds thousands of events per run). */
export function tallyEvent(tally: RunTally, e: SimEvent): void {
  switch (e.type) {
    case "pixelBack":
      tally.grabbedBack++;
      if (e.b === 1) tally.clutchGrabs++;
      return;
    case "combo":
      tally.maxCombo = Math.max(tally.maxCombo, e.a ?? 0);
      return;
    case "explode":
      if (e.b === 1) tally.fizzBank++;
      return;
    case "smash":
      if ((e.b ?? 0) > 0) tally.pops++;
      return;
    case "trait":
      tally.traitTriggers++;
      return;
    case "gulp":
      if (e.a === SimEvents.GULP_EV_BURP) tally.gulpBurped = true;
      return;
    default:
      return;
  }
}

/** Folds a list of events into a fresh tally. */
export function tallyEvents(events: Iterable<SimEvent>): RunTally {
  const t = emptyTally();
  for (const e of events) tallyEvent(t, e);
  return t;
}

/** Venue id the meta layer sees: the handheld plays the same sim, so its runs count as Pixel Life runs. */
export function metaVenueOf(venueId: string): string {
  return venueId === "handheld" ? "pixel-life" : venueId;
}

/** Everything a stored, verified run contributes to its facts. */
export interface VerifiedRun {
  readonly venueId: string;
  readonly kind: RunKind;
  readonly arena: string;
  /** Belt trial the run was accepted as (already validated at submission), or null. */
  readonly beltTrial: string | null;
  readonly score: number;
  readonly lostDelta: Hex64;
  /** The Friend at the start of the run, as replayed (`runs.sim_friend`). */
  readonly friend: { readonly front: Hex64; readonly lost: Hex64 };
}

/**
 * The `RunFacts` of a verified run. `tally` is null when the replay could not count events (older worker): the facts
 * then only carry what the summary proves (score, flawless, kept share), which still earns score and belt-free stamps.
 */
export function runFacts(run: VerifiedRun, tally: RunTally | null): RunFacts {
  const present = andNot(run.friend.front, run.friend.lost);
  const start = popcount(present);
  const lost = popcount(and(run.lostDelta, present));
  const keptBps = start === 0 ? 0 : Math.floor(((start - lost) * 10_000) / start);
  const trial = run.beltTrial !== null && beltDef(run.beltTrial) ? (run.beltTrial as BeltId) : null;
  return {
    venueId: metaVenueOf(run.venueId),
    score: run.score,
    island: run.arena,
    mode: trial ? "trial" : run.kind === "daily" ? "daily" : "quick",
    ...(trial ? { beltTrial: trial } : {}),
    keptBps,
    flawless: start > 0 && lost === 0,
    ...(tally
      ? {
          grabbedBack: tally.grabbedBack,
          clutchGrabs: tally.clutchGrabs,
          maxCombo: tally.maxCombo,
          fizzBank: tally.fizzBank,
          pops: tally.pops,
          traitTriggers: tally.traitTriggers,
          gulpBurped: tally.gulpBurped,
        }
      : {}),
  };
}
