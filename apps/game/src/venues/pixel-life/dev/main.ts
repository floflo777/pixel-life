/**
 * Loose Pixels dev page: mounts the venue on a real stage with an in-memory host (venue-kit test host rules: sim economy,
 * guest/owner identity, local seeds) and the `@pl/audio` engine. Query params:
 * `owner=1` (own Friend, regrow CTA), `token=<id>` (fixture Friend), `auto=free|daily` (skip the start card),
 * `oneswitch=1`, `reduced=1`, `noflash=1`, `quality=low|medium|high`, `seed=<n>`, `mute=1`.
 */
import { AudioEngine, CUES, type CueName } from "@pl/audio";
import { type FriendView, type RunKind } from "@pl/shared";
import { createSignal, createTestVenueHost, type VenueHost } from "@pl/venue-kit";
import { FIXTURE_FRIENDS } from "../../../friend/dev/fixtures";
import { createStage, type SharedStage } from "../../../stage/stage";
import type { QualityTier } from "../../../stage/quality";
import { DAY_SKY } from "../../../post/post-pipeline";
import type { VenueAudioExt } from "../audio";
import { FAKE_SIM } from "../fake-sim";
import { createLoosePixelsVenue, type LoosePixelsInstance } from "../venue";

const q = new URLSearchParams(location.search);
const flag = (k: string): boolean => q.get(k) === "1";

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
if (!canvas) throw new Error("missing #stage canvas");
const quality = q.get("quality") as QualityTier | null;
const reducedMotion = flag("reduced") || matchMedia("(prefers-reduced-motion: reduce)").matches;
const stage: SharedStage = createStage(canvas, {
  reducedMotion,
  noFlashes: flag("noflash"),
  preserveDrawingBuffer: true,
  ...(quality ? { quality } : {}),
});
stage.post.setSky(DAY_SKY);

// Identity: a real loaner Friend (guest), or the same Friend as an owner.
const token = q.get("token") ?? "344030";
const appearance = FIXTURE_FRIENDS.find((f) => f.tokenId === token) ?? FIXTURE_FRIENDS[0];
if (!appearance) throw new Error("no fixture friends");
const owner = flag("owner");
const now = Date.now();
const friend: FriendView = {
  appearance,
  pub: {
    tokenId: appearance.tokenId,
    scars: { lost: "0".repeat(64), updatedAt: now, version: 0 },
    goldHeld: 0,
    glowCracks: 0,
    streak: 0,
    lastSeen: now,
    economy: "sim",
  },
  loaned: !owner,
};
const seed = Number(q.get("seed") ?? "") || undefined;
const harness = createTestVenueHost({
  identity: { mode: owner ? "owner" : "guest", friend, loaned: !owner },
  startTime: now,
  ...(seed !== undefined ? { freeSeed: seed, dailySeed: { day: "2026-09-30", seed, endsAt: now + 3_600_000 } } : {}),
});

// Audio: the engine unlocks on the first gesture; mute is persisted like the shell does.
const engine = new AudioEngine({ muted: flag("mute") || localStorage.getItem("lp-mute") === "1" });
engine.unlockOnGesture(window);
const muted = createSignal(engine.muted);
addEventListener("keydown", (e) => {
  if (e.code !== "KeyM") return;
  engine.setMuted(!engine.muted);
  muted.set(engine.muted);
  localStorage.setItem("lp-mute", engine.muted ? "1" : "0");
});
const isCue = (c: string): c is CueName => c in CUES;
const audio: VenueAudioExt = {
  play(cue, o) {
    if (isCue(cue)) engine.play(cue, o?.volume !== undefined ? { gain: o.volume } : {});
  },
  playWith(cue, p) {
    if (isCue(cue)) engine.play(cue, p);
  },
  muted: muted.signal,
  music: {
    play: (theme, s) => engine.music.play(theme, s),
    stop: (o) => engine.music.stop(o),
    setIntensity: (v) => engine.music.setIntensity(v),
    setMood: (m) => engine.music.setMood(m),
    setSlowmo: (a) => engine.music.setSlowmo(a),
    stinger: (n) => engine.music.stinger(n),
  },
};

const host: VenueHost<SharedStage> = {
  ...harness.host,
  stage,
  audio,
  reducedMotion,
  exit(reason) {
    harness.host.exit(reason);
    dev.textContent = `exit(${reason ?? ""}) → the shell would navigate now`;
  },
};
const dev = document.querySelector<HTMLElement>("#dev") ?? document.body;
dev.textContent = `sim: ${FAKE_SIM.name} · ${owner ? "owner" : "guest"} #${appearance.tokenId} · m mute`;

const auto = q.get("auto") as RunKind | null;
const venue = createLoosePixelsVenue({
  sim: FAKE_SIM,
  ...(auto ? { autoStart: auto } : {}),
  oneSwitch: flag("oneswitch"),
  noFlashes: flag("noflash"),
});
const instance = (await venue.mount(host)) as LoosePixelsInstance;

declare global {
  interface Window {
    __lp?: {
      ready: boolean;
      stage: SharedStage;
      instance: LoosePixelsInstance;
      harness: typeof harness;
    };
  }
}
window.__lp = { ready: true, stage, instance, harness };
