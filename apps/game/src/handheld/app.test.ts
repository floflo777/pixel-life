import { EMPTY_MASK, RUN_TICKS, frontMask, isSubset, popcount, type SimConfig } from "@pl/shared";
import { createTestVenueHost, manifestProblems, testFriendView, type TestVenueHarness } from "@pl/venue-kit";
import { describe, expect, it } from "vitest";
import { HANDHELD_RESULT_VENUE, HandheldApp, type ScreenName } from "./app.js";
import { devHost } from "./dev/fixture.js";
import { createFakeSim } from "./fake-sim.js";
import type { Button } from "./input.js";
import { HANDHELD_MANIFEST, integerScale, jsonInputEncoder } from "./mount.js";

function makeApp(harness: TestVenueHarness, opts: { skipBoot?: boolean; sims?: SimConfig[] } = {}) {
  return new HandheldApp({
    host: harness.host,
    now: () => harness.now,
    createSim: (cfg) => {
      opts.sims?.push(cfg);
      return createFakeSim(cfg);
    },
    encodeInputs: jsonInputEncoder,
    newRunId: () => "run-1",
    skipBoot: opts.skipBoot ?? true,
  });
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const frames = (app: HandheldApp, n: number, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) app.update(dt);
};
/** Reads the screen without TypeScript narrowing it across calls that change it. */
const screen = (app: HandheldApp): ScreenName => app.screen;
const tap = (app: HandheldApp, b: Button) => {
  app.pad.press(b, app.time);
  frames(app, 2);
  app.pad.release(b, app.time);
  frames(app, 2);
};

describe("HandheldApp", () => {
  it("boots, then any button goes home without also activating the menu", () => {
    const h = createTestVenueHost();
    const app = makeApp(h, { skipBoot: false });
    frames(app, 30);
    expect(screen(app)).toBe("boot");
    tap(app, "ok");
    expect(screen(app)).toBe("home");
    frames(app, 10);
    expect(screen(app)).toBe("home");
  });

  it("renders only 1-bit pixels at 30 fps", () => {
    const h = createTestVenueHost();
    const app = makeApp(h);
    let fresh = 0;
    for (let i = 0; i < 60; i++) if (app.update(1 / 60)) fresh++;
    expect(fresh).toBeGreaterThanOrEqual(29);
    expect(fresh).toBeLessThanOrEqual(31);
    expect(app.lcd.buf.every((v) => v === 0 || v === 1)).toBe(true);
  });

  it("plays a whole run on the sim and reports it on the shared Pixel Life board", async () => {
    const h = devHost();
    const sims: SimConfig[] = [];
    const app = makeApp(h, { sims });
    tap(app, "ok");
    expect(screen(app)).toBe("run");
    expect(sims[0]).toMatchObject({ kind: "free", friend: { front: frontMask(h.host.identity.friend.appearance) } });
    // Hold ● for a full charge, release: a fling is logged at full power.
    app.pad.press("ok", app.time);
    frames(app, 60);
    app.pad.release("ok", app.time);
    frames(app, 2);
    let guard = 0;
    while (screen(app) === "run" && guard++ < 2000) app.update(0.25);
    expect(screen(app)).toBe("results");
    await flush();
    const res = h.log.results[0];
    expect(res).toBeDefined();
    expect(res?.venueId).toBe(HANDHELD_RESULT_VENUE);
    expect(res?.claimed.ticks).toBe(RUN_TICKS);
    const inputs = JSON.parse(new TextDecoder().decode(res?.inputs)) as { k: number; pow: number }[];
    expect(inputs[0]).toMatchObject({ k: 0, pow: 1023 });
    expect(h.log.cues).toContain("fling");
    expect(h.log.cues).toContain("time-up");
    // The run's new scars were applied to the Friend by the host.
    const lost = h.host.identity.friend.pub.scars.lost;
    expect(isSubset(res?.claimed.lostDelta ?? EMPTY_MASK, lost)).toBe(true);
  });

  it("goes home from results with ◄ and starts again with ●", async () => {
    const h = createTestVenueHost();
    const app = makeApp(h);
    tap(app, "ok");
    while (screen(app) === "run") app.update(0.25);
    await flush();
    frames(app, 60);
    tap(app, "ok");
    expect(screen(app)).toBe("run");
    while (screen(app) === "run") app.update(0.25);
    await flush();
    frames(app, 60);
    tap(app, "left");
    expect(screen(app)).toBe("home");
  });

  it("quits a run with a 1 s hold of back (◄+► on the device) without reporting it", () => {
    const h = createTestVenueHost();
    const app = makeApp(h);
    tap(app, "ok");
    app.pad.press("left", app.time);
    app.pad.press("right", app.time);
    frames(app, 70);
    expect(screen(app)).toBe("home");
    expect(h.log.results).toHaveLength(0);
  });

  it("offers Regrow for scars and pays through the host's confirmed economy", async () => {
    const h = devHost();
    const app = makeApp(h);
    const menu = app.menu().map((m) => m.id);
    expect(menu).toEqual(["play", "daily", "regrow"]);
    expect(app.menu()[2]?.sub).toContain("SIM");
    tap(app, "left"); // wraps to Regrow
    tap(app, "ok");
    await flush();
    frames(app, 2);
    expect(h.log.receipts).toHaveLength(1);
    expect(popcount(h.host.identity.friend.pub.scars.lost)).toBe(0);
    expect(app.menu().map((m) => m.id)).toEqual(["play", "daily"]);
  });

  it("refuses Regrow for guests with a message instead of calling the economy", async () => {
    // A 36-px block Friend with one scar (pixel 5·16+5 = 85: nibble 21, bit 1).
    const lost = "0".repeat(42) + "2" + "0".repeat(21);
    const friend = testFriendView({ loaned: true, lost });
    const h = createTestVenueHost({ identity: { mode: "guest", friend, loaned: true } });
    const app = makeApp(h);
    expect(app.menu().map((m) => m.id)).toContain("regrow");
    tap(app, "left");
    tap(app, "ok");
    await flush();
    expect(h.log.receipts).toHaveLength(0);
    expect(h.log.quotes).toHaveLength(0);
  });

  it("uses the daily seed for Daily runs", async () => {
    const h = createTestVenueHost({ dailySeed: { day: "2026-09-30", seed: 777, endsAt: 0 } });
    const sims: SimConfig[] = [];
    const app = makeApp(h, { sims });
    tap(app, "right");
    tap(app, "ok");
    await flush();
    frames(app, 2);
    expect(screen(app)).toBe("run");
    expect(sims[0]).toMatchObject({ seed: 777, kind: "daily" });
  });

  it("freezes the run while the shell is paused", () => {
    const h = createTestVenueHost();
    const app = makeApp(h);
    tap(app, "ok");
    const t0 = app.runView?.tick ?? 0;
    h.setPaused(true);
    frames(app, 60);
    expect(app.runView?.tick).toBe(t0);
    h.setPaused(false);
    frames(app, 60);
    expect(app.runView?.tick).toBeGreaterThan(t0);
  });

  it("slingshots from a touch drag", () => {
    const h = createTestVenueHost();
    const app = makeApp(h);
    tap(app, "ok");
    frames(app, 60);
    const before = app.runView?.friend.bodies[0]?.x ?? 0;
    app.pointer("down", 64, 64);
    app.pointer("move", 30, 64);
    app.pointer("up", 30, 64);
    frames(app, 30);
    expect(app.runView?.friend.bodies[0]?.x ?? 0).toBeGreaterThan(before + 5);
  });
});

describe("venue glue", () => {
  it("has a valid native manifest on the Pixel Life board", () => {
    expect(manifestProblems(HANDHELD_MANIFEST)).toEqual([]);
    expect(HANDHELD_MANIFEST.kind).toBe("native");
    expect(HANDHELD_MANIFEST.results).toEqual({ leaderboard: "score-desc", affectsScars: true });
    expect(HANDHELD_MANIFEST.thumbnail.split("\n").every((r) => r.length === 16)).toBe(true);
  });

  it("picks the largest integer upscale that fits", () => {
    expect(integerScale(512, 600)).toBe(4);
    expect(integerScale(383, 900)).toBe(2);
    expect(integerScale(100, 100)).toBe(1);
  });
});

describe("fake sim", () => {
  it("is deterministic for a config and input log", () => {
    const f = testFriendView();
    const cfg: SimConfig = {
      seed: 42,
      kind: "free",
      arena: "meadow",
      friend: { front: frontMask(f.appearance), lost: EMPTY_MASK, familyId: 1, goldHeld: 0 },
    };
    const run = () => {
      const sim = createFakeSim(cfg);
      while (!sim.done) sim.step(sim.tick % 90 === 0 ? [{ t: sim.tick, k: 0, ang: sim.tick % 4096, pow: 700 }] : []);
      return sim.summary();
    };
    expect(run()).toEqual(run());
  });
});
