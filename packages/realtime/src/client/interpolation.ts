import type { PresenceEntity, ServerMsg, TokenIdStr } from "@pl/shared";
import type { Vec2 } from "../geometry.js";
import { HUB_WALK_SPEED, isMoving, positionAt, type Segment } from "../motion.js";

/** Default render delay behind the server clock (GDD §11.3: 120 ms buffer). */
export const INTERPOLATION_DELAY_MS = 120;
/** A late segment's position error is blended away over this long instead of snapping. */
const CORRECTION_MS = 150;
/** Segments older than this behind the newest sample time are dropped. */
const HISTORY_MS = 2000;

/** What the renderer needs per Friend per frame. */
export interface EntitySample {
  readonly x: number;
  readonly z: number;
  /** Walking right now (drives the walk cycle). */
  readonly moving: boolean;
  /** Unit heading of the current or last walk ([0, 1] = facing the camera by default). */
  readonly heading: Vec2;
}

interface Track {
  entity: PresenceEntity;
  /** Position at welcome/join time, used before the first segment starts. */
  base: Vec2;
  /** Sorted by t0. */
  segments: Segment[];
  heading: Vec2;
  lastT: number | null;
  correction: { dx: number; dz: number; t: number } | null;
}

/**
 * Client presence store with an interpolation buffer. `moved` segments are exact in server time, so sampling at
 * `serverNow − delay` reproduces the server path; a segment that arrives after its start was already rendered
 * has its jump blended out over {@link CORRECTION_MS}, so the output never teleports.
 */
export class PresenceBuffer {
  readonly #tracks = new Map<string, Track>();
  #you: string | null = null;

  /** Creates an empty buffer. `speed` must match the server's walk speed. */
  constructor(readonly speed = HUB_WALK_SPEED) {}

  /** Own entity id (from `welcome`). */
  get you(): string | null {
    return this.#you;
  }

  /** Entity ids currently present. */
  ids(): string[] {
    return [...this.#tracks.keys()];
  }

  /** Presence data (token, scars hash, venue…) of an entity. */
  entity(id: string): PresenceEntity | undefined {
    return this.#tracks.get(id)?.entity;
  }

  /** Applies any server message; unrelated messages are ignored. Returns true when presence changed. */
  apply(msg: ServerMsg): boolean {
    switch (msg[0]) {
      case "welcome":
        this.#tracks.clear();
        this.#you = msg[1];
        for (const e of msg[2]) this.#add(e);
        return true;
      case "join":
        this.#add(msg[1]);
        return true;
      case "leave":
        return this.#tracks.delete(msg[1]);
      case "moved":
        return this.#moved(msg[1], { fx: msg[2], fz: msg[3], tx: msg[4], tz: msg[5], t0: msg[6] });
      case "venue": {
        const t = this.#tracks.get(msg[1]);
        if (t) t.entity = { ...t.entity, venue: msg[2] };
        return t !== undefined;
      }
      case "scars":
        return this.#patchToken(msg[1], { scarsHash: msg[2] });
      default:
        return false;
    }
  }

  /** Interpolated state of `id` at server time `t` (normally `serverNow − delay`). */
  sample(id: string, t: number): EntitySample | undefined {
    const tr = this.#tracks.get(id);
    if (!tr) return undefined;
    const [x, z] = this.#raw(tr, t);
    const seg = this.#segmentAt(tr, t);
    const moving = seg !== null && isMoving(seg, t, this.speed);
    if (seg && (seg.tx !== seg.fx || seg.tz !== seg.fz)) tr.heading = unit([seg.tx - seg.fx, seg.tz - seg.fz]);
    let cx = 0;
    let cz = 0;
    if (tr.correction) {
      const k = 1 - (t - tr.correction.t) / CORRECTION_MS;
      if (k <= 0 || k > 1) tr.correction = null;
      else {
        cx = tr.correction.dx * k;
        cz = tr.correction.dz * k;
      }
    }
    tr.lastT = tr.lastT === null ? t : Math.max(tr.lastT, t);
    this.#prune(tr, t);
    return { x: x + cx, z: z + cz, moving, heading: tr.heading };
  }

  #add(e: PresenceEntity): void {
    this.#tracks.set(e.id, {
      entity: { ...e },
      base: [e.x, e.z],
      segments: [],
      heading: [0, 1],
      lastT: null,
      correction: null,
    });
  }

  #moved(id: string, s: Segment): boolean {
    const tr = this.#tracks.get(id);
    if (!tr) return false;
    // If this walk started before what we already drew, remember the visual error and fade it out.
    const late = tr.lastT !== null && s.t0 < tr.lastT;
    const before = late && tr.lastT !== null ? this.#displayed(tr, tr.lastT) : null;
    let i = tr.segments.length;
    while (i > 0 && (tr.segments[i - 1] as Segment).t0 > s.t0) i--;
    tr.segments.splice(i, 0, s);
    tr.entity = { ...tr.entity, x: s.tx, z: s.tz };
    if (before && tr.lastT !== null) {
      const after = this.#raw(tr, tr.lastT);
      tr.correction = { dx: before[0] - after[0], dz: before[1] - after[1], t: tr.lastT };
    }
    return true;
  }

  #displayed(tr: Track, t: number): Vec2 {
    const [x, z] = this.#raw(tr, t);
    if (!tr.correction) return [x, z];
    const k = Math.max(0, 1 - (t - tr.correction.t) / CORRECTION_MS);
    return [x + tr.correction.dx * k, z + tr.correction.dz * k];
  }

  #patchToken(tokenId: TokenIdStr, patch: Partial<PresenceEntity>): boolean {
    let hit = false;
    for (const tr of this.#tracks.values()) {
      if (tr.entity.tokenId === tokenId) {
        tr.entity = { ...tr.entity, ...patch };
        hit = true;
      }
    }
    return hit;
  }

  #segmentAt(tr: Track, t: number): Segment | null {
    let found: Segment | null = null;
    for (const s of tr.segments) {
      if (s.t0 <= t) found = s;
      else break;
    }
    return found;
  }

  #raw(tr: Track, t: number): Vec2 {
    const seg = this.#segmentAt(tr, t);
    return seg ? positionAt(seg, t, this.speed) : tr.base;
  }

  #prune(tr: Track, t: number): void {
    // Keep the segment active at (t − HISTORY_MS) so a late sample in that window still resolves correctly.
    const horizon = t - HISTORY_MS;
    let drop = 0;
    while (drop + 1 < tr.segments.length && (tr.segments[drop + 1] as Segment).t0 <= horizon) drop++;
    if (drop > 0) {
      const last = tr.segments[drop - 1] as Segment;
      tr.base = [last.tx, last.tz];
      tr.segments.splice(0, drop);
    }
  }
}

function unit(v: Vec2): Vec2 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  return l === 0 ? [0, 1] : [v[0] / l, v[1] / l];
}
