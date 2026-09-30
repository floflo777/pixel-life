/**
 * A placeholder native venue in the "pixel-life" slot until the real Pixel Life venue (T5) is merged. It is honest about
 * being a stand-in, but exercises the whole `VenueHost` contract: it renders your voxel Friend on the shared stage,
 * takes taps / keys, plays cues, knocks pixels off (capped by `runScarCap`), and reports a result so the shell's
 * results card, scars, Bits and share card all run for real.
 */
import { attachProjectedShadow, buildFriendModel, buildIsland, RUN_POSE, tagHalo } from "@pl/game";
import {
  andNot,
  effectiveLost,
  EMPTY_MASK,
  frontMask,
  getBit,
  mulberry32,
  or,
  popcount,
  RUN_TICKS,
  runScarCap,
  setBit,
  SIM_HZ,
  toIndices,
} from "@pl/shared";
import type { NativeVenue } from "@pl/venue-kit";
import { Vector3 } from "three";
import type { GameStage } from "../stage/runtime.js";
import { PIXEL_LIFE } from "./registry.js";

/** Length of a placeholder run. */
export const PLACEHOLDER_RUN_S = 20;
/** Every Nth hit is a bite that knocks a pixel off. */
const BITE_EVERY = 3;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

/** The placeholder venue (manifest = the Pixel Life slot, version marked `placeholder`). */
export const placeholderPixelLife: NativeVenue<GameStage> = {
  manifest: PIXEL_LIFE.manifest,
  async mount(host) {
    const stage = host.stage;
    const view = host.identity.friend;
    const tokenId = view.appearance.tokenId;
    const front = frontMask(view.appearance);
    const goldHeld = view.loaned ? 0 : view.pub.goldHeld;
    let lost = effectiveLost(view.pub.scars, Date.now(), tokenId, { goldHeld });
    let lostDelta = EMPTY_MASK;
    const cap = runScarCap(popcount(front));
    const seed = host.seeds.free();
    const rand = mulberry32(seed);

    const island = buildIsland({
      radius: 9,
      cell: 0.24,
      seed: seed % 997,
      underside: 8,
      scatter: { tufts: 14, flowers: 20 },
    });
    stage.scene.add(island.object);
    const model = buildFriendModel(view.appearance, lost, { gold: goldHeld, lod: 0, halo: false });
    model.object.rotation.x = -0.45;
    tagHalo(model.object, "halo");
    stage.scene.add(model.object);
    const shadow = attachProjectedShadow(model.object, { groundY: 0 });
    stage.rig.pose = { ...RUN_POSE, distance: 9 };
    stage.rig.baseYaw = 0;
    stage.rig.snap(new Vector3(0, 1.1, 0));

    // Venue HUD (venues own their in-run HUD; the shell's top bar stays).
    const root = stage.renderer.domElement.parentElement ?? document.body;
    const hud = el("div", "venue-hud");
    const badge = el("p", "venue-badge mono", "placeholder venue · the real Pixel Life lands soon");
    const timer = el("p", "venue-timer num");
    const score = el("p", "venue-score num");
    const px = el("p", "venue-px mono");
    const help = el(
      "p",
      "venue-help mono",
      "tap your Friend (or press space) to bonk it. every 3rd bonk bites a pixel off.",
    );
    const finish = el("button", "btn btn-paper venue-finish", "finish run");
    finish.type = "button";
    hud.append(badge, timer, score, px, help, finish);
    root.append(hud);

    let paused = host.paused.value;
    const offPause = host.paused.subscribe((p) => (paused = p));
    let t = 0;
    let hits = 0;
    let points = 0;
    let ended = false;

    const draw = (): void => {
      timer.textContent = `0:${String(Math.max(0, Math.ceil(PLACEHOLDER_RUN_S - t))).padStart(2, "0")}`;
      score.textContent = `score ${points}`;
      px.textContent = `${popcount(front) - popcount(lost)}/${popcount(front)} px · lost ${popcount(lostDelta)}/${cap}`;
    };
    draw();

    const hit = (): void => {
      if (ended || paused) return;
      hits++;
      points += 10 * Math.min(8, 1 + Math.floor(hits / 4));
      const present = toIndices(andNot(front, lost));
      if (hits % BITE_EVERY === 0 && popcount(lostDelta) < cap && present.length > 1) {
        const i = present[Math.floor(rand() * present.length)] ?? present[0];
        if (i !== undefined && !getBit(lost, i)) {
          lost = setBit(lost, i, true);
          lostDelta = or(lostDelta, setBit(EMPTY_MASK, i, true));
          model.setLost(lost);
          host.audio.play("pixel.lost");
        }
      } else host.audio.play("smash.nib");
      if (!host.reducedMotion) stage.rig.shake(0.25);
      draw();
    };

    const end = (): void => {
      if (ended) return;
      ended = true;
      host.audio.play("run.end");
      finish.disabled = true;
      void host
        .reportResult({
          venueId: PIXEL_LIFE.manifest.id,
          runId: crypto.randomUUID(),
          seed,
          kind: "free",
          inputs: new Uint8Array(0),
          claimed: {
            score: points,
            lostDelta,
            recovered: 0,
            smashed: hits,
            ticks: Math.min(RUN_TICKS, Math.round(t * SIM_HZ)),
            finalHash: "placeholder",
          },
        })
        .finally(() => host.exit("done"));
    };

    finish.addEventListener("click", end);
    const offInput = stage.input.on((e) => {
      if (e.type === "tap") hit();
      if (e.type === "key" && e.down && (e.code === "Space" || e.code === "Enter")) hit();
    });
    const offFrame = stage.onFrame((dt) => {
      if (paused || ended) return;
      t += dt;
      draw();
      if (t >= PLACEHOLDER_RUN_S) end();
    });
    host.audio.play("run.start");

    return {
      pause(p) {
        paused = p;
      },
      resize() {
        // The stage resizes itself; the DOM HUD is CSS-positioned.
      },
      async unmount() {
        offInput();
        offFrame();
        offPause();
        hud.remove();
        shadow.dispose();
        model.object.removeFromParent();
        model.dispose();
        island.object.removeFromParent();
        island.dispose();
      },
    };
  },
};
