import { describe, expect, it } from "vitest";
import { decodeInputs, EMPTY_MASK, replay, type Hex64, type SimConfig } from "@pl/shared";
import { angleFromDir, flingInput, InputLog, SteerEncoder } from "./input";
import { SHARED_SIM } from "./sim-module";

/** A 16×16 blob as a front mask (rows 3..12, cols 4..11). */
function blob(): Hex64 {
  const bits = new Array<number>(256).fill(0);
  for (let r = 3; r < 13; r++) for (let c = 4; c < 12; c++) bits[r * 16 + c] = 1;
  let hex = "";
  for (let i = 0; i < 256; i += 4) {
    const n = ((bits[i] ?? 0) << 3) | ((bits[i + 1] ?? 0) << 2) | ((bits[i + 2] ?? 0) << 1) | (bits[i + 3] ?? 0);
    hex += n.toString(16);
  }
  return hex as Hex64;
}

describe("venue run loop on the real sim", () => {
  it("records an input log the server replay verifies (same summary and hash)", () => {
    const cfg: SimConfig = {
      seed: 1234,
      kind: "daily",
      arena: "meadow",
      friend: { front: blob(), lost: EMPTY_MASK, familyId: 0, goldHeld: 0 },
    };
    const sim = SHARED_SIM.createSim(cfg);
    const log = new InputLog();
    const steer = new SteerEncoder();
    // The venue's loop: queue inputs between ticks, flush them stamped with the tick they are applied on.
    while (!sim.done) {
      const v = sim.view();
      const b = v.friend.bodies[0];
      const target = v.creatures[0];
      if (b && target && v.friend.ready && v.tick % 45 === 0) {
        const f = flingInput(0, angleFromDir(target.x - b.x, target.z - b.z), 0.7);
        if (f) log.push(f);
      }
      const loose = v.debris[0];
      const s = steer.update(0, !!loose && !!b, loose && b ? angleFromDir(loose.x - b.x, loose.z - b.z) : 0);
      if (s) log.push(s);
      sim.step(log.flush(sim.tick));
      sim.drainEvents();
    }
    const summary = sim.summary();
    expect(log.inputs.length).toBeGreaterThan(10);
    const bytes = SHARED_SIM.encodeInputs(log.inputs);
    expect(replay(cfg, decodeInputs(bytes))).toEqual(summary);
  });
});
