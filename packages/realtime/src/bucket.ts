import type { RateRule } from "@pl/shared";

/** Float slack so that exact refills (0.5/s over 2000 ms) are not lost to rounding. */
const EPS = 1e-9;

/**
 * Classic token bucket: starts full at `burst`, refills continuously at `perSec`, one token per message.
 * Time is passed in, so the bucket is pure and testable with any clock.
 */
export class TokenBucket {
  #tokens: number;
  #last: number;

  /** Creates a full bucket at time `now` (ms). */
  constructor(
    readonly rule: RateRule,
    now: number,
  ) {
    this.#tokens = rule.burst;
    this.#last = now;
  }

  /** Takes one token at `now`; returns false (and takes nothing) when the bucket is empty. */
  take(now: number): boolean {
    this.#refill(now);
    if (this.#tokens + EPS < 1) return false;
    this.#tokens = Math.max(0, this.#tokens - 1);
    return true;
  }

  /** Tokens available at `now` (refills first). */
  available(now: number): number {
    this.#refill(now);
    return this.#tokens;
  }

  #refill(now: number): void {
    const dt = now - this.#last;
    if (dt > 0) {
      this.#tokens = Math.min(this.rule.burst, this.#tokens + (dt / 1000) * this.rule.perSec);
      this.#last = now;
    }
  }
}
