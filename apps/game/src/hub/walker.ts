/**
 * Local player movement (pure, wire units). Click-to-move plans an A* path on the room navmesh and walks it leg by
 * leg, sending one `move` per waypoint (the server only validates straight legs). Stick/keyboard steering walks
 * directly, re-sending a clipped look-ahead target at most every 125 ms (architecture §1b.1) and a final stop.
 * The local Friend is drawn from this prediction, so input feels instant; the server's segments drive everyone else.
 */
import { HUB_WALK_SPEED, type Vec2 } from "@pl/realtime/client";

/** The navmesh queries the walker needs (a `Navmesh` from `@pl/realtime` satisfies it). */
export interface WalkArea {
  contains(p: Vec2): boolean;
  clip(a: Vec2, b: Vec2): Vec2;
  findPath(a: Vec2, b: Vec2): Vec2[] | null;
  nearestWalkable(p: Vec2): Vec2 | null;
}

/** A `move` the scene must send (integer wire cm). */
export interface MoveIntent {
  readonly x: number;
  readonly z: number;
}

/** Steering re-send period (architecture §1b.1: at most every 125 ms while dragging). */
export const STEER_RESEND_MS = 125;
/** Steering look-ahead: how far ahead of the Friend the sent target sits (0.6 s of walking). */
export const STEER_LOOKAHEAD = HUB_WALK_SPEED * 0.6;

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}
function len(v: Vec2): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1]);
}
function round(p: Vec2): Vec2 {
  return [Math.round(p[0]), Math.round(p[1])];
}

/** Predicts the local Friend's walk and produces the `move` messages that make the server agree. */
export class LocalWalker {
  #pos: Vec2;
  #path: Vec2[] = [];
  #steer: Vec2 | null = null;
  #lastSteerSend = -Infinity;
  #heading: Vec2 = [0, 1];
  #moving = false;
  #out: MoveIntent[] = [];

  /** Starts standing at `start` (wire cm). */
  constructor(
    private area: WalkArea,
    start: Vec2,
    readonly speed = HUB_WALK_SPEED,
  ) {
    this.#pos = start;
  }

  /** Current predicted position (wire cm). */
  get position(): Vec2 {
    return this.#pos;
  }
  /** Unit heading of the current or last walk. */
  get heading(): Vec2 {
    return this.#heading;
  }
  /** True while walking (path or steering). */
  get moving(): boolean {
    return this.#moving;
  }
  /** Remaining waypoints of a click-to-move (for the path preview), current position first when walking. */
  get path(): readonly Vec2[] {
    return this.#path.length ? [this.#pos, ...this.#path] : [];
  }
  /** True while a stick or keys are held. */
  get steering(): boolean {
    return this.#steer !== null;
  }

  /** Switches room: new area, new position, nothing pending. */
  reset(area: WalkArea, at: Vec2): void {
    this.area = area;
    this.#pos = at;
    this.#path = [];
    this.#steer = null;
    this.#moving = false;
  }

  /**
   * Plans a walk to `target` (snapped to the nearest walkable point). Returns the planned path (start first) or null
   * when unreachable. The first leg's `move` is queued immediately.
   */
  walkTo(target: Vec2): Vec2[] | null {
    const goal = this.area.nearestWalkable(round(target));
    if (!goal) return null;
    const from = this.area.contains(this.#pos) ? this.#pos : (this.area.nearestWalkable(round(this.#pos)) ?? this.#pos);
    const path = this.area.findPath(from, goal);
    if (!path || path.length < 2) return null;
    this.#steer = null;
    this.#path = path.slice(1).map(round);
    this.#moving = true;
    const first = this.#path[0] as Vec2;
    this.#out.push({ x: first[0], z: first[1] });
    return path;
  }

  /** Stops where it stands (and tells the server). */
  stop(): void {
    if (!this.#moving) return;
    this.#path = [];
    this.#steer = null;
    this.#moving = false;
    const p = round(this.#pos);
    this.#out.push({ x: p[0], z: p[1] });
  }

  /**
   * Stick/keyboard direction on the ground (any length; zero or null releases). Steering cancels a click-to-move.
   */
  steer(dir: Vec2 | null): void {
    const l = dir ? len(dir) : 0;
    if (!dir || l < 1e-6) {
      if (this.#steer) {
        this.#steer = null;
        this.#lastSteerSend = -Infinity;
        this.#moving = false;
        const p = round(this.#pos);
        this.#out.push({ x: p[0], z: p[1] });
      }
      return;
    }
    this.#path = [];
    this.#steer = [dir[0] / l, dir[1] / l];
  }

  /** Corrects the prediction toward the server (a clipped leg, a spawn). Snaps; callers blend visually if needed. */
  correct(to: Vec2): void {
    this.#pos = to;
  }

  /** Advances `dtMs` at time `now` (ms) and returns the moves to send, oldest first. */
  update(dtMs: number, now: number): MoveIntent[] {
    const step = (this.speed * Math.max(0, dtMs)) / 1000;
    if (this.#steer) this.#updateSteer(step, now);
    else if (this.#path.length) this.#updatePath(step);
    else this.#moving = false;
    const out = this.#out;
    this.#out = [];
    return out;
  }

  #updatePath(step: number): void {
    let left = step;
    while (left > 0 && this.#path.length) {
      const wp = this.#path[0] as Vec2;
      const d = sub(wp, this.#pos);
      const l = len(d);
      if (l > 1e-9) this.#heading = [d[0] / l, d[1] / l];
      if (l <= left) {
        this.#pos = wp;
        left -= l;
        this.#path.shift();
        const next = this.#path[0];
        if (next) this.#out.push({ x: next[0], z: next[1] });
      } else {
        this.#pos = [this.#pos[0] + (d[0] / l) * left, this.#pos[1] + (d[1] / l) * left];
        left = 0;
      }
    }
    this.#moving = this.#path.length > 0;
  }

  #updateSteer(step: number, now: number): void {
    const dir = this.#steer as Vec2;
    this.#heading = dir;
    const want: Vec2 = [this.#pos[0] + dir[0] * step, this.#pos[1] + dir[1] * step];
    const got = this.area.clip(this.#pos, want);
    this.#moving = len(sub(got, this.#pos)) > step * 0.05;
    this.#pos = got;
    // Never faster than the resend period: the server's move bucket is 8/s (burst 16).
    if (now - this.#lastSteerSend >= STEER_RESEND_MS) {
      const ahead: Vec2 = [this.#pos[0] + dir[0] * STEER_LOOKAHEAD, this.#pos[1] + dir[1] * STEER_LOOKAHEAD];
      const target = round(this.area.clip(this.#pos, ahead));
      if (this.area.contains(target)) {
        this.#out.push({ x: target[0], z: target[1] });
        this.#lastSteerSend = now;
      }
    }
  }
}
