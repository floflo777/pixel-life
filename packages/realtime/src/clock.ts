/** Time source for rooms and buckets. Milliseconds; only differences and ordering matter, never the epoch. */
export interface Clock {
  /** Current time in ms. Must be non-decreasing. */
  now(): number;
}

/** Wall clock in epoch ms: the server-time base that `welcome`, `moved.t0` and `pong` carry. */
export const systemClock: Clock = { now: () => Date.now() };

/** A clock that only moves when told to, for deterministic tests and simulations. */
export class ManualClock implements Clock {
  #t: number;

  /** Starts at `start` ms. */
  constructor(start = 1_000_000) {
    this.#t = start;
  }

  /** Current manual time. */
  now(): number {
    return this.#t;
  }

  /** Moves time forward by `ms` (negative values are rejected so the clock stays monotonic). */
  advance(ms: number): number {
    if (!(ms >= 0)) throw new RangeError("ManualClock only moves forward.");
    this.#t += ms;
    return this.#t;
  }

  /** Jumps to absolute time `t` (not before the current time). */
  set(t: number): void {
    if (t < this.#t) throw new RangeError("ManualClock only moves forward.");
    this.#t = t;
  }
}
