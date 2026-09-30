/**
 * Loose Pixels, the flagship venue (NativeVenue on the shared three.js stage). It owns the run loop only: the sim is
 * stepped on the stage's fixed 60 Hz tick with the recorded inputs, the renderer interpolates the last two views, and
 * every beat the sim emits becomes juice (hit-stop, slow-mo, shake, impact frames, particles, callouts), audio and HUD.
 * Identity, economy, persistence and navigation stay with the host (venue-kit contract, DECISIONS D-08).
 */
import { Vector3 } from "three";
import {
  effectiveLost,
  familyName,
  frontMask,
  popcount,
  type DailySeed,
  type EconomyQuote,
  type Hex64,
  type RunAck,
  type RunKind,
  beltTrialSeed,
  BOT_PROFILES,
  createBot,
  SimEvents as EV,
  type Bot,
  type Sim,
  type SimConfig,
  type SimEvent as AnyEvent,
  type SimView as FullSimView,
} from "@pl/shared";
import type { NativeVenue, VenueHost, VenueInstance, VenueManifest } from "@pl/venue-kit";
import { RUN_POSE, type OrbitPose } from "../../stage/camera-rig";
import type { SharedStage as GameStage } from "../../stage/stage";
import type { InputEvent } from "../../stage/input";
import { powerForDistance, previewDistances, previewPoints } from "./aim";
import { PHASE_INTENSITY, RunAudio, smashCue, telegraphCue, type VenueAudioExt } from "./audio";
import { Hud, type ScreenPoint } from "./hud";
import { comboScale as comboGrow, planFor, TimeWarp, type Beat, type JuicePlan } from "./juice";
import {
  formatEta,
  formatRf,
  grabCallout,
  lossCallout,
  phaseBanner,
  popCallout,
  type Callout,
  type EndReason,
} from "./hud-format";
import {
  angleFromDeg,
  angleFromDir,
  dirFromAngle,
  dragCancels,
  dragPower,
  flingInput,
  ButtonEdges,
  InputLog,
  KeyboardAim,
  MIN_POWER,
  padAim,
  PAD,
  OneSwitchAim,
  SteerEncoder,
} from "./input";
import { buildResults, replayNote, scarNote, type ResultsModel } from "./results";
import { disposePlaceholderCreatures, RunScene, U, type CreatureFactory } from "./scene";
import { drawSilhouette, renderShareCard } from "./share-card";
import { KIND, PX, SHARED_SIM, type SimModule } from "./sim-module";

/** Stable venue id (hub door, results, leaderboards). */
export const VENUE_ID = "pixel-life";

const THUMB = [
  "................",
  "....##....##....",
  "....########....",
  "...##########...",
  "...#..####..#...",
  "...##########...",
  "....########....",
  "......####......",
  "....########..#.",
  "...##.####.##...",
  "......####......",
  ".....##..##.....",
  ".....#....#.....",
  "................",
  "..#.........#...",
  "................",
].join("\n");

/** The hub door description. */
export const MANIFEST: VenueManifest = {
  id: VENUE_ID,
  name: "Loose Pixels",
  version: "0.1.0",
  kind: "native",
  room: "pixel-arena",
  requires: { ownedFriend: false },
  economy: { sinks: ["regrow"] },
  results: { leaderboard: "score-desc", affectsScars: true },
  thumbnail: THUMB,
};

/** Options when building the venue (the shell passes none; dev pages and tests use them). */
export interface LoosePixelsOptions {
  /** The sim implementation; defaults to the real `@pl/shared` sim (the one the server replays). */
  readonly sim?: SimModule;
  /** Creature renderer (the creatures module); placeholder voxel sprites otherwise. */
  readonly creatureFactory?: CreatureFactory;
  readonly arena?: string;
  /**
   * A Fling Belt trial the host wants played (belt id): the run uses the fixed `beltTrialSeed(id)` everyone shares and
   * is reported with `beltTrial` so the server can grade it.
   */
  readonly beltTrial?: string;
  /** Skip the start card and begin a run of this kind right away (a belt trial when `beltTrial` is set). */
  readonly autoStart?: RunKind;
  /** Accessibility: one-switch controls (auto-rotating aim, oscillating power). */
  readonly oneSwitch?: boolean;
  /** Accessibility: tap-to-target (a tap flings toward the point with the power that stops there) instead of tap-to-sweep. */
  readonly tapTarget?: boolean;
  /** Accessibility: no impact-frame inversions (separate from reduced motion). */
  readonly noFlashes?: boolean;
  /** Clock for timers (tests). Defaults to `performance.now()`. */
  readonly now?: () => number;
}

/** Debug handle the dev page and capture script read; not part of the venue contract. */
export interface LoosePixelsDebug {
  readonly state: () => string;
  readonly view: () => FullSimView | null;
  readonly results: () => ResultsModel | null;
  readonly start: (kind: RunKind, beltTrial?: string) => Promise<void>;
  /** Fires a fling now (angle 0..4095, power 0..1). */
  readonly fling: (ang: number, p: number) => void;
  readonly shareCanvas: () => HTMLCanvasElement | null;
  /** Fast-forwards the sim by `ticks` (autopilot inputs only; events drained silently); capture tooling only. */
  readonly advance: (ticks: number) => void;
  /** Lets the sim's balance bot play (attract mode, captures); null hands control back. */
  readonly autopilot: (profile: keyof typeof BOT_PROFILES | null, seed?: number) => void;
}

/** A mounted Loose Pixels instance. */
export interface LoosePixelsInstance extends VenueInstance {
  readonly debug: LoosePixelsDebug;
}

type State = "start" | "run" | "ending" | "results" | "gone";

const BUBBLES: Readonly<Record<number, string>> = {
  [KIND.nib]: "pardon!",
  [KIND.pogo]: "hup!",
  [KIND.clank]: "grr…",
  [KIND.slurp]: "blub",
  [KIND.fizz]: "tss…",
};
const ACCENT_HEX = [0xed927e, 0xf2ce68, 0x7db4db, 0xb3a0d8, 0xb3a0d8, 0xf2ce68] as const;
/** Camera focus offset toward the viewer (world units): keeps the island's far rim and the HUD apart. */
const CAM_Z = 0.5;
/** Window event the web shell's coachmarks listen to (apps/web onboarding `COACH_DOM_EVENT`). */
export const COACH_DOM_EVENT = "pl:coach";
/** Coach event names the venue reports (apps/web onboarding `COACH_EVENTS`). */
export type CoachEvent =
  "run:start" | "fling" | "pixels:loose" | "pixels:grabbed" | "pixels:scarred" | "pause" | "run:end";
const BITE_TIPS_KEY = "loose-pixels:bite-tips";

function runIdOf(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Builds the venue around a sim implementation. */
export function createLoosePixelsVenue(opts: LoosePixelsOptions = {}): NativeVenue<GameStage> {
  return {
    manifest: MANIFEST,
    mount: async (host) => mountVenue(host, opts),
  };
}

async function mountVenue(host: VenueHost<GameStage>, opts: LoosePixelsOptions): Promise<LoosePixelsInstance> {
  const stage = host.stage;
  const simModule = opts.sim ?? SHARED_SIM;
  const now = opts.now ?? (() => performance.now());
  const audio = new RunAudio(host.audio as VenueAudioExt);
  const reduced = host.reducedMotion;
  const arenaName = opts.arena ?? "meadow";
  const canvas = stage.renderer.domElement;
  const parent = canvas.parentElement ?? document.body;

  // ── Take over the shared stage (restored on unmount) ───────────────────────────────────────────────────────────────
  const saved = {
    pose: { ...stage.rig.pose },
    follow: stage.rig.followRate,
    minW: stage.rig.minVisibleWidth,
    timeScale: stage.timeScale,
  };
  // Frame 1: the whole island in view, top well visible (GDD §2.4: pitch 38°, FOV 28°), underside cut by the bottom edge.
  const pose: OrbitPose = { ...RUN_POSE, pitch: 38, fov: 28, distance: 14 };
  stage.rig.pose = { ...pose };
  stage.rig.followRate = reduced ? 1.5 : 6;
  // Portrait phones: pull back until the island (plus a little sky) fits the width.
  stage.rig.minVisibleWidth = 12.5;
  stage.setAccess({ reducedMotion: reduced, noFlashes: opts.noFlashes ?? false });
  stage.rig.snap(new Vector3(0, 0, CAM_Z));

  // ── Friend & scene ────────────────────────────────────────────────────────────────────────────────────────────────
  const friendView = () => host.identity.friend;
  const appearance = friendView().appearance;
  const front = frontMask(appearance);
  const total = popcount(front);
  const startLostNow = () =>
    effectiveLost(friendView().pub.scars, Date.now(), appearance.tokenId, { goldHeld: friendView().pub.goldHeld });
  /**
   * The real Munchies speak for themselves and draw their own spawn ripple; generic bubbles and the scene ripple are
   * only for injected renderers that don't (flips to true as soon as any visual speaks).
   */
  let creaturesSpeak = !opts.creatureFactory;
  const GULP_BUBBLE = -1;
  const buildScene = (startLost: Hex64, seed: number, arena: { a: number; b: number }): RunScene =>
    new RunScene({
      appearance,
      startLost,
      goldHeld: friendView().pub.goldHeld,
      arena: { ...arena, name: arenaName },
      seed,
      reducedMotion: reduced,
      ...(opts.creatureFactory ? { creatureFactory: opts.creatureFactory } : {}),
      onCreatureSpeak: (id, text, sec) => {
        creaturesSpeak = true;
        const c = cur?.creatures.find((q) => q.id === id);
        if (c) hud.bubble(id, text, projectSim(c.x, c.z, c.y + 6), now(), sec * 1000);
      },
      onGulpSpeak: (text, sec) => {
        const g = cur?.gulp;
        if (g) hud.bubble(GULP_BUBBLE, text, projectSim(g.mouthX, g.mouthZ, 14), now(), sec * 1000);
      },
    });
  const MEADOW = { a: 36, b: 24 };
  let scene = buildScene(startLostNow(), 21, MEADOW);
  stage.scene.add(scene.root);

  const loaned = host.identity.loaned || host.identity.mode === "guest";
  const hud = new Hud(parent, {
    tokenId: appearance.tokenId,
    subtitle: `${familyName(appearance.familyId).toLowerCase()} · ${loaned ? "on loan" : "your friend"}`,
    front,
    reducedMotion: reduced,
  });

  // ── Run state ─────────────────────────────────────────────────────────────────────────────────────────────────────
  let state: State = "start";
  let sim: Sim | null = null;
  let cfg: SimConfig | null = null;
  let daily: DailySeed | null = null;
  /** Belt id of the current run when it is a Fling Belt trial. */
  let trial: string | null = null;
  /** Wall-clock start of the current run (reported with its start scars so the server can replay from them). */
  let startedAt = 0;
  let prev: FullSimView | null = null;
  let cur: FullSimView | null = null;
  let log = new InputLog();
  let pilot: Bot | null = null;
  /** Autopilot inputs for this tick (the bot reads the view like a player reads the screen). */
  const pilotInputs = (): void => {
    if (!pilot || !cur) return;
    for (const i of pilot.decide(cur)) log.push(i);
  };
  const steer = new SteerEncoder();
  const warp = new TimeWarp(reduced);
  const keys = new KeyboardAim();
  const one = new OneSwitchAim();
  let paused = false;
  let resumeAt = 0;
  let time = 0;
  let bestCombo = 0;
  let gulpBurped = false;
  let endReason: EndReason = "time";
  let results: ResultsModel | null = null;
  let shareCanvas: HTMLCanvasElement | null = null;
  let aim: { ang: number; p: number; from: "drag" | "keys" | "one" | "pad" } | null = null;
  const padButtons = new ButtonEdges();
  let padLast: { ang: number; p: number } | null = null;
  let aimSlowLeft = 0;
  let keyAimShownUntil = 0;
  let lastChargeStep = 0;
  let buffered: { ang: number; p: number; until: number } | null = null;
  let steerTarget: { x: number; z: number; until: number } | null = null;
  let sweepKey = false;
  let lastPhase = -1;
  let musicSlow = 0;
  const tmp = new Vector3();
  const tmp2 = new Vector3();

  const project = (v: Vector3): ScreenPoint => {
    const p = tmp2.copy(v).project(stage.camera);
    if (p.z > 1) return null;
    return { x: ((p.x + 1) / 2) * canvas.clientWidth, y: ((1 - p.y) / 2) * canvas.clientHeight };
  };
  const projectSim = (x: number, z: number, h = 0): ScreenPoint => project(scene.world(x, z, h, tmp));
  /** Ground-plane (y = 0) hit of a CSS-px screen point, in sim units. */
  const groundAt = (sx: number, sy: number): { x: number; z: number } | null => {
    const ndc = new Vector3((sx / canvas.clientWidth) * 2 - 1, 1 - (sy / canvas.clientHeight) * 2, 0.5);
    ndc.unproject(stage.camera);
    const o = stage.camera.position;
    const dir = ndc.sub(o);
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = -o.y / dir.y;
    if (t <= 0) return null;
    return { x: (o.x + dir.x * t) / U, z: (o.z + dir.z * t) / U };
  };
  const body = () => cur?.friend.bodies[0] ?? null;
  const friendScreen = (): ScreenPoint => {
    const b = body();
    return b ? projectSim(b.x, b.z, 0) : null;
  };
  // Callouts sit beside the Friend's head (frame 1: "−4 px" to its upper right), clear of the timer.
  const friendHead = (): ScreenPoint => project(tmp.copy(scene.friendPos).add(tmp2.set(1.7, 1.9, 0)));

  // ── Coachmarks (web onboarding listens for `pl:coach` window events; unknown names are ignored) ─────────────────────
  let coachTick = -1;
  const coachSent = new Set<CoachEvent>();
  const coach = (name: CoachEvent): void => {
    // Pixel beats come in bursts (one event per pixel): report each name at most once per sim tick.
    const tick = cur?.tick ?? -1;
    if (tick !== coachTick) {
      coachTick = tick;
      coachSent.clear();
    }
    if (coachSent.has(name)) return;
    coachSent.add(name);
    try {
      window.dispatchEvent(new CustomEvent(COACH_DOM_EVENT, { detail: name }));
    } catch {
      // No window (tests) or a host that forbids custom events: hints are optional.
    }
  };

  // ── Juice ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const juice = (plan: JuicePlan, at?: ScreenPoint): void => {
    const t = now();
    warp.apply(t, plan);
    if (plan.trauma) stage.rig.shake(plan.trauma);
    if (plan.punch) stage.rig.punch();
    if (plan.dipMs) stage.rig.dip(plan.dipMs);
    if (plan.impactFrames) stage.post.impacts.requestFrame(t, plan.impactFrames);
    if (at && !reduced) {
      // Local 9-point burst at the contact, in internal render px (y up).
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      const sx = stage.post.stats.internalWidth / w;
      const sy = stage.post.stats.internalHeight / h;
      stage.post.impacts.requestBurst(at.x * sx, (h - at.y) * sy);
    }
  };
  const beat = (b: Beat, at?: ScreenPoint): void => juice(planFor(b), at);
  const say = (c: Callout, x: number, z: number, h = 3, life?: number): void => {
    const sx = x;
    const sz = z;
    hud.callout(c, () => projectSim(sx, sz, h), now(), life);
  };
  const sayFriend = (c: Callout, life?: number): void => hud.callout(c, friendHead, now(), life);

  // ── Events ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const onEvent = (e: AnyEvent, before: FullSimView, after: FullSimView): void => {
    const x = e.x ?? 0;
    const z = e.z ?? 0;
    const pan = (): number => {
      const p = projectSim(x, z);
      return p ? Math.min(1, Math.max(0, p.x / (canvas.clientWidth || 1))) : 0.5;
    };
    switch (e.type) {
      case "launch":
        coach("fling");
        audio.cue("fling.release", { gain: 0.6 + ((e.b ?? 0) / 1023) * 0.6, x: pan() });
        scene.hop(time, (e.b ?? 0) / 1023);
        break;
      case "smash": {
        const kind = before.creatures.find((c) => c.id === e.a)?.kind ?? KIND.nib;
        const pts = e.b ?? 0;
        if (e.a !== undefined) scene.smashCreature(e.a);
        scene.burst(x, z, [ACCENT_HEX[kind] ?? 0xeeeeee, 0x111111, 0xeeeeee], reduced ? 4 : 8, 1.5);
        if (pts > 0) {
          const combo = after.friend.combo;
          bestCombo = Math.max(bestCombo, combo);
          say(popCallout(pts), x, z, 4);
          audio.cue(smashCue(kind), { x: pan(), step: Math.max(0, combo - 1) });
          beat({ kind: "pop", combo, armoured: kind === KIND.clank }, projectSim(x, z, 2));
          scene.squash(time);
        }
        break;
      }
      case "combo": {
        const n = e.a ?? 2;
        bestCombo = Math.max(bestCombo, n);
        sayFriend({ text: `combo x${n}`, tone: "lime", scale: comboGrow(n) }, 900);
        if (n >= 5) audio.music?.stinger("combo");
        break;
      }
      case "bite": {
        const px = e.b ?? 1;
        coach("pixels:loose");
        beat({ kind: "bite", px });
        scene.squash(time);
        sayFriend(lossCallout(px));
        audio.cue("bite", { x: pan(), step: px });
        audio.cue("slowmo.in");
        let tips: number;
        try {
          tips = Number(localStorage.getItem(BITE_TIPS_KEY) ?? "0") || 0;
          if (tips < 2) localStorage.setItem(BITE_TIPS_KEY, String(tips + 1));
        } catch {
          tips = 2;
        }
        if (tips < 2) hud.showBanner("grab them back!", "lime", now(), 1300);
        break;
      }
      case "pixelOff":
        audio.cue("pixel.pop", { x: pan() });
        break;
      case "pixelBack":
        coach("pixels:grabbed");
        if (e.b === 1) {
          beat({ kind: "clutch" });
          sayFriend(grabCallout(true));
          audio.cue("pixel.clutch", { x: pan() });
        } else {
          sayFriend(grabCallout(false), 600);
          audio.cue("pixel.sweep", { x: pan() });
        }
        break;
      case "pixelLost":
        coach("pixels:scarred");
        audio.cue(e.b === EV.LOST_EDGE || e.b === EV.LOST_GULP ? "pixel.fall" : "pixel.lost", { x: pan() });
        break;
      case "edge":
        if (e.a === EV.EDGE_FALL) {
          beat({ kind: "ringout" });
          audio.cue("ringout", { x: pan() });
          sayFriend({ text: "ring out −50", tone: "coral" }, 1000);
        } else if (e.a === EV.EDGE_PIXELS) {
          say(lossCallout(e.b ?? 3), 0, 0, 4);
        }
        break;
      case "hit":
        if (e.a !== undefined && e.a >= 0) scene.hitCreature(e.a);
        if (e.b === EV.HIT_PLATE) {
          beat({ kind: "plate" }, projectSim(x, z, 2));
          audio.cue("bonk.shell", { x: pan() });
          say({ text: "bonk!", tone: "paper" }, x, z, 4);
          scene.squash(time);
        } else if (e.b === EV.HIT_LAUNCH_FIZZ) {
          say({ text: "fizz bank!", tone: "lime" }, x, z, 4);
        } else {
          audio.cue("bonk.rim", { x: pan() });
          scene.squash(time);
        }
        break;
      case "parry":
        if (e.a !== undefined) scene.hitCreature(e.a);
        say({ text: "parry", tone: "paper" }, x, z, 4);
        break;
      case "glance":
        beat({ kind: "glance" });
        audio.cue("gold.glance", { x: pan() });
        scene.burst(x, z, [0xe8b530, 0xfff8e4], 3, 6);
        break;
      case "telegraph": {
        const kind = e.b ?? 0;
        const cue = telegraphCue(kind);
        if (cue && kind !== KIND.snatch) audio.cue(cue, { x: pan(), gain: 0.7 });
        const text = BUBBLES[kind];
        if (text && e.a !== undefined && !creaturesSpeak) hud.bubble(e.a, text, projectSim(x, z, 6), now(), 600);
        break;
      }
      case "steal":
        audio.cue("snatch.cackle", { x: pan() });
        if (e.a !== undefined && !creaturesSpeak) hud.bubble(e.a, "mine!", projectSim(x, z, 9), now(), 1200);
        break;
      case "yank":
        if (e.a !== undefined) scene.attackCreature(e.a);
        audio.cue("slurp.tongue", { x: pan() });
        break;
      case "spawn":
        if (!creaturesSpeak) scene.ripple(x, z);
        audio.cue("creature.spawn", { x: pan(), gain: 0.5 });
        break;
      case "explode":
        scene.burst(x, z, [0xf2ce68, 0x111111, 0xeeeeee], reduced ? 6 : 14, 1, 8);
        audio.cue("smash.fizz", { x: pan() });
        stage.rig.shake(0.3);
        break;
      case "crumb":
        say({ text: `+${e.a ?? 20}`, tone: "paper" }, x, z, 2);
        break;
      case "gulp":
        onGulp(e, x, z);
        break;
      case "phase": {
        const ph = e.a ?? 0;
        const text = phaseBanner(ph);
        if (text && ph !== 3) hud.showBanner(text, "paper", now(), 1000);
        audio.music?.setIntensity(PHASE_INTENSITY[ph] ?? 0.5);
        if (ph === 4) {
          audio.music?.stinger("fill");
          hud.showBanner("last light ×1.5", "lime", now(), 1200);
        }
        break;
      }
      case "end":
        endReason = e.a === EV.END_CRUMBLE ? "crumble" : "time";
        beat({ kind: "end" });
        audio.cue("run.end");
        break;
      default:
        break;
    }
  };

  const onGulp = (e: AnyEvent, x: number, z: number): void => {
    switch (e.a) {
      case EV.GULP_EV_RUMBLE: {
        audio.cue("gulp.rumble");
        audio.music?.setMood("gulp");
        audio.music?.stinger("gulp");
        hud.showBanner("gulp!", "coral", now(), 1200, true);
        const p = projectSim(x, z);
        hud.setEdgeBand(p && p.x < canvas.clientWidth / 2 ? "left" : "right");
        break;
      }
      case EV.GULP_EV_BITE:
        beat({ kind: "gulpBite" });
        scene.gulpBeat("bite");
        audio.cue("gulp.bite");
        scene.burst(x, z, [0xb9d984, 0xed927e, 0xb3a0d8], reduced ? 8 : 20, 0, 9);
        break;
      case EV.GULP_EV_TOOTH_HIT:
        beat({ kind: "tooth" }, projectSim(x, z, 2));
        scene.gulpBeat("tooth", e.b ?? 0);
        audio.cue("gulp.tooth", { step: e.b ?? 0 });
        say(popCallout(100), x, z, 5);
        scene.burst(x, z, [0xf2ce68, 0xeeeeee], 6, 3, 6);
        break;
      case EV.GULP_EV_BURP:
        gulpBurped = true;
        scene.gulpBeat("burp");
        audio.cue("gulp.burp");
        audio.music?.stinger("burp");
        hud.showBanner("gulp burped! +500", "lime", now(), 1600);
        break;
      case EV.GULP_EV_INHALE:
        audio.cue("gulp.inhale");
        hud.showBanner("inhale!", "coral", now(), 900, true);
        break;
      case EV.GULP_EV_SINK:
      case EV.GULP_EV_REGROW:
        audio.music?.setMood("normal");
        hud.setEdgeBand(null);
        break;
      default:
        break;
    }
  };

  // ── Input ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const canPlay = (): boolean => state === "run" && !paused && sim !== null && !sim.done;
  const fire = (ang: number, p: number): void => {
    const input = flingInput(0, ang, p);
    if (!input || !canPlay()) return;
    steerTarget = null;
    const b = body();
    const ready = cur?.friend.ready ?? false;
    if (ready || !b) {
      log.push(input);
      // Sweeping stops on a fling (the sim ignores steering above 8 u/s anyway, keep the log tidy).
      const off = steer.update(0, false, 0);
      if (off) log.push(off);
    } else buffered = { ang, p, until: now() + 250 };
  };
  const aimFromDrag = (vx: number, vy: number): number | null => {
    const f = friendScreen();
    const b = body();
    if (!f || !b) return null;
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
    if (!canPlay()) return;
    audioUnlockHint();
    switch (e.type) {
      case "dragstart":
        aim = { ang: 0, p: 0, from: "drag" };
        break;
      case "drag": {
        const len = Math.hypot(e.vector.x, e.vector.y);
        const ang = aimFromDrag(e.vector.x, e.vector.y);
        if (ang !== null) aim = { ang, p: dragPower(len), from: "drag" };
        break;
      }
      case "dragend": {
        const len = Math.hypot(e.vector.x, e.vector.y);
        const ang = aimFromDrag(e.vector.x, e.vector.y);
        aim = null;
        if (ang !== null && !dragCancels(len)) fire(ang, dragPower(len));
        break;
      }
      case "tap": {
        const g = groundAt(e.at.x, e.at.y);
        if (!g) break;
        const b = body();
        if (opts.tapTarget && b) {
          // Tap-to-target: fling toward the point with the power whose slide stops there (sim damping, own mass).
          const dist = Math.hypot(g.x - b.x, g.z - b.z);
          fire(angleFromDir(g.x - b.x, g.z - b.z), Math.max(MIN_POWER, powerForDistance(dist, b.mass)));
        } else {
          // Tap-to-sweep: steer toward the tapped ground point (collect loose pixels without a full fling).
          steerTarget = { x: g.x, z: g.z, until: now() + 1500 };
        }
        break;
      }
      case "cancel":
        aim = null;
        break;
    }
  };
  const nearestCreatureDegs = (): number[] => {
    const b = body();
    if (!b || !cur) return [];
    return cur.creatures.map((c) => (Math.atan2(c.z - b.z, c.x - b.x) * 180) / Math.PI);
  };
  const onKey = (code: string, down: boolean): void => {
    if (down && (code === "KeyP" || (code === "Escape" && !aim && !keys.charging))) {
      if (state === "run") setPaused(!paused);
      return;
    }
    if (!canPlay()) return;
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
          keyAimShownUntil = time + 0.6;
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
      case "KeyW":
        if (down) {
          keys.snap(nearestCreatureDegs());
          keyAimShownUntil = time + 1.5;
        }
        break;
      case "ArrowDown":
      case "KeyS":
        sweepKey = down;
        break;
      default:
        break;
    }
  };
  let audioHinted = false;
  const audioUnlockHint = (): void => {
    if (audioHinted) return;
    audioHinted = true;
    hud.hint(null);
  };

  /** First connected standard gamepad, if the browser exposes any. */
  const readPad = (): Gamepad | null => {
    try {
      for (const p of navigator.getGamepads?.() ?? []) if (p?.connected) return p;
    } catch {
      // Gamepad API blocked (permissions policy): keyboard, touch and one-switch still work.
    }
    return null;
  };
  /** Gamepad (GDD §2.2): left stick aims + sets power, A fires (or release the right trigger), Start pauses. */
  const pollPad = (): void => {
    const pad = readPad();
    if (!pad) {
      if (aim?.from === "pad") aim = null;
      padButtons.reset();
      return;
    }
    if (padButtons.edge(PAD.start, pad.buttons[PAD.start]?.pressed ?? false) === "press" && state === "run")
      setPaused(!paused);
    if (!canPlay()) return;
    const a = padAim(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    if (a) {
      padLast = a;
      aim = { ...a, from: "pad" };
    } else if (aim?.from === "pad") aim = null;
    const fireA = padButtons.edge(PAD.a, pad.buttons[PAD.a]?.pressed ?? false) === "press";
    const trig = padButtons.edge(PAD.trigger, (pad.buttons[PAD.trigger]?.value ?? 0) > PAD.triggerOn) === "release";
    const shot = a ?? (trig ? padLast : null);
    if ((fireA || trig) && shot) {
      audioUnlockHint();
      fire(shot.ang, shot.p);
      padLast = null;
    }
  };

  /** Continuous input work per rendered frame (keyboard rotation, charge, steering, gamepad). */
  const pollInput = (dt: number): void => {
    pollPad();
    if (!canPlay()) return;
    const inp = stage.input;
    const left = inp.isKeyDown("ArrowLeft") || inp.isKeyDown("KeyA");
    const right = inp.isKeyDown("ArrowRight") || inp.isKeyDown("KeyD");
    const fine = inp.isKeyDown("ShiftLeft") || inp.isKeyDown("ShiftRight");
    if (opts.oneSwitch) {
      one.tick(dt);
      aim = { ang: angleFromDeg(one.deg), p: one.phase === "power" ? one.power : 0.35, from: "one" };
    } else {
      if (left !== right) {
        keys.rotate(right ? 1 : -1, dt, fine);
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
        aim = { ang: angleFromDeg(keys.deg), p: Math.max(p, 0.12), from: "keys" };
      } else if (time < keyAimShownUntil && aim?.from !== "drag" && aim?.from !== "pad") {
        aim = { ang: angleFromDeg(keys.deg), p: 0.35, from: "keys" };
      } else if (aim && aim.from !== "drag" && aim.from !== "pad") aim = null;
    }
    if (aim?.from === "drag" && aim.p > 0) {
      const t = aim.p;
      if (t !== 0 && Math.round(t * 8) > lastChargeStep) {
        lastChargeStep = Math.round(t * 8);
        audio.cue("fling.charge", { step: lastChargeStep });
      }
    } else if (!keys.charging) lastChargeStep = 0;
    // Buffered fling (released during cooldown): fire as soon as the sim says ready.
    if (buffered) {
      if (now() > buffered.until) buffered = null;
      else if (cur?.friend.ready) {
        const b = buffered;
        buffered = null;
        fire(b.ang, b.p);
      }
    }
    // Steering: keyboard sweep (toward the nearest loose pixel) or tap target.
    const b = body();
    let want: { on: boolean; dir: number } = { on: false, dir: 0 };
    if (b && sweepKey) {
      let best: { x: number; z: number } | null = null;
      let bd = Infinity;
      for (const d of cur?.debris ?? []) {
        const dd = Math.hypot(d.x - b.x, d.z - b.z);
        if (dd < bd && d.carriedBy < 0) {
          bd = dd;
          best = d;
        }
      }
      want = best
        ? { on: true, dir: angleFromDir(best.x - b.x, best.z - b.z) }
        : { on: true, dir: angleFromDeg(keys.deg) };
    } else if (b && steerTarget) {
      const dx = steerTarget.x - b.x;
      const dz = steerTarget.z - b.z;
      if (Math.hypot(dx, dz) < 1.5 || now() > steerTarget.until) steerTarget = null;
      else want = { on: true, dir: angleFromDir(dx, dz) };
    }
    const s = steer.update(0, want.on, want.dir);
    if (s) log.push(s);
  };

  // ── Pause ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const setPaused = (p: boolean): void => {
    if (state !== "run") return;
    if (p === paused && !(p === false && resumeAt > 0)) return;
    if (p) {
      coach("pause");
      paused = true;
      resumeAt = 0;
      hud.setCountdown(0);
      aim = null;
      keys.cancel();
      log.clearPending();
      audio.music?.setIntensity(0.1);
      const body = hud.openModal("paused");
      body.append(Object.assign(document.createElement("p"), { textContent: "the run is frozen. nothing bites." }));
      hud.button(body, "▶ resume", () => setPaused(false), true);
      hud.button(body, "quit run", () => host.exit("quit"));
    } else if (paused && resumeAt === 0) {
      hud.closeModal();
      // 3-2-1 step countdown, 0.9 s total.
      resumeAt = now() + 900;
    }
  };
  const unsubPause = host.paused.subscribe((p) => setPaused(p));
  const onBlur = (): void => setPaused(true);
  window.addEventListener("blur", onBlur);

  // ── Run lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────
  const startRun = async (kind: RunKind, belt: string | null = null): Promise<void> => {
    if (state === "gone") return;
    hud.closeModal();
    let seed: number;
    daily = null;
    trial = belt;
    startedAt = Date.now();
    if (belt) {
      kind = "free";
      seed = beltTrialSeed(belt);
    } else if (kind === "daily") {
      try {
        daily = await host.seeds.daily();
        seed = daily.seed;
      } catch {
        hud.showBanner("daily unavailable", "coral", now(), 1400);
        kind = "free";
        seed = host.seeds.free();
      }
    } else seed = host.seeds.free();
    const startLost = startLostNow();
    cfg = {
      seed: seed >>> 0,
      kind,
      arena: arenaName,
      friend: { front, lost: startLost, familyId: appearance.familyId, goldHeld: friendView().pub.goldHeld },
    };
    sim = simModule.createSim(cfg);
    cur = sim.view();
    prev = cur;
    // Rebuild the scene so the Friend shows its current scars (they may have changed since the last run) and the
    // island matches the sim's arena.
    scene.dispose();
    scene = buildScene(startLost, seed >>> 0, { a: cur.arena.a, b: cur.arena.b });
    stage.scene.add(scene.root);
    log = new InputLog();
    steer.reset();
    warp.reset();
    bestCombo = 0;
    gulpBurped = false;
    endReason = "time";
    results = null;
    lastPhase = -1;
    paused = false;
    resumeAt = 0;
    state = "run";
    coach("run:start");
    audio.cue("run.start");
    audio.music?.play("run", seed);
    audio.music?.setIntensity(PHASE_INTENSITY[0]);
    hud.hint(
      opts.oneSwitch
        ? "press to lock aim · press again to fling"
        : opts.tapTarget
          ? "drag to fling · tap a spot to fling there"
          : "drag to fling · tap to sweep",
    );
  };

  const endRun = (): void => {
    if (!sim || !cfg || !cur || state !== "run") return;
    state = "ending";
    coach("run:end");
    aim = null;
    const summary = sim.summary();
    const inputs = log.inputs;
    const runCfg = cfg;
    const finalView = cur;
    const model = buildResults({
      tokenId: appearance.tokenId,
      mode: host.identity.mode,
      loaned: host.identity.loaned,
      kind: runCfg.kind,
      arena: arenaName,
      gulpMood: finalView.gulp.mood,
      endReason,
      front,
      startLost: runCfg.friend.lost,
      summary,
      bestCombo,
      gulpBurped,
      ...(daily ? { day: daily.day } : {}),
    });
    results = model;
    const report = host.reportResult({
      venueId: VENUE_ID,
      runId: runIdOf(),
      seed: runCfg.seed,
      kind: runCfg.kind,
      inputs: simModule.encodeInputs(inputs),
      claimed: summary,
      startLost: runCfg.friend.lost,
      startedAt,
      ...(trial ? { beltTrial: trial } : {}),
    });
    // Let the end slow-mo play (0.5× for 500 ms), then iris to results.
    setTimeout(() => {
      if (state !== "ending") return;
      hud.iris(() => {
        if (state !== "ending") return;
        state = "results";
        audio.music?.stop({ at: "bar", fade: 1.5 });
        audio.music?.stinger("results");
        showResults(model, report);
      });
    }, 520);
  };

  const showResults = (model: ResultsModel, report: Promise<RunAck>): void => {
    hud.setEdgeBand(null);
    hud.setAim(null, false, time);
    hud.setBrackets([]);
    hud.hint(null);
    const card = hud.openModal(model.headline);
    const row = document.createElement("div");
    row.className = "lp-res";
    const sil = document.createElement("canvas");
    sil.width = 128;
    sil.height = 128;
    const ctx = sil.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#eeeeee";
      ctx.fillRect(0, 0, 128, 128);
      drawSilhouette(ctx, 0, 0, 8, model.share.front, model.share.lost);
    }
    const dl = document.createElement("dl");
    const stat = (k: string, v: string): void => {
      dl.append(Object.assign(document.createElement("dt"), { textContent: k }));
      dl.append(Object.assign(document.createElement("dd"), { textContent: v }));
    };
    stat("kept", `${model.kept}/${model.total} px`);
    stat("score", model.score.toLocaleString("en-US").replace(/,/g, " "));
    stat("best combo", `x${model.bestCombo}`);
    stat("gulp burped", model.gulpBurped ? "yes" : "no");
    stat("grabbed back", String(model.recovered));
    stat("lost", `${model.lostThisRun} (scars)`);
    stat("bits", `+${model.bits}`);
    row.append(sil, dl);
    card.append(row);
    const note = document.createElement("p");
    note.textContent = scarNote(model, null, false);
    card.append(note);
    const runTrial = trial;
    const replayLine = document.createElement("p");
    const setReplay = (ack: RunAck | null, failed: boolean): void => {
      const text = replayNote(model.share.kind, model.share.day, ack, failed, runTrial ?? undefined);
      replayLine.textContent = text ?? "";
      replayLine.hidden = text === null;
    };
    setReplay(null, false);
    card.append(replayLine);
    const btns = document.createElement("div");
    card.append(btns);
    const again = trial;
    hud.button(
      btns,
      again ? "try the trial again" : "play again",
      () => void startRun(cfg?.kind ?? "free", again),
      true,
    );
    hud.button(btns, "share", () => void share(model));
    let regrowBtn: HTMLButtonElement | null = null;
    let quote: EconomyQuote | null = null;
    if (model.cta === "regrow") {
      regrowBtn = hud.button(btns, `regrow ${model.lostThisRun}`, () => void regrow());
      regrowBtn.disabled = true;
      host.economy
        .quote({ kind: "regrow", tokenId: appearance.tokenId, pixels: model.regrowPixels })
        .then((q) => {
          quote = q;
          if (regrowBtn)
            regrowBtn.textContent = `regrow ${model.lostThisRun} · ${formatRf(q.totalMicro)}${q.mode === "sim" ? " (simulated)" : ""}`;
        })
        .catch(() => {
          if (regrowBtn) regrowBtn.textContent = "regrow unavailable";
        });
      const heal = document.createElement("p");
      // Free regrowth: 0.5 px/h (DECISIONS D-04), faster with Gold Pixels.
      const rate = 0.5 * Math.min(2, 1 + 0.25 * friendView().pub.goldHeld);
      heal.textContent = `or heals free in ${formatEta((model.lostThisRun / rate) * 3_600_000)}`;
      card.append(heal);
    } else if (model.cta === "connect") {
      const p = document.createElement("p");
      p.textContent = "bring your own friend: your friend's scars stick — and heal.";
      card.append(p);
    }
    hud.button(btns, "walk into the sky →", () => host.exit("done"));
    const regrow = async (): Promise<void> => {
      if (!regrowBtn || !quote) return;
      regrowBtn.disabled = true;
      try {
        await host.economy.request(quote.action);
        regrowBtn.textContent = "regrown ✓";
        audio.cue("regrow.sparkle");
        note.textContent = "pixels regrown. your friend is whole again.";
      } catch (err) {
        regrowBtn.disabled = false;
        const code = (err as { code?: string }).code;
        note.textContent =
          code === "cancelled"
            ? "regrow cancelled."
            : code === "insufficient_funds"
              ? "not enough RF for that regrow."
              : "regrow failed. try again.";
      }
    };
    report
      .then((ack) => {
        note.textContent = scarNote(model, ack, false);
        setReplay(ack, false);
        if (regrowBtn && ack.applied && quote) regrowBtn.disabled = false;
        else if (regrowBtn && ack.applied)
          // The quote may still be in flight: enable when it lands.
          setTimeout(() => {
            if (regrowBtn && quote) regrowBtn.disabled = false;
          }, 300);
      })
      .catch(() => {
        note.textContent = scarNote(model, null, true);
        setReplay(null, true);
      });
  };

  const share = async (model: ResultsModel): Promise<void> => {
    shareCanvas = renderShareCard(model.share, shareCanvas ?? undefined);
    const blob = await new Promise<Blob | null>((r) => shareCanvas?.toBlob(r, "image/png"));
    if (!blob) return;
    const file = new File([blob], `loose-pixels-${model.share.tokenId}.png`, { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    const data: ShareData = { files: [file], title: "Loose Pixels", text: `${model.score} · ${model.share.rule}` };
    if (nav.canShare?.(data)) {
      try {
        await nav.share(data);
        return;
      } catch {
        // Fall back to a download when the share sheet is dismissed or refused.
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const showStart = (): void => {
    state = "start";
    const card = hud.openModal("loose pixels");
    const p1 = document.createElement("p");
    p1.textContent = "every hit knocks a pixel off. grab it back — or regrow it.";
    const p2 = document.createElement("p");
    p2.textContent = opts.oneSwitch
      ? "one-switch: press to lock the aim, press again to fling."
      : `drag anywhere to fling (opposite to the drag). ${opts.tapTarget ? "tap a spot to fling there" : "tap to sweep"}. keys: ←/→ aim, space charge, ↓ sweep, p pause. pad: stick aims, a flings, start pauses.`;
    card.append(p1, p2);
    if (loaned) {
      const p3 = document.createElement("p");
      p3.textContent = `#${appearance.tokenId} is on loan: its scars reset at 00:00 utc.`;
      card.append(p3);
    }
    const belt = opts.beltTrial;
    if (belt) {
      const p4 = document.createElement("p");
      p4.textContent = `belt trial: ${belt} · same seed for everyone.`;
      card.append(p4);
      hud.button(card, "▶ start trial", () => void startRun("free", belt), true);
      hud.button(card, "free run", () => void startRun("free"));
    } else {
      hud.button(card, "▶ play", () => void startRun("free"), true);
      hud.button(card, "daily run", () => void startRun("daily"));
    }
  };

  // ── Loops ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const unsubInput = stage.input.on(onInput);
  const unsubTick = stage.onTick(() => {
    if (state !== "run" || paused || resumeAt > 0 || !sim || sim.done) return;
    pilotInputs();
    const inputs = log.flush(sim.tick);
    sim.step(inputs);
    const before = cur ?? sim.view();
    prev = before;
    cur = sim.view();
    for (const e of sim.drainEvents()) onEvent(e, before, cur);
    if (cur.phase !== lastPhase) lastPhase = cur.phase;
    if (sim.done) endRun();
  });
  const unsubFrame = stage.onFrame((dt, alpha) => {
    time += dt;
    const t = now();
    // Resume countdown.
    if (resumeAt > 0) {
      const left = resumeAt - t;
      if (left <= 0) {
        resumeAt = 0;
        paused = false;
        hud.setCountdown(0);
        audio.music?.setIntensity(PHASE_INTENSITY[cur?.phase ?? 0] ?? 0.5);
      } else hud.setCountdown(Math.ceil(left / 300));
    }
    // Drop-in 3-2-1 over the first 1.2 s of the run (stepped blocks).
    if (state === "run" && cur && !paused && resumeAt === 0) {
      hud.setCountdown(cur.tick < 72 ? 3 - Math.floor(cur.tick / 24) : 0);
    }
    pollInput(dt);
    let scale = paused || resumeAt > 0 || state !== "run" ? (state === "ending" ? warp.scale(t) : 0) : warp.scale(t);
    // Aim slow-mo: re-aiming while FLYING runs at 0.5× for up to 1 s per aim.
    const flying = body()?.flying ?? false;
    if (aim && flying && state === "run") {
      if (aimSlowLeft > 0) {
        scale = Math.min(scale, reduced ? 0.6 : 0.5);
        aimSlowLeft -= dt;
      }
    } else if (!aim) aimSlowLeft = 1;
    stage.timeScale = scale;
    const slow = scale > 0 && scale < 1 ? 1 : 0;
    if (slow !== musicSlow) {
      musicSlow = slow;
      audio.music?.setSlowmo(slow);
      if (!slow) audio.cue("slowmo.out");
    }
    if (!cur || !prev) return;
    scene.sync(prev, cur, state === "run" ? alpha : 1, time, dt * scale);
    const gulpUp = cur.gulp.phase >= 1 && cur.gulp.phase <= 4;
    // Camera: lerp(islandCentre, friend + v·0.12 s, 0.35); dolly out during Old Gulp.
    const b = body();
    if (b && state !== "results") {
      // While Old Gulp is up the camera favours the island centre so the whale and the whole rim stay in frame.
      // Portrait: the readability clamp (≥ 3 px per sprite pixel) can't fit the whole island in the width, so the camera
      // leans harder toward the Friend to keep it (the thing you steer) on screen.
      const portrait = canvas.clientWidth < canvas.clientHeight;
      const k = reduced ? 0.15 : gulpUp ? 0.12 : portrait ? 0.55 : 0.35;
      stage.rig.follow(tmp.set((b.x + b.vx * 0.12) * U * k, 0, (b.z + b.vz * 0.12) * U * k + CAM_Z));
    }
    // Old Gulp: dolly out 12 % over 0.6 s (GDD §2.4), none under reduced motion (the static framing fits).
    const wantDist = pose.distance * (gulpUp && !reduced ? 1.12 : 1);
    stage.rig.pose.distance += (wantDist - stage.rig.pose.distance) * Math.min(1, dt / 0.6);
    // HUD.
    const f = cur.friend;
    let present = 0;
    for (let i = 0; i < 256; i++) if (f.pixels[i] === PX.body) present++;
    let urgent: number | null = null;
    let frozen = false;
    for (const d of cur.debris) {
      if (d.carriedBy >= 0) frozen = true;
      if (urgent === null || d.left < urgent) urgent = d.left;
    }
    hud.update({
      tick: cur.tick,
      score: cur.score,
      chain: f.chain,
      present,
      total,
      pixels: f.pixels,
      loose: cur.debris.length,
      urgent,
      frozen,
      time,
      paused,
    });
    if (state === "run" || state === "ending") {
      const a = cur.arena;
      hud.setBrackets(
        cur.debris.map((d) => {
          const edge = (d.x / a.a) ** 2 + (d.z / a.b) ** 2 > 0.72 || d.y < 0;
          const blinkOff = d.left <= 36 && !reduced && Math.floor(time * 8) % 2 === 1;
          return {
            p: projectSim(d.x, d.z, Math.max(0, d.y) + 0.5),
            off: blinkOff,
            safety: d.safety,
            tag: d.carriedBy >= 0 ? "" : edge ? "edge!" : "",
          };
        }),
      );
      const byId = new Map(cur.creatures.map((c) => [c.id, c] as const));
      hud.moveBubbles((id) => {
        if (id === GULP_BUBBLE) return projectSim(cur?.gulp.mouthX ?? 0, cur?.gulp.mouthZ ?? 0, 14);
        const c = byId.get(id);
        return c ? projectSim(c.x, c.z, c.y + (c.kind === KIND.snatch ? 5 : 6)) : null;
      }, t);
      // Aim preview: 8 dots over the first 0.5 s, from the Friend along the aim.
      if (aim && b && aim.p > 0 && (f.ready || aim.from !== "drag" || flying)) {
        const dir = dirFromAngle(aim.ang);
        const pts = previewPoints(b.x, b.z, dir.x, dir.z, previewDistances(aim.p, Math.max(1, present)), a.a, a.b);
        hud.setAim(
          pts.map((q) => projectSim(q.x, q.z, 0.3)),
          aim.p >= 1,
          time,
        );
      } else hud.setAim(null, false, time);
    }
    hud.frame(t);
  });

  if (opts.autoStart) await startRun(opts.autoStart, opts.beltTrial ?? null);
  else showStart();

  const instance: LoosePixelsInstance = {
    pause(p) {
      setPaused(p);
    },
    resize() {
      // The stage observes its canvas; the DOM HUD is fluid.
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
      disposePlaceholderCreatures();
      stage.rig.pose = saved.pose;
      stage.rig.followRate = saved.follow;
      stage.rig.minVisibleWidth = saved.minW;
      stage.timeScale = saved.timeScale;
    },
    debug: {
      advance: (ticks) => {
        if (!sim || state !== "run") return;
        for (let i = 0; i < ticks && !sim.done; i++) {
          pilotInputs();
          sim.step(log.flush(sim.tick));
          sim.drainEvents();
          cur = sim.view();
        }
        cur = sim.view();
        prev = cur;
        if (sim.done) endRun();
      },
      autopilot: (profile, seed = 1) => {
        pilot = profile ? createBot(BOT_PROFILES[profile], seed) : null;
      },
      state: () => state,
      view: () => cur,
      results: () => results,
      start: (kind, belt) => startRun(kind, belt ?? null),
      fling: (ang, p) => fire(ang, p),
      shareCanvas: () => {
        if (!results) return null;
        shareCanvas = renderShareCard(results.share, shareCanvas ?? undefined);
        return shareCanvas;
      },
    },
  };
  return instance;
}
