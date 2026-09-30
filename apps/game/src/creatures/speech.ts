import { Vector3, type Camera, type Object3D } from "three";
import type { CreatureKind } from "./sprites";
import type { CreatureState } from "./states";

/** A line a creature says: shown in a paper bubble above `anchor` for `duration` seconds. */
export interface SpeechLine {
  readonly text: string;
  readonly duration: number;
  readonly anchor: Object3D;
}

/** Listener for speech lines. */
export type SpeechListener = (line: SpeechLine) => void;

/** What each Munchie says on entering a state (GDD §3 personalities). Short, one word or glyph where possible. */
export const SPEECH_LINES: Readonly<Record<CreatureKind, Partial<Record<CreatureState, string>>>> = {
  nib: { telegraph: "pardon!", attack: "nom" },
  pogo: { airborne: "hee!", attack: "hee hee!" },
  clank: { telegraph: "hmph!", stunned: "grr" },
  snatch: { telegraph: "shiny!", carry: "MINE!", stunned: "caw!" },
  slurp: { sleep: "zzz", telegraph: "hrrm…", stunned: "hmph" },
  fizz: { telegraph: "fzzt!", projectile: "wheee!" },
};

/** Speech bubble duration in seconds. */
export const SPEECH_SECONDS = 1.2;

/** The line (if any) for entering `state`. */
export function speechFor(kind: CreatureKind, state: CreatureState): string | undefined {
  return SPEECH_LINES[kind][state];
}

interface Bubble {
  el: HTMLDivElement;
  anchor: Object3D;
  until: number;
}

/**
 * Optional DOM renderer for speech lines (bible §4.1 emote bubbles: paper, 2 px ink border, ink tail, Silkscreen 12 px).
 * Pools up to `max` bubbles; the oldest is reused when full. Call `update(nowSeconds)` once per frame after the camera
 * moves. Hosts that draw their own HUD can ignore this and subscribe to `onSpeak` directly.
 */
export class SpeechBubbles {
  private readonly bubbles: Bubble[] = [];
  private readonly tmp = new Vector3();

  constructor(
    private readonly container: HTMLElement,
    private readonly camera: Camera,
    private readonly max = 12,
  ) {}

  /** Shows a line; returns immediately. */
  show(line: SpeechLine, now: number): void {
    let b = this.bubbles.find((x) => x.anchor === line.anchor);
    if (!b && this.bubbles.length >= this.max) {
      b = this.bubbles.reduce((a, x) => (x.until < a.until ? x : a));
    }
    if (!b) {
      const el = document.createElement("div");
      el.setAttribute("role", "status");
      el.style.cssText = [
        "position:absolute",
        "transform:translate(-50%,-100%)",
        "background:#eeeeee",
        "color:#111111",
        "border:2px solid #111111",
        "box-shadow:2px 2px 0 #111111",
        "padding:1px 5px",
        "font:12px/1.2 Silkscreen, ui-monospace, monospace",
        "white-space:nowrap",
        "pointer-events:none",
      ].join(";");
      const tail = document.createElement("div");
      tail.style.cssText =
        "position:absolute;left:50%;bottom:-6px;width:6px;height:6px;background:#111111;transform:translateX(-50%)";
      el.appendChild(document.createElement("span"));
      el.appendChild(tail);
      this.container.appendChild(el);
      b = { el, anchor: line.anchor, until: 0 };
      this.bubbles.push(b);
    }
    b.anchor = line.anchor;
    b.until = now + line.duration;
    const span = b.el.firstChild as HTMLSpanElement;
    span.textContent = line.text;
    b.el.style.display = "block";
  }

  /** Re-projects visible bubbles and hides expired ones. */
  update(now: number): void {
    const r = this.container.getBoundingClientRect();
    for (const b of this.bubbles) {
      const visible = now < b.until && b.anchor.parent !== null;
      b.el.style.display = visible ? "block" : "none";
      if (!visible) continue;
      b.anchor.getWorldPosition(this.tmp).project(this.camera);
      b.el.style.left = `${Math.round(((this.tmp.x + 1) / 2) * r.width)}px`;
      b.el.style.top = `${Math.round(((1 - this.tmp.y) / 2) * r.height)}px`;
    }
  }

  /** Removes every bubble element. */
  dispose(): void {
    for (const b of this.bubbles) b.el.remove();
    this.bubbles.length = 0;
  }
}
