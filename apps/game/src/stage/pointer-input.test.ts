// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InputEvent } from "./input";
import { bindPointerInput, isStageKeyTarget, type PointerInput } from "./pointer-input";

describe("stage keyboard ownership (#26)", () => {
  let page: HTMLElement;
  let stage: HTMLElement;
  let canvas: HTMLCanvasElement;
  let input: PointerInput;
  let events: InputEvent[];

  beforeEach(() => {
    document.body.innerHTML = `
      <main id="page">
        <button id="play-now">Play now</button>
        <a id="link" href="/sky">sky</a>
        <input id="field" />
        <div id="note" tabindex="-1">note</div>
        <div id="stage" class="live-stage">
          <canvas id="canvas"></canvas>
          <div id="hud"><span id="hud-label">score</span><button id="hud-btn">pause</button><div id="fake" role="button" tabindex="0">x</div></div>
        </div>
      </main>`;
    page = document.getElementById("page") as HTMLElement;
    stage = document.getElementById("stage") as HTMLElement;
    canvas = document.getElementById("canvas") as HTMLCanvasElement;
    input = bindPointerInput(canvas);
    events = [];
    input.on((e) => events.push(e));
  });
  afterEach(() => {
    input.dispose();
    document.body.innerHTML = "";
  });

  const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  /** Focuses `id` (or blurs everything for null), dispatches a keydown from the focused element, returns it. */
  const press = (id: string | null, code: string): KeyboardEvent => {
    if (id) el(id).focus();
    else (document.activeElement as HTMLElement | null)?.blur();
    const e = new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true });
    (id ? el(id) : document.body).dispatchEvent(e);
    return e;
  };

  it("classifies targets: page/body/stage belong to the stage; controls and outside elements do not", () => {
    expect(isStageKeyTarget(null, stage)).toBe(true);
    expect(isStageKeyTarget(window, stage)).toBe(true);
    expect(isStageKeyTarget(document, stage)).toBe(true);
    expect(isStageKeyTarget(document.body, stage)).toBe(true);
    expect(isStageKeyTarget(document.documentElement, stage)).toBe(true);
    expect(isStageKeyTarget(canvas, stage)).toBe(true);
    expect(isStageKeyTarget(el("hud-label"), stage)).toBe(true);
    for (const id of ["play-now", "link", "field", "hud-btn", "fake"])
      expect(isStageKeyTarget(el(id), stage)).toBe(false);
    expect(isStageKeyTarget(el("note"), stage)).toBe(false);
    expect(isStageKeyTarget(page, stage)).toBe(false);
  });

  it("leaves Enter and Space to a focused button or link (no preventDefault, no stage event)", () => {
    for (const id of ["play-now", "link", "hud-btn", "fake"]) {
      for (const code of ["Enter", "NumpadEnter", "Space"]) {
        const e = press(id, code);
        expect(e.defaultPrevented, `${id} ${code}`).toBe(false);
      }
    }
    expect(events).toEqual([]);
  });

  it("ignores every key while a field or an element outside the stage has focus", () => {
    expect(press("field", "KeyA").defaultPrevented).toBe(false);
    expect(press("note", "ArrowLeft").defaultPrevented).toBe(false);
    expect(events).toEqual([]);
    expect(input.isKeyDown("ArrowLeft")).toBe(false);
  });

  it("still drives the game when nothing in particular has focus", () => {
    const e = press(null, "Space");
    expect(e.defaultPrevented).toBe(true);
    expect(events).toEqual([expect.objectContaining({ type: "key", code: "Space", down: true })]);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    expect(events.at(-1)).toMatchObject({ type: "key", code: "Space", down: false });
  });
});
