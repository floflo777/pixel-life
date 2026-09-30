/**
 * Bump Sumo dev page: mounts the venue on a real stage with an in-memory host (venue-kit test host) and the `@pl/audio`
 * engine, against the real loaner roster (`@pl/assets/loaners.json`). Query params:
 * `token=<id>` (which loaner you play), `owner=1` (play it as its owner), `auto=1` (skip the start card),
 * `bots=0|1|2`, `reduced=1`, `noflash=1`, `quality=low|medium|high`, `seed=<n>`, `mute=1`.
 */
import { AudioEngine, CUES, type CueName } from "@pl/audio";
import { parseLoaners } from "@pl/assets";
import loanersJson from "@pl/assets/loaners.json";
import type { FriendView } from "@pl/shared";
import { createSignal, createTestVenueHost, type VenueHost } from "@pl/venue-kit";
import { DAY_SKY } from "../../../post/post-pipeline";
import type { QualityTier } from "../../../stage/quality";
import { createStage, type SharedStage } from "../../../stage/stage";
import type { VenueAudioExt } from "../../pixel-life/audio";
import { createBumpSumoVenue, type BumpSumoInstance } from "../venue";

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

// The real loaner roster: you play one of them, three others are your rivals.
const loaners = parseLoaners(loanersJson);
const token = q.get("token") ?? "344030";
const mine = loaners.find((l) => l.appearance.tokenId === token) ?? loaners[0];
if (!mine) throw new Error("no loaners");
const owner = flag("owner");
const now = Date.now();
const friend: FriendView = {
  appearance: mine.appearance,
  pub: {
    tokenId: mine.appearance.tokenId,
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
  ...(seed !== undefined ? { freeSeed: seed } : {}),
});

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

const dev = document.querySelector<HTMLElement>("#dev") ?? document.body;
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
dev.textContent = `bump sumo · ${owner ? "owner" : "guest"} #${mine.appearance.tokenId} · m mute`;

const bots = Number(q.get("bots") ?? "1");
const venue = createBumpSumoVenue({
  rivals: async () => loaners.map((l) => l.appearance),
  botLevel: bots === 0 || bots === 2 ? bots : 1,
  autoStart: flag("auto"),
  noFlashes: flag("noflash"),
});
const instance = (await venue.mount(host)) as BumpSumoInstance;

declare global {
  interface Window {
    __bs?: { ready: boolean; stage: SharedStage; instance: BumpSumoInstance; harness: typeof harness };
  }
}
window.__bs = { ready: true, stage, instance, harness };
