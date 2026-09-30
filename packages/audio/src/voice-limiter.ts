/**
 * Fixed-capacity voice allocator. Pure bookkeeping (no WebAudio), backed by typed arrays so
 * `acquire` never allocates: safe to call from a 60 fps hot path.
 *
 * Policy, in order:
 *  1. Voices whose end time has passed are free.
 *  2. A cue restarted within its `minInterval` is rejected (avoids flams and phasing).
 *  3. A cue at its own `maxVoices` steals its own oldest voice.
 *  4. Otherwise a free slot is used.
 *  5. Otherwise the lowest-priority (then oldest) voice with priority ≤ the newcomer is stolen.
 *  6. Otherwise the start is rejected: important sounds are never cut by trivial ones.
 */
export class VoiceLimiter {
  /** Total slots. */
  readonly capacity: number;
  /** Set by `acquire`: true when the returned slot was taken from a still-sounding voice. */
  stolen = false;

  private readonly cue: Int32Array;
  private readonly priority: Int32Array;
  private readonly start: Float64Array;
  private readonly end: Float64Array;
  private readonly lastStart: Float64Array;
  private activeLimit: number;

  /** `cueCount` sizes the per-cue restart table; `capacity` is the hard voice cap. */
  constructor(capacity: number, cueCount: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacity must be a positive integer");
    this.capacity = capacity;
    this.activeLimit = capacity;
    this.cue = new Int32Array(capacity).fill(-1);
    this.priority = new Int32Array(capacity);
    this.start = new Float64Array(capacity);
    this.end = new Float64Array(capacity);
    this.lastStart = new Float64Array(Math.max(1, cueCount)).fill(Number.NEGATIVE_INFINITY);
  }

  /** Lowers (or restores) the usable voice count without reallocating, e.g. for reduced audio. */
  setLimit(limit: number): void {
    this.activeLimit = Math.max(1, Math.min(this.capacity, Math.trunc(limit)));
  }

  /** The current usable voice count. */
  get limit(): number {
    return this.activeLimit;
  }

  /**
   * Reserves a slot for `cueId` sounding from `now` until `endTime`.
   * Returns the slot index, or −1 if the start must be dropped. Sets `stolen`.
   */
  acquire(
    cueId: number,
    priority: number,
    now: number,
    endTime: number,
    maxPerCue: number,
    minInterval: number,
  ): number {
    this.stolen = false;
    const last = this.lastStart[cueId] ?? Number.NEGATIVE_INFINITY;
    if (now - last < minInterval) return -1;

    let sameCount = 0;
    let sameOldest = -1;
    let free = -1;
    let victim = -1;
    for (let i = 0; i < this.activeLimit; i++) {
      const c = this.cue[i] ?? -1;
      if (c < 0 || (this.end[i] ?? 0) <= now) {
        if (free < 0) free = i;
        continue;
      }
      if (c === cueId) {
        sameCount++;
        if (sameOldest < 0 || (this.start[i] ?? 0) < (this.start[sameOldest] ?? 0)) sameOldest = i;
      }
      const p = this.priority[i] ?? 0;
      if (p <= priority) {
        if (
          victim < 0 ||
          p < (this.priority[victim] ?? 0) ||
          (p === this.priority[victim] && (this.start[i] ?? 0) < (this.start[victim] ?? 0))
        ) {
          victim = i;
        }
      }
    }

    let slot: number;
    if (sameCount >= maxPerCue && sameOldest >= 0) {
      slot = sameOldest;
      this.stolen = true;
    } else if (free >= 0) {
      slot = free;
    } else if (victim >= 0) {
      slot = victim;
      this.stolen = true;
    } else {
      return -1;
    }
    this.cue[slot] = cueId;
    this.priority[slot] = priority;
    this.start[slot] = now;
    this.end[slot] = endTime;
    this.lastStart[cueId] = now;
    return slot;
  }

  /** Marks a slot free (its sound ended or was stopped). */
  release(slot: number): void {
    if (slot >= 0 && slot < this.capacity) {
      this.cue[slot] = -1;
      this.end[slot] = 0;
    }
  }

  /** Frees every slot and forgets restart times. */
  reset(): void {
    this.cue.fill(-1);
    this.end.fill(0);
    this.lastStart.fill(Number.NEGATIVE_INFINITY);
  }

  /** Number of slots still sounding at `now` (for meters and tests). */
  activeCount(now: number): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if ((this.cue[i] ?? -1) >= 0 && (this.end[i] ?? 0) > now) n++;
    return n;
  }

  /** Cue id occupying a slot, or −1. */
  cueAt(slot: number): number {
    return this.cue[slot] ?? -1;
  }
}
