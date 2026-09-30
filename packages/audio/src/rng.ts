/** Deterministic, allocation-free pseudo-random helpers for procedural audio. */

/** 32-bit integer hash of several integers (murmur3-style finalizer); equal inputs always give equal outputs. */
export function hashInts(a: number, b = 0, c = 0, d = 0): number {
  let h = 0x9e3779b9 ^ Math.imul(a | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) ^ Math.imul(b | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39) ^ Math.imul(c | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) ^ Math.imul(d | 0, 0x165667b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hashes an arbitrary string (e.g. a Daily seed or theme id) to a 32-bit integer, stable across engines. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mulberry32 generator. Mutable and reusable: `reseed` lets a single instance serve many bars
 * without allocating, and the same seed always yields the same sequence.
 */
export class Rng {
  private state: number;

  /** Creates a generator seeded with a 32-bit integer. */
  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Restarts the sequence from `seed`. */
  reseed(seed: number): void {
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n) (n ≥ 1). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Float in [−1, 1). */
  bipolar(): number {
    return this.next() * 2 - 1;
  }

  /** Uniformly picks one element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new RangeError("Rng.pick needs a non-empty array");
    return item;
  }
}
