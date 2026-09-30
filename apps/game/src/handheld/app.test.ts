import {
  EMPTY_MASK,
  RUN_TICKS,
  createSim,
  decodeInputs,
  frontMask,
  isSubset,
  popcount,
  replay,
  type SimConfig,
} from "@pl/shared";
import { createTestVenueHost, manifestProblems, testFriendView, type TestVenueHarness } from "@pl/venue-kit";
import { describe, expect, it } from "vitest";
import { HANDHELD_ARENA, HANDHELD_VENUE_ID, HandheldApp, type ScreenName } from "./app.js";
import { devHost } from "./dev/fixture.js";
import type { Button } from "./input.js";
import { HANDHELD_MANIFEST, integerScale } from "./mount.js";

function makeApp(harness: TestVenueHarness, opts: { skipBoot?: boolean; sims?: SimConfig[] } = {}) {
  return new HandheldApp({
    host: harness.host,
    now: () => harness.now,
    createSim: (cfg) => {
      opts.sims?.push(cfg);
      return createSim(cfg);
    },
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

  it("plays a whole run on the shared sim and reports a log the server can replay", async () => {
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
    expect(res?.venueId).toBe(HANDHELD_VENUE_ID);
    expect(res?.claimed.ticks).toBeGreaterThan(0);
    expect(res?.claimed.ticks).toBeLessThanOrEqual(RUN_TICKS);
    const inputs = decodeInputs(res?.inputs ?? new Uint8Array());
    expect(inputs[0]).toMatchObject({ k: 0, pow: 1023 });
    // What the server does (runs/replay-worker): rebuild the config and replay the decoded log headlessly.
    const cfg = sims[0];
    if (!cfg || !res) throw new Error("no run");
    expect(cfg).toMatchObject({ arena: HANDHELD_ARENA, seed: res.seed, kind: res.kind });
    expect(cfg.friend.gold).toBeUndefined();
    expect(replay(cfg, inputs)).toEqual(res.claimed);
    expect(h.log.cues).toContain("fling.release");
    expect(h.log.cues).toContain("run.end");
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
    expect(menu).toEqual(["play", "daily", "regrow", "exit"]);
    expect(app.menu()[2]?.sub).toContain("SIM");
    tap(app, "left"); // wraps to Exit
    tap(app, "left"); // Regrow
    tap(app, "ok");
    await flush();
    frames(app, 2);
    expect(h.log.receipts).toHaveLength(1);
    expect(popcount(h.host.identity.friend.pub.scars.lost)).toBe(0);
    expect(app.menu().map((m) => m.id)).toEqual(["play", "daily", "exit"]);
  });

  it("refuses Regrow for guests with a message instead of calling the economy", async () => {
    // A 36-px block Friend with one scar (pixel 5·16+5 = 85: nibble 21, bit 1).
    const lost = "0".repeat(42) + "2" + "0".repeat(21);
    const friend = testFriendView({ loaned: true, lost });
    const h = createTestVenueHost({ identity: { mode: "guest", friend, loaned: true } });
    const app = makeApp(h);
    expect(app.menu().map((m) => m.id)).toContain("regrow");
    tap(app, "left");
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
    // Wait out the sim's drop-in lock (no fling before 1.2 s).
    frames(app, 90);
    expect(app.runView?.friend.ready).toBe(true);
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

describe("exit, mute and reduced motion", () => {
  it("exits to the hub from the home menu's EXIT item, once", () => {
    const h = createTestVenueHost();
    const app = makeApp(h);
    tap(app, "left"); // wraps to Exit
    tap(app, "ok");
    expect(h.log.exits).toEqual(["done"]);
    app.exit("quit");
    expect(h.log.exits).toEqual(["done"]);
  });

  it("exiting mid-run abandons the run without reporting it", async () => {
    const h = createTestVenueHost();
    const app = makeApp(h);
    tap(app, "ok");
    frames(app, 30);
    app.exit("quit");
    frames(app, 30);
    await flush();
    expect(h.log.exits).toEqual(["quit"]);
    expect(h.log.results).toHaveLength(0);
  });

  it("plays no cues while the device or the shell is muted", () => {
    const h = createTestVenueHost();
    const app = makeApp(h);
    app.muted = true;
    tap(app, "ok");
    frames(app, 120);
    expect(h.log.cues).toHaveLength(0);
    app.muted = false;
    h.setMuted(true);
    frames(app, 120);
    expect(h.log.cues).toHaveLength(0);
  });

  it("keeps the home Friend still under reduced motion", () => {
    const render = (reducedMotion: boolean) => {
      const h = createTestVenueHost({ reducedMotion });
      const app = makeApp(h);
      const shots = new Set<string>();
      for (let i = 0; i < 120; i++) if (app.update(1 / 30)) shots.add(app.lcd.buf.slice(20, 90 * 128).join(""));
      return shots.size;
    };
    expect(render(true)).toBeLessThan(render(false));
  });
});

describe("home scars", () => {
  it("heals scars on the home screen as wall-clock time passes (effectiveLost)", () => {
    const h = devHost();
    const app = makeApp(h);
    const lostNow = () => app.menu().find((m) => m.id === "regrow")?.sub ?? "none";
    const before = lostNow();
    expect(before).not.toBe("none");
    h.advance(30 * 24 * 3600 * 1000);
    expect(lostNow()).toBe("none");
  });
});
