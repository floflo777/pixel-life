/**
 * Browser glue: mounts the handheld app on a `<canvas>` (exactly 128×128 backing pixels, crisp integer CSS upscale),
 * wires keyboard / pointer input and the host's frame loop, and exposes it as a `NativeVenue` for the hub.
 */
import type { SimInput } from "@pl/shared";
import type { NativeVenue, VenueHost, VenueInstance, VenueManifest } from "@pl/venue-kit";
import { HandheldApp } from "./app.js";
import { createFakeSim } from "./fake-sim.js";
import { keyToButton, type Button } from "./input.js";
import { LCD_SIZE } from "./lcd.js";
import type { HandheldSimFactory, InputEncoder } from "./view.js";

/** Options for `mountHandheld`. The defaults are the local fake sim and a JSON input log (replace once T2 lands). */
export interface HandheldOptions {
  /** The sim factory; pass the shared `createSim` once `feat/sim` merges. */
  createSim?: HandheldSimFactory;
  /** Input-log encoder for `reportResult`; pass the shared `encodeInputs` once `feat/sim` merges. */
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

/** Placeholder input log until the shared codec lands: the inputs as UTF-8 JSON (never accepted by server replay). */
export const jsonInputEncoder: InputEncoder = (inputs: readonly SimInput[]) =>
  new TextEncoder().encode(JSON.stringify(inputs));

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
  canvas.setAttribute("aria-label", "Pixel Life handheld screen. Arrow keys aim or pick, Space holds and flings.");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = false;
  const image = ctx.createImageData(LCD_SIZE, LCD_SIZE);

  const app = new HandheldApp({
    host,
    now: opts.now ?? (() => Date.now()),
    createSim: opts.createSim ?? createFakeSim,
    encodeInputs: opts.encodeInputs ?? jsonInputEncoder,
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

/** The handheld's venue manifest (runs rank on the Pixel Life board; scars persist exactly as in 3D). */
export const HANDHELD_MANIFEST: VenueManifest = {
  id: "handheld",
  name: "Pixel Life Handheld",
  version: "0.1.0",
  kind: "native",
  room: "pixel-arena",
  requires: { ownedFriend: false },
  economy: { sinks: ["regrow"] },
  results: { leaderboard: "score-desc", affectsScars: true },
  thumbnail: HANDHELD_THUMBNAIL,
};

/**
 * The handheld as a `NativeVenue`. A `NativeVenue` gets no DOM from the host, so `getCanvas` supplies the canvas (e.g.
 * one the shell's venue slot creates). Sim ticks follow the host stage's frame loop.
 */
export function createHandheldVenue(getCanvas: () => HTMLCanvasElement, opts: HandheldOptions = {}): NativeVenue {
  return {
    manifest: HANDHELD_MANIFEST,
    mount: (host) => mountHandheld(getCanvas(), host, opts),
  };
}
