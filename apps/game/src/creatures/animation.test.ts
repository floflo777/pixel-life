import { describe, expect, it } from "vitest";
import {
  CLIPS,
  IDLE_FPS,
  STEP_FPS,
  clipFor,
  creaturePose,
  fizzFuse,
  hitOverlay,
  keyIndex,
  shardCount,
  shardSample,
  tongueExtension,
} from "./animation";
import { CREATURE_KINDS, CREATURE_SPRITES } from "./sprites";
import { CREATURE_STATES } from "./states";

describe("state → clip mapping", () => {
  it("resolves every kind × state to frames that exist", () => {
    for (const kind of CREATURE_KINDS)
      for (const state of CREATURE_STATES) {
        const clip = clipFor(kind, state);
        expect(clip.keys.length, `${kind}.${state}`).toBeGreaterThan(0);
        for (const k of clip.keys)
          if (k.frame) expect(CREATURE_SPRITES[kind].frames, `${kind}.${state}`).toHaveProperty(k.frame);
      }
  });

  it("gives every kind its own telegraph and attack (every damaging action is telegraphed)", () => {
    for (const kind of CREATURE_KINDS) {
      expect(CLIPS[kind].telegraph, kind).toBeDefined();
      expect(CLIPS[kind].stunned, kind).toBeDefined();
    }
    expect(creaturePose("nib", "telegraph", 0).frame).toBe("bow");
    expect(creaturePose("pogo", "telegraph", 0).frame).toBe("crouch");
    expect(creaturePose("clank", "telegraph", 0).frame).toBe("jaws");
    expect(creaturePose("slurp", "telegraph", 0).frame).toBe("puff");
    expect(creaturePose("fizz", "telegraph", 0).frame).toBe("fused");
    expect(creaturePose("snatch", "attack", 0).frame).toBe("dart");
    expect(creaturePose("snatch", "carry", 0).frame).toMatch(/^carry/);
    expect(creaturePose("slurp", "sleep", 0).frame).toBe("sleep");
    expect(creaturePose("slurp", "attack", 0).frame).toBe("open");
    expect(creaturePose("pogo", "airborne", 0).frame).toBe("hop");
  });

  it("bows Nib 20° in 2 steps, inside the 0.45 s telegraph", () => {
    const deg = (t: number): number => Math.round((creaturePose("nib", "telegraph", t).pitch * 180) / Math.PI);
    expect(deg(0)).toBe(10);
    expect(deg(1 / STEP_FPS)).toBe(20);
    expect(deg(0.44)).toBe(20);
  });

  it("hides the body while spawning, then pops in", () => {
    expect(creaturePose("clank", "spawn", 0).visible).toBe(false);
    expect(creaturePose("clank", "spawn", 0.6).visible).toBe(true);
    expect(creaturePose("clank", "spawn", 0.6).scale).toBe(1);
    expect(creaturePose("clank", "smashed", 0.1).visible).toBe(false);
  });
});

describe("stepped, deterministic idles", () => {
  it("is a pure function of (kind, state, t, phase)", () => {
    for (const kind of CREATURE_KINDS)
      for (let t = 0; t < 3; t += 0.037)
        expect(creaturePose(kind, "idle", t, 2)).toEqual(creaturePose(kind, "idle", t, 2));
  });

  it("idles in 2 frames at 6 fps with squash & stretch", () => {
    const clip = clipFor("nib", "idle");
    expect(clip.fps).toBe(IDLE_FPS);
    expect(clip.keys).toHaveLength(2);
    const a = creaturePose("nib", "idle", 0);
    const b = creaturePose("nib", "idle", 1 / IDLE_FPS);
    expect(a.sy).toBe(1);
    expect(b.sx).toBeGreaterThan(1);
    expect(b.sy).toBeLessThan(1);
    expect(creaturePose("nib", "idle", 2 / IDLE_FPS)).toEqual(a);
  });

  it("holds each key for a whole step (nothing eases)", () => {
    for (const kind of CREATURE_KINDS) {
      const clip = clipFor(kind, "move");
      const dt = 1 / clip.fps;
      for (let s = 0; s < 8; s++) {
        const a = creaturePose(kind, "move", s * dt + 0.001);
        const b = creaturePose(kind, "move", (s + 1) * dt - 0.001);
        expect(b).toEqual(a);
      }
    }
  });

  it("desyncs crowds by phase and holds the last key of one-shot clips", () => {
    const idle = clipFor("clank", "idle");
    expect(keyIndex(idle, 0, 1)).not.toBe(keyIndex(idle, 0, 0));
    const once = clipFor("nib", "attack");
    expect(keyIndex(once, 100)).toBe(once.keys.length - 1);
    expect(keyIndex(once, -1)).toBe(0);
  });
});

describe("one-shot overlays", () => {
  it("fizz fuse blinks faster as it burns and swells in 4 steps", () => {
    const toggles = (t0: number, t1: number): number => {
      let n = 0;
      let prev = fizzFuse(t0).spark;
      for (let t = t0; t < t1; t += 1 / 240) {
        const s = fizzFuse(t).spark;
        if (s !== prev) n++;
        prev = s;
      }
      return n;
    };
    expect(toggles(1.0, 1.5)).toBeGreaterThan(toggles(0, 0.5));
    const swells = new Set(Array.from({ length: 150 }, (_, i) => fizzFuse(i / 100).swell));
    expect(swells.size).toBeLessThanOrEqual(5);
    expect(fizzFuse(1.5).swell).toBeCloseTo(1.2, 9);
  });

  it("hit flashes paper for 2 frames then settles by 0.25 s", () => {
    expect(hitOverlay(0)?.flash).toBe(true);
    expect(hitOverlay(1 / STEP_FPS)?.flash).toBe(true);
    expect(hitOverlay(2 / STEP_FPS)?.flash).toBe(false);
    expect(hitOverlay(0.25)).toBeNull();
    expect(hitOverlay(-1)).toBeNull();
  });

  it("tongue goes 3 frames out, 2 back", () => {
    const keys = [0, 1, 2, 3, 4].map((i) => tongueExtension((i + 0.5) / STEP_FPS));
    expect(keys).toEqual([1 / 3, 2 / 3, 1, 0.5, 0]);
  });

  it("shatters into 6–10 deterministic shards, gone in 0.5 s", () => {
    for (let seed = 0; seed < 50; seed++) {
      const n = shardCount(seed);
      expect(n).toBeGreaterThanOrEqual(6);
      expect(n).toBeLessThanOrEqual(10);
    }
    expect(shardSample(3, 2, 0.2, 6, 5)).toEqual(shardSample(3, 2, 0.2, 6, 5));
    expect(shardSample(3, 2, 0.21, 6, 5)).toEqual(shardSample(3, 2, 0.2, 6, 5));
    expect(shardSample(3, 2, 0.5, 6, 5)).toBeNull();
    const a = shardSample(3, 2, 0, 6, 5);
    const b = shardSample(3, 2, 0.3, 6, 5);
    expect(a && b && Math.abs(b.x - a.x)).toBeGreaterThan(0);
  });
});
