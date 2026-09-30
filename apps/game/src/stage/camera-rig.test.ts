import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  CameraRig,
  DEFAULT_LIMITS,
  DIP,
  HUB_POSE,
  clampPose,
  dampFactor,
  dipEnvelope,
  framedDistance,
  maxReadableDistance,
  orbitOffset,
  pixelsPerUnit,
  steppedNoise,
} from "./camera-rig";

describe("orbitOffset", () => {
  it("puts yaw 0 on +Z and pitch lifts the camera", () => {
    const [x, y, z] = orbitOffset(0, 0, 10);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(10, 9);
    const [, y2, z2] = orbitOffset(0, 90, 10);
    expect(y2).toBeCloseTo(10, 9);
    expect(z2).toBeCloseTo(0, 9);
  });
  it("keeps the distance", () => {
    const o = orbitOffset(17, 28, 21);
    expect(Math.hypot(...o)).toBeCloseTo(21, 9);
  });
  it("matches the frame-2 hub camera (pitch 28°)", () => {
    // style.html frame 2: camera (0.3, 11.6, 16.9) looking at (0, 1.75, -1.6).
    const dy = 11.6 - 1.75;
    const dz = 16.9 + 1.6;
    expect((Math.atan2(dy, dz) * 180) / Math.PI).toBeCloseTo(28, 0);
  });
});

describe("readability", () => {
  it("keeps 0.15 u sprite pixels ≥ 3 render px at the max distance", () => {
    const d = maxReadableDistance(30, 360);
    expect(0.15 * pixelsPerUnit(30, 360, d)).toBeCloseTo(3, 9);
    expect(0.15 * pixelsPerUnit(30, 360, d * 0.9)).toBeGreaterThan(3);
  });
  it("allows the hub pose on a 360-px-tall internal target", () => {
    expect(HUB_POSE.distance).toBeLessThanOrEqual(maxReadableDistance(HUB_POSE.fov, 360));
  });
});

describe("framedDistance", () => {
  it("keeps the pose distance when the width already fits", () => {
    expect(framedDistance(21, 30, 16 / 9, 360, 20)).toBe(21);
  });
  it("pulls back in portrait but never past the readability limit", () => {
    const d = framedDistance(21, 30, 9 / 16, 320, 20);
    expect(d).toBeGreaterThan(21);
    expect(d).toBeCloseTo(maxReadableDistance(30, 320), 9);
    expect(framedDistance(21, 30, 9 / 16, 320, 20, null)).toBeGreaterThan(d);
  });
  it("never shortens an explicit pose distance", () => {
    expect(framedDistance(50, 30, 16 / 9, 360, null)).toBe(50);
  });
});

describe("dampFactor", () => {
  it("is frame-rate independent", () => {
    const one = dampFactor(4, 1 / 30);
    const two = 1 - (1 - dampFactor(4, 1 / 60)) ** 2;
    expect(two).toBeCloseTo(one, 12);
  });
  it("is 0 for no time and bounded by 1", () => {
    expect(dampFactor(4, 0)).toBe(0);
    expect(dampFactor(4, 1e6)).toBeLessThanOrEqual(1);
    expect(dampFactor(-1, 1)).toBe(0);
  });
});

describe("clampPose", () => {
  it("clamps yaw around the base yaw and pitch/distance to limits", () => {
    const p = clampPose({ yaw: 90, pitch: 5, distance: 1000, fov: 30 }, DEFAULT_LIMITS, 10);
    expect(p).toEqual({ yaw: 30, pitch: DEFAULT_LIMITS.minPitch, distance: DEFAULT_LIMITS.maxDistance, fov: 30 });
  });
});

describe("steppedNoise", () => {
  it("is deterministic, bounded and holds for 1/24 s", () => {
    expect(steppedNoise(3, 0.5)).toBe(steppedNoise(3, 0.5));
    expect(steppedNoise(3, 0.5)).toBe(steppedNoise(3, 0.5 + 0.01));
    for (let t = 0; t < 3; t += 0.013) {
      const n = steppedNoise(7, t);
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
    }
    const values = new Set(Array.from({ length: 48 }, (_, i) => steppedNoise(1, i / 24)));
    expect(values.size).toBeGreaterThan(40);
  });
});

describe("dipEnvelope", () => {
  it("ramps in 4 stepped keys, holds, and ramps out", () => {
    const hold = 400;
    const r = DIP.rampMs;
    expect(dipEnvelope(-1, hold)).toBe(0);
    const inKeys = [0, r * 0.3, r * 0.6, r * 0.9].map((t) => dipEnvelope(t, hold));
    expect(inKeys).toEqual([0.25, 0.5, 0.75, 1]);
    expect(dipEnvelope(r + hold / 2, hold)).toBe(1);
    const outKeys = [0, r * 0.3, r * 0.6, r * 0.9].map((t) => dipEnvelope(r + hold + t, hold));
    expect(outKeys).toEqual([0.75, 0.5, 0.25, 0]);
    expect(dipEnvelope(2 * r + hold, hold)).toBe(0);
  });
  it("only ever returns one of the 5 key values", () => {
    for (let t = 0; t < 1000; t += 3) expect([0, 0.25, 0.5, 0.75, 1]).toContain(dipEnvelope(t, 300));
  });
});

describe("CameraRig", () => {
  const make = (reducedMotion = false): CameraRig => {
    const rig = new CameraRig(new PerspectiveCamera(30, 16 / 9, 0.5, 120), { reducedMotion });
    rig.snap(new Vector3(0, 0, 0));
    rig.update(0);
    return rig;
  };

  it("looks at the focus from the posed direction", () => {
    const rig = make();
    const dir = new Vector3();
    rig.camera.getWorldDirection(dir);
    const expected = new Vector3(...orbitOffset(0, HUB_POSE.pitch, HUB_POSE.distance)).normalize().negate();
    expect(dir.distanceTo(expected)).toBeLessThan(1e-6);
    expect(rig.camera.position.length()).toBeCloseTo(HUB_POSE.distance, 6);
  });

  it("eases toward the goal and respects the dead zone", () => {
    const rig = make();
    rig.deadZone = 1;
    rig.follow(new Vector3(0.5, 0, 0));
    rig.update(1);
    expect(rig.focus.x).toBe(0);
    rig.follow(new Vector3(5, 0, 0));
    for (let i = 0; i < 600; i++) rig.update(1 / 60);
    expect(rig.focus.x).toBeCloseTo(4, 3);
  });

  it("decays shake trauma and returns to rest", () => {
    const rig = make();
    rig.shake(0.8);
    rig.update(1 / 60);
    const shaken = rig.camera.position.clone();
    const rest = new Vector3(...orbitOffset(0, HUB_POSE.pitch, HUB_POSE.distance));
    expect(shaken.distanceTo(rest)).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) rig.update(1 / 60);
    expect(rig.juice.trauma).toBe(0);
    expect(rig.camera.position.distanceTo(rest)).toBeLessThan(1e-9);
  });

  it("dips pitch toward 18° and back", () => {
    const rig = make();
    rig.dip(400);
    rig.update(0.2);
    const pitch = (Math.asin(rig.camera.position.y / rig.camera.position.length()) * 180) / Math.PI;
    expect(pitch).toBeCloseTo(DIP.pitch, 3);
    expect(rig.camera.position.length()).toBeCloseTo(HUB_POSE.distance * DIP.distanceMul, 3);
    for (let i = 0; i < 60; i++) rig.update(1 / 60);
    expect(rig.juice.dip).toBeNull();
  });

  it("punches the FOV then restores it", () => {
    const rig = make();
    rig.punch();
    rig.update(1 / 60);
    expect(rig.camera.fov).toBeCloseTo(HUB_POSE.fov * 0.94, 9);
    rig.update(0.2);
    expect(rig.camera.fov).toBe(HUB_POSE.fov);
  });

  it("ignores shake, dip and punch under reduced motion", () => {
    const rig = make(true);
    const rest = rig.camera.position.clone();
    rig.shake(1);
    rig.dip(400);
    rig.punch();
    rig.update(1 / 60);
    expect(rig.camera.position.distanceTo(rest)).toBeLessThan(1e-9);
    expect(rig.camera.fov).toBe(HUB_POSE.fov);
  });
});
