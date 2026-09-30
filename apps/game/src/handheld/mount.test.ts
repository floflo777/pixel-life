// @vitest-environment happy-dom
import { createTestVenueHost, type TestVenueHarness } from "@pl/venue-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HandheldApp } from "./app.js";
import { createHandheldVenue, HANDHELD_ID, HANDHELD_MANIFEST, type HandheldVenueInstance } from "./mount.js";

/** happy-dom has no 2D canvas: a minimal context that records presents. */
function stubCanvas(): { puts: number } {
  const counter = { puts: 0 };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return {
      imageSmoothingEnabled: true,
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {
        counter.puts++;
      },
    } as unknown as CanvasRenderingContext2D;
  } as never);
  return counter;
}

/** A test host whose stage looks like the three.js GameStage (a renderer canvas inside a container). */
function stagedHost(): { h: TestVenueHarness; container: HTMLElement; stageCanvas: HTMLCanvasElement } {
  const h = createTestVenueHost();
  const container = document.createElement("div");
  const stageCanvas = document.createElement("canvas");
  container.appendChild(stageCanvas);
  document.body.appendChild(container);
  Object.assign(h.host.stage, { renderer: { domElement: stageCanvas } });
  return { h, container, stageCanvas };
}

describe("createHandheldVenue", () => {
  let puts: { puts: number };
  beforeEach(() => {
    puts = stubCanvas();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  const mount = async (h: TestVenueHarness) =>
    (await createHandheldVenue({ skipBoot: true }).mount(h.host)) as HandheldVenueInstance;

  it("is the Handheld Arcade native venue", () => {
    const v = createHandheldVenue();
    expect(v.manifest).toBe(HANDHELD_MANIFEST);
    expect(v.manifest.id).toBe(HANDHELD_ID);
    expect(v.manifest.name).toBe("Handheld Arcade");
  });

  it("overlays the shared stage's container with a 128×128 canvas and drives it from the frame loop", async () => {
    const { h, container } = stagedHost();
    const inst = await mount(h);
    expect(inst.overlay.parentElement).toBe(container);
    expect(container.style.position).toBe("relative");
    const lcd = inst.overlay.querySelector<HTMLCanvasElement>(".plhh-screen canvas");
    expect(lcd?.width).toBe(128);
    expect(lcd?.height).toBe(128);
    expect(inst.app).toBeInstanceOf(HandheldApp);
    const before = puts.puts;
    for (let i = 0; i < 30; i++) h.frame(1 / 60);
    expect(puts.puts).toBeGreaterThan(before);
    expect(h.host.stage.listeners).toBe(1);
    expect(inst.overlay.querySelector(".plhh-badge")?.textContent).toBe("rf simulated");

    await inst.unmount();
    expect(container.querySelector(".plhh-venue")).toBeNull();
    expect(container.style.position).toBe("");
    expect(h.host.stage.listeners).toBe(0);
  });

  it("goes back to The Sky from the exit button", async () => {
    const { h } = stagedHost();
    const inst = await mount(h);
    inst.overlay.querySelector<HTMLButtonElement>('[data-act="exit"]')?.click();
    expect(h.log.exits).toEqual(["quit"]);
    await inst.unmount();
  });

  it("has a mute switch (and the shell's mute wins)", async () => {
    const { h } = stagedHost();
    const inst = await mount(h);
    const btn = inst.overlay.querySelector<HTMLButtonElement>('[data-act="mute"]');
    if (!btn) throw new Error("no mute button");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    btn.click();
    expect(inst.app.muted).toBe(true);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    btn.click();
    expect(inst.app.muted).toBe(false);
    h.setMuted(true);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.disabled).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM" }));
    expect(inst.app.muted).toBe(true);
    await inst.unmount();
  });

  it("pauses through the instance and the shell signal", async () => {
    const { h } = stagedHost();
    const inst = await mount(h);
    // Start a run with the keyboard (● on the home menu's PLAY).
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    h.frame(1 / 60);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    for (let i = 0; i < 10; i++) h.frame(1 / 60);
    expect(inst.app.screen).toBe("run");
    inst.pause(true);
    const t0 = inst.app.runView?.tick;
    for (let i = 0; i < 30; i++) h.frame(1 / 60);
    expect(inst.app.runView?.tick).toBe(t0);
    inst.pause(false);
    for (let i = 0; i < 30; i++) h.frame(1 / 60);
    expect(inst.app.runView?.tick).toBeGreaterThan(t0 ?? 0);
    await inst.unmount();
  });

  it("falls back to an explicit container when the stage has no DOM", async () => {
    const h = createTestVenueHost();
    const box = document.createElement("div");
    box.style.position = "absolute";
    document.body.appendChild(box);
    const inst = (await createHandheldVenue({ container: box, skipBoot: true }).mount(h.host)) as HandheldVenueInstance;
    expect(inst.overlay.parentElement).toBe(box);
    expect(box.style.position).toBe("absolute");
    await inst.unmount();
  });
});
