import { describe, expect, it } from "vitest";
import { EMPTY_MASK, familyIdFromName, fromIndices, RUN_TICKS, type SimConfig, type SimInput } from "@pl/shared";
import { FAKE_SIM } from "./fake-sim";
import { asFullView } from "./sim-view";

const idx: number[] = [];
for (let y = 3; y < 13; y++) for (let x = 4; x < 12; x++) idx.push(y * 16 + x);
const cfg: SimConfig = {
  seed: 7,
  kind: "free",
  arena: "meadow",
  friend: { front: fromIndices(idx), lost: EMPTY_MASK, familyId: familyIdFromName("Mask"), goldHeld: 0 },
};

function run(inputs: (t: number) => SimInput[]) {
  const sim = FAKE_SIM.createSim(cfg);
  const types = new Set<string>();
  while (!sim.done) {
    sim.step(inputs(sim.tick));
    for (const e of sim.drainEvents()) types.add(e.type);
  }
  return { sim, types };
}

describe("fake sim", () => {
  it("plays a full 60 s run deterministically and exposes the renderer view", () => {
    const flings = (t: number): SimInput[] => (t % 90 === 80 ? [{ t, k: 0, ang: (t * 37) % 4096, pow: 700 }] : []);
    const a = run(flings);
    const b = run(flings);
    expect(a.sim.hash()).toBe(b.sim.hash());
    expect(a.sim.summary()).toEqual(b.sim.summary());
    const v = asFullView(a.sim.view());
    expect(v.done).toBe(true);
    expect(v.tick).toBeLessThanOrEqual(RUN_TICKS);
    expect(v.friend.bodies).toHaveLength(1);
    expect(a.types.has("end")).toBe(true);
    expect(a.types.has("launch")).toBe(true);
    expect(a.types.has("spawn")).toBe(true);
    expect(a.types.has("gulp") || a.sim.tick < 2400).toBe(true);
  });
  it("encodes one 7-byte record per input", () => {
    const bytes = FAKE_SIM.encodeInputs([
      { t: 1, k: 0, ang: 10, pow: 1023 },
      { t: 2, k: 1, dir: 5, on: 1 },
    ]);
    expect(bytes.length).toBe(14);
  });
});
