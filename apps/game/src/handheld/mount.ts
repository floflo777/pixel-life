/**
 * Browser glue: mounts the handheld app on a `<canvas>` (exactly 128×128 backing pixels, crisp integer CSS upscale),
 * wires keyboard / pointer input and the host's frame loop, and packages it as the "Handheld Arcade" `NativeVenue`: a
 * 2D overlay (device frame + mute / exit chrome) laid over the shared stage's container in The Sky.
 */
import { createSim, encodeInputs } from "@pl/shared";
import type { NativeVenue, SharedStage, VenueHost, VenueInstance, VenueManifest } from "@pl/venue-kit";
import { HandheldApp } from "./app.js";
import { createHandheldDevice } from "./device.js";
import { keyToButton, type Button } from "./input.js";
import { LCD_SIZE } from "./lcd.js";
import type { HandheldSimFactory, InputEncoder } from "./view.js";

/** Options for `mountHandheld`. Sim and codec default to the shared ones (the code the server replays). */
export interface HandheldOptions {
  /** Sim factory (default `@pl/shared` `createSim`). */
  createSim?: HandheldSimFactory;
  /** Input-log encoder for `reportResult` (default `@pl/shared` `encodeInputs`). */
  encodeInputs?: InputEncoder;
  /** Wall clock for scar regrowth (ms). */
  now?: () => number;
  /** Where keyboard events are read (default `window`); null disables the keyboard. */
  keyTarget?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
  skipBoot?: boolean;
}

/** A mounted handheld: the venue instance plus device-button hooks and the app (dev tooling). */
export interface HandheldInstance extends VenueInstance {
  /** Presses / releases a device button (on-screen ◄ ● ►). */
  press(b: Button): void;
  release(b: Button): void;
  readonly app: HandheldApp;
}

// Compile-time guarantee that the shared sim and codec plug in as the handheld's defaults.
const defaultSim: HandheldSimFactory = createSim;
const defaultEncoder: InputEncoder = encodeInputs;

/** True iff `t` is (inside) an interactive control other than the handheld canvas. */
function isControl(t: EventTarget | null): boolean {
  return (
    typeof Element !== "undefined" &&
    t instanceof Element &&
    t.closest("button, input, select, textarea, a[href], [contenteditable=true], [role=dialog]") !== null
  );
}

/** Largest integer upscale of the 128 px screen that fits a w×h box (at least 1). */
export function integerScale(w: number, h: number): number {
  return Math.max(1, Math.floor(Math.min(w, h) / LCD_SIZE));
}

/**
 * Mounts the handheld on `canvas` with `host` (a `VenueHost`, as a native venue gets). The canvas backing store is set
 * to 128×128 and upscaled by CSS with nearest-neighbour; call `resize` with the available box to pick the integer scale.
 */
export async function mountHandheld(
  canvas: HTMLCanvasElement,
  host: VenueHost,
  opts: HandheldOptions = {},
): Promise<HandheldInstance> {
  canvas.width = LCD_SIZE;
  canvas.height = LCD_SIZE;
  canvas.style.imageRendering = "pixelated";
  canvas.style.touchAction = "none";
  canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "Handheld Arcade screen, 128 by 128 one-bit. Left and right arrows aim or pick, hold Space to charge and release to fling, hold Escape for the menu.",
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = false;
  const image = ctx.createImageData(LCD_SIZE, LCD_SIZE);

  const app = new HandheldApp({
    host,
    now: opts.now ?? (() => Date.now()),
    createSim: opts.createSim ?? defaultSim,
    encodeInputs: opts.encodeInputs ?? defaultEncoder,
    newRunId: () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `hh-${Date.now()}`),
    skipBoot: opts.skipBoot ?? false,
  });

  const present = () => {
    app.lcd.toRGBA(image.data);
    ctx.putImageData(image, 0, 0);
  };
  const cleanups: (() => void)[] = [];

  const keys = opts.keyTarget === undefined ? window : opts.keyTarget;
  if (keys) {
    const down = (e: Event) => {
      const k = e as KeyboardEvent;
      const b = keyToButton(k.code);
      if (!b || k.ctrlKey || k.metaKey || k.altKey) return;
      // Let focused controls (the overlay's buttons, shell dialogs) keep their own Space / Enter / Escape.
      if (isControl(k.target)) return;
      k.preventDefault();
      app.pad.press(b, app.time);
    };
    const up = (e: Event) => {
      const b = keyToButton((e as KeyboardEvent).code);
      if (b) app.pad.release(b, app.time);
    };
    const blur = () => app.pad.releaseAll(app.time);
    keys.addEventListener("keydown", down);
    keys.addEventListener("keyup", up);
    keys.addEventListener("blur", blur);
    cleanups.push(() => {
      keys.removeEventListener("keydown", down);
      keys.removeEventListener("keyup", up);
      keys.removeEventListener("blur", blur);
    });
  }

  const toLcd = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / Math.max(1, r.width)) * LCD_SIZE,
      y: ((e.clientY - r.top) / Math.max(1, r.height)) * LCD_SIZE,
    };
  };
  const onPointer = (kind: "down" | "move" | "up" | "cancel") => (e: PointerEvent) => {
    const p = toLcd(e);
    if (kind === "down") canvas.setPointerCapture?.(e.pointerId);
    app.pointer(kind, p.x, p.y);
  };
  const handlers: [string, (e: PointerEvent) => void][] = [
    ["pointerdown", onPointer("down")],
    ["pointermove", onPointer("move")],
    ["pointerup", onPointer("up")],
    ["pointercancel", onPointer("cancel")],
  ];
  for (const [n, h] of handlers) canvas.addEventListener(n, h as EventListener);
  cleanups.push(() => {
    for (const [n, h] of handlers) canvas.removeEventListener(n, h as EventListener);
  });

  cleanups.push(
    host.stage.onFrame((dt) => {
      if (app.update(dt)) present();
    }),
  );
  cleanups.push(host.paused.subscribe((p) => app.setPaused(p)));
  app.update(0);
  present();

  return {
    app,
    press: (b) => app.pad.press(b, app.time),
    release: (b) => app.pad.release(b, app.time),
    pause: (p) => app.setPaused(p),
    resize(w, h) {
      const px = LCD_SIZE * integerScale(w, h);
      canvas.style.width = `${px}px`;
      canvas.style.height = `${px}px`;
    },
    async unmount() {
      for (const c of cleanups.splice(0)) c();
    },
  };
}

/** Rows of the handheld's 16×16 1-bit door thumbnail (a tiny device with a Friend on its screen). */
export const HANDHELD_THUMBNAIL = [
  "................",
  "..############..",
  "..#..........#..",
  "..#.#......#.#..",
  "..#.##....##.#..",
  "..#.########.#..",
  "..#.#.####.#.#..",
  "..#.########.#..",
  "..#..#....#..#..",
  "..#..........#..",
  "..############..",
  "..#..........#..",
  "..#.#..##..#.#..",
  "..#..........#..",
  "..############..",
  "................",
].join("\n");

/** Stable venue id of the Handheld Arcade (hub door, `venueId` of its runs). */
export const HANDHELD_ID = "handheld";

/**
 * The Handheld Arcade's manifest: a cabinet in The Sky's arcade room. Its runs use the shared sim and rank on the Loose
 * Pixels boards; scars persist exactly as in 3D.
 */
export const HANDHELD_MANIFEST: VenueManifest = {
  id: HANDHELD_ID,
  name: "Handheld Arcade",
  version: "0.2.0",
  kind: "native",
  room: "pixel-arena",
  requires: { ownedFriend: false },
  economy: { sinks: ["regrow"] },
  results: { leaderboard: "score-desc", affectsScars: true },
  thumbnail: HANDHELD_THUMBNAIL,
};

/** Options for `createHandheldVenue`. */
export interface HandheldVenueOptions extends HandheldOptions {
  /**
   * Element the overlay covers. Default: the parent of the shared stage's canvas (`stage.renderer.domElement`, as the
   * three.js `GameStage` exposes it), else `document.body`.
   */
  container?: HTMLElement | (() => HTMLElement);
  /** Largest screen size in CSS px (integer multiples of 128; default 512). */
  maxScreenPx?: number;
}

/** The instance `createHandheldVenue` mounts: a handheld plus its overlay element. */
export interface HandheldVenueInstance extends HandheldInstance {
  /** The overlay root (removed on unmount). */
  readonly overlay: HTMLElement;
  /** Toggles the device's own mute (the shell's mute always wins). */
  setMuted(m: boolean): void;
}

const VENUE_STYLE_ID = "pl-handheld-venue-style";
const VENUE_CSS = `
.plhh-venue{--ink:#111;--paper:#eee;position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:12px;padding:12px 16px;box-sizing:border-box;overflow:auto;
  background-color:var(--paper);background-image:radial-gradient(#b0b0b0 1px,transparent 1.5px);
  background-size:16px 16px;background-position:8px 8px;color:var(--ink);
  font:700 11px/1 "Silkscreen",ui-monospace,monospace}
.plhh-venue-bar{position:absolute;top:12px;left:16px;right:16px;display:flex;gap:8px;align-items:center;
  justify-content:space-between;pointer-events:none}
.plhh-venue-bar>*{pointer-events:auto}
.plhh-venue-tools{display:flex;gap:8px;align-items:center}
.plhh-chip{min-height:44px;min-width:44px;padding:0 12px;border:3px solid var(--ink);background:var(--paper);
  color:var(--ink);box-shadow:3px 3px 0 var(--ink);font:inherit;text-transform:lowercase;cursor:pointer;
  white-space:nowrap}
.plhh-chip:active{box-shadow:none;transform:translate(3px,3px)}
.plhh-chip:focus-visible{outline:3px dashed var(--ink);outline-offset:3px}
.plhh-chip[aria-pressed=true]{background:var(--ink);color:var(--paper)}
.plhh-badge{background:var(--ink);color:var(--paper);padding:6px 8px;text-transform:lowercase;white-space:nowrap}
.plhh-venue .plhh-top span{white-space:nowrap}
@media (max-width:420px){.plhh-venue{justify-content:flex-start;padding-top:68px}
  .plhh-venue .plhh-top span+span,.plhh-badge .plhh-long{display:none}}
@media (prefers-reduced-motion:reduce){.plhh-chip:active{transform:none}}
`;

/** The stage's canvas container when the stage is the three.js `GameStage` (structural check, no three.js import). */
function stageContainer(stage: SharedStage): HTMLElement | null {
  const r = (stage as SharedStage & { renderer?: { domElement?: unknown } }).renderer;
  const el = r?.domElement;
  return typeof HTMLElement !== "undefined" && el instanceof HTMLElement ? el.parentElement : null;
}

/** Builds the overlay DOM (chrome + device) inside `container`. */
function buildOverlay(container: HTMLElement, loaned: boolean) {
  const doc = container.ownerDocument;
  if (!doc.getElementById(VENUE_STYLE_ID)) {
    const st = doc.createElement("style");
    st.id = VENUE_STYLE_ID;
    st.textContent = VENUE_CSS;
    doc.head.appendChild(st);
  }
  const overlay = doc.createElement("section");
  overlay.className = "plhh-venue";
  overlay.setAttribute("aria-label", "Handheld Arcade");
  overlay.innerHTML = `
    <div class="plhh-venue-bar">
      <button type="button" class="plhh-chip" data-act="exit">◄ the sky</button>
      <div class="plhh-venue-tools">
        <span class="plhh-badge" title="RF prices here are simulated">rf sim<span class="plhh-long">ulated</span></span>
        <button type="button" class="plhh-chip" data-act="mute" aria-pressed="false">sound on</button>
      </div>
    </div>`;
  container.appendChild(overlay);
  const device = createHandheldDevice(overlay, loaned ? "handheld arcade · loan" : "handheld arcade");
  const exitBtn = overlay.querySelector<HTMLButtonElement>('[data-act="exit"]');
  const muteBtn = overlay.querySelector<HTMLButtonElement>('[data-act="mute"]');
  if (!exitBtn || !muteBtn) throw new Error("handheld overlay chrome missing");
  exitBtn.setAttribute("aria-label", "Leave the Handheld Arcade and go back to The Sky");
  return { overlay, device, exitBtn, muteBtn };
}

/**
 * The Handheld Arcade as a `NativeVenue`. On mount it lays a 2D overlay (paper page, device frame with ◄ ● ►, a
 * "back to The Sky" button, a mute switch and the RF SIMULATED badge) over the shared stage's container and drives the
 * handheld from the stage's frame loop. Pause, the shell's mute and reduced motion come from the host; results go
 * through `host.reportResult` with `venueId: "handheld"`; leaving calls `host.exit`.
 */
export function createHandheldVenue(opts: HandheldVenueOptions = {}): NativeVenue {
  return {
    manifest: HANDHELD_MANIFEST,
    mount: (host) => mountHandheldVenue(host, opts),
  };
}

/** Mounts the Handheld Arcade overlay on `host` (see `createHandheldVenue`). */
export async function mountHandheldVenue(
  host: VenueHost,
  opts: HandheldVenueOptions = {},
): Promise<HandheldVenueInstance> {
  const container =
    (typeof opts.container === "function" ? opts.container() : opts.container) ??
    stageContainer(host.stage) ??
    document.body;
  const view = container.ownerDocument.defaultView;
  // The overlay is absolutely positioned: give a statically positioned container a containing block (restored later).
  const pos = view ? view.getComputedStyle(container).position : "static";
  const restorePosition = pos === "static" || pos === "" ? container.style.position : null;
  if (restorePosition !== null) container.style.position = "relative";

  const loaned = host.identity.loaned || host.identity.mode === "guest";
  const { overlay, device, exitBtn, muteBtn } = buildOverlay(container, loaned);
  let inst: HandheldInstance;
  try {
    inst = await mountHandheld(device.canvas, host, opts);
  } catch (e) {
    overlay.remove();
    if (restorePosition !== null) container.style.position = restorePosition;
    throw e;
  }
  const box = () => ({ w: overlay.clientWidth || container.clientWidth, h: overlay.clientHeight - 56 });
  const unbind = device.bind(inst, opts.maxScreenPx ?? 512, box);
  const offs: (() => void)[] = [unbind];

  const shellMuted = host.audio.muted;
  const setMuted = (m: boolean): void => {
    inst.app.muted = m;
    const off = m || shellMuted.value;
    muteBtn.setAttribute("aria-pressed", String(off));
    muteBtn.textContent = off ? "sound off" : "sound on";
    muteBtn.disabled = shellMuted.value;
    muteBtn.title = shellMuted.value ? "Muted in settings" : "";
  };
  setMuted(false);
  offs.push(shellMuted.subscribe(() => setMuted(inst.app.muted)));
  const onMute = () => setMuted(!inst.app.muted);
  const onExit = () => inst.app.exit("quit");
  muteBtn.addEventListener("click", onMute);
  exitBtn.addEventListener("click", onExit);
  offs.push(() => {
    muteBtn.removeEventListener("click", onMute);
    exitBtn.removeEventListener("click", onExit);
  });
  const keys = opts.keyTarget === undefined ? view : opts.keyTarget;
  if (keys) {
    const onKey = (e: Event) => {
      const k = e as KeyboardEvent;
      if (k.code === "KeyM" && !k.repeat && !k.ctrlKey && !k.metaKey && !k.altKey) onMute();
    };
    keys.addEventListener("keydown", onKey);
    offs.push(() => keys.removeEventListener("keydown", onKey));
  }
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => device.fit());
    ro.observe(overlay);
    offs.push(() => ro.disconnect());
  }
  device.canvas.focus({ preventScroll: true });

  let gone = false;
  return {
    ...inst,
    app: inst.app,
    overlay,
    setMuted,
    resize: () => device.fit(),
    async unmount() {
      if (gone) return;
      gone = true;
      for (const off of offs.splice(0)) off();
      await inst.unmount();
      overlay.remove();
      if (restorePosition !== null) container.style.position = restorePosition;
    },
  };
}
