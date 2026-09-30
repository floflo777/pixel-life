/**
 * Handheld input: three device buttons ◄ ● ► (plus an optional "back", which the 3-button device reaches by pressing
 * ◄ and ► together), mapped from keyboard, on-screen buttons and touch. The aim/charge controller turns held buttons
 * into sim flings (GDD §7): ◄/► rotate the aim in 16 steps at 12 steps/s, holding ● charges in 8 steps over 0.8 s and
 * releasing flings. Pure: time is passed in, so it is unit-tested without a DOM.
 */

/** A logical handheld button. */
export type Button = "left" | "ok" | "right" | "back";

/** Aim directions per turn (22.5° each). */
export const AIM_STEPS = 16;
/** Held ◄/► auto-repeat rate (steps per second) after the first step. */
export const AIM_REPEAT_HZ = 12;
/** Delay before a held ◄/► starts auto-repeating (ms). */
export const AIM_REPEAT_DELAY_MS = 180;
/** Charge steps and the time to reach full charge. */
export const CHARGE_STEPS = 8;
/** See `CHARGE_STEPS`. */
export const CHARGE_FULL_MS = 800;
/** Holding "back" this long opens the menu (quits the run). */
export const BACK_HOLD_MS = 1000;
/** A fling released while the Friend is still busy is kept this long and fired when it becomes ready. */
export const FLING_BUFFER_MS = 300;

/** Maps a `KeyboardEvent.code` to a button: arrows/A/D for ◄►, Space/Enter/Z/↑ for ●, X/Escape/Backspace for back. */
export function keyToButton(code: string): Button | null {
  switch (code) {
    case "ArrowLeft":
    case "KeyA":
      return "left";
    case "ArrowRight":
    case "KeyD":
      return "right";
    case "Space":
    case "Enter":
    case "NumpadEnter":
    case "KeyZ":
    case "ArrowUp":
    case "KeyW":
      return "ok";
    case "KeyX":
    case "Escape":
    case "Backspace":
    case "ArrowDown":
    case "KeyS":
      return "back";
    default:
      return null;
  }
}

/**
 * Maps a tap at (x, y) on a w×h surface (the screen itself, for touch) to a button: the left and right thirds are ◄/►,
 * the middle third is ●. Returns null outside the surface.
 */
export function tapToButton(x: number, y: number, w: number, h: number): Button | null {
  if (x < 0 || y < 0 || x >= w || y >= h || w <= 0) return null;
  if (x < w / 3) return "left";
  if (x >= (2 * w) / 3) return "right";
  return "ok";
}

/** Quantises a sim angle (0..4095, 0 = +x, 1024 = +z) to the nearest of the 16 aim steps. */
export function angleToAimStep(ang: number): number {
  return ((Math.round(ang / (4096 / AIM_STEPS)) % AIM_STEPS) + AIM_STEPS) % AIM_STEPS;
}

/** The sim angle (0..4095) of aim step `s` (any integer, wrapped). */
export function aimStepToAngle(s: number): number {
  return ((((s % AIM_STEPS) + AIM_STEPS) % AIM_STEPS) * 4096) / AIM_STEPS;
}

/** Charge step 1..8 after holding ● for `heldMs` (a tap is step 1; full after 0.8 s). */
export function chargeStep(heldMs: number): number {
  return Math.min(CHARGE_STEPS, 1 + Math.floor(Math.max(0, heldMs) / (CHARGE_FULL_MS / CHARGE_STEPS)));
}

/** Sim fling power 0..1023 for a charge step (step 8 = 1023). */
export function chargeToPower(step: number): number {
  const s = Math.min(CHARGE_STEPS, Math.max(0, Math.round(step)));
  return Math.round((s / CHARGE_STEPS) * 1023);
}

/**
 * A slingshot drag on the screen (dx, dy in LCD pixels, from press to current point) as a fling: the Friend goes the
 * opposite way to the drag; power grows linearly to full at `fullPx`. Screen y maps to world z through the handheld's
 * squashed projection (`zScale / xScale`), so the fling goes where the finger visually points. Returns null for drags
 * shorter than 3 px (a tap).
 */
export function dragToFling(
  dx: number,
  dy: number,
  fullPx = 40,
  xScale = 1.5,
  zScale = 0.9,
): { ang: number; pow: number } | null {
  const len = Math.hypot(dx, dy);
  if (len < 3) return null;
  const wx = -dx / xScale;
  const wz = -dy / zScale;
  const ang = Math.round(((Math.atan2(wz, wx) / (Math.PI * 2)) * 4096 + 4096) % 4096) % 4096;
  const pow = Math.round(Math.min(1, len / fullPx) * 1023);
  return { ang, pow };
}

/** Edge-triggered button events produced by `ButtonPad`. */
export type PadEvent =
  | { type: "down"; button: Button }
  | { type: "up"; button: Button; heldMs: number }
  | { type: "repeat"; button: Button }
  | { type: "long"; button: Button };

/**
 * Tracks held buttons from any number of sources (keyboard, device buttons, touch), with time passed in. Presses of a
 * button already held (e.g. key auto-repeat) are ignored. ◄ + ► held together also count as "back" (3-button device).
 */
export class ButtonPad {
  private readonly downAt = new Map<Button, number>();
  private readonly repeatDue = new Map<Button, number>();
  private readonly longFired = new Set<Button>();
  private chordBack = false;
  private queue: PadEvent[] = [];

  /** Presses `b` at time `t` (ms). */
  press(b: Button, t: number): void {
    if (this.downAt.has(b)) return;
    this.downAt.set(b, t);
    this.queue.push({ type: "down", button: b });
    if (b === "left" || b === "right") this.repeatDue.set(b, t + AIM_REPEAT_DELAY_MS);
    if (this.downAt.has("left") && this.downAt.has("right") && !this.downAt.has("back")) {
      this.chordBack = true;
      this.press("back", t);
    }
  }

  /** Releases `b` at time `t` (ms); releasing a button that is not held does nothing. */
  release(b: Button, t: number): void {
    const at = this.downAt.get(b);
    if (at === undefined) return;
    this.downAt.delete(b);
    this.repeatDue.delete(b);
    this.longFired.delete(b);
    this.queue.push({ type: "up", button: b, heldMs: t - at });
    if (this.chordBack && (b === "left" || b === "right")) {
      this.chordBack = false;
      this.release("back", t);
      // The other arrow is still held from the chord: it must not start spinning the aim straight away.
      const other = b === "left" ? "right" : "left";
      if (this.downAt.has(other)) this.repeatDue.set(other, t + AIM_REPEAT_DELAY_MS);
    }
  }

  /** Releases everything (focus loss, pause). */
  releaseAll(t: number): void {
    for (const b of [...this.downAt.keys()]) this.release(b, t);
  }

  /** True while `b` is held. */
  isDown(b: Button): boolean {
    return this.downAt.has(b);
  }

  /** How long `b` has been held at `t`, or 0 when not held. */
  heldMs(b: Button, t: number): number {
    const at = this.downAt.get(b);
    return at === undefined ? 0 : t - at;
  }

  /** Advances to time `t` and returns the pending events (repeats for held ◄/►, `long` once per 1 s hold of ● / back). */
  poll(t: number): PadEvent[] {
    for (const [b, due] of this.repeatDue) {
      let next = due;
      // While both are held (the back chord) the aim must not spin.
      if (!this.chordBack) {
        while (next <= t) {
          this.queue.push({ type: "repeat", button: b });
          next += 1000 / AIM_REPEAT_HZ;
        }
      } else next = Math.max(next, t);
      this.repeatDue.set(b, next);
    }
    for (const [b, at] of this.downAt) {
      // Only ● and back have a long-press meaning; ◄/► holds are aim repeats.
      if ((b === "ok" || b === "back") && !this.longFired.has(b) && t - at >= BACK_HOLD_MS) {
        this.longFired.add(b);
        this.queue.push({ type: "long", button: b });
      }
    }
    const out = this.queue;
    this.queue = [];
    return out;
  }
}

/** A fling request in sim units. */
export interface Fling {
  ang: number;
  pow: number;
}

/**
 * Aim + charge state for a run. Feed it the pad's events and the Friend's readiness; it returns the fling to send (at
 * most one per call). ◄/► steps the aim (screen-anticlockwise / clockwise), ● charges while held and flings on release,
 * "back" cancels a charge.
 */
export class AimController {
  /** Current aim step 0..15 (0 = +x, 4 = +z / toward the camera). */
  aim: number;
  /** Charge step while ● is held (0 = not charging). */
  charge = 0;
  private chargeFrom: number | null = null;
  private pending: { fling: Fling; until: number } | null = null;

  constructor(initialAim = 12) {
    this.aim = ((initialAim % AIM_STEPS) + AIM_STEPS) % AIM_STEPS;
  }

  /** The current aim as a sim angle. */
  get angle(): number {
    return aimStepToAngle(this.aim);
  }

  /** Handles events at time `t`; `ready` is the sim's `friend.ready`. Returns a fling to send now, or null. */
  update(events: readonly PadEvent[], t: number, ready: boolean): Fling | null {
    let out: Fling | null = null;
    for (const e of events) {
      if ((e.type === "down" || e.type === "repeat") && e.button === "left") this.aim = (this.aim + AIM_STEPS - 1) % 16;
      if ((e.type === "down" || e.type === "repeat") && e.button === "right") this.aim = (this.aim + 1) % AIM_STEPS;
      if (e.type === "down" && e.button === "ok") this.chargeFrom = t;
      if (e.type === "down" && e.button === "back") this.cancel();
      if (e.type === "up" && e.button === "ok" && this.chargeFrom !== null) {
        const fling = { ang: this.angle, pow: chargeToPower(chargeStep(t - this.chargeFrom)) };
        this.chargeFrom = null;
        this.pending = { fling, until: t + FLING_BUFFER_MS };
      }
    }
    this.charge = this.chargeFrom === null ? 0 : chargeStep(t - this.chargeFrom);
    if (this.pending) {
      if (ready) {
        out = this.pending.fling;
        this.pending = null;
      } else if (t > this.pending.until) this.pending = null;
    }
    return out;
  }

  /** Drops any charge or buffered fling. */
  cancel(): void {
    this.chargeFrom = null;
    this.charge = 0;
    this.pending = null;
  }
}
