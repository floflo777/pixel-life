import { describe, expect, it } from "vitest";
import { SimTuning, type SimCreatureView } from "@pl/shared";
import { SIM_STATES } from "../../creatures";
import { cameraFacing, facingDir, MAX_TURN, runCreatureState } from "./creature-adapter";

const creature = (o: Partial<SimCreatureView>): SimCreatureView => ({
  id: 1,
  kind: SimTuning.NIB,
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vz: 0,
  facing: 0,
  state: 0,
  stateTicks: 0,
  telegraph: false,
  hp: 1,
  stun: 0,
  spawning: 0,
  ...o,
});

describe("creature adapter", () => {
  it("reads the sim heading (0 = +x, 1024 = +z)", () => {
    expect(facingDir(0).dx).toBeCloseTo(1);
    expect(facingDir(1024).dz).toBeCloseTo(1);
  });

  it("keeps faces toward the camera", () => {
    const side = cameraFacing(1, 0);
    expect(Math.atan2(side.dx, side.dz)).toBeCloseTo(MAX_TURN);
    const away = cameraFacing(-0.2, -1);
    expect(Math.abs(Math.atan2(away.dx, away.dz))).toBeLessThanOrEqual(MAX_TURN + 1e-9);
    expect(away.dx).toBeLessThan(0);
    expect(cameraFacing(0, 1)).toEqual({ dx: 0, dz: 1 });
  });

  it("maps sim states to view states with spawn/stun/flee priority", () => {
    expect(runCreatureState(creature({ state: SIM_STATES.nib.BOWING }))).toBe("telegraph");
    expect(runCreatureState(creature({ state: SIM_STATES.nib.BOWING, spawning: 10 }))).toBe("spawn");
    expect(runCreatureState(creature({ stun: 5 }))).toBe("stunned");
    expect(runCreatureState(creature({ state: SIM_STATES.FLEEING }))).toBe("flee");
    expect(runCreatureState(creature({ kind: SimTuning.SNATCH, state: SIM_STATES.snatch.CARRY }))).toBe("carry");
  });
});
