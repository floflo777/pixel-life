/**
 * Bump Sumo controls, pure: keyboard, one-pointer and two-thumb touch all reduce to one control state (walk direction,
 * walk on/off, charge held) that is sampled once per sim tick into the `SumoInput` log (a record only on change).
 *
 * Schemes (all live at once):
 * - keyboard: WASD / arrows walk, Space or J holds the charge (a quick tap side-steps), P / Esc pause;
 * - one pointer (mouse or one thumb): drag to walk, press and hold still to charge, let go to shove, quick tap = dodge;
 * - two thumbs: the drag stick on the left, the SHOVE button on the right.
 */
import type { SumoInput } from "@pl/shared";

/** Steps per turn in the sim's integer angles. */
const TURN = 4096;
/** Stick directions are quantised to this many sectors so a wobbling thumb does not spam the log. */
export const STICK_SECTORS = 64;
/** Drag length (CSS px) under which the stick is centred. */
export const STICK_DEADZONE_PX = 14;
/** Holding the pointer still this long (ms) starts a charge. */
export const HOLD_TO_CHARGE_MS = 160;
/** Ticks the charge is held for a pointer tap (well under the sim's tap threshold: a dodge). */
export const TAP_PULSE_TICKS = 2;

/** One tick of player control. */
export interface ControlState {
  readonly move: boolean;
  /** Integer angle 0..4095 (0 = screen right, 1024 = screen down / toward the camera). */
  readonly dir: number;
  readonly charge: boolean;
}

/** Sim angle of a screen-space vector (x right, y down): the ring is seen from the front, so screen down ≈ +z. */
export function dirFromScreen(x: number, y: number, sectors = TURN): number {
  const a = Math.atan2(y, x);
  const steps = Math.round((a / (2 * Math.PI)) * sectors);
  return ((((steps % sectors) + sectors) % sectors) * (TURN / sectors)) % TURN;
}

/** Stick state from a drag vector: centred inside the dead zone, else a quantised direction. */
export function stickFromDrag(dx: number, dy: number): { move: boolean; dir: number } {
  if (Math.hypot(dx, dy) < STICK_DEADZONE_PX) return { move: false, dir: 0 };
  return { move: true, dir: dirFromScreen(dx, dy, STICK_SECTORS) };
}

/** Keyboard walk from a held-keys axis (x right, y down); exact 8 directions. */
export function stickFromAxis(x: number, y: number): { move: boolean; dir: number } {
  if (x === 0 && y === 0) return { move: false, dir: 0 };
  return { move: true, dir: dirFromScreen(x, y, 8) };
}

/**
 * Samples control states into a tick-stamped log, one record per change. `sample` must be called once per sim tick with
 * that tick, in order; `pulse` holds the charge for a few ticks (a pointer tap → side-step).
 */
export class InputRecorder {
  private readonly log: SumoInput[] = [];
  private last: SumoInput | null = null;
  private pulseLeft = 0;
  private pulseRelease = false;

  /** Queues a tap: charge on for `ticks`, then off (the sim turns a short charge into a dodge). */
  pulse(ticks = TAP_PULSE_TICKS): void {
    this.pulseLeft = ticks;
    this.pulseRelease = true;
  }

  /** Records the state for `tick` if it differs from the last record; returns the record or null. */
  sample(tick: number, s: ControlState): SumoInput | null {
    let charge = s.charge;
    if (this.pulseLeft > 0) {
      this.pulseLeft--;
      charge = true;
    } else if (this.pulseRelease) {
      this.pulseRelease = false;
      charge = false;
    }
    const rec: SumoInput = {
      t: tick,
      move: s.move ? 1 : 0,
      dir: s.move ? s.dir : (this.last?.dir ?? 0),
      charge: charge ? 1 : 0,
    };
    const l = this.last;
    if (l && l.move === rec.move && l.dir === rec.dir && l.charge === rec.charge) return null;
    if (l && l.t >= tick) throw new RangeError("InputRecorder.sample must be called with increasing ticks.");
    this.last = rec;
    this.log.push(rec);
    return rec;
  }

  /** Forces a neutral record at `tick` (pause, blur: nobody walks or charges while frozen). */
  neutral(tick: number): SumoInput | null {
    this.pulseLeft = 0;
    this.pulseRelease = false;
    return this.sample(tick, { move: false, dir: 0, charge: false });
  }

  /** The recorded log (tick-increasing). */
  get inputs(): readonly SumoInput[] {
    return this.log;
  }
}

/**
 * One-pointer gesture state: a press that stays still for `HOLD_TO_CHARGE_MS` charges; a drag walks; a quick tap is a
 * dodge. Feed it pointer transitions and the current time; read `charge` / `stick` each frame.
 */
export class PointerStick {
  private downAt: number | null = null;
  private dragging = false;
  private dx = 0;
  private dy = 0;

  /** Pointer pressed at time `now` (ms). */
  press(now: number): void {
    this.downAt = now;
    this.dragging = false;
    this.dx = 0;
    this.dy = 0;
  }

  /** The pointer moved past the drag slop: it walks now, never charges during this press. */
  drag(dx: number, dy: number): void {
    if (this.downAt === null) return;
    this.dragging = true;
    this.dx = dx;
    this.dy = dy;
  }

  /** Pointer released or cancelled. */
  release(): void {
    this.downAt = null;
    this.dragging = false;
    this.dx = 0;
    this.dy = 0;
  }

  /** True while a still press has been held long enough to charge. */
  charging(now: number): boolean {
    return this.downAt !== null && !this.dragging && now - this.downAt >= HOLD_TO_CHARGE_MS;
  }

  /** The walk stick from the current drag. */
  stick(): { move: boolean; dir: number } {
    return this.dragging ? stickFromDrag(this.dx, this.dy) : { move: false, dir: 0 };
  }
}
