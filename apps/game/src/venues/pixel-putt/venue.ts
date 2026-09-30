/**
 * Pixel Putt (venue id `pixel-putt`): scarless floating mini-golf as a `NativeVenue` on the shared stage (GDD §11.8 A).
 * One verb, the same as Loose Pixels: drag back anywhere and release to fling your curled-up Friend. Nine seeded holes
 * (the Daily course uses the server's daily seed), par per hole, a scorecard, and juice on every beat: tumble, squash,
 * dust, bumper hit-stop, confetti and a hole-in-one fanfare. The deterministic sim lives in `@pl/shared`
 * (`PixelPutt`); this module only renders it, records the input log and reports the round to the host.
 */
import { Vector3 } from "three";
import {
  effectiveLost,
  encodeInputs,
  frontMask,
  PixelPutt,
  popcount,
  type DailySeed,
  type RunAck,
  type RunKind,
} from "@pl/shared";
import type { NativeVenue, VenueHost, VenueInstance, VenueManifest } from "@pl/venue-kit";
import type { OrbitPose } from "../../stage/camera-rig";
import type { InputEvent } from "../../stage/input";
import type { SharedStage as GameStage } from "../../stage/stage";
import { RunAudio, type VenueAudioExt } from "../pixel-life/audio";
import {
  angleFromDeg,
  angleFromDir,
  dirFromAngle,
  dragCancels,
  dragPower,
  flingInput,
  InputLog,
  KeyboardAim,
  OneSwitchAim,
  powerToSim,
} from "../pixel-life/input";
import { cuesFor, formatToPar, PUTT_RULE, roundHeadline, scoreName, scoreTone } from "./format";
import { PuttHud, type AimDot, type ScreenPoint } from "./hud";
import { PuttScene } from "./scene";

/** Stable venue id (hub door, results, leaderboards). */
export const PIXEL_PUTT_ID = "pixel-putt";

const THUMB = [
  "................",
  "..........#.....",
  "..........###...",
  "..........#####.",
  "..........###...",
  "..........#.....",
  "..........#.....",
  "...####...#.....",
  "..##..##..#.....",
  "..#.##.#..#.....",
  "..##..##..#.....",
  "...####..###....",
  "................",
  ".##############.",
  "................",
  "................",
].join("\n");

/**
 * The hub door description. Scarless (`affectsScars: false`); ranked by `score` = the round's stroke cap minus the
 * strokes taken (`PixelPutt.puttScore`), so "score-desc" orders the board by fewest strokes.
 */
export const PIXEL_PUTT_MANIFEST: VenueManifest = {
  id: PIXEL_PUTT_ID,
  name: "Pixel Putt",
  version: "0.1.0",
  kind: "native",
  room: "sky-docks",
  requires: { ownedFriend: false },
  economy: { sinks: [] },
  results: { leaderboard: "score-desc", affectsScars: false },
  thumbnail: THUMB,
};

/** Options when building the venue (the shell passes none; dev pages and tests use them). */
export interface PixelPuttOptions {
  /** Skip the start card and begin a round of this kind right away. */
  readonly autoStart?: RunKind;
  /** Accessibility: one-switch controls (auto-rotating aim, oscillating power). */
  readonly oneSwitch?: boolean;
  /** Accessibility: no impact-frame inversions (separate from reduced motion). */
  readonly noFlashes?: boolean;
  /** Clock for UI timers (tests). Defaults to `performance.now()`. */
  readonly now?: () => number;
}

/** Debug handle the dev page and capture script read; not part of the venue contract. */
export interface PixelPuttDebug {
  readonly state: () => string;
  readonly view: () => PixelPutt.PuttView | null;
  readonly course: () => PixelPutt.PuttCourse | null;
  readonly start: (kind: RunKind) => Promise<void>;
  /** Fires a fling now (angle 0..4095, power 0..1). */
  readonly fling: (ang: number, p: number) => void;
  /** Lets the search bot play every shot (dev autoplay, captures). */
  readonly autoplay: (on: boolean) => void;
  /** Shows the aim preview for (angle 0..4095, power 0..1), or hides it with null. */
  readonly aim: (a: { ang: number; p: number } | null) => void;
  /** Bot-plays (synchronously, recorded in the input log) until hole index `hole` is on the tee. */
  readonly skipTo: (hole: number) => void;
}

/** A mounted Pixel Putt instance. */
export interface PixelPuttInstance extends VenueInstance {
  readonly debug: PixelPuttDebug;
}

type State = "start" | "play" | "ending" | "results" | "gone";

function runIdOf(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `putt-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Builds the venue. */
export function createPixelPuttVenue(opts: PixelPuttOptions = {}): NativeVenue<GameStage> {
  return { manifest: PIXEL_PUTT_MANIFEST, mount: async (host) => mountVenue(host, opts) };
}

async function mountVenue(host: VenueHost<GameStage>, opts: PixelPuttOptions): Promise<PixelPuttInstance> {
  const stage = host.stage;
  const now = opts.now ?? (() => performance.now());
  const audio = new RunAudio(host.audio as VenueAudioExt);
  const reduced = host.reducedMotion;
  const canvas = stage.renderer.domElement;
  const parent = canvas.parentElement ?? document.body;

  // ── Take over the shared stage (restored on unmount) ───────────────────────────────────────────────────────────────
  const rig = stage.rig;
  const saved = {
    pose: { ...rig.pose },
    baseYaw: rig.baseYaw,
    follow: rig.followRate,
    minW: rig.minVisibleWidth,
    unit: rig.readableUnit,
    timeScale: stage.timeScale,
  };
  rig.minVisibleWidth = null;
  rig.readableUnit = null;
  rig.followRate = reduced ? 2 : 4;
  stage.setAccess({ reducedMotion: reduced, noFlashes: opts.noFlashes ?? false });

  // ── Friend, scene, HUD ────────────────────────────────────────────────────────────────────────────────────────────
  const friendView = () => host.identity.friend;
  const appearance = friendView().appearance;
  const front = frontMask(appearance);
  const lostNow = () =>
    effectiveLost(friendView().pub.scars, Date.now(), appearance.tokenId, { goldHeld: friendView().pub.goldHeld });
  const scene = new PuttScene({ appearance, lost: lostNow(), gold: friendView().pub.goldHeld, reducedMotion: reduced });
  stage.scene.add(scene.root);
  const hud = new PuttHud(parent, reduced);
  const loaned = host.identity.loaned || host.identity.mode === "guest";

  // ── Round state ───────────────────────────────────────────────────────────────────────────────────────────────────
  let state: State = "start";
  let sim: PixelPutt.PuttSim | null = null;
  let kind: RunKind = "free";
  let seed = 0;
  let daily: DailySeed | null = null;
  let prev: PixelPutt.PuttView | null = null;
  let cur: PixelPutt.PuttView | null = null;
  let log = new InputLog();
  const keys = new KeyboardAim();
  const one = new OneSwitchAim();
  let aim: { ang: number; p: number; from: "drag" | "keys" | "one" | "debug" } | null = null;
  let keyAimShownUntil = 0;
  let lastChargeStep = 0;
  let paused = false;
  let resumeAt = 0;
  let stopUntil = 0;
  let time = 0;
  let portrait = false;
  let autoplay = false;
  let botPlan: { ang: number; pow: number; wait: number } | null = null;
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  const focus = new Vector3();

  const project = (v: Vector3): ScreenPoint => {
    const p = tmp2.copy(v).project(stage.camera);
    if (p.z > 1) return null;
    return { x: ((p.x + 1) / 2) * canvas.clientWidth, y: ((1 - p.y) / 2) * canvas.clientHeight };
  };
  const projectAt = (x: number, z: number, y = 0): ScreenPoint => project(tmp.set(x, y, z));
  /** Ground-plane (y = 0) hit of a CSS-px screen point. */
  const groundAt = (sx: number, sy: number): { x: number; z: number } | null => {
    const ndc = new Vector3((sx / canvas.clientWidth) * 2 - 1, 1 - (sy / canvas.clientHeight) * 2, 0.5);
    ndc.unproject(stage.camera);
    const o = stage.camera.position;
    const dir = ndc.sub(o);
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = -o.y / dir.y;
    if (t <= 0) return null;
    return { x: o.x + dir.x * t, z: o.z + dir.z * t };
  };
  const ball = () => cur?.ball ?? null;
  const ballHead = (): ScreenPoint => {
    const b = ball();
    return b ? projectAt(b.x, b.z, scene.friendHeight + 0.4) : null;
  };
  const hole = (): PixelPutt.PuttHole | null => (sim && cur ? (sim.course.holes[cur.hole] ?? null) : null);

  // ── Camera: frame the whole hole; portrait screens turn the course so it runs up the screen ─────────────────────
  /** The hole shown behind the start card (a windmill, fixed knobs) until a round begins. */
  let showcase: PixelPutt.PuttHole | null = null;
  const frameHole = (snap: boolean): void => {
    const h = hole() ?? showcase;
    if (!h) return;
    const w = canvas.clientWidth || 1;
    const hgt = canvas.clientHeight || 1;
    portrait = hgt > w * 1.1;
    const yaw = portrait ? -90 : 0;
    const b = h.bounds;
    const across = (portrait ? b.z1 - b.z0 : b.x1 - b.x0) + 5;
    const along = (portrait ? b.x1 - b.x0 : b.z1 - b.z0) + 5;
    const pitch = 52;
    const fov = 30;
    const tanH = Math.tan((fov * Math.PI) / 360);
    const aspect = w / hgt;
    const dW = across / (2 * tanH * aspect);
    const dD = (along * Math.sin((pitch * Math.PI) / 180)) / (2 * tanH);
    const pose: OrbitPose = { yaw, pitch, fov, distance: Math.min(60, Math.max(14, dW, dD)) };
    rig.baseYaw = yaw;
    rig.pose = pose;
    scene.setView(yaw, pitch);
    focus.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    if (snap) rig.snap(focus);
  };

  // ── Juice ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const hitStop = (ms: number): void => {
    stopUntil = Math.max(stopUntil, now() + ms);
  };
  const impact = (frames: number, at?: ScreenPoint): void => {
    stage.post.impacts.requestFrame(now(), frames);
    if (at && !reduced) {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      stage.post.impacts.requestBurst(
        at.x * (stage.post.stats.internalWidth / w),
        (h - at.y) * (stage.post.stats.internalHeight / h),
      );
    }
  };
  const say = (text: string, tone: "lime" | "paper" | "coral", life = 900): void =>
    hud.callout(text, tone, ballHead, now(), life);

  // ── Events ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const onEvent = (e: PixelPutt.PuttEvent): void => {
    for (const c of cuesFor(e)) audio.cue(c.cue, { ...(c.gain !== undefined ? { gain: c.gain } : {}) });
    switch (e.type) {
      case "tee": {
        const h = sim?.course.holes[e.hole];
        if (!h) break;
        scene.setHole(h);
        cur = sim?.view() ?? cur;
        prev = cur;
        frameHole(true);
        hud.setHole(h.number, sim?.course.holes.length ?? 9, h.name, h.par);
        hud.banner(`hole ${h.number}`, "paper", now(), 1400, `par ${h.par} · ${h.name}`);
        hud.announce(`hole ${h.number}, par ${h.par}: ${h.name}`);
        keys.deg = (Math.atan2(h.cup.z - h.tee.z, h.cup.x - h.tee.x) * 180) / Math.PI;
        audio.music?.setIntensity(0.15 + 0.1 * h.tier);
        break;
      }
      case "launch":
        scene.dust(e.x, e.z, 4 + Math.round((e.pow / 1023) * 6));
        scene.squash();
        break;
      case "bounce":
        scene.squash();
        if (e.kind === "bumper") {
          scene.bumperHit(e.x, e.z);
          hitStop(50);
          if (e.speed > 6) say("boing!", "paper", 600);
        } else if (e.kind === "blade") {
          say("whack!", "paper", 600);
          rig.shake(0.15);
        } else if (e.kind === "nib") scene.nibHit(e.x, e.z, "pardon!");
        else if (e.speed > 8) scene.dust(e.x, e.z, 3);
        break;
      case "land":
        if (e.speed > 4) scene.dust(e.x, e.z, 5);
        break;
      case "lip":
        say("lip out!", "coral", 800);
        break;
      case "fall":
        scene.splash(e.x, e.z);
        say("splash!", "coral", 900);
        break;
      case "penalty":
        hud.callout(e.reason === "nib" ? "+1 nib!" : "+1 stroke", "coral", ballHead, now(), 1100);
        break;
      case "reset":
      case "rest":
        break;
      case "sink": {
        const ace = e.strokes === 1;
        const name = scoreName(e.strokes, e.par);
        const tone = scoreTone(e.strokes, e.par);
        scene.confetti(e.x, e.z, ace || e.strokes < e.par);
        hud.banner(
          name,
          ace ? "lime" : tone,
          now(),
          ace ? 2200 : 1500,
          `${e.strokes} stroke${e.strokes === 1 ? "" : "s"} · par ${e.par}`,
        );
        hud.announce(`${name} ${e.strokes} strokes on a par ${e.par}`);
        if (ace) {
          hitStop(200);
          rig.punch();
          rig.shake(0.35);
          impact(2, projectAt(e.x, e.z, 0.5));
          audio.music?.stinger("fill");
        } else if (e.strokes < e.par) {
          hitStop(80);
          impact(1, projectAt(e.x, e.z, 0.5));
          audio.music?.stinger("combo");
        }
        break;
      }
      case "pickup":
        hud.banner("picked up", "coral", now(), 1400, `${e.strokes} strokes · par ${e.par}`);
        hud.announce(`picked up at ${e.strokes} strokes`);
        break;
      case "end":
        endRound();
        break;
    }
  };

  // ── Input ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const canAim = (): boolean => state === "play" && !paused && resumeAt === 0 && !autoplay && (cur?.ready ?? false);
  const fire = (ang: number, p: number): void => {
    if (!canAim() && aim?.from !== "debug") return;
    const input = flingInput(0, ang, p);
    if (!input || !cur?.ready) return;
    log.push(input);
    aim = null;
    hud.hint(null);
  };
  const aimFromDrag = (vx: number, vy: number): number | null => {
    const b = ball();
    if (!b) return null;
    const f = projectAt(b.x, b.z, 0);
    if (!f) return null;
    // Slingshot: the launch goes opposite to the drag.
    const target = groundAt(f.x - vx, f.y - vy);
    if (!target) return null;
    return angleFromDir(target.x - b.x, target.z - b.z);
  };
  const onInput = (e: InputEvent): void => {
    if (e.type === "key") {
      onKey(e.code, e.down);
      return;
    }
    if (!canAim()) return;
    switch (e.type) {
      case "dragstart":
        aim = { ang: 0, p: 0, from: "drag" };
        break;
      case "drag": {
        const ang = aimFromDrag(e.vector.x, e.vector.y);
        if (ang !== null) aim = { ang, p: dragPower(Math.hypot(e.vector.x, e.vector.y)), from: "drag" };
        break;
      }
      case "dragend": {
        const len = Math.hypot(e.vector.x, e.vector.y);
        const ang = aimFromDrag(e.vector.x, e.vector.y);
        aim = null;
        if (ang !== null && !dragCancels(len)) fire(ang, dragPower(len));
        break;
      }
      case "tap":
        hud.hint("drag back from anywhere, then let go");
        break;
      case "cancel":
        aim = null;
        break;
    }
  };
  const onKey = (code: string, down: boolean): void => {
    if (down && (code === "KeyP" || (code === "Escape" && !aim && !keys.charging))) {
      if (state === "play") setPaused(!paused);
      return;
    }
    if (!canAim()) return;
    if (opts.oneSwitch && (code === "Space" || code === "Enter" || code === "KeyJ")) {
      if (!down) return;
      const shot = one.press();
      if (shot) fire(angleFromDeg(shot.deg), shot.power);
      return;
    }
    switch (code) {
      case "Space":
      case "KeyJ":
        if (down) {
          keys.startCharge();
          lastChargeStep = 0;
        } else if (keys.charging) {
          const p = keys.release();
          fire(angleFromDeg(keys.deg), p);
        }
        break;
      case "Escape":
        if (down) {
          keys.cancel();
          one.cancel();
          aim = null;
        }
        break;
      case "ArrowUp":
      case "KeyW": {
        // Snap the aim straight at the cup.
        const h = hole();
        const b = ball();
        if (down && h && b) {
          keys.deg = (Math.atan2(h.cup.z - b.z, h.cup.x - b.x) * 180) / Math.PI;
          keyAimShownUntil = time + 1.5;
        }
        break;
      }
      default:
        break;
    }
  };
  const pollInput = (dt: number): void => {
    if (!canAim()) {
      if (aim?.from !== "debug") aim = null;
      return;
    }
    const inp = stage.input;
    const left = inp.isKeyDown("ArrowLeft") || inp.isKeyDown("KeyA");
    const right = inp.isKeyDown("ArrowRight") || inp.isKeyDown("KeyD");
    const fine = inp.isKeyDown("ShiftLeft") || inp.isKeyDown("ShiftRight");
    if (opts.oneSwitch) {
      one.tick(dt);
      aim = { ang: angleFromDeg(one.deg), p: one.phase === "power" ? one.power : 0.3, from: "one" };
      return;
    }
    if (left !== right) {
      // On a turned (portrait) camera "screen right" is a different world direction; keep the key feel screen-relative.
      keys.rotate((right ? 1 : -1) * (portrait ? -1 : 1), dt, !fine);
      keyAimShownUntil = time + 1.5;
    }
    keys.tick(dt);
    if (keys.charging) {
      const p = keys.power;
      const step = Math.round(p * 8);
      if (step > lastChargeStep) {
        lastChargeStep = step;
        audio.cue("fling.charge", { step });
      }
      aim = { ang: angleFromDeg(keys.deg), p: Math.max(p, 0.1), from: "keys" };
    } else if (time < keyAimShownUntil && aim?.from !== "drag") {
      aim = { ang: angleFromDeg(keys.deg), p: 0.3, from: "keys" };
    } else if (aim && aim.from !== "drag" && aim.from !== "debug") aim = null;
    if (aim?.from === "drag") {
      const step = Math.round(aim.p * 8);
      if (step > lastChargeStep) audio.cue("fling.charge", { step });
      lastChargeStep = step;
    }
  };

  // ── Pause ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const setPaused = (p: boolean): void => {
    if (state !== "play") return;
    if (p === paused && !(p === false && resumeAt > 0)) return;
    if (p) {
      paused = true;
      resumeAt = 0;
      hud.setCountdown(0);
      aim = null;
      keys.cancel();
      log.clearPending();
      audio.music?.setIntensity(0.05);
      const body = hud.openModal("paused");
      body.append(Object.assign(document.createElement("p"), { textContent: "the course waits for you." }));
      hud.button(body, "▶ resume", () => setPaused(false), true);
      hud.button(body, "quit round", () => host.exit("quit"));
    } else if (paused && resumeAt === 0) {
      hud.closeModal();
      resumeAt = now() + 900;
    }
  };
  hud.pauseBtn.addEventListener("click", () => setPaused(!paused));
  const unsubPause = host.paused.subscribe((p) => setPaused(p));
  const onBlur = (): void => setPaused(true);
  window.addEventListener("blur", onBlur);

  // ── Round lifecycle ───────────────────────────────────────────────────────────────────────────────────────────────
  const startRound = async (k: RunKind): Promise<void> => {
    if (state === "gone") return;
    hud.closeModal();
    daily = null;
    kind = k;
    if (k === "daily") {
      try {
        daily = await host.seeds.daily();
        seed = daily.seed;
      } catch {
        hud.banner("daily unavailable", "coral", now(), 1400);
        kind = "free";
        seed = host.seeds.free();
      }
    } else seed = host.seeds.free();
    const total = popcount(front);
    const present = Math.max(0, total - popcount(lostNow()));
    sim = PixelPutt.createPuttSim({ seed: seed >>> 0, kind, friend: { total, present } });
    log = new InputLog();
    cur = sim.view();
    prev = cur;
    paused = false;
    resumeAt = 0;
    state = "play";
    showcase = null;
    hud.setPlaying(true);
    for (const e of sim.drainEvents()) onEvent(e);
    audio.cue("run.start");
    audio.music?.play("run", seed);
    audio.music?.setIntensity(0.2);
    hud.setCard(
      [],
      sim.course.holes.map((h) => h.par),
      0,
    );
    hud.hint(opts.oneSwitch ? "press to lock the aim · press again to fling" : "drag back & let go to fling");
  };

  const endRound = (): void => {
    if (!sim || state !== "play") return;
    state = "ending";
    aim = null;
    const s = sim.summary();
    const report = host.reportResult({
      venueId: PIXEL_PUTT_ID,
      runId: runIdOf(),
      seed: sim.config.seed,
      kind,
      inputs: encodeInputs(log.inputs),
      claimed: s.run,
    });
    setTimeout(() => {
      if (state !== "ending") return;
      state = "results";
      audio.music?.stop({ at: "bar", fade: 1.5 });
      audio.music?.stinger("results");
      showResults(s, report);
    }, 1200);
  };

  const showResults = (s: PixelPutt.PuttSummary, report: Promise<RunAck>): void => {
    hud.setAim(null, false);
    hud.setPower(null);
    hud.hint(null);
    const course = sim?.course;
    const card = hud.openModal(roundHeadline(s.total, s.par, s.holeInOnes));
    const big = document.createElement("div");
    big.className = "pp-big";
    big.textContent = `${s.total} · ${formatToPar(s.total, s.par)}`;
    card.append(big);
    const sub = document.createElement("p");
    sub.textContent = `${kind === "daily" && daily ? `daily course ${daily.day}` : "free round"} · par ${s.par}${s.holeInOnes ? ` · ${s.holeInOnes} hole${s.holeInOnes > 1 ? "s" : ""} in one` : ""}`;
    card.append(sub);
    const table = document.createElement("table");
    table.className = "pp-table";
    const row = (label: string, cells: { text: string; cls?: string }[]): HTMLTableRowElement => {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = label;
      tr.append(th);
      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c.text;
        if (c.cls) td.className = c.cls;
        tr.append(td);
      }
      return tr;
    };
    const pars = course?.holes.map((h) => h.par) ?? [];
    table.append(
      row(
        "hole",
        pars.map((_, i) => ({ text: String(i + 1) })),
      ),
      row(
        "par",
        pars.map((p) => ({ text: String(p) })),
      ),
      row(
        "you",
        s.card.map((c, i) => ({ text: String(c), cls: scoreTone(c, pars[i] ?? 3) })),
      ),
    );
    card.append(table);
    const note = document.createElement("p");
    note.textContent = "scarless course: no pixels were at stake. saving your round…";
    card.append(note);
    const btns = document.createElement("div");
    card.append(btns);
    hud.button(btns, "play again", () => void startRound(kind), true);
    if (kind !== "daily") hud.button(btns, "daily course", () => void startRound("daily"));
    hud.button(btns, "walk into the sky →", () => host.exit("done"));
    report
      .then((ack) => {
        if (ack.bits !== undefined) note.textContent = `+${ack.bits} bits · scarless course: no pixels were at stake.`;
        else if (loaned) note.textContent = "round saved. bring your own friend to earn bits.";
        else note.textContent = "round saved · scarless course: no pixels were at stake.";
      })
      .catch(() => {
        note.textContent = "couldn't save this round (offline?). your score still counts here.";
      });
  };

  const showStart = (): void => {
    state = "start";
    hud.setPlaying(false);
    showcase = PixelPutt.buildHole(PixelPutt.templateSpec(4, [0.5, 0.3, 0.5, 0.5]), 1);
    scene.setHole(showcase);
    const idle: PixelPutt.PuttView = {
      tick: 0,
      hole: 0,
      holeTick: 0,
      phase: "play",
      ball: { x: showcase.tee.x, z: showcase.tee.z, y: 0, vx: 0, vz: 0, mode: "rest" },
      ready: false,
      strokes: 0,
      card: [],
      total: 0,
      parSoFar: 0,
    };
    cur = idle;
    prev = idle;
    frameHole(true);
    const card = hud.openModal("pixel putt");
    const p1 = document.createElement("p");
    p1.textContent = PUTT_RULE;
    const p2 = document.createElement("p");
    p2.textContent = opts.oneSwitch
      ? "one-switch: press to lock the aim, press again to fling."
      : "drag back from anywhere and let go: the further you pull, the harder the fling. keys: ←/→ aim, ↑ aim at the cup, hold space to charge, p pause.";
    const p3 = document.createElement("p");
    p3.textContent = "9 floating holes. windmills, gaps, bumpers and nibs (+1 stroke). no pixels at stake.";
    card.append(p1, p2, p3);
    if (loaned) {
      const p4 = document.createElement("p");
      p4.textContent = `playing as #${appearance.tokenId} (on loan).`;
      card.append(p4);
    }
    hud.button(card, "▶ play", () => void startRound("free"), true);
    hud.button(card, "daily course", () => void startRound("daily"));
  };

  // ── Loops ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const unsubInput = stage.input.on(onInput);
  const unsubTick = stage.onTick(() => {
    if (state !== "play" || paused || resumeAt > 0 || !sim || sim.done) return;
    if (autoplay && cur?.ready && !botPlan) botPlan = PixelPutt.chooseShot(sim);
    if (botPlan && cur?.ready) {
      if (botPlan.wait > 0) botPlan = { ...botPlan, wait: botPlan.wait - 1 };
      else {
        log.push({ t: 0, k: 0, ang: botPlan.ang, pow: botPlan.pow });
        botPlan = null;
      }
    }
    const inputs = log.flush(sim.tick);
    sim.step(inputs);
    prev = cur;
    cur = sim.view();
    for (const e of sim.drainEvents()) onEvent(e);
  });
  const unsubFrame = stage.onFrame((dt, alpha) => {
    time += dt;
    const t = now();
    if (resumeAt > 0) {
      const left = resumeAt - t;
      if (left <= 0) {
        resumeAt = 0;
        paused = false;
        hud.setCountdown(0);
        audio.music?.setIntensity(0.2);
      } else hud.setCountdown(Math.ceil(left / 300));
    }
    pollInput(dt);
    const running = state === "play" || state === "ending";
    stage.timeScale = !running || paused || resumeAt > 0 || t < stopUntil ? 0 : 1;
    // Presentation time: frozen during hit-stop and pause, but the start-card showcase keeps idling.
    const sdt = stage.timeScale > 0 || state === "start" ? dt : 0;
    if (!cur || !prev) {
      hud.frame(t);
      return;
    }
    // Re-frame on rotation / resize.
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    if (h > w * 1.1 !== portrait) frameHole(false);
    scene.sync(prev, cur, running ? alpha : 1, sdt);
    const b = cur.ball;
    const k = b.mode === "rest" ? 0.12 : 0.3;
    rig.follow(tmp.set(focus.x + (b.x - focus.x) * k, 0, focus.z + (b.z - focus.z) * k));
    // HUD.
    hud.setStrokes(cur.strokes);
    if (sim)
      hud.setCard(
        cur.card,
        sim.course.holes.map((x) => x.par),
        cur.hole,
      );
    if (aim && cur.ready && sim && aim.p > 0) {
      const pts = sim.preview(aim.ang, powerToSim(aim.p), 27, 3);
      const dots: AimDot[] = [];
      let landed = false;
      for (const q of pts) {
        let kind: AimDot["kind"] = "air";
        if (q.y < 0) kind = "drop";
        else if (!landed && q.y === 0) {
          landed = true;
          kind = "land";
        }
        dots.push({ p: projectAt(q.x, q.z, Math.max(0, q.y) + 0.15), kind });
        if (kind === "drop") break;
      }
      if (dots.length === 0) {
        const d = dirFromAngle(aim.ang);
        dots.push({ p: projectAt(b.x + d.x, b.z + d.z, 0.15), kind: "air" });
      }
      hud.setAim(dots, aim.p >= 1);
      hud.setPower(aim.p);
    } else {
      hud.setAim(null, false);
      hud.setPower(null);
    }
    hud.frame(t);
  });

  if (opts.autoStart) await startRound(opts.autoStart);
  else showStart();

  return {
    pause(p) {
      setPaused(p);
    },
    resize() {
      frameHole(false);
    },
    async unmount() {
      state = "gone";
      unsubTick();
      unsubFrame();
      unsubInput();
      unsubPause();
      window.removeEventListener("blur", onBlur);
      audio.music?.stop({ at: "now", fade: 0.3 });
      hud.dispose();
      scene.dispose();
      rig.pose = saved.pose;
      rig.baseYaw = saved.baseYaw;
      rig.followRate = saved.follow;
      rig.minVisibleWidth = saved.minW;
      rig.readableUnit = saved.unit;
      stage.timeScale = saved.timeScale;
    },
    debug: {
      state: () => state,
      view: () => cur,
      course: () => sim?.course ?? null,
      start: (k) => startRound(k),
      fling: (ang, p) => {
        aim = { ang, p, from: "debug" };
        fire(ang, p);
      },
      autoplay: (on) => {
        autoplay = on;
        botPlan = null;
        if (on) hud.hint(null);
      },
      aim: (a) => {
        aim = a ? { ...a, from: "debug" } : null;
      },
      skipTo: (target) => {
        if (!sim || state !== "play") return;
        let lastTee: PixelPutt.PuttEvent | null = null;
        for (let guard = 0; guard < PixelPutt.PUTT.maxTicks && !sim.done; guard++) {
          const v = sim.view();
          if (v.hole >= target && v.ready) break;
          const shot = v.ready ? PixelPutt.chooseShot(sim) : null;
          if (shot) for (let i = 0; i < shot.wait; i++) sim.step();
          const input = shot ? { t: sim.tick, k: 0 as const, ang: shot.ang, pow: shot.pow } : null;
          if (input) log.push(input);
          sim.step(log.flush(sim.tick));
          for (const e of sim.drainEvents()) if (e.type === "tee") lastTee = e;
        }
        cur = sim.view();
        prev = cur;
        if (lastTee) onEvent(lastTee);
      },
    },
  };
}
