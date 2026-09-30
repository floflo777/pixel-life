import { describe, expect, it } from "vitest";
import {
  CREATURE_STATES,
  SIM_GULP,
  SIM_STATES,
  gulpMoodFromSim,
  gulpPhaseFromSim,
  kindOf,
  viewStateFromSim,
  type CreatureState,
} from "./states";
import { CREATURE_KINDS } from "./sprites";

const sim = (kind: number, state: number, extra: Partial<{ stun: number; spawn: number; dead: boolean }> = {}) => ({
  kind,
  state,
  stun: 0,
  spawn: 0,
  dead: false,
  ...extra,
});

describe("viewStateFromSim", () => {
  it("maps every sim state of every kind (telegraph before attack)", () => {
    const expected: Record<string, [number, CreatureState][]> = {
      nib: [
        [SIM_STATES.nib.CHASE, "move"],
        [SIM_STATES.nib.BOWING, "telegraph"],
        [SIM_STATES.nib.RETREAT, "attack"],
        [SIM_STATES.nib.WAITING, "idle"],
      ],
      pogo: [
        [SIM_STATES.pogo.CROUCHING, "telegraph"],
        [SIM_STATES.pogo.HOPPING, "airborne"],
        [SIM_STATES.pogo.RESTING, "idle"],
      ],
      clank: [
        [SIM_STATES.clank.WALK, "move"],
        [SIM_STATES.clank.JAWS, "telegraph"],
        [SIM_STATES.clank.RECOVERING, "attack"],
      ],
      snatch: [
        [SIM_STATES.snatch.CIRCLE, "move"],
        [SIM_STATES.snatch.AIM, "telegraph"],
        [SIM_STATES.snatch.SWOOPING, "attack"],
        [SIM_STATES.snatch.CARRY, "carry"],
        [SIM_STATES.snatch.LEAVING, "flee"],
      ],
      slurp: [
        [SIM_STATES.slurp.SLEEPING, "sleep"],
        [SIM_STATES.slurp.AWAKE, "idle"],
        [SIM_STATES.slurp.TONGUING, "attack"],
        [SIM_STATES.slurp.PUFFING, "telegraph"],
      ],
      fizz: [
        [SIM_STATES.fizz.RUSH, "move"],
        [SIM_STATES.fizz.FUSED, "telegraph"],
        [SIM_STATES.fizz.PROJECTILE, "projectile"],
      ],
    };
    CREATURE_KINDS.forEach((k, idx) => {
      for (const [s, v] of expected[k] ?? []) expect(viewStateFromSim(sim(idx, s)), `${k}.${s}`).toBe(v);
    });
  });

  it("applies dead > spawn > stun > flee priority", () => {
    expect(viewStateFromSim(sim(0, 1, { dead: true, stun: 5, spawn: 3 }))).toBe("smashed");
    expect(viewStateFromSim(sim(0, 1, { spawn: 3, stun: 5 }))).toBe("spawn");
    expect(viewStateFromSim(sim(0, SIM_STATES.FLEEING, { stun: 5 }))).toBe("stunned");
    for (let k = 0; k < 6; k++) expect(viewStateFromSim(sim(k, SIM_STATES.FLEEING))).toBe("flee");
  });

  it("falls back to idle for unknown per-kind states and throws on unknown kinds", () => {
    expect(viewStateFromSim(sim(2, 7))).toBe("idle");
    expect(() => viewStateFromSim(sim(6, 0))).toThrow(RangeError);
    expect(kindOf(3)).toBe("snatch");
  });

  it("only produces known view states", () => {
    for (let k = 0; k < 6; k++)
      for (let s = 0; s < 10; s++) expect(CREATURE_STATES).toContain(viewStateFromSim(sim(k, s)));
  });
});

describe("Gulp mapping", () => {
  it("maps sim phases and moods", () => {
    expect(gulpPhaseFromSim(SIM_GULP.IDLE)).toBe("hidden");
    expect(gulpPhaseFromSim(SIM_GULP.SHADOW)).toBe("rising");
    expect(gulpPhaseFromSim(SIM_GULP.TEETH_OUT)).toBe("teeth");
    expect(gulpPhaseFromSim(SIM_GULP.INHALING)).toBe("inhale");
    expect(gulpPhaseFromSim(SIM_GULP.SUNK)).toBe("sinking");
    expect(gulpPhaseFromSim(SIM_GULP.DONE)).toBe("hidden");
    expect([0, 1, 2, 9].map(gulpMoodFromSim)).toEqual(["hungry", "sleepy", "grumpy", "hungry"]);
  });
});
