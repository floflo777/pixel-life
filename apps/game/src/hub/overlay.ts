/**
 * DOM overlay for the hub (art bible §4.1, §6): name tags under the feet, emote/quick-chat bubbles above heads, the
 * venue marquee and lime door pill, paper signs, gate cards, Mend Well bubbles, "+N px" callouts and the stepped iris.
 * Elements are pooled and only touched when their text or rounded position changes. States flip; nothing eases.
 */
import { toRows, type Hex64, type TokenIdStr } from "@pl/shared";
import type { RoomLabel } from "./rooms";

const STYLE_ID = "plh-style";
const CSS = `
.plh-root{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:"Silkscreen",monospace;contain:strict}
.plh-el{position:absolute;left:0;top:0;will-change:transform;white-space:nowrap}
.plh-tag{background:#eee;color:#111;border:2px solid #111;box-shadow:2px 2px 0 #111;padding:1px 5px 2px;font-size:10px;line-height:11px}
.plh-tag b{font-weight:400;display:block}
.plh-tag i{font:10px/11px "Sometype Mono",monospace;font-style:normal;text-transform:lowercase;display:block}
.plh-tag.you{background:#111;color:#ccff00}
.plh-tag.you i{color:#eee}
.plh-tag.id i{display:none}
.plh-bub{background:#eee;color:#111;border:2px solid #111;box-shadow:2px 2px 0 #111;padding:2px 6px 3px;font-size:12px;line-height:13px}
.plh-bub:after{content:"";position:absolute;left:calc(50% - 4px);bottom:-8px;border:4px solid transparent;border-top:4px solid #111}
.plh-bub.say{font-size:11px;text-transform:lowercase}
.plh-bub.zz{opacity:1;color:#8f7bbd}
.plh-marquee{background:#111;color:#eee;box-shadow:4px 4px 0 #111;font-weight:700;font-size:26px;line-height:26px;letter-spacing:3px;padding:8px 18px 6px}
.plh-pill{pointer-events:auto;cursor:pointer;background:#ccff00;color:#111;border:2px solid #111;box-shadow:2px 2px 0 #111;font:700 11px/12px "Silkscreen",monospace;padding:2px 6px;min-height:20px}
.plh-pill:active{box-shadow:none;translate:2px 2px}
.plh-sign{background:#eee;color:#111;border:2px solid #111;box-shadow:2px 2px 0 #111;padding:2px 6px 3px;font-size:10px;line-height:11px}
.plh-sign i{font:10px/11px "Sometype Mono",monospace;font-style:normal;display:block;text-transform:lowercase}
.plh-gate{pointer-events:auto;cursor:pointer;text-align:left}
button.plh-sign{pointer-events:auto;cursor:pointer;text-align:left}
.plh-well{pointer-events:auto;cursor:pointer;background:#eee;border:2px solid #111;border-radius:50%;box-shadow:2px 2px 0 #111;width:40px;height:40px;padding:0;display:grid;place-items:center}
.plh-well canvas{width:24px;height:24px;image-rendering:pixelated}
.plh-call{color:#eee;font-weight:700;font-size:14px;text-shadow:2px 0 #111,-2px 0 #111,0 2px #111,0 -2px #111,3px 3px 0 #111}
.plh-iris{position:absolute;inset:0;background:#111;pointer-events:none;display:none}
@media (max-width:420px){.plh-marquee{font-size:18px;line-height:18px;padding:6px 12px 4px}}
`;

/** A screen position in CSS px relative to the overlay root. */
export interface ScreenPos {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

/** One name tag to show this frame. */
export interface TagView {
  readonly key: string;
  readonly id: string;
  readonly status: string;
  readonly level: "full" | "id";
  readonly you: boolean;
  readonly at: ScreenPos;
}

/** One bubble to show this frame. */
export interface BubbleView {
  readonly key: string;
  readonly text: string;
  readonly kind: "emote" | "say" | "zz";
  readonly at: ScreenPos;
}

/** A Mend Well bubble (a scarred Friend's silhouette). */
export interface WellBubble {
  readonly tokenId: TokenIdStr;
  readonly frame: Hex64;
  readonly lost: Hex64;
}

interface Callout {
  p: Pooled;
  until: number;
  x: number;
  y: number;
}

interface Pooled {
  el: HTMLElement;
  text: string;
  tx: string;
  shown: boolean;
}

function place(p: Pooled, x: number, y: number, visible: boolean): void {
  const show = visible && Number.isFinite(x) && Number.isFinite(y);
  if (show !== p.shown) {
    p.el.style.display = show ? "" : "none";
    p.shown = show;
  }
  if (!show) return;
  const tx = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  if (tx !== p.tx) {
    p.el.style.transform = tx;
    p.tx = tx;
  }
}

/** Callbacks from overlay controls. */
export interface OverlayHandlers {
  onDoor(doorId: string): void;
  onWell(tokenId: TokenIdStr): void;
}

/** The pooled DOM overlay. */
export class HubOverlay {
  readonly root: HTMLDivElement;
  readonly #labels = new Map<string, Pooled & { label: RoomLabel; inner: HTMLElement }>();
  readonly #tags = new Map<string, Pooled>();
  readonly #bubbles = new Map<string, Pooled>();
  #well: Pooled[] = [];
  #wellKey = "";
  readonly #iris: HTMLDivElement;
  readonly #calls: Callout[] = [];

  /** Mounts into `host` (positioned over the canvas). */
  constructor(
    host: HTMLElement,
    private readonly handlers: OverlayHandlers,
  ) {
    const doc = host.ownerDocument;
    if (!doc.getElementById(STYLE_ID)) {
      const s = doc.createElement("style");
      s.id = STYLE_ID;
      s.textContent = CSS;
      doc.head.appendChild(s);
    }
    this.root = doc.createElement("div");
    this.root.className = "plh-root";
    this.#iris = doc.createElement("div");
    this.#iris.className = "plh-iris";
    this.root.appendChild(this.#iris);
    host.appendChild(this.root);
  }

  #make(cls: string, tag: "div" | "button" = "div"): Pooled {
    const el = this.root.ownerDocument.createElement(tag);
    el.className = `plh-el ${cls}`;
    el.style.display = "none";
    this.root.insertBefore(el, this.#iris);
    return { el, text: "", tx: "", shown: false };
  }

  /** Replaces the room's static labels. */
  setLabels(labels: readonly RoomLabel[]): void {
    for (const l of this.#labels.values()) l.el.remove();
    this.#labels.clear();
    for (const label of labels) {
      const button = label.doorId !== undefined;
      const cls = { marquee: "plh-marquee", pill: "plh-pill", sign: "plh-sign", gate: "plh-sign plh-gate" }[label.kind];
      const p = this.#make(cls, button ? "button" : "div");
      if (button) {
        const id = label.doorId as string;
        (p.el as HTMLButtonElement).type = "button";
        p.el.addEventListener("click", () => this.handlers.onDoor(id));
        p.el.setAttribute("aria-label", `${label.title} ${label.sub ?? ""}`.trim());
      }
      this.#labels.set(label.id, { ...p, label, inner: p.el });
      this.#setLabelText(label.id, label.title, label.sub ?? "");
    }
  }

  #setLabelText(id: string, title: string, sub: string): void {
    const l = this.#labels.get(id);
    if (!l) return;
    const text = `${title}|${sub}`;
    if (text === l.text) return;
    l.text = text;
    l.el.textContent = title;
    if (sub) {
      const i = this.root.ownerDocument.createElement("i");
      i.textContent = sub;
      l.el.appendChild(i);
    }
  }

  /** Updates live label text (door counts, the Daily countdown) and positions. */
  updateLabels(
    project: (l: RoomLabel) => ScreenPos,
    text: (l: RoomLabel) => { title: string; sub: string } | null,
  ): void {
    for (const [id, l] of this.#labels) {
      const t = text(l.label);
      if (t) this.#setLabelText(id, t.title, t.sub);
      const at = project(l.label);
      // Anchor: marquee/sign/gate sit above their point, pills centred on it.
      const w = l.el.offsetWidth;
      const h = l.el.offsetHeight;
      place(l, at.x - w / 2, l.label.kind === "pill" ? at.y - h / 2 : at.y - h, at.visible);
    }
  }

  /** Shows exactly these tags (others hide). Tags hang under the feet. */
  updateTags(tags: readonly TagView[]): void {
    const seen = new Set<string>();
    for (const t of tags) {
      seen.add(t.key);
      let p = this.#tags.get(t.key);
      if (!p) this.#tags.set(t.key, (p = this.#make("plh-tag")));
      const text = `${t.level}|${t.you}|${t.id}|${t.status}`;
      if (text !== p.text) {
        p.text = text;
        p.el.className = `plh-el plh-tag${t.you ? " you" : ""}${t.level === "id" ? " id" : ""}`;
        p.el.replaceChildren();
        const b = this.root.ownerDocument.createElement("b");
        b.textContent = t.id;
        p.el.appendChild(b);
        if (t.status) {
          const i = this.root.ownerDocument.createElement("i");
          i.textContent = t.status;
          p.el.appendChild(i);
        }
      }
      place(p, t.at.x - p.el.offsetWidth / 2, t.at.y + 4, t.at.visible);
    }
    for (const [k, p] of this.#tags)
      if (!seen.has(k)) {
        if (this.#tags.size > 24) {
          p.el.remove();
          this.#tags.delete(k);
        } else place(p, 0, 0, false);
      }
  }

  /** Shows exactly these bubbles (above heads). */
  updateBubbles(bubbles: readonly BubbleView[]): void {
    const seen = new Set<string>();
    for (const b of bubbles) {
      seen.add(b.key);
      let p = this.#bubbles.get(b.key);
      if (!p) this.#bubbles.set(b.key, (p = this.#make("plh-bub")));
      const text = `${b.kind}|${b.text}`;
      if (text !== p.text) {
        p.text = text;
        p.el.className = `plh-el plh-bub${b.kind === "say" ? " say" : b.kind === "zz" ? " zz" : ""}`;
        p.el.textContent = b.text;
      }
      place(p, b.at.x - p.el.offsetWidth / 2, b.at.y - p.el.offsetHeight - 8, b.at.visible);
    }
    for (const [k, p] of this.#bubbles)
      if (!seen.has(k)) {
        if (this.#bubbles.size > 48) {
          p.el.remove();
          this.#bubbles.delete(k);
        } else place(p, 0, 0, false);
      }
  }

  /** The Mend Well bubbles: up to 7 scarred Friends in a floating arc around `at`. */
  updateWell(list: readonly WellBubble[], at: ScreenPos | null): void {
    const key = list.map((w) => `${w.tokenId}:${w.lost}`).join(",");
    if (key !== this.#wellKey) {
      this.#wellKey = key;
      for (const p of this.#well) p.el.remove();
      this.#well = list.slice(0, 7).map((w) => {
        const p = this.#make("plh-well", "button");
        (p.el as HTMLButtonElement).type = "button";
        p.el.setAttribute("aria-label", `mend #${w.tokenId}`);
        p.el.addEventListener("click", () => this.handlers.onWell(w.tokenId));
        p.el.appendChild(silhouette(this.root.ownerDocument, w.frame, w.lost));
        return p;
      });
    }
    const n = this.#well.length;
    this.#well.forEach((p, i) => {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const ang = Math.PI * (1.1 + 0.8 * t);
      const x = (at?.x ?? 0) + Math.cos(ang) * 90 - 20;
      const y = (at?.y ?? 0) + Math.sin(ang) * 46 - 20 - (i % 2) * 10;
      place(p, x, y, at?.visible ?? false);
    });
  }

  /** A "+N px" callout at a screen point for 1 s (stepped: shown, then gone). */
  callout(text: string, at: ScreenPos, now: number): void {
    const p = this.#make("plh-call");
    p.el.textContent = text;
    this.#calls.push({ p, until: now + 1000, x: at.x, y: at.y });
    place(p, at.x - 16, at.y - 20, at.visible);
  }

  /** Expires callouts; they rise in two steps. */
  tick(now: number): void {
    for (let i = this.#calls.length - 1; i >= 0; i--) {
      const c = this.#calls[i] as Callout;
      if (now >= c.until) {
        c.p.el.remove();
        this.#calls.splice(i, 1);
      } else if (c.until - now < 500) place(c.p, c.x - 16, c.y - 34, true);
    }
  }

  /**
   * Stepped iris (GDD §11.5: 0.4 s): closes in 4 steps, runs `mid`, opens in 4 steps. Reduced motion = a plain cut.
   */
  async iris(mid: () => Promise<void>, reducedMotion: boolean): Promise<void> {
    const el = this.#iris;
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    // The dark lives outside a shrinking/growing hole: a hard-edged radial mask, 4 steps each way.
    const step = async (open: boolean): Promise<void> => {
      el.style.display = "block";
      for (let k = 1; k <= 4; k++) {
        const r = (open ? k : 4 - k) * 20;
        el.style.maskImage = `radial-gradient(circle at 50% 55%, transparent ${r}%, #000 ${r}%)`;
        await wait(50);
      }
    };
    if (reducedMotion) {
      el.style.display = "block";
      el.style.maskImage = "none";
      await mid();
      el.style.display = "none";
      return;
    }
    await step(false);
    await mid();
    await step(true);
    el.style.display = "none";
  }

  /** Removes every element. */
  dispose(): void {
    this.root.remove();
  }
}

/** A 16×16 silhouette canvas: ink body, paper scar slots with a coral dot. */
function silhouette(doc: Document, frame: Hex64, lost: Hex64): HTMLCanvasElement {
  const c = doc.createElement("canvas");
  c.width = 16;
  c.height = 16;
  const g = c.getContext("2d");
  if (!g) return c;
  const rows = toRows(frame);
  const lr = toRows(lost);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== "#") return;
      g.fillStyle = lr[y]?.[x] === "#" ? "#ed927e" : "#1d1b24";
      g.fillRect(x, y, 1, 1);
    }),
  );
  return c;
}
