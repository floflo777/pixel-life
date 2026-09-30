/**
 * sfc32 PRNG (architecture §3): 128-bit state, integer-only (`Math.imul`-free adds/xors/shifts), so every engine produces
 * the same stream. Each sim subsystem owns its own stream derived from `SimConfig.seed`, so e.g. the spawn sequence does
 * not shift when the player's bite tie-breaks consume numbers.
 */

/** A deterministic sfc32 generator. `state()` exposes the four words for hashing. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  /** Seeds from a 32-bit `seed` and a per-subsystem `stream` id; 16 warm-up rounds decorrelate close seeds. */
  constructor(seed: number, stream: number) {
    this.a = 0x9e3779b9 ^ Math.imul(stream + 1, 0x85ebca6b);
    this.b = seed | 0;
    this.c = 0x243f6a88 ^ stream;
    this.d = 1;
    for (let i = 0; i < 16; i++) this.u32();
  }

  /** Next unsigned 32-bit integer. */
  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1) with 32 bits of resolution (exact division by 2^32). */
  float(): number {
    return this.u32() / 4294967296;
  }

  /** Uniform integer in [0, n) for n ≥ 1. */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }

  /** The four state words (for hashing and tests). */
  state(): [number, number, number, number] {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }
}
