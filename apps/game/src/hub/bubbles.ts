/**
 * Emote / quick-chat bubble queues (pure). One bubble per Friend at a time, stepped (no fades), with a short queue so
 * a burst of emotes plays in order instead of overwriting itself, and a per-Friend mute (GDD §11.3 block/mute).
 */

/** What a bubble shows. `emote` bubbles are one glyph; `say` bubbles are a quick-chat phrase. */
export interface Bubble {
  readonly kind: "emote" | "say";
  readonly text: string;
  /** Server/local ms when it became visible (set by the board). */
  readonly shownAt: number;
  readonly until: number;
}

/** Timing and size of the queues. */
export interface BubbleTiming {
  readonly emoteMs: number;
  readonly sayMs: number;
  /** Pending bubbles kept per Friend; the oldest pending one is dropped beyond this. */
  readonly maxQueue: number;
}

/** Default timing: an emote bubble lives 1.6 s, a phrase 3 s, two more can wait. */
export const DEFAULT_BUBBLE_TIMING: BubbleTiming = { emoteMs: 1600, sayMs: 3000, maxQueue: 2 };

interface Slot {
  current: Bubble | null;
  pending: { kind: Bubble["kind"]; text: string }[];
}

/** All bubble queues of a room, keyed by any stable id (entity id or `rest:<tokenId>`). */
export class BubbleBoard {
  readonly #slots = new Map<string, Slot>();
  readonly #muted = new Set<string>();

  /** Creates an empty board. */
  constructor(readonly timing: BubbleTiming = DEFAULT_BUBBLE_TIMING) {}

  /** Queues a bubble for `key`. Ignored while `key` is muted. Returns whether it was accepted. */
  push(key: string, kind: Bubble["kind"], text: string, now: number): boolean {
    if (this.#muted.has(key)) return false;
    let s = this.#slots.get(key);
    if (!s) this.#slots.set(key, (s = { current: null, pending: [] }));
    s.pending.push({ kind, text });
    while (s.pending.length > this.timing.maxQueue) s.pending.shift();
    this.#advance(s, now);
    return true;
  }

  /** Mutes or unmutes a Friend: muting clears what it is showing. */
  setMuted(key: string, muted: boolean): void {
    if (muted) {
      this.#muted.add(key);
      this.#slots.delete(key);
    } else this.#muted.delete(key);
  }

  /** True while `key` is muted. */
  isMuted(key: string): boolean {
    return this.#muted.has(key);
  }

  /** Forgets a Friend (left the room). */
  remove(key: string): void {
    this.#slots.delete(key);
  }

  /** Forgets everyone (room change). Mutes persist. */
  clear(): void {
    this.#slots.clear();
  }

  /** The bubble `key` shows at `now` (advancing its queue), or null. */
  current(key: string, now: number): Bubble | null {
    const s = this.#slots.get(key);
    if (!s) return null;
    this.#advance(s, now);
    if (!s.current && s.pending.length === 0) this.#slots.delete(key);
    return s.current;
  }

  /** Every visible bubble at `now`. */
  visible(now: number): Map<string, Bubble> {
    const out = new Map<string, Bubble>();
    for (const key of [...this.#slots.keys()]) {
      const b = this.current(key, now);
      if (b) out.set(key, b);
    }
    return out;
  }

  #advance(s: Slot, now: number): void {
    if (s.current && now >= s.current.until) s.current = null;
    if (!s.current) {
      const next = s.pending.shift();
      if (next) {
        const ms = next.kind === "say" ? this.timing.sayMs : this.timing.emoteMs;
        s.current = { kind: next.kind, text: next.text, shownAt: now, until: now + ms };
      }
    }
  }
}
