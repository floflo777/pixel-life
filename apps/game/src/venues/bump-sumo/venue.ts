/**
 * Bump Sumo (venue id `bump-sumo`): your voxel Friend against three real loaner Friends on a small floating ring. Walk,
 * hold to charge, release to shove; every shove knocks pixels off and pixels are weight, so a battered Friend flies
 * farther. Last Friend on the ring wins the round; three rounds a match (about a minute). Scarless and RF-free: the
 * venue only reports a result so the Sky can credit Bits (`affectsScars: false`).
 *
 * The venue owns the match loop only (venue-kit contract): the deterministic sim from `@pl/shared` steps on the stage's
 * fixed 60 Hz tick with the recorded player inputs; the scene interpolates; sim events become juice, audio and HUD.
 */
import { Vector3 } from "three";
import {
  createSumo,
  EMPTY_MASK,
  effectiveLost,
  encodeSumoInputs,
  and,
  frontMask,
  SumoFighterState,
  SumoPhase,
  SumoTuning,
  type FriendAppearance,
  type Hex64,
  type RunAck,
  type SumoEvent,
  type SumoSim,
  type SumoView,
} from "@pl/shared";
import type { NativeVenue, VenueHost, VenueInstance, VenueManifest } from "@pl/venue-kit";
import type { OrbitPose } from "../../stage/camera-rig";
import type { InputEvent } from "../../stage/input";
import type { SharedStage as GameStage } from "../../stage/stage";
import { RunAudio, type VenueAudioExt } from "../pixel-life/audio";
import { TimeWarp, type JuicePlan } from "../pixel-life/juice";
import { InputRecorder, PointerStick, stickFromAxis, type ControlState } from "./controls";
import {
  buildSumoResults,
  FIGHTER_COLORS,
  FIGHTER_CSS,
  fighterLabel,
  pickRivals,
  roundEndBanner,
  sumoPlan,
  type SumoBeat,
  type SumoResults,
} from "./format";
import { drawPixels, SumoHud, type ScreenPoint } from "./hud";
import { SUMO_PITCH_DEG, SumoScene, U } from "./scene";

/** Stable venue id (hub door, results, leaderboards). */
export const VENUE_ID = "bump-sumo";

const THUMB = [
  "................",
  "................",
  "..##........##..",
  ".####......####.",
  ".####.#..#.####.",
  "..##..####..##..",
  ".####.####.####.",
  "######.##.######",
  ".####......####.",
  ".#..#......#..#.",
  "................",
  "..############..",
  ".#............#.",
  ".#............#.",
  "..############..",
  "................",
].join("\n");

/** The hub door description: scarless, no RF sinks, ranked by score. */
export const MANIFEST: VenueManifest = {
  id: VENUE_ID,
  name: "Bump Sumo",
  version: "0.1.0",
  kind: "native",
  room: "plaza",
  requires: { ownedFriend: false },
  economy: { sinks: [] },
  results: { leaderboard: "score-desc", affectsScars: false },
  thumbnail: THUMB,
};

/** Options when building the venue. */
export interface BumpSumoOptions {
  /**
   * The rival pool: real loaner Friends (the shell passes `@pl/assets` loaners), as a list or an async loader. Three are
   * picked per match (never the player's own token, distinct families first).
   */
  readonly rivals: readonly FriendAppearance[] | (() => Promise<readonly FriendAppearance[]>);
  /** Bot skill 0..2 (default 1); bots also sharpen a little every round. */
  readonly botLevel?: 0 | 1 | 2;
  /** Skip the start card and begin a match right away. */
  readonly autoStart?: boolean;
  /** Accessibility: no full-frame impact inversions. */
  readonly noFlashes?: boolean;
  /** Clock for juice timers (tests). Defaults to `performance.now()`. */
  readonly now?: () => number;
}

/** Debug handle the dev page and capture script read; not part of the venue contract. */
export interface BumpSumoDebug {
  readonly state: () => string;
  readonly view: () => SumoView | null;
  readonly results: () => SumoResults | null;
  readonly start: () => Promise<void>;
  /** Overrides the player's controls (capture tooling); null gives control back to the devices. */
  readonly drive: (c: ControlState | null) => void;
  /** Fast-forwards the sim by `ticks` using the current controls (events drained silently). */
  readonly advance: (ticks: number) => void;
}

/** A mounted Bump Sumo instance. */
export interface BumpSumoInstance extends VenueInstance {
  readonly debug: BumpSumoDebug;
}

type State = "loading" | "error" | "start" | "run" | "ending" | "results" | "gone";

function runIdOf(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `sumo-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Builds the Bump Sumo venue. */
export function createBumpSumoVenue(opts: BumpSumoOptions): NativeVenue<GameStage> {
  return { manifest: MANIFEST, mount: async (host) => mountVenue(host, opts) };
}

async function mountVenue(host: VenueHost<GameStage>, opts: BumpSumoOptions): Promise<BumpSumoInstance> {
  const stage = host.stage;
  const now = opts.now ?? (() => performance.now());
  const audio = new RunAudio(host.audio as VenueAudioExt);
  const reduced = host.reducedMotion;
  const canvas = stage.renderer.domElement;
  const parent = canvas.parentElement ?? document.body;

  // ── Take over the shared stage (restored on unmount) ───────────────────────────────────────────────────────────────
  const saved = {
    pose: { ...stage.rig.pose },
    follow: stage.rig.followRate,
    minW: stage.rig.minVisibleWidth,
    timeScale: stage.timeScale,
  };
  const pose: OrbitPose = { yaw: 0, pitch: SUMO_PITCH_DEG, distance: 26, fov: 29 };
  stage.rig.pose = { ...pose };
  stage.rig.followRate = reduced ? 1.5 : 4;
  stage.rig.minVisibleWidth = 14;
  stage.setAccess({ reducedMotion: reduced, noFlashes: opts.noFlashes ?? false });
  stage.rig.snap(new Vector3(0, 0, -0.5));

  // ── Identity ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const friendView = () => host.identity.friend;
  const appearance = friendView().appearance;
  const front = frontMask(appearance);
  const loaned = host.identity.loaned || host.identity.mode === "guest";
  const startLostNow = (): Hex64 =>
    and(
      effectiveLost(friendView().pub.scars, Date.now(), appearance.tokenId, { goldHeld: friendView().pub.goldHeld }),
      front,
    );

  // ── State ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  let state: State = "loading";
  let pool: readonly FriendAppearance[] = [];
  let lineup: FriendAppearance[] = [];
  let seed = 0;
  let sim: SumoSim | null = null;
  let prev: SumoView | null = null;
  let cur: SumoView | null = null;
  let scene: SumoScene | null = null;
  let hud: SumoHud | null = null;
  let recorder = new InputRecorder();
  let results: SumoResults | null = null;
  let paused = false;
  let resumeAt = 0;
  let time = 0;
  let driven: ControlState | null = null;
  let control: ControlState = { move: false, dir: 0, charge: false };
  let shoveHeld = false;
  let wasPressed = false;
  let pointerCharged = false;
  let stickAt: ScreenPoint = null;
  let lastChargeStep = 0;
  let hintShown = false;
  let bumpCueAt = 0;
  const pointer = new PointerStick();
  const warp = new TimeWarp(reduced);
  const tmp = new Vector3();
  const tmp2 = new Vector3();

  const project = (v: Vector3): ScreenPoint => {
    const p = tmp2.copy(v).project(stage.camera);
    if (p.z > 1) return null;
    return { x: ((p.x + 1) / 2) * canvas.clientWidth, y: ((1 - p.y) / 2) * canvas.clientHeight };
  };
  const projectSim = (x: number, z: number, h = 0): ScreenPoint => project(tmp.set(x * U, h * U, z * U));
  const headOf = (slot: number, h = 19): ScreenPoint => {
    const p = scene?.fighterPos(slot);
    return p ? project(tmp.copy(p).setY(p.y + h * U)) : null;
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
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      stage.post.impacts.requestBurst(
        at.x * (stage.post.stats.internalWidth / w),
        (h - at.y) * (stage.post.stats.internalHeight / h),
      );
    }
  };
  const beat = (b: SumoBeat, at?: ScreenPoint): void => juice(sumoPlan(b), at);
  const pan = (x: number, z: number): number => {
    const p = projectSim(x, z);
    return p ? Math.min(1, Math.max(0, p.x / (canvas.clientWidth || 1))) : 0.5;
  };
  const say = (text: string, tone: "paper" | "lime" | "coral", slot: number, life = 800): void => {
    hud?.callout(text, tone, () => headOf(slot, 21), now(), life);
  };

  // ── Events ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const onEvents = (events: readonly SumoEvent[], view: SumoView): void => {
    const lostBy = new Map<number, number>();
    const backBy = new Map<number, number>();
    let popCue = false;
    for (const e of events) {
      const x = e.x ?? 0;
      const z = e.z ?? 0;
      const a = e.a ?? -1;
      const b = e.b ?? -1;
      switch (e.type) {
        case "ready":
          hud?.showBanner(`round ${a + 1}`, "paper", now(), 950, a === 2 ? "final round" : undefined);
          hud?.setRound(a, view.roundWinners);
          audio.cue("run.count");
          audio.music?.setIntensity([0.35, 0.55, 0.8][a] ?? 0.5);
          break;
        case "fight":
          hud?.showBanner("fight!", "lime", now(), 700);
          audio.cue("run.start");
          if (!hintShown) {
            hintShown = true;
            hud?.hint(
              matchMedia("(pointer: coarse)").matches
                ? "drag to walk · hold still or SHOVE to charge · tap to dodge"
                : "wasd walk · hold space, let go to shove · tap space to dodge",
            );
            setTimeout(() => hud?.hint(null), 6000);
          }
          break;
        case "shove":
          audio.cue("fling.release", { gain: 0.45 + ((e.n ?? 0) / 1023) * 0.55, x: pan(x, z) });
          lastChargeStep = 0;
          break;
        case "dodge":
          audio.cue("emote.hop", { gain: 0.5, x: pan(x, z) });
          if (a === 0) say("dodge", "paper", 0, 500);
          break;
        case "hit": {
          const p = (e.n ?? 0) / 1023;
          const mine = a === 0 || b === 0;
          beat({ kind: "hit", power: p, mine }, projectSim(x, z, 6));
          scene?.squash(b, time);
          scene?.burst(
            x,
            z,
            [FIGHTER_COLORS[b] ?? 0xeeeeee, 0x111111, 0xeeeeee],
            4 + Math.round(p * 8),
            6,
            2.5 + p * 3,
          );
          audio.cue(p >= 0.85 ? "smash.clank" : "bonk.shell", { x: pan(x, z), gain: 0.7 + p * 0.3 });
          if (p >= 0.85) say(a === 0 ? "dosukoi!" : "oof!", a === 0 ? "lime" : "paper", b, 700);
          break;
        }
        case "clash":
          beat({ kind: "clash", mine: a === 0 || b === 0 }, projectSim(x, z, 6));
          scene?.burst(x, z, [0xf2ce68, 0x111111, 0xeeeeee], 12, 6, 5);
          audio.cue("smash.clank", { x: pan(x, z) });
          hud?.callout("clash!", "paper", () => projectSim(x, z, 16), now(), 700);
          break;
        case "bump":
          if (now() - bumpCueAt > 120) {
            bumpCueAt = now();
            beat({ kind: "bump" });
            audio.cue("bonk.rim", { x: pan(x, z), gain: Math.min(0.6, (e.n ?? 12) / 60) });
          }
          break;
        case "parry":
          beat({ kind: "parry", mine: a === 0 || b === 0 }, projectSim(x, z, 6));
          audio.cue("gold.glance", { x: pan(x, z) });
          say("parry!", "lime", a, 800);
          break;
        case "pixelOff":
          lostBy.set(a, (lostBy.get(a) ?? 0) + 1);
          popCue = true;
          break;
        case "pixelBack":
          if (e.n === 1) {
            backBy.set(a, (backBy.get(a) ?? 0) + 1);
            audio.cue(a === 0 ? "pixel.clutch" : "pixel.sweep", { x: pan(x, z), gain: a === 0 ? 0.9 : 0.35 });
          }
          break;
        case "pixelGone":
          if (e.n === 1) audio.cue("pixel.fall", { x: pan(x, z), gain: 0.35 });
          break;
        case "hover":
          say("glide!", "paper", a, 700);
          audio.cue("emote.hop", { x: pan(x, z) });
          break;
        case "ringout": {
          const mine = a === 0 || b === 0;
          beat({ kind: "ringout", mine });
          audio.cue("ringout", { x: pan(x, z) });
          if (a === 0) hud?.showBanner("ring out!", "coral", now(), 1300, "you're out this round");
          else if (b === 0) hud?.showBanner("ring out!", "lime", now(), 1100, `+${SumoTuning.SCORE_KO}`);
          else hud?.showBanner("ring out!", "paper", now(), 900);
          break;
        }
        case "quake":
          beat({ kind: "quake" });
          audio.cue("emote.stomp", { x: pan(x, z) });
          say("dosukoi!", "lime", a, 800);
          scene?.burst(x, z, [0xe6e1d2, 0xd9d4c6, 0x111111], 14, 1, 4);
          break;
        case "shrink":
          hud?.showBanner("the ring shrinks!", "coral", now(), 1000);
          audio.cue("gulp.rumble", { gain: 0.5 });
          audio.music?.setIntensity(1);
          break;
        case "roundEnd": {
          beat({ kind: "roundEnd" });
          const bn = roundEndBanner(a, b);
          hud?.showBanner(bn.text, bn.tone, now(), 1600);
          hud?.setRound(b, view.roundWinners);
          audio.cue(a === 0 ? "regrow.sparkle" : "run.end");
          break;
        }
        case "matchEnd":
          endMatch();
          break;
        default:
          break;
      }
    }
    if (popCue) audio.cue("pixel.pop", { gain: 0.8 });
    for (const [slot, n] of lostBy) say(`-${n}px`, "coral", slot, 800);
    for (const [slot, n] of backBy) if (slot === 0) say(`+${n}px`, "lime", slot, 600);
  };

  // ── Input ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const canPlay = (): boolean => state === "run" && !paused && resumeAt === 0 && sim !== null && !sim.done;
  const onInput = (e: InputEvent): void => {
    if (e.type === "key") {
      if (e.down && (e.code === "KeyP" || e.code === "Escape")) {
        if (state === "run") setPaused(!paused);
      }
      return;
    }
    if (e.type === "tap" || e.type === "dragstart")
      hud?.setTouch(e.kind !== "mouse" || matchMedia("(pointer: coarse)").matches);
    if (!canPlay()) return;
    switch (e.type) {
      case "dragstart":
        stickAt = { x: e.start.x, y: e.start.y };
        pointer.drag(0, 0);
        break;
      case "drag":
        pointer.drag(e.vector.x, e.vector.y);
        hud?.setStick(stickAt, e.vector.x, e.vector.y);
        break;
      case "tap":
        // A quick tap side-steps (the sim reads a very short charge as a dodge) unless the press already charged.
        if (!pointerCharged) recorder.pulse();
        break;
      case "dragend":
      case "cancel":
        stickAt = null;
        hud?.setStick(null);
        break;
    }
  };

  /** Merges keyboard, pointer and the SHOVE button into this frame's control state. */
  const pollControls = (): void => {
    const inp = stage.input;
    const t = now();
    if (inp.pressed && !wasPressed) {
      pointer.press(t);
      pointerCharged = false;
    } else if (!inp.pressed && wasPressed) pointer.release();
    wasPressed = inp.pressed;
    if (!canPlay()) return;
    if (driven) {
      control = driven;
      return;
    }
    const ax = inp.axis();
    const keyStick = stickFromAxis(ax.x, ax.y);
    const ptrStick = pointer.stick();
    const stick = keyStick.move ? keyStick : ptrStick;
    const ptrCharge = pointer.charging(t);
    if (ptrCharge) pointerCharged = true;
    const charge = inp.isKeyDown("Space") || inp.isKeyDown("KeyJ") || inp.isKeyDown("KeyK") || shoveHeld || ptrCharge;
    control = { move: stick.move, dir: stick.move ? stick.dir : control.dir, charge };
  };

  const onShoveDown = (e: PointerEvent): void => {
    e.preventDefault();
    hud?.shoveBtn.setPointerCapture(e.pointerId);
    shoveHeld = true;
    hud?.setShoveHeld(true);
  };
  const onShoveUp = (): void => {
    shoveHeld = false;
    hud?.setShoveHeld(false);
  };

  // ── Pause ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const setPaused = (p: boolean): void => {
    if (state !== "run" || !hud) return;
    if (p === paused && !(p === false && resumeAt > 0)) return;
    if (p) {
      paused = true;
      resumeAt = 0;
      shoveHeld = false;
      audio.music?.setIntensity(0.1);
      const body = hud.openModal("paused");
      body.append(Object.assign(document.createElement("p"), { textContent: "the bout is frozen." }));
      hud.button(body, "▶ resume", () => setPaused(false), true);
      hud.button(body, "quit bout", () => host.exit("quit"));
    } else if (paused && resumeAt === 0) {
      hud.closeModal();
      resumeAt = now() + 600;
    }
  };
  const unsubPause = host.paused.subscribe((p) => setPaused(p));
  const onBlur = (): void => setPaused(true);
  window.addEventListener("blur", onBlur);

  // ── Match lifecycle ───────────────────────────────────────────────────────────────────────────────────────────────
  const buildLineup = (): void => {
    seed = host.seeds.free() >>> 0;
    const rivals = pickRivals(pool, appearance.tokenId, seed);
    lineup = [appearance, ...rivals];
  };

  const buildScene = (startLost: Hex64): void => {
    scene?.dispose();
    hud?.dispose();
    const probe = createSumo(configFor(startLost));
    const radii = probe.view().fighters.map((f) => f.radius);
    scene = new SumoScene({
      appearances: lineup,
      startLost: [startLost],
      radii,
      reducedMotion: reduced,
    });
    stage.scene.add(scene.root);
    hud = new SumoHud(
      parent,
      lineup.map((a, i) => fighterLabel(i, a)),
      reduced,
    );
    hud.pauseBtn.addEventListener("click", () => setPaused(true));
    hud.shoveBtn.addEventListener("pointerdown", onShoveDown);
    hud.shoveBtn.addEventListener("pointerup", onShoveUp);
    hud.shoveBtn.addEventListener("pointercancel", onShoveUp);
    hud.shoveBtn.addEventListener("lostpointercapture", onShoveUp);
    hud.setTouch(matchMedia("(pointer: coarse)").matches);
    cur = probe.view();
    prev = cur;
    hud.setCards(cardStates(cur));
    hud.setRound(0, []);
  };

  const configFor = (startLost: Hex64) => ({
    seed,
    botLevel: opts.botLevel ?? 1,
    fighters: lineup.map((a, i) => ({
      front: frontMask(a),
      lost: i === 0 ? startLost : EMPTY_MASK,
      familyId: a.familyId,
    })),
  });

  const cardStates = (v: SumoView) =>
    v.fighters.map((f) => ({
      present: f.present,
      total: f.total,
      wins: f.wins,
      out: f.state === SumoFighterState.Out || f.state === SumoFighterState.Falling,
      pixels: f.pixels,
    }));

  const startMatch = async (): Promise<void> => {
    if (state === "gone" || state === "loading" || state === "error") return;
    if (state === "results" || !scene) {
      buildLineup();
      buildScene(startLostNow());
    }
    hud?.closeModal();
    const startLost = startLostNow();
    sim = createSumo(configFor(startLost));
    cur = sim.view();
    prev = cur;
    recorder = new InputRecorder();
    results = null;
    paused = false;
    resumeAt = 0;
    warp.reset();
    control = { move: false, dir: 0, charge: false };
    state = "run";
    audio.music?.play("run", seed);
  };

  const endMatch = (): void => {
    if (!sim || state !== "run") return;
    state = "ending";
    const summary = sim.summary();
    const stats = sim.stats();
    const model = buildSumoResults(stats, summary.score);
    results = model;
    const final = cur;
    const report = host.reportResult({
      venueId: VENUE_ID,
      runId: runIdOf(),
      seed,
      kind: "free",
      inputs: encodeSumoInputs(recorder.inputs),
      claimed: summary,
    });
    setTimeout(
      () => {
        if (state !== "ending") return;
        state = "results";
        audio.music?.stop({ at: "bar", fade: 1.2 });
        audio.music?.stinger("results");
        showResults(model, report, final);
      },
      reduced ? 300 : 900,
    );
  };

  const rosterEl = (v: SumoView | null, placeOf?: (slot: number) => number): HTMLElement => {
    const grid = document.createElement("div");
    grid.className = "bs-roster";
    lineup.forEach((a, i) => {
      const cell = document.createElement("div");
      cell.style.borderColor = "#111";
      cell.style.background = i === 0 ? FIGHTER_CSS[0] : "#eee";
      const c = document.createElement("canvas");
      const px = v?.fighters[i]?.pixels;
      if (px) drawPixels(c, px, 3);
      const l = fighterLabel(i, a);
      const place = placeOf ? `${placeOf(i)}. ` : "";
      cell.append(c, Object.assign(document.createElement("div"), { textContent: `${place}${l.name}` }));
      cell.append(Object.assign(document.createElement("div"), { textContent: `${l.family} · ${l.trait}` }));
      const strip = document.createElement("b");
      strip.style.cssText = `display:block;height:4px;background:${FIGHTER_CSS[i] ?? "#eee"};margin-top:3px`;
      cell.append(strip);
      grid.append(cell);
    });
    return grid;
  };

  const showResults = (model: SumoResults, report: Promise<RunAck>, final: SumoView | null): void => {
    if (!hud) return;
    hud.hint(null);
    hud.setChip(null);
    hud.setMeter(null, 0);
    const card = hud.openModal(model.headline);
    card.classList.add("bs-res");
    const order = final
      ? final.fighters
          .map((f, i) => ({ i, f }))
          .sort((p, q) => q.f.wins - p.f.wins || q.f.kos - p.f.kos || q.f.present - p.f.present || p.i - q.i)
          .map((o) => o.i)
      : [0, 1, 2, 3];
    card.append(rosterEl(final, (slot) => order.indexOf(slot) + 1));
    const dl = document.createElement("dl");
    for (const [k, v] of model.stats) {
      dl.append(Object.assign(document.createElement("dt"), { textContent: k }));
      dl.append(Object.assign(document.createElement("dd"), { textContent: v }));
    }
    const bitsDd = Object.assign(document.createElement("dd"), { textContent: `+${model.bitsEstimate} (est.)` });
    dl.append(Object.assign(document.createElement("dt"), { textContent: "bits" }), bitsDd);
    card.append(dl);
    card.append(Object.assign(document.createElement("p"), { textContent: model.scarNote }));
    const btns = document.createElement("div");
    card.append(btns);
    hud.button(btns, "rematch", () => void startMatch(), true);
    hud.button(btns, "walk into the sky →", () => host.exit("done"));
    report
      .then((ack) => {
        if (typeof ack.bits === "number") bitsDd.textContent = `+${ack.bits}`;
        else if (loaned) bitsDd.textContent = `+${model.bitsEstimate} (sign in to keep them)`;
      })
      .catch(() => {
        bitsDd.textContent = "not saved (offline)";
      });
  };

  const showStart = (): void => {
    if (!hud) return;
    state = "start";
    const card = hud.openModal("bump sumo");
    const p = (t: string) => card.append(Object.assign(document.createElement("p"), { textContent: t }));
    p("shove the other friends off the ring. last friend standing wins the round. best of three.");
    card.append(rosterEl(cur));
    p("pixels are weight: every shove knocks a few off, and the fewer you have, the farther you fly. grab yours back!");
    const ul = document.createElement("ul");
    for (const t of [
      "walk: wasd / arrows · or drag",
      "shove: hold space (or hold still, or the SHOVE button), let go",
      "dodge: tap space · tap the ring",
      "pause: p",
    ])
      ul.append(Object.assign(document.createElement("li"), { textContent: t }));
    card.append(ul);
    p(
      `scarless: every pixel comes home after the bout.${loaned ? ` #${appearance.tokenId} is on loan.` : ""} no RF in play.`,
    );
    hud.button(card, "▶ fight", () => void startMatch(), true);
    hud.button(card, "back to the sky", () => host.exit("quit"));
  };

  const loadPool = async (): Promise<void> => {
    state = "loading";
    try {
      pool = typeof opts.rivals === "function" ? await opts.rivals() : opts.rivals;
      buildLineup();
      buildScene(startLostNow());
      state = "start";
      if (opts.autoStart) await startMatch();
      else showStart();
    } catch (err) {
      state = "error";
      console.warn("bump-sumo: rivals unavailable", err);
      const errHud = hud ?? new SumoHud(parent, [], reduced);
      hud = errHud;
      const card = errHud.openModal("no rivals yet");
      card.append(
        Object.assign(document.createElement("p"), {
          textContent: "couldn't load the loaner friends. check the connection.",
        }),
      );
      errHud.button(card, "retry", () => void loadPool(), true);
      errHud.button(card, "back to the sky", () => host.exit("quit"));
    }
  };

  // ── Loops ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const stepOnce = (): void => {
    if (!sim) return;
    recorder.sample(sim.tick, canPlay() ? control : { move: false, dir: control.dir, charge: false });
    const inputs = recorder.inputs;
    const last = inputs[inputs.length - 1];
    sim.step(last && last.t === sim.tick ? [last] : []);
    prev = cur;
    cur = sim.view();
    const events = sim.drainEvents();
    if (events.length) onEvents(events, cur);
  };
  const unsubInput = stage.input.on(onInput);
  const unsubTick = stage.onTick(() => {
    if (state !== "run" || paused || resumeAt > 0 || !sim || sim.done) return;
    const before = cur;
    stepOnce();
    // Out of the round: watch the rest at double speed.
    const me = cur?.fighters[0];
    if (me && me.state === SumoFighterState.Out && cur?.phase === SumoPhase.Fight && !sim.done) stepOnce();
    if (before) prev = before;
  });
  const unsubFrame = stage.onFrame((dt, alpha) => {
    time += dt;
    const t = now();
    if (resumeAt > 0 && t >= resumeAt) {
      resumeAt = 0;
      paused = false;
    }
    pollControls();
    const scale = state === "run" && !paused && resumeAt === 0 ? warp.scale(t) : state === "ending" ? 0.5 : 0;
    stage.timeScale = scale;
    audio.music?.setSlowmo(scale > 0 && scale < 1 ? 1 : 0);
    if (!scene || !cur || !prev || !hud) return;
    const hot = cur.phase === SumoPhase.Fight && cur.phaseTicks >= SumoTuning.SHRINK_START;
    scene.sync(prev, cur, state === "run" ? alpha : 1, time, dt * scale, hot);
    // Camera: the ring stays framed; drift a little toward you.
    const me = cur.fighters[0];
    // Portrait phones cannot fit the whole ring at a readable voxel size: keep your Friend centred instead.
    const k = canvas.clientWidth < canvas.clientHeight ? 0.75 : 0.22;
    if (me && me.state !== SumoFighterState.Out) stage.rig.follow(tmp.set(me.x * U * k, 0, me.z * U * k - 0.5));
    else stage.rig.follow(tmp.set(0, 0, -0.5));
    hud.setCards(cardStates(cur));
    const steps = me ? Math.round(me.charge * SumoTuning.CHARGE_BLOCKS) : 0;
    if (steps > lastChargeStep) audio.cue("fling.charge", { step: steps });
    lastChargeStep = steps;
    hud.setMeter(state === "run" ? headOf(0, 22) : null, steps);
    const watching = me?.state === SumoFighterState.Out && cur.phase === SumoPhase.Fight && state === "run";
    hud.setChip(watching ? "you're out · watching ×2" : null);
    hud.frame(t);
  });

  await loadPool();

  const instance: BumpSumoInstance = {
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
      hud?.dispose();
      scene?.dispose();
      stage.rig.pose = saved.pose;
      stage.rig.followRate = saved.follow;
      stage.rig.minVisibleWidth = saved.minW;
      stage.timeScale = saved.timeScale;
    },
    debug: {
      state: () => state,
      view: () => cur,
      results: () => results,
      start: () => startMatch(),
      drive: (c) => {
        driven = c;
        if (c) control = c;
      },
      advance: (ticks) => {
        if (!sim || state !== "run") return;
        for (let i = 0; i < ticks && !sim.done; i++) {
          recorder.sample(sim.tick, control);
          const last = recorder.inputs[recorder.inputs.length - 1];
          sim.step(last && last.t === sim.tick ? [last] : []);
          const ev = sim.drainEvents();
          if (ev.some((e) => e.type === "matchEnd")) {
            cur = sim.view();
            endMatch();
          }
        }
        cur = sim.view();
        prev = cur;
      },
    },
  };
  return instance;
}
