/**
 * Optional CSS device frame around the handheld canvas: an ink-bordered paper bezel with a hard shadow (the brand's
 * card language, art bible §7), the Sharp Memory LCD window and three 44 px+ buttons ◄ ● ►. Pure DOM + CSS; the shell
 * may use its own chrome instead and just call `mountHandheld` on a bare canvas.
 */
import type { Button } from "./input.js";
import type { HandheldInstance } from "./mount.js";

const STYLE_ID = "pl-handheld-style";
const CSS = `
.plhh{--ink:#111;--paper:#eee;display:inline-flex;flex-direction:column;align-items:center;gap:14px;
  padding:18px 18px 20px;background:var(--paper);border:3px solid var(--ink);box-shadow:8px 8px 0 var(--ink);
  font:700 11px/1 "Silkscreen",ui-monospace,monospace;color:var(--ink);user-select:none;-webkit-user-select:none;
  box-sizing:border-box;max-width:100%}
.plhh-top{display:flex;justify-content:space-between;width:100%;letter-spacing:1px;text-transform:lowercase}
.plhh-screen{border:3px solid var(--ink);line-height:0;background:var(--paper)}
.plhh-screen canvas{display:block;image-rendering:pixelated;image-rendering:crisp-edges;outline:none}
.plhh-screen canvas:focus-visible{outline:3px dashed var(--ink);outline-offset:3px}
.plhh-pad{display:flex;gap:18px;align-items:center}
.plhh-btn{min-width:52px;height:52px;border:3px solid var(--ink);background:var(--paper);color:var(--ink);
  box-shadow:3px 3px 0 var(--ink);font:inherit;font-size:20px;cursor:pointer;touch-action:none;padding:0 10px}
.plhh-btn.ok{border-radius:50%;width:60px;height:60px;background:var(--ink);color:var(--paper)}
.plhh-btn.is-down,.plhh-btn:active{box-shadow:none;transform:translate(3px,3px)}
.plhh-btn:focus-visible{outline:3px dashed var(--ink);outline-offset:3px}
.plhh-hint{font-weight:400;font-size:10px;letter-spacing:.5px;text-transform:lowercase;opacity:.8}
@media (prefers-color-scheme:dark){.plhh[data-theme=auto]{--ink:#eee;--paper:#111}}
`;

/** The built device: its root element, the canvas to mount on, and a `bind` that wires the buttons to an instance. */
export interface HandheldDevice {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** Wires the on-screen buttons to `inst` and fits the screen to `maxScreenPx`; returns an unbind function. */
  bind(inst: HandheldInstance, maxScreenPx?: number): () => void;
}

/** Builds the device frame inside `parent`. `label` is the small top-left caption. */
export function createHandheldDevice(parent: HTMLElement, label = "pixel life"): HandheldDevice {
  const doc = parent.ownerDocument;
  if (!doc.getElementById(STYLE_ID)) {
    const st = doc.createElement("style");
    st.id = STYLE_ID;
    st.textContent = CSS;
    doc.head.appendChild(st);
  }
  const root = doc.createElement("div");
  root.className = "plhh";
  root.innerHTML = `
    <div class="plhh-top"><span></span><span>128×128 · 1-bit</span></div>
    <div class="plhh-screen"><canvas></canvas></div>
    <div class="plhh-pad">
      <button class="plhh-btn" data-b="left" aria-label="Left: aim or previous">◄</button>
      <button class="plhh-btn ok" data-b="ok" aria-label="Action: hold to charge, release to fling">●</button>
      <button class="plhh-btn" data-b="right" aria-label="Right: aim or next">►</button>
    </div>
    <div class="plhh-hint">◄ ► aim · hold ● fling · ◄+► back</div>`;
  const cap = root.querySelector(".plhh-top span");
  if (cap) cap.textContent = label;
  parent.appendChild(root);
  const canvas = root.querySelector("canvas");
  if (!canvas) throw new Error("device canvas missing");

  return {
    root,
    canvas,
    bind(inst, maxScreenPx = 512) {
      const offs: (() => void)[] = [];
      for (const el of root.querySelectorAll<HTMLButtonElement>(".plhh-btn")) {
        const b = el.dataset.b as Button;
        const down = (e: PointerEvent) => {
          e.preventDefault();
          el.setPointerCapture?.(e.pointerId);
          el.classList.add("is-down");
          inst.press(b);
        };
        const up = () => {
          el.classList.remove("is-down");
          inst.release(b);
        };
        // Keyboard activation of a focused on-screen button (Enter/Space) is a tap.
        const click = (e: MouseEvent) => {
          if (e.detail !== 0) return;
          inst.press(b);
          inst.release(b);
        };
        el.addEventListener("pointerdown", down);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
        el.addEventListener("click", click);
        offs.push(() => {
          el.removeEventListener("pointerdown", down);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          el.removeEventListener("click", click);
        });
      }
      const fit = () => {
        const avail = Math.min(maxScreenPx, window.innerWidth - 60, window.innerHeight - 210);
        inst.resize(avail, avail);
      };
      fit();
      window.addEventListener("resize", fit);
      offs.push(() => window.removeEventListener("resize", fit));
      return () => offs.splice(0).forEach((f) => f());
    },
  };
}
