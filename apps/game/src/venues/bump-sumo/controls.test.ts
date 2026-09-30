import { describe, expect, it } from "vitest";
import {
  dirFromScreen,
  HOLD_TO_CHARGE_MS,
  InputRecorder,
  PointerStick,
  STICK_DEADZONE_PX,
  stickFromAxis,
  stickFromDrag,
  TAP_PULSE_TICKS,
} from "./controls";

describe("Bump Sumo directions", () => {
  it("maps screen vectors to sim angles (right 0, down 1024, left 2048, up 3072)", () => {
    expect(dirFromScreen(1, 0)).toBe(0);
    expect(dirFromScreen(0, 1)).toBe(1024);
    expect(dirFromScreen(-1, 0)).toBe(2048);
    expect(dirFromScreen(0, -1)).toBe(3072);
    expect(stickFromAxis(1, 1)).toEqual({ move: true, dir: 512 });
    expect(stickFromAxis(0, 0).move).toBe(false);
  });

  it("quantises drags and ignores the dead zone", () => {
    expect(stickFromDrag(STICK_DEADZONE_PX - 1, 0).move).toBe(false);
    const s = stickFromDrag(40, 1);
    expect(s.move).toBe(true);
    expect(s.dir % 64).toBe(0);
    expect(s.dir).toBe(0);
  });
});

describe("InputRecorder", () => {
  it("records only changes, in tick order", () => {
    const r = new InputRecorder();
    expect(r.sample(0, { move: false, dir: 0, charge: false })).not.toBeNull();
    expect(r.sample(1, { move: false, dir: 0, charge: false })).toBeNull();
    expect(r.sample(5, { move: true, dir: 1024, charge: false })).toEqual({ t: 5, move: 1, dir: 1024, charge: 0 });
    // Letting go of the stick keeps the last direction (the sim keeps facing it).
    expect(r.sample(9, { move: false, dir: 0, charge: true })).toEqual({ t: 9, move: 0, dir: 1024, charge: 1 });
    expect(r.inputs).toHaveLength(3);
    expect(() => r.sample(9, { move: true, dir: 0, charge: false })).toThrow(RangeError);
  });

  it("turns a tap into a short charge pulse then a release", () => {
    const r = new InputRecorder();
    r.sample(0, { move: false, dir: 0, charge: false });
    r.pulse();
    const idle = { move: false, dir: 0, charge: false };
    const seen = [1, 2, 3, 4].map((t) => r.sample(t, idle)?.charge ?? null);
    expect(seen.slice(0, TAP_PULSE_TICKS + 1)).toEqual([1, null, 0]);
    expect(r.neutral(10)).toBeNull();
  });
});

describe("PointerStick", () => {
  it("charges on a still hold, walks on a drag, never both", () => {
    const p = new PointerStick();
    p.press(0);
    expect(p.charging(HOLD_TO_CHARGE_MS - 1)).toBe(false);
    expect(p.charging(HOLD_TO_CHARGE_MS)).toBe(true);
    p.release();
    expect(p.charging(10_000)).toBe(false);
    p.press(0);
    p.drag(0, 50);
    expect(p.charging(1000)).toBe(false);
    expect(p.stick()).toEqual({ move: true, dir: 1024 });
    p.release();
    expect(p.stick().move).toBe(false);
  });
});
