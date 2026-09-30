/**
 * Player intent → `SimInput` (GDD §2.2). Pure: screen/world geometry is done by the caller, which hands in drag lengths
 * and ground-plane directions. Every control scheme (drag, keyboard, one-switch, tap-to-sweep) ends in the same two
 * input kinds, stamped with the tick they apply to, so the recorded log replays exactly on the server.
 */
import type { SimInput } from "@pl/shared";

/** Drag deadzone and full-power length in CSS px (GDD §2.2). */
export const DRAG = { deadzonePx: 12, fullPx: 168 } as const;
/** Minimum launch power (p < 0.08 cancels, like the sim's MIN_POW = 82/1023). */
export const MIN_POWER = 0.08;
/** Angle steps per turn in `SimInput` (0 = +x, 1024 = +z). */
export const ANGLE_STEPS = 4096;
/** Keyboard aim rotation (deg/s), fine aim with Shift, and the snap-to-creature cone (deg). */
export const KEY_AIM = { degPerS: 200, fineDegPerS: 60, snapConeDeg: 20 } as const;
/** Keyboard charge: 0 → 1 in 0.8 s in 8 visible steps. */
export const KEY_CHARGE = { fullS: 0.8, steps: 8 } as const;
/** One-switch: aim auto-rotates at 90°/s; power oscillates 0→1→0 over 1.2 s. */
export const ONE_SWITCH = { degPerS: 90, cycleS: 1.2 } as const;
/** A steer update is re-sent only when its direction moves this many angle steps (keeps the log small). */
export const STEER_RESEND_STEPS = 48;

/** Clamp helper. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Launch power 0..1 from a drag length in CSS px; 0 inside the deadzone. */
export function dragPower(lenPx: number): number {
  if (!Number.isFinite(lenPx)) return 0;
  return clamp((lenPx - DRAG.deadzonePx) / DRAG.fullPx, 0, 1);
}

/** True when a drag this long should cancel instead of firing (under the deadzone, or below the minimum power). */
export function dragCancels(lenPx: number): boolean {
  return dragPower(lenPx) < MIN_POWER;
}

/** Ground-plane direction (x right, z toward camera) → sim angle 0..4095. A zero vector maps to 0. */
export function angleFromDir(dx: number, dz: number): number {
  if (dx === 0 && dz === 0) return 0;
  const a = Math.round((Math.atan2(dz, dx) / (2 * Math.PI)) * ANGLE_STEPS);
  return ((a % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
}

/** Sim angle → unit ground direction. */
export function dirFromAngle(ang: number): { x: number; z: number } {
  const r = (ang / ANGLE_STEPS) * 2 * Math.PI;
  return { x: Math.cos(r), z: Math.sin(r) };
}

/** Degrees (0 = +x, 90 = +z) → sim angle. */
export function angleFromDeg(deg: number): number {
  const a = Math.round((deg / 360) * ANGLE_STEPS);
  return ((a % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
}

/** Shortest signed distance between two sim angles, in steps (−2048..2047). */
export function angleDelta(a: number, b: number): number {
  const d = (((b - a) % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
  return d >= ANGLE_STEPS / 2 ? d - ANGLE_STEPS : d;
}

/** Power 0..1 → the sim's 0..1023 integer. */
export function powerToSim(p: number): number {
  return Math.round(clamp(Number.isFinite(p) ? p : 0, 0, 1) * 1023);
}

/** A fling input at tick `t`, or null when the power is below the cancel threshold. */
export function flingInput(t: number, ang: number, p: number): SimInput | null {
  if (!(p >= MIN_POWER)) return null;
  return { t, k: 0, ang: ((Math.round(ang) % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS, pow: powerToSim(p) };
}

/** Keyboard charge level after holding for `heldS` seconds: stepped in eighths, holds at 1. */
export function keyChargePower(heldS: number): number {
  if (!(heldS > 0)) return 0;
  const k = Math.floor((heldS / KEY_CHARGE.fullS) * KEY_CHARGE.steps + 1e-9);
  return Math.min(KEY_CHARGE.steps, k) / KEY_CHARGE.steps;
}

/** One-switch power oscillation 0→1→0 over the cycle (a triangle wave; `t` seconds since the direction lock). */
export function oneSwitchPower(t: number): number {
  const c = ONE_SWITCH.cycleS;
  const u = (((t % c) + c) % c) / c;
  return u < 0.5 ? u * 2 : 2 - u * 2;
}

/** Keyboard aim: an angle rotated by held keys, a charge timer, and snap-to-creature. */
export class KeyboardAim {
  /** Aim in degrees (0 = +x, 90 = +z toward the camera). Starts pointing "up-screen" (away from the camera). */
  deg = 270;
  private held = -1;

  /** True while Space/J is held. */
  get charging(): boolean {
    return this.held >= 0;
  }

  /** Current charge 0..1 (stepped). */
  get power(): number {
    return this.held >= 0 ? keyChargePower(this.held) : 0;
  }

  /** Rotates by `dir` (−1 left/counter-clockwise on screen, +1 right) for `dt` seconds. */
  rotate(dir: number, dt: number, fine: boolean): void {
    if (dir === 0) return;
    // Screen-right on a top-down-ish camera is +x; with z toward the camera, clockwise on screen is +deg.
    this.deg = (((this.deg + dir * (fine ? KEY_AIM.fineDegPerS : KEY_AIM.degPerS) * dt) % 360) + 360) % 360;
  }

  /** Snaps to the nearest target within the cone (targets as degrees); returns whether it snapped. */
  snap(targetsDeg: readonly number[]): boolean {
    let best: number | null = null;
    let bestD = KEY_AIM.snapConeDeg + 1e-9;
    for (const t of targetsDeg) {
      const d = Math.abs(((t - this.deg + 540) % 360) - 180);
      if (d <= bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best === null) return false;
    this.deg = ((best % 360) + 360) % 360;
    return true;
  }

  /** Starts charging (Space/J down). */
  startCharge(): void {
    if (this.held < 0) this.held = 0;
  }

  /** Advances the charge timer. */
  tick(dt: number): void {
    if (this.held >= 0) this.held += dt;
  }

  /** Releases: returns the power to fire with (0 = nothing charged), and resets. */
  release(): number {
    const p = this.power;
    this.held = -1;
    return p;
  }

  /** Esc: drops the charge without firing. */
  cancel(): void {
    this.held = -1;
  }
}

/** One-switch scheme: press 1 locks the auto-rotating direction, press 2 fires at the oscillating power. */
export class OneSwitchAim {
  deg = 270;
  private lockedAt: number | null = null;
  private t = 0;

  /** "aim" while rotating, "power" after the first press. */
  get phase(): "aim" | "power" {
    return this.lockedAt === null ? "aim" : "power";
  }

  /** Current power (0 while aiming). */
  get power(): number {
    return this.lockedAt === null ? 0 : oneSwitchPower(this.t - this.lockedAt);
  }

  /** Advances the clock (seconds); rotates while aiming. */
  tick(dt: number): void {
    this.t += dt;
    if (this.lockedAt === null) this.deg = (this.deg + ONE_SWITCH.degPerS * dt) % 360;
  }

  /** The switch press: returns the fling to fire on the second press, else null. */
  press(): { deg: number; power: number } | null {
    if (this.lockedAt === null) {
      this.lockedAt = this.t;
      return null;
    }
    const shot = { deg: this.deg, power: this.power };
    this.lockedAt = null;
    return shot;
  }

  /** Back to aiming without firing. */
  cancel(): void {
    this.lockedAt = null;
  }
}

/** Dedupes steer (sweep) toggles: emits only on/off changes and meaningful direction changes. */
export class SteerEncoder {
  private on = false;
  private dir = 0;

  /** Whether steering is currently on (as last sent). */
  get active(): boolean {
    return this.on;
  }

  /** Desired steering at tick `t`; returns the input to send, or null when nothing changed enough. */
  update(t: number, on: boolean, dir: number): SimInput | null {
    const d = ((Math.round(dir) % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
    if (on === this.on && (!on || Math.abs(angleDelta(this.dir, d)) < STEER_RESEND_STEPS)) return null;
    this.on = on;
    if (on) this.dir = d;
    return { t, k: 1, dir: on ? d : this.dir, on: on ? 1 : 0 };
  }

  /** Forgets state (new run). */
  reset(): void {
    this.on = false;
    this.dir = 0;
  }
}

/**
 * Collects inputs between ticks and stamps them with the tick they are applied on. The log is the replay record:
 * ticks are non-decreasing and every input in it was actually handed to `sim.step`.
 */
export class InputLog {
  private pending: SimInput[] = [];
  private readonly all: SimInput[] = [];

  /** Queues an input; its `t` is overwritten when it is flushed. */
  push(i: SimInput): void {
    this.pending.push(i);
  }

  /** Stamps pending inputs with `tick`, records and returns them (empty array when none). */
  flush(tick: number): readonly SimInput[] {
    if (this.pending.length === 0) return EMPTY;
    const out = this.pending.map((i) => ({ ...i, t: tick }));
    this.pending = [];
    this.all.push(...out);
    return out;
  }

  /** Drops queued, unflushed inputs (pause, cancel). */
  clearPending(): void {
    this.pending = [];
  }

  /** Every input handed to the sim so far. */
  get inputs(): readonly SimInput[] {
    return this.all;
  }
}

const EMPTY: readonly SimInput[] = Object.freeze([]);
