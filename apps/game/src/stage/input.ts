/** Where a pointer sample came from. Touch and pen are coarse; mouse is fine. */
export type PointerKind = "mouse" | "touch" | "pen";

/** A point in both CSS px (relative to the canvas top-left) and NDC (-1..1, y up). */
export interface InputPoint {
  readonly x: number;
  readonly y: number;
  readonly ndcX: number;
  readonly ndcY: number;
}

/** A 2D vector in CSS px (y down, like the screen). */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Semantic keyboard actions (keyboard parity for tap/fling per the accessibility rules). */
export type KeyAction = "confirm" | "cancel" | "emote" | null;

/** Normalised input events, identical for mouse, touch, pen and (where it makes sense) keyboard. */
export type InputEvent =
  | { readonly type: "tap"; readonly at: InputPoint; readonly kind: PointerKind }
  | { readonly type: "dragstart"; readonly start: InputPoint; readonly kind: PointerKind }
  | {
      readonly type: "drag";
      readonly start: InputPoint;
      readonly current: InputPoint;
      /** current − start, in CSS px. For a slingshot fling the launch vector is its negation. */
      readonly vector: Vec2;
      readonly kind: PointerKind;
    }
  | {
      readonly type: "dragend";
      readonly start: InputPoint;
      readonly end: InputPoint;
      readonly vector: Vec2;
      /** Release velocity in CSS px/s over the last `velocityWindowMs`. */
      readonly velocity: Vec2;
      readonly durationMs: number;
      readonly kind: PointerKind;
    }
  | { readonly type: "cancel" }
  | { readonly type: "key"; readonly code: string; readonly down: boolean; readonly action: KeyAction };

/** Thresholds separating taps from drags. */
export interface GestureConfig {
  /** A press shorter than this with little movement is a tap. */
  readonly tapMaxMs: number;
  /** Movement (CSS px) under which a press is still a tap; also the drag start threshold. Coarse pointers get 1.5×. */
  readonly slopPx: number;
  /** Window over which release velocity is measured. */
  readonly velocityWindowMs: number;
}

/** Defaults tuned for phones: 44 px targets and thumbs that wobble ~8 px. */
export const DEFAULT_GESTURES: GestureConfig = { tapMaxMs: 300, slopPx: 8, velocityWindowMs: 80 };

/** Converts CSS px within a `width × height` box into an InputPoint. */
export function toPoint(x: number, y: number, width: number, height: number): InputPoint {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return { x, y, ndcX: (x / w) * 2 - 1, ndcY: 1 - (y / h) * 2 };
}

interface Sample {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

interface Active {
  readonly id: number;
  readonly kind: PointerKind;
  readonly start: InputPoint;
  readonly t0: number;
  dragging: boolean;
  last: InputPoint;
  readonly trail: Sample[];
}

/**
 * Turns raw pointer down/move/up samples into taps and drags. Pure: callers feed it timestamps and
 * CSS coordinates. Only the first active pointer drives gestures; a second finger cancels the drag
 * (a pinch is never mistaken for a fling).
 */
export class GestureTracker {
  private active: Active | null = null;
  private extra = new Set<number>();
  private width = 1;
  private height = 1;

  constructor(private readonly cfg: GestureConfig = DEFAULT_GESTURES) {}

  /** Sets the canvas CSS size used for NDC conversion. */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** True while the primary pointer is pressed. */
  get pressed(): boolean {
    return this.active !== null;
  }

  private slop(kind: PointerKind): number {
    return kind === "mouse" ? this.cfg.slopPx : this.cfg.slopPx * 1.5;
  }

  /** Feeds a press. */
  down(id: number, x: number, y: number, t: number, kind: PointerKind): InputEvent[] {
    if (this.active) {
      if (id === this.active.id) return [];
      this.extra.add(id);
      const wasDragging = this.active.dragging;
      this.active = null;
      return wasDragging ? [{ type: "cancel" }] : [];
    }
    if (this.extra.size > 0) {
      this.extra.add(id);
      return [];
    }
    const p = toPoint(x, y, this.width, this.height);
    this.active = { id, kind, start: p, t0: t, dragging: false, last: p, trail: [{ x, y, t }] };
    return [];
  }

  /** Feeds a move. */
  move(id: number, x: number, y: number, t: number): InputEvent[] {
    const a = this.active;
    if (!a || a.id !== id) return [];
    const p = toPoint(x, y, this.width, this.height);
    a.last = p;
    a.trail.push({ x, y, t });
    this.trimTrail(a, t);
    const vector = { x: p.x - a.start.x, y: p.y - a.start.y };
    const out: InputEvent[] = [];
    if (!a.dragging && Math.hypot(vector.x, vector.y) > this.slop(a.kind)) {
      a.dragging = true;
      out.push({ type: "dragstart", start: a.start, kind: a.kind });
    }
    if (a.dragging) out.push({ type: "drag", start: a.start, current: p, vector, kind: a.kind });
    return out;
  }

  /** Feeds a release. */
  up(id: number, x: number, y: number, t: number): InputEvent[] {
    this.extra.delete(id);
    const a = this.active;
    if (!a || a.id !== id) return [];
    this.active = null;
    const p = toPoint(x, y, this.width, this.height);
    a.trail.push({ x, y, t });
    this.trimTrail(a, t);
    const vector = { x: p.x - a.start.x, y: p.y - a.start.y };
    const moved = Math.hypot(vector.x, vector.y);
    const durationMs = t - a.t0;
    if (!a.dragging && moved <= this.slop(a.kind)) {
      return durationMs <= this.cfg.tapMaxMs ? [{ type: "tap", at: a.start, kind: a.kind }] : [];
    }
    const first = a.trail[0] ?? { x, y, t };
    const span = Math.max(1, t - first.t);
    const velocity = { x: ((x - first.x) / span) * 1000, y: ((y - first.y) / span) * 1000 };
    const out: InputEvent[] = [];
    if (!a.dragging) out.push({ type: "dragstart", start: a.start, kind: a.kind });
    out.push({ type: "dragend", start: a.start, end: p, vector, velocity, durationMs, kind: a.kind });
    return out;
  }

  /** Feeds a cancel (pointercancel, lost capture, window blur). */
  cancel(id?: number): InputEvent[] {
    if (id !== undefined) this.extra.delete(id);
    else this.extra.clear();
    const a = this.active;
    if (!a || (id !== undefined && a.id !== id)) return [];
    this.active = null;
    return a.dragging ? [{ type: "cancel" }] : [];
  }

  private trimTrail(a: Active, t: number): void {
    while (a.trail.length > 2 && (a.trail[0]?.t ?? t) < t - this.cfg.velocityWindowMs) a.trail.shift();
  }
}

const AXIS_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
};

/** Maps a KeyboardEvent.code to a semantic action. */
export function keyAction(code: string): KeyAction {
  switch (code) {
    case "Enter":
    case "NumpadEnter":
    case "Space":
      return "confirm";
    case "Escape":
      return "cancel";
    case "KeyE":
      return "emote";
    default:
      return null;
  }
}

/** True for keys the stage consumes (so the page doesn't scroll on arrows/space). */
export function isGameKey(code: string): boolean {
  return code in AXIS_KEYS || keyAction(code) !== null;
}

/**
 * Held-key state → a movement axis in screen space (x right, y down), length ≤ 1 so diagonals
 * aren't faster. Opposite keys cancel.
 */
export class KeyAxes {
  private readonly held = new Set<string>();

  /** Records a key transition; returns false for auto-repeat downs so callers can drop them. */
  set(code: string, down: boolean): boolean {
    if (down) {
      if (this.held.has(code)) return false;
      this.held.add(code);
      return true;
    }
    return this.held.delete(code);
  }

  /** True while the key is held. */
  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** Releases everything (window blur). */
  clear(): string[] {
    const codes = [...this.held];
    this.held.clear();
    return codes;
  }

  /** Current normalised axis. */
  axis(): Vec2 {
    let x = 0;
    let y = 0;
    const seen = new Set<string>();
    for (const code of this.held) {
      const v = AXIS_KEYS[code];
      if (!v) continue;
      const tag = `${v[0]},${v[1]}`;
      if (seen.has(tag)) continue;
      seen.add(tag);
      x += v[0];
      y += v[1];
    }
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }
}
