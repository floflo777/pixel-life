/** Pure music-ducking state: overlapping duck requests merge into one envelope (deepest wins, longest hold wins). */

/** Mutable duck state owned by the engine. */
export interface DuckState {
  /** Current requested attenuation in dB (positive = quieter). */
  depthDb: number;
  /** Audio-clock time at which the release starts. */
  until: number;
}

/** A fresh, inactive duck state. */
export function createDuckState(): DuckState {
  return { depthDb: 0, until: Number.NEGATIVE_INFINITY };
}

/**
 * Merges a duck request into `state` in place. Returns true if the envelope must be rescheduled
 * (deeper or longer than what is already active), false if the active duck already covers it.
 */
export function requestDuck(state: DuckState, now: number, depthDb: number, hold: number): boolean {
  const active = now < state.until;
  const until = now + Math.max(0, hold);
  if (active && depthDb <= state.depthDb && until <= state.until) return false;
  state.depthDb = active ? Math.max(state.depthDb, depthDb) : depthDb;
  state.until = Math.max(active ? state.until : Number.NEGATIVE_INFINITY, until);
  return true;
}
