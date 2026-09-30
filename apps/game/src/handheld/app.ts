/**
 * The handheld's state machine (boot → home → run → results → home) on top of a `VenueHost`. DOM-free: time advances
 * only through `update(dt)` and input arrives through `pad` / `pointer`, so a whole run is testable with the venue-kit
 * test host. It renders into `lcd` at 30 fps (15 fps stepping during slow-mo) and says when a new frame is ready.
 *
 * Runs use the shared deterministic sim (`createSim` from `@pl/shared`) with exactly the config the server rebuilds
 * (arena "meadow", the Friend's effective scars, no gold slots), and report the `encodeInputs` log, so the server can
 * replay them and they rank on the same boards as the 3D venue, tagged `venueId: "handheld"`.
 */
import {
  createSim as sharedCreateSim,
  encodeInputs as sharedEncodeInputs,
  SimEvents,
  ECON,
  RUN_TICKS,
  SIM_HZ,
  and,
  andNot,
  frameIndex,
  frontMask,
  isEmpty,
  popcount,
  COLOSSUS_FAMILY_ID,
  type FriendView,
  type Hex64,
  type RunKind,
  type ScarState,
  type SimInput,
} from "@pl/shared";
import { clockDuration, homeScars, shortDuration } from "./heal.js";
import { AimController, ButtonPad, dragToFling, tapToButton, type PadEvent } from "./input.js";
import { Lcd } from "./lcd.js";
import { toScreen } from "./project.js";
import { drawBoot, drawHome, drawResults, drawRun, type MenuItem, type ReportState, type RunFx } from "./screens.js";
import type { HandheldSim, HandheldSimFactory, HandheldView, InputEncoder } from "./view.js";
import type { VenueHost } from "@pl/venue-kit";

/** Which screen is showing. */
export type ScreenName = "boot" | "home" | "run" | "results";

/**
 * Venue id the handheld reports runs under. The server replays every run with the same sim whatever the venue and the
 * boards are not venue-scoped, so handheld runs rank next to 3D ones; the id only tags where the run was played.
 */
export const HANDHELD_VENUE_ID = "handheld";
/** Arena the handheld plays: the server's default replay arena (`POST /api/runs` without `arena`). */
export const HANDHELD_ARENA = "meadow";
/** Render rate and the slow-mo rate. */
export const LCD_FPS = 30;
/** See `LCD_FPS`. */
export const SLOWMO_FPS = 15;
/** Minimum spacing of full-screen inversions (GDD §7: max 1 per 600 ms). */
export const INVERSE_COOLDOWN_MS = 600;

/** Dependencies of the app. `createSim` / `encodeInputs` default to the shared sim and codec. */
export interface HandheldAppDeps {
  host: VenueHost;
  /** Wall clock (ms since epoch) for scar regrowth. */
  now: () => number;
  /** Sim factory (default: `@pl/shared` `createSim`); tests may wrap it to observe configs. */
  createSim?: HandheldSimFactory;
  /** Input-log encoder (default: `@pl/shared` `encodeInputs`, the format the server replays). */
  encodeInputs?: InputEncoder;
  newRunId: () => string;
  /** Skip the boot animation (dev, tests). */
  skipBoot?: boolean;
}

/** Top-bar titles for the two ways a run ends. */
const END_TITLES: Record<number, string> = { [SimEvents.END_TIME]: "TIME UP", [SimEvents.END_CRUMBLE]: "CRUMBLED" };
/** Wave-phase banners (GDD wave table): drop-in has none. */
const PHASE_BANNERS: Record<number, string> = { 1: "SNACK TIME", 2: "RUSH!", 3: "FRENZY!", 4: "LAST LIGHT" };
/** Smash cue per creature kind (0 Nib … 5 Fizz). */
const SMASH_CUES = ["smash.nib", "smash.pogo", "smash.clank", "smash.snatch", "smash.slurp", "smash.fizz"] as const;

interface RunState {
  sim: HandheldSim;
  view: HandheldView;
  seed: number;
  kind: RunKind;
  runId: string;
  inputs: SimInput[];
  aim: AimController;
  acc: number;
  hitStop: number;
  slowmo: number;
  fx: Omit<RunFx, "frame" | "aim" | "charge" | "timeLeftTicks" | "reducedMotion" | "paused" | "drag">;
  lastInverseAt: number;
  shakeLeft: number;
  lostBefore: Hex64;
  /** Creature kind by id (smash events carry only the id). */
  kinds: Map<number, number>;
  endTitle: string;
  /** The Friend has been ready at least once (the drop-in lock is over). */
  everReady: boolean;
}

interface ResultsState {
  run: RunState;
  report: ReportState;
  fresh: Hex64;
  holesAfter: Hex64;
}

/** The handheld app. Create with `new HandheldApp(deps)`, then drive `update(dt)` from the stage's frame loop. */
export class HandheldApp {
  /** The 1-bit screen; valid after `update` returns true. */
  readonly lcd = new Lcd();
  /** Button state; press/release with `this.time`. */
  readonly pad = new ButtonPad();
  /** Current screen. */
  screen: ScreenName;
  /** App time in ms (advances only through `update`). */
  time = 0;
  /** Rendered frame counter. */
  frame = 0;
  private screenAt = 0;
  private frameAcc = 0;
  private dirty = true;
  private menuSel = 0;
  private toast: { text: string; until: number } | null = null;
  private busy = false;
  private run: RunState | null = null;
  private results: ResultsState | null = null;
  /** Newer scars than the host's identity (from a receipt or run ack), until the host catches up. */
  private scarsOverride: ScarState | null = null;
  private drag: { x0: number; y0: number; dx: number; dy: number } | null = null;
  private paused = false;
  /** Buttons pressed since the current screen opened: a release only counts if its press was seen here. */
  private readonly armed = new Set<string>();
  private readonly createSim: HandheldSimFactory;
  private readonly encodeInputs: InputEncoder;
  /** Venue-level mute (the device's own switch), on top of the shell's mute. */
  muted = false;
  private exited = false;

  constructor(private readonly deps: HandheldAppDeps) {
    this.screen = deps.skipBoot ? "home" : "boot";
    this.createSim = deps.createSim ?? sharedCreateSim;
    this.encodeInputs = deps.encodeInputs ?? sharedEncodeInputs;
  }

  /** Plays a cue unless the shell or the device is muted. */
  private cue(name: string, volume?: number): void {
    const audio = this.deps.host.audio;
    if (this.muted || audio.muted.value) return;
    audio.play(name, volume === undefined ? undefined : { volume });
  }

  /** The Friend as the app sees it (host identity, or a newer scar state it was handed). */
  get friend(): FriendView {
    const f = this.deps.host.identity.friend;
    const o = this.scarsOverride;
    if (!o || o.version <= f.pub.scars.version) return f;
    return { ...f, pub: { ...f.pub, scars: o } };
  }

  /** The live run view (null outside a run). */
  get runView(): HandheldView | null {
    return this.run?.view ?? null;
  }

  /** Current home menu items (depends on scars and identity). */
  menu(): MenuItem[] {
    const items: MenuItem[] = [
      { id: "play", label: "PLAY", sub: "FREE RUN" },
      { id: "daily", label: "DAILY", sub: "▣ BOARD" },
    ];
    const lost = homeScars(this.friend, this.deps.now()).lostCount;
    if (lost > 0) {
      const rf = (lost * ECON.regrowMicroPerPx) / 1_000_000;
      items.push({ id: "regrow", label: "REGROW", sub: `${rf} RF SIM` });
    }
    items.push({ id: "exit", label: "EXIT", sub: "TO THE SKY" });
    return items;
  }

  /** Pauses / resumes (shell pause or `VenueInstance.pause`). Releases held buttons. */
  setPaused(p: boolean): void {
    if (p === this.paused) return;
    this.paused = p;
    this.pad.releaseAll(this.time);
    this.run?.aim.cancel();
    this.dirty = true;
  }

  /** Pointer input in LCD pixels: taps map to ◄●►; during a run a drag from the Friend is a slingshot fling. */
  pointer(kind: "down" | "move" | "up" | "cancel", x: number, y: number): void {
    if (this.screen === "run" && this.run) {
      if (kind === "down") this.drag = { x0: x, y0: y, dx: 0, dy: 0 };
      else if (kind === "move" && this.drag) {
        this.drag.dx = x - this.drag.x0;
        this.drag.dy = y - this.drag.y0;
      } else if (kind === "up" && this.drag) {
        const fling = dragToFling(x - this.drag.x0, y - this.drag.y0);
        this.drag = null;
        if (fling) this.fling(fling.ang, fling.pow);
        else {
          // A tap during a run: a short ● (weakest fling in the current aim).
          this.pad.press("ok", this.time);
          this.pad.release("ok", this.time);
        }
      } else if (kind === "cancel") this.drag = null;
      return;
    }
    if (kind !== "up") return;
    const b = tapToButton(x, y, 128, 128);
    if (!b) return;
    this.pad.press(b, this.time);
    this.pad.release(b, this.time);
  }

  /** Advances by `dt` seconds. Returns true when `lcd` holds a new frame to present. */
  update(dt: number): boolean {
    const ms = Math.max(0, Math.min(0.25, dt)) * 1000;
    this.time += ms;
    const paused = this.paused || this.deps.host.paused.value;
    const events = this.pad.poll(this.time);
    if (!paused) this.handle(events);
    if (this.screen === "run" && this.run && !paused) this.stepRun(ms);
    const fps = this.run && this.run.slowmo > 0 ? SLOWMO_FPS : LCD_FPS;
    this.frameAcc += ms;
    if (this.frameAcc < 1000 / fps && !this.dirty) return false;
    this.frameAcc = Math.min(this.frameAcc - 1000 / fps, 1000 / fps);
    if (this.frameAcc < 0) this.frameAcc = 0;
    this.dirty = false;
    this.render(paused);
    this.frame++;
    return true;
  }

  // -------------------------------------------------------------------------------------------------------------------

  private go(screen: ScreenName): void {
    this.screen = screen;
    this.screenAt = this.time;
    this.dirty = true;
    this.drag = null;
    this.armed.clear();
  }

  /** True iff `e` releases ● after a press made on this screen (so a press that changed screens can't also act). */
  private okReleased(e: PadEvent): boolean {
    if (e.type === "down") this.armed.add(e.button);
    if (e.type !== "up" || e.button !== "ok" || !this.armed.has("ok")) return false;
    this.armed.delete("ok");
    return true;
  }

  private say(text: string, ms = 2200): void {
    this.toast = { text, until: this.time + ms };
    this.dirty = true;
  }

  private handle(events: readonly PadEvent[]): void {
    switch (this.screen) {
      case "boot":
        if (
          this.time - this.screenAt > 2400 ||
          (this.time - this.screenAt > 300 && events.some((e) => e.type === "down"))
        )
          this.go("home");
        return;
      case "home":
        return this.handleHome(events);
      case "run":
        return this.handleRun(events);
      case "results":
        return this.handleResults(events);
    }
  }

  private handleHome(events: readonly PadEvent[]): void {
    const items = this.menu();
    if (this.menuSel >= items.length) this.menuSel = 0;
    for (const e of events) {
      if (e.type === "down" && e.button === "left") this.menuSel = (this.menuSel + items.length - 1) % items.length;
      if (e.type === "down" && e.button === "right") this.menuSel = (this.menuSel + 1) % items.length;
      if (e.type === "long" && e.button === "back") this.exit("quit");
      if (this.okReleased(e) && !this.busy) {
        const item = items[this.menuSel];
        if (item?.id === "play") this.startRun(this.deps.host.seeds.free(), "free");
        if (item?.id === "daily") void this.startDaily();
        if (item?.id === "regrow") void this.regrow();
        if (item?.id === "exit") this.exit("done");
      }
    }
  }

  /**
   * Leaves the venue for the hub. A run in progress is abandoned (never reported), exactly like a mid-run quit.
   * Safe to call more than once; only the first call reaches the host.
   */
  exit(reason: "done" | "quit" = "quit"): void {
    if (this.exited) return;
    this.exited = true;
    this.run = null;
    this.pad.releaseAll(this.time);
    this.cue("ui.back");
    this.deps.host.exit(reason);
  }

  private async startDaily(): Promise<void> {
    this.busy = true;
    this.say("LOADING...", 10_000);
    try {
      const d = await this.deps.host.seeds.daily();
      this.toast = null;
      this.startRun(d.seed, "daily");
    } catch {
      this.say("OFFLINE: TRY ●");
    } finally {
      this.busy = false;
    }
  }

  private async regrow(): Promise<void> {
    const f = this.friend;
    if (this.deps.host.identity.mode !== "owner" || f.loaned) {
      this.say("OWNERS ONLY");
      return;
    }
    const lost = homeScars(f, this.deps.now()).lost;
    if (isEmpty(lost)) return;
    this.busy = true;
    this.say("CONFIRM...", 60_000);
    try {
      const action = { kind: "regrow" as const, tokenId: f.appearance.tokenId, pixels: lost };
      await this.deps.host.economy.quote(action);
      const receipt = await this.deps.host.economy.request(action);
      this.scarsOverride = receipt.scars;
      this.say(`HEALED ${popcount(lost)} PX`);
      this.cue("regrow.sparkle");
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
      this.say(code === "cancelled" ? "CANCELLED" : code === "insufficient_funds" ? "NO FUNDS" : "NOT NOW");
    } finally {
      this.busy = false;
    }
  }

  private startRun(seed: number, kind: RunKind): void {
    const f = this.friend;
    const front = frontMask(f.appearance);
    const lost = homeScars(f, this.deps.now()).lost;
    // Exactly the config the server rebuilds for replay (runs/routes.ts): no `gold` slots, meadow arena.
    const sim = this.createSim({
      seed,
      kind,
      arena: HANDHELD_ARENA,
      friend: { front, lost, familyId: f.appearance.familyId, goldHeld: f.pub.goldHeld },
    });
    this.run = {
      sim,
      view: sim.view(),
      seed,
      kind,
      runId: this.deps.newRunId(),
      inputs: [],
      aim: new AimController(12),
      acc: 0,
      hitStop: 0,
      slowmo: 0,
      fx: { lastGain: 0, gainAge: 99, impacts: [], callouts: [], bonk: null, inverse: null, shake: { dx: 0, dy: 0 } },
      lastInverseAt: -Infinity,
      shakeLeft: 0,
      lostBefore: lost,
      kinds: new Map(),
      endTitle: "TIME UP",
      everReady: false,
    };
    this.cue("run.start");
    this.results = null;
    this.go("run");
  }

  private fling(ang: number, pow: number): void {
    const r = this.run;
    if (!r || !r.view.friend.ready) return;
    r.inputs.push({
      t: r.sim.tick,
      k: 0,
      ang: Math.round(ang) & 4095,
      pow: Math.max(0, Math.min(1023, Math.round(pow))),
    });
    this.cue("fling.release", 0.6 + (pow / 1023) * 0.6);
  }

  private handleRun(events: readonly PadEvent[]): void {
    const r = this.run;
    if (!r) return;
    if (events.some((e) => e.type === "long" && e.button === "back")) {
      // Quit mid-run: the run is abandoned (not reported), as with the 3D venue's quit.
      this.run = null;
      this.go("home");
      this.say("RUN QUIT");
      return;
    }
    const f = r.aim.update(events, this.time, r.view.friend.ready);
    if (f) this.fling(f.ang, f.pow);
  }

  private stepRun(ms: number): void {
    const r = this.run;
    if (!r) return;
    const fx = r.fx;
    if (r.hitStop > 0) {
      r.hitStop -= ms;
      return;
    }
    const speed = r.slowmo > 0 ? 0.5 : 1;
    if (r.slowmo > 0) r.slowmo -= ms;
    r.acc += (ms / 1000) * speed;
    let steps = 0;
    while (r.acc >= 1 / SIM_HZ && steps < 8 && !r.sim.done) {
      // Inputs are stamped for the tick they are applied on.
      const tick = r.sim.tick;
      r.sim.step(r.inputs.filter((i) => i.t === tick));
      r.acc -= 1 / SIM_HZ;
      steps++;
    }
    if (steps === 0) return;
    const wasReady = r.everReady;
    r.view = r.sim.view();
    if (!wasReady && r.view.friend.ready) {
      // The drop-in lock is over: the first fling is allowed now.
      r.everReady = true;
      fx.callouts = [...fx.callouts, { x: 64, y: 30, text: "GO!", age: 0 }];
    }
    for (const e of r.sim.drainEvents()) this.onEvent(r, e.type, e.a ?? 0, e.b ?? 0, e.x ?? 0, e.z ?? 0);
    // Age the juice by simulated time, in render frames.
    const age = (steps / SIM_HZ) * LCD_FPS;
    fx.gainAge += age;
    fx.impacts = fx.impacts.map((i) => ({ ...i, age: i.age + age })).filter((i) => i.age < 6);
    fx.callouts = fx.callouts.map((c) => ({ ...c, age: c.age + age })).filter((c) => c.age < 24);
    if (fx.bonk) fx.bonk = fx.bonk.left - age > 0 ? { ...fx.bonk, left: fx.bonk.left - age } : null;
    if (r.shakeLeft > 0) r.shakeLeft -= age;
    if (r.sim.done) this.finishRun(r);
  }

  private onEvent(r: RunState, type: string, a: number, b: number, x: number, z: number): void {
    const fx = r.fx;
    const s = toScreen(x, z);
    const callout = (text: string, dy: number, age = 0) =>
      (fx.callouts = [...fx.callouts, { x: s.sx, y: s.sy + dy, text, age }]);
    switch (type) {
      case "spawn":
        r.kinds.set(a, b);
        break;
      case "hit":
        fx.impacts = [...fx.impacts, { x: s.sx, y: s.sy - 8, age: 0 }];
        if (a < 0) this.cue(b === SimEvents.HIT_TOOTH_BOUNCE ? "gulp.tooth" : "bonk.rim");
        else this.cue("bonk.shell", 0.7);
        break;
      case "smash": {
        const kind = r.kinds.get(a) ?? 0;
        r.kinds.delete(a);
        this.cue(SMASH_CUES[kind] ?? "smash.nib");
        // Only player-caused pops (b > 0) score, stop time and flash.
        if (b <= 0) break;
        r.hitStop = 100;
        fx.lastGain = b;
        fx.gainAge = 0;
        callout(`+${b}`, -22);
        if (this.time - r.lastInverseAt >= INVERSE_COOLDOWN_MS) {
          r.lastInverseAt = this.time;
          fx.inverse = { x: s.sx, y: s.sy - 8 };
          fx.bonk = { x: s.sx + 10, y: Math.min(106, s.sy + 4), left: 15 };
        }
        break;
      }
      case "combo":
        if (a >= 2) callout(`COMBO x${a}`, -32, 4);
        break;
      case "bite":
        this.cue("bite");
        r.shakeLeft = 6;
        fx.callouts = [...fx.callouts, { x: s.sx + 22, y: s.sy - 20, text: `-${b}PX`, age: 0 }];
        break;
      case "pixelBack":
        this.cue(b === 1 ? "pixel.clutch" : "pixel.sweep");
        callout(b === 1 ? "CLUTCH" : "+1", -6, 12);
        break;
      case "pixelLost":
        this.cue("pixel.lost", 0.6);
        break;
      case "steal":
        this.cue("snatch.cackle");
        callout("SNATCHED!", -24);
        break;
      case "explode":
        this.cue("smash.fizz");
        fx.impacts = [...fx.impacts, { x: s.sx, y: s.sy - 4, age: 0 }];
        break;
      case "glance":
        this.cue("gold.glance");
        break;
      case "crumb":
        this.cue("pixel.sweep", 0.5);
        callout(`+${a}`, -8, 6);
        break;
      case "gulp":
        if (a === SimEvents.GULP_EV_RUMBLE) {
          this.cue("gulp.rumble");
          r.shakeLeft = 10;
          fx.callouts = [...fx.callouts, { x: 64, y: 22, text: "GULP!", age: 0 }];
        } else if (a === SimEvents.GULP_EV_BITE) {
          this.cue("gulp.bite");
          r.shakeLeft = 8;
        } else if (a === SimEvents.GULP_EV_TOOTH_HIT) this.cue("gulp.tooth");
        else if (a === SimEvents.GULP_EV_BURP) this.cue("gulp.burp");
        else if (a === SimEvents.GULP_EV_INHALE) this.cue("gulp.inhale");
        break;
      case "phase": {
        const banner = PHASE_BANNERS[a];
        if (banner) fx.callouts = [...fx.callouts, { x: 64, y: 30, text: banner, age: 0 }];
        break;
      }
      case "edge":
        if (a === SimEvents.EDGE_FALL) {
          this.cue("ringout");
          r.slowmo = 500;
          callout("EDGE!", -10);
        } else if (a === SimEvents.EDGE_SAVED) callout("SAVED!", -10);
        break;
      case "end":
        r.endTitle = END_TITLES[a] ?? "TIME UP";
        this.cue("run.end");
        break;
    }
  }

  private finishRun(r: RunState): void {
    const sum = r.sim.summary();
    this.results = { run: r, report: "sending", fresh: andNot(sum.lostDelta, r.lostBefore), holesAfter: r.lostBefore };
    this.go("results");
    void this.report();
  }

  private async report(): Promise<void> {
    const res = this.results;
    if (!res) return;
    res.report = "sending";
    this.dirty = true;
    const r = res.run;
    try {
      const ack = await this.deps.host.reportResult({
        venueId: HANDHELD_VENUE_ID,
        runId: r.runId,
        seed: r.seed,
        kind: r.kind,
        inputs: this.encodeInputs(r.inputs),
        claimed: r.sim.summary(),
      });
      if (ack.scars) this.scarsOverride = ack.scars;
      res.report =
        ack.verified === "mismatch"
          ? "unverified"
          : ack.applied
            ? "saved"
            : ack.reason === "guest"
              ? "guest"
              : ack.reason === "unverified"
                ? "error"
                : "practice";
    } catch {
      res.report = "error";
    }
    this.dirty = true;
  }

  private handleResults(events: readonly PadEvent[]): void {
    const res = this.results;
    if (!res) return;
    // Ignore presses still held over from the run for a moment, so a fling doesn't skip the results.
    if (this.time - this.screenAt < 600) return;
    for (const e of events) {
      if (e.type === "down" && (e.button === "left" || e.button === "back")) {
        this.run = null;
        this.go("home");
        return;
      }
      if (this.okReleased(e)) {
        if (res.report === "error") void this.report();
        else if (res.report !== "sending") this.startRun(this.deps.host.seeds.free(), "free");
        return;
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  private render(paused: boolean): void {
    const lcd = this.lcd;
    const f = this.friend;
    const front = frontMask(f.appearance);
    switch (this.screen) {
      case "boot":
        drawBoot(lcd, { t: (this.time - this.screenAt) / 1000, front, frame: this.frame });
        return;
      case "home": {
        const now = this.deps.now();
        const h = homeScars(f, now);
        const k = Math.floor(this.time / 250) % 8;
        const facing = f.appearance.familyId === COLOSSUS_FAMILY_ID ? "right" : "down";
        const idle = f.appearance.frames[frameIndex(false, facing, k)];
        const mask = idle && !isEmpty(idle) ? idle : front;
        if (this.toast && this.time > this.toast.until) this.toast = null;
        const menu = this.menu();
        drawHome(lcd, {
          tokenId: f.appearance.tokenId,
          mask,
          holes: and(h.lost, mask),
          sprout: h.sprout,
          growth: h.growth,
          lostCount: h.lostCount,
          nextInMs: h.nextInMs,
          wholeInMs: h.wholeInMs,
          menu,
          selected: Math.min(this.menuSel, menu.length - 1),
          frame: this.frame,
          dx: this.deps.host.reducedMotion ? 0 : Math.round(Math.sin(this.time / 1700) * 2),
          dy: this.deps.host.reducedMotion ? 0 : Math.floor(this.time / 500) % 2,
          toast: this.toast?.text ?? null,
          loaned: f.loaned,
          fmtShort: shortDuration,
          fmtClock: clockDuration,
        });
        return;
      }
      case "run": {
        const r = this.run;
        if (!r) return;
        const shaking = r.shakeLeft > 0 && !this.deps.host.reducedMotion;
        drawRun(
          lcd,
          r.view,
          {
            ...r.fx,
            frame: this.frame,
            aim: r.aim.aim,
            charge: r.aim.charge,
            timeLeftTicks: RUN_TICKS - r.view.tick,
            reducedMotion: this.deps.host.reducedMotion,
            paused,
            drag: this.drag ? { dx: this.drag.dx, dy: this.drag.dy } : null,
            shake: shaking ? { dx: this.frame % 2 ? 1 : -1, dy: 0 } : { dx: 0, dy: 0 },
          },
          RUN_TICKS,
        );
        // The inversion lasts exactly one rendered frame.
        r.fx.inverse = null;
        return;
      }
      case "results": {
        const res = this.results;
        if (!res) return;
        const sum = res.run.view;
        drawResults(lcd, {
          score: sum.score,
          front,
          holes: res.holesAfter,
          fresh: res.fresh,
          smashed: sum.stats.smashed,
          recovered: sum.stats.recovered,
          lost: popcount(res.fresh),
          report: res.report,
          frame: this.frame,
          title: res.run.endTitle,
          kind: res.run.kind,
        });
        return;
      }
    }
  }
}
