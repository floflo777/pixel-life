import { describe, expect, it } from "vitest";
import {
  angleDelta,
  angleFromDeg,
  angleFromDir,
  dirFromAngle,
  dragCancels,
  dragPower,
  flingInput,
  InputLog,
  keyChargePower,
  KeyboardAim,
  OneSwitchAim,
  oneSwitchPower,
  powerToSim,
  SteerEncoder,
} from "./input";

describe("drag power", () => {
  it("is 0 inside the 12 px deadzone and 1 at 180 px", () => {
    expect(dragPower(0)).toBe(0);
    expect(dragPower(12)).toBe(0);
    expect(dragPower(96)).toBeCloseTo(0.5);
    expect(dragPower(180)).toBe(1);
    expect(dragPower(900)).toBe(1);
    expect(dragPower(Number.NaN)).toBe(0);
  });
  it("cancels below p = 0.08", () => {
    expect(dragCancels(11)).toBe(true);
    expect(dragCancels(12 + 0.07 * 168)).toBe(true);
    expect(dragCancels(12 + 0.09 * 168)).toBe(false);
  });
});

describe("angles", () => {
  it("maps ground directions to 0..4095 (0 = +x, 1024 = +z)", () => {
    expect(angleFromDir(1, 0)).toBe(0);
    expect(angleFromDir(0, 1)).toBe(1024);
    expect(angleFromDir(-1, 0)).toBe(2048);
    expect(angleFromDir(0, -1)).toBe(3072);
    expect(angleFromDir(0, 0)).toBe(0);
  });
  it("round-trips through dirFromAngle", () => {
    for (const a of [0, 100, 1024, 2047, 3000, 4095]) {
      const d = dirFromAngle(a);
      expect(angleFromDir(d.x, d.z)).toBe(a);
    }
  });
  it("converts degrees and measures the shortest delta", () => {
    expect(angleFromDeg(90)).toBe(1024);
    expect(angleFromDeg(-90)).toBe(3072);
    expect(angleDelta(4000, 100)).toBe(196);
    expect(angleDelta(100, 4000)).toBe(-196);
  });
});

describe("fling encoding", () => {
  it("encodes power to 0..1023 and cancels weak flings", () => {
    expect(powerToSim(1)).toBe(1023);
    expect(powerToSim(0.5)).toBe(512);
    expect(powerToSim(2)).toBe(1023);
    expect(flingInput(5, 1024, 0.05)).toBeNull();
    expect(flingInput(5, -1, 1)).toEqual({ t: 5, k: 0, ang: 4095, pow: 1023 });
  });
});

describe("keyboard aim", () => {
  it("charges in 8 visible steps over 0.8 s, then holds", () => {
    expect(keyChargePower(0)).toBe(0);
    expect(keyChargePower(0.1)).toBe(1 / 8);
    expect(keyChargePower(0.45)).toBe(4 / 8);
    expect(keyChargePower(0.8)).toBe(1);
    expect(keyChargePower(5)).toBe(1);
  });
  it("rotates at 200°/s (60 fine) and snaps within 20°", () => {
    const k = new KeyboardAim();
    k.deg = 0;
    k.rotate(1, 0.5, false);
    expect(k.deg).toBeCloseTo(100);
    k.rotate(-1, 1, true);
    expect(k.deg).toBeCloseTo(40);
    expect(k.snap([65, 200])).toBe(false);
    expect(k.snap([55, 200])).toBe(true);
    expect(k.deg).toBe(55);
    k.deg = 350;
    expect(k.snap([5])).toBe(true);
    expect(k.deg).toBe(5);
  });
  it("releases the charged power once", () => {
    const k = new KeyboardAim();
    k.startCharge();
    k.tick(0.3);
    expect(k.charging).toBe(true);
    expect(k.release()).toBe(3 / 8);
    expect(k.charging).toBe(false);
    expect(k.release()).toBe(0);
  });
});

describe("one-switch", () => {
  it("oscillates 0→1→0 over 1.2 s", () => {
    expect(oneSwitchPower(0)).toBe(0);
    expect(oneSwitchPower(0.6)).toBeCloseTo(1);
    expect(oneSwitchPower(0.3)).toBeCloseTo(0.5);
    expect(oneSwitchPower(1.2)).toBeCloseTo(0);
  });
  it("locks on the first press and fires on the second", () => {
    const o = new OneSwitchAim();
    o.deg = 0;
    o.tick(1);
    expect(o.deg).toBeCloseTo(90);
    expect(o.press()).toBeNull();
    expect(o.phase).toBe("power");
    o.tick(0.6);
    expect(o.deg).toBeCloseTo(90);
    const shot = o.press();
    expect(shot?.deg).toBeCloseTo(90);
    expect(shot?.power).toBeCloseTo(1);
    expect(o.phase).toBe("aim");
  });
});

describe("steer encoder", () => {
  it("emits on toggles and meaningful direction changes only", () => {
    const s = new SteerEncoder();
    expect(s.update(1, false, 0)).toBeNull();
    expect(s.update(2, true, 1000)).toEqual({ t: 2, k: 1, dir: 1000, on: 1 });
    expect(s.update(3, true, 1010)).toBeNull();
    expect(s.update(4, true, 1100)).toEqual({ t: 4, k: 1, dir: 1100, on: 1 });
    expect(s.update(5, false, 0)).toEqual({ t: 5, k: 1, dir: 1100, on: 0 });
    expect(s.update(6, false, 3000)).toBeNull();
  });
});

describe("input log", () => {
  it("stamps pending inputs with the tick they are stepped on and records them", () => {
    const log = new InputLog();
    expect(log.flush(0)).toHaveLength(0);
    log.push({ t: -1, k: 0, ang: 10, pow: 500 });
    log.push({ t: -1, k: 1, dir: 0, on: 1 });
    const out = log.flush(42);
    expect(out.map((i) => i.t)).toEqual([42, 42]);
    log.push({ t: 0, k: 1, dir: 0, on: 0 });
    log.clearPending();
    expect(log.flush(43)).toHaveLength(0);
    expect(log.inputs).toHaveLength(2);
  });
});
