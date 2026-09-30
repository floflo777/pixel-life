import { describe, expect, it, vi } from "vitest";
import { EMPTY_MASK } from "@pl/shared";
import type { VenueResult } from "@pl/venue-kit";
import { headingOf, realCreatureFactory, tookHit, type SimCreature } from "./creatures.js";
import { runRequest } from "./host.js";
import { runToast } from "./PlayScreen.js";
import { NATIVE_VENUES, nativeVenue, PIXEL_LIFE, SDK_VENUES, venueIds } from "./registry.js";
import { pickOutcome } from "./VenueScreen.js";

const creature = (o: Partial<SimCreature> = {}): SimCreature => ({
  id: 1,
  kind: 0,
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vz: 0,
  facing: 0,
  state: 0,
  stateTicks: 0,
  telegraph: false,
  hp: 2,
  stun: 0,
  spawning: 0,
  ...o,
});

describe("creature adapter", () => {
  it("turns sim facing into a ground heading", () => {
    const [x0, z0] = headingOf(0);
    expect(x0).toBeCloseTo(1);
    expect(z0).toBeCloseTo(0);
    const [x1, z1] = headingOf(1024);
    expect(x1).toBeCloseTo(0);
    expect(z1).toBeCloseTo(1);
  });

  it("flags a hit when hp drops or a stun starts", () => {
    expect(tookHit(null, creature())).toBe(false);
    expect(tookHit(creature({ hp: 2 }), creature({ hp: 1 }))).toBe(true);
    expect(tookHit(creature({ stun: 0 }), creature({ stun: 10 }))).toBe(true);
    expect(tookHit(creature({ stun: 10 }), creature({ stun: 9 }))).toBe(false);
  });

  it("drives the creature view from sim state", () => {
    const view = {
      object: {},
      setState: vi.fn(),
      setFacing: vi.fn(),
      playHit: vi.fn(),
      update: vi.fn(),
      dispose: vi.fn(),
    };
    const mod = {
      createCreatureView: vi.fn(() => view),
      kindOf: vi.fn(() => "nib"),
      viewStateFromSim: vi.fn(() => "move"),
    } as unknown as Parameters<typeof realCreatureFactory>[0];
    const make = realCreatureFactory(mod);
    const v = make(0);
    expect(v.object).toBe(view.object);
    const t = { dt: 0.016, time: 1, reducedMotion: false };
    v.update(creature({ hp: 2 }), t);
    v.update(creature({ hp: 1, facing: 1024 }), t);
    expect(view.setState).toHaveBeenCalledWith("move");
    expect(view.playHit).toHaveBeenCalledTimes(1);
    expect(view.update).toHaveBeenCalledWith(0.016);
    v.dispose();
    expect(view.dispose).toHaveBeenCalled();
  });
});

describe("venue registry", () => {
  it("lists every venue once, with a rule for its door card", () => {
    const ids = venueIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of [...Object.values(NATIVE_VENUES), ...Object.values(SDK_VENUES)])
      expect(e.rule.length).toBeGreaterThan(10);
    for (const [id, e] of Object.entries(NATIVE_VENUES)) expect(e.manifest.id).toBe(id);
    expect(nativeVenue(null)).toBe(PIXEL_LIFE);
    expect(nativeVenue("seed-pack")).toBeNull();
  });
});

describe("run reporting", () => {
  const result: VenueResult = {
    venueId: "pixel-life",
    runId: "r1",
    seed: 7,
    kind: "daily",
    inputs: new Uint8Array([1, 2, 255]),
    claimed: { score: 10 } as VenueResult["claimed"],
  };

  it("maps a result onto POST /api/runs, forwarding the optional run-start fields", () => {
    const t = Date.UTC(2026, 9, 1, 12);
    expect(runRequest(result, t)).toEqual({
      venueId: "pixel-life",
      kind: "daily",
      seed: 7,
      inputs: "AQL/",
      claimed: { score: 10 },
      day: "2026-10-01",
    });
    const full = runRequest({ ...result, kind: "free", startLost: EMPTY_MASK, startedAt: 5, beltTrial: "green" }, t);
    expect(full).toMatchObject({ startLost: EMPTY_MASK, startedAt: 5, beltTrial: "green" });
    expect(full).not.toHaveProperty("day");
  });

  it("says what a run earned and any verification problem", () => {
    const run = { result, ack: {} as never, problem: null };
    expect(runToast(run, { bits: 12, newStamps: [] })).toBe("+12 bits");
    expect(runToast({ ...run, problem: "We couldn't verify this run." }, { bits: 0, newStamps: ["a", "b"] })).toBe(
      "+0 bits · new stamps! · We couldn't verify this run.",
    );
  });
});

describe("seed pack demo", () => {
  it("walks the published chances in order", () => {
    const bps = [5600, 3000, 1200, 200];
    expect(pickOutcome(bps, 0)).toBe(0);
    expect(pickOutcome(bps, 0.5599)).toBe(0);
    expect(pickOutcome(bps, 0.56)).toBe(1);
    expect(pickOutcome(bps, 0.97)).toBe(2);
    expect(pickOutcome(bps, 0.999)).toBe(3);
    expect(pickOutcome(bps, 1)).toBe(3);
  });
});
