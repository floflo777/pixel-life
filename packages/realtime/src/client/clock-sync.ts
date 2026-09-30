/** One ping/pong measurement. */
export interface ClockSample {
  /** serverTime − localTime estimate, ms. */
  readonly offset: number;
  /** Round trip, ms. */
  readonly rtt: number;
}

/** Offsets further than this from the current estimate are applied at once instead of slewed. */
const SNAP_MS = 1000;
/** Slew rate: the estimate moves at most 0.1 ms per elapsed ms, so rendered motion never visibly jumps. */
const SLEW = 0.1;

/**
 * Server clock estimate from ping/pong (NTP-style, min-RTT filter over the last `window` samples). The applied
 * offset is slewed toward the best estimate rather than stepped, so interpolated positions stay smooth.
 */
export class ClockSync {
  readonly #samples: ClockSample[] = [];
  #target: number | null = null;
  #applied = 0;
  #lastLocal: number | null = null;

  /** Keeps the last `window` samples. */
  constructor(readonly window = 8) {}

  /** True once at least one estimate exists. */
  get synced(): boolean {
    return this.#target !== null;
  }

  /** Best round-trip time seen in the window (Infinity before any ping). */
  get rtt(): number {
    return this.#samples.reduce((m, s) => Math.min(m, s.rtt), Infinity);
  }

  /** Rough first estimate from `welcome.serverTime` (ignores one-way latency; pings refine it). */
  seed(serverTime: number, localNow: number): void {
    if (this.#samples.length > 0) return;
    this.#setTarget(serverTime - localNow, localNow);
  }

  /** Adds a ping/pong sample: sent at `localSent`, pong carrying `serverTime` received at `localRecv`. */
  addSample(localSent: number, serverTime: number, localRecv: number): ClockSample {
    const rtt = Math.max(0, localRecv - localSent);
    const sample = { offset: serverTime - (localSent + rtt / 2), rtt };
    this.#samples.push(sample);
    if (this.#samples.length > this.window) this.#samples.shift();
    const best = this.#samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.#setTarget(best.offset, localRecv);
    return sample;
  }

  /** Estimated server time at local time `localNow`. */
  serverNow(localNow: number): number {
    this.#slew(localNow);
    return localNow + this.#applied;
  }

  /** Forgets everything (a new connection may land on a restarted server). */
  reset(): void {
    this.#samples.length = 0;
    this.#target = null;
    this.#lastLocal = null;
    this.#applied = 0;
  }

  #setTarget(offset: number, localNow: number): void {
    this.#slew(localNow);
    if (this.#target === null || Math.abs(offset - this.#applied) > SNAP_MS) this.#applied = offset;
    this.#target = offset;
  }

  #slew(localNow: number): void {
    const last = this.#lastLocal;
    this.#lastLocal = localNow;
    if (this.#target === null || last === null) return;
    const maxStep = Math.max(0, localNow - last) * SLEW;
    const diff = this.#target - this.#applied;
    this.#applied += Math.max(-maxStep, Math.min(maxStep, diff));
  }
}
