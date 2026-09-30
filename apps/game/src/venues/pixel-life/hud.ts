/**
 * The in-run HUD and venue screens as a DOM overlay (GDD §6.3/§6.4, art bible §6): score card, inverted timer card,
 * Friend card with the live silhouette, the sweep-back bar, projected callouts, loose-pixel brackets, aim dots, and the
 * start / pause / results cards. It is dumb: the venue computes screen positions and strings (hud-format.ts) and
 * pushes them in. UI motion is stepped (no easing).
 */
import { EMPTY_MASK, fromIndices, type Hex64 } from "@pl/shared";
import {
  chainLabel,
  chainPips,
  formatClock,
  formatPx,
  formatScore,
  formatSeconds,
  looseLabel,
  sweepBlocks,
  SWEEP_BLOCKS,
  timerBlocks,
  TIMER_BLOCKS,
  type Callout,
} from "./hud-format";
import { drawSilhouette } from "./share-card";
import { PX } from "./sim-view";

const CSS = `
.lp-hud{position:absolute;inset:0;pointer-events:none;font-family:'Sometype Mono','Courier New',monospace;color:#111;
  --ink:#111;--paper:#eee;--signal:#CCFF00;--coral:#ED927E;user-select:none;-webkit-user-select:none;overflow:hidden;
  z-index:5;}
.lp-hud *{box-sizing:border-box}
.lp-card{position:absolute;background:var(--paper);border:2px solid var(--ink);box-shadow:4px 4px 0 var(--ink);padding:8px 12px}
.lp-num{font-family:Silkscreen,'Courier New',monospace;font-weight:700;line-height:1}
.lp-label{font-size:11px;text-transform:lowercase;letter-spacing:.02em}
.lp-score{left:12px;top:12px;min-width:132px}
.lp-score .lp-num{font-size:26px;margin:2px 0 4px}
.lp-chip{display:inline-block;background:var(--ink);color:var(--signal);padding:1px 5px;font-size:11px;margin-left:6px}
.lp-pips{display:flex;gap:2px;margin-top:5px}
.lp-pips i{width:8px;height:6px;border:1px solid var(--ink);display:block}
.lp-pips i.on{background:var(--ink)}
.lp-timer{left:50%;top:12px;transform:translateX(-50%);background:var(--ink);color:var(--paper);box-shadow:4px 4px 0 #0006;
  padding:6px 18px;text-align:center}
.lp-timer .lp-num{font-size:28px}
.lp-tbar{display:flex;gap:1px;margin-top:4px;height:4px}
.lp-tbar i{flex:1;background:#444;display:block}.lp-tbar i.on{background:var(--paper)}
.lp-friend{right:12px;top:12px;display:flex;gap:10px;align-items:flex-start}
.lp-friend canvas{width:64px;height:64px;image-rendering:pixelated;border:2px solid var(--ink);background:var(--paper)}
.lp-friend .lp-num{font-size:24px}
.lp-pill{display:inline-block;margin-top:5px;background:var(--signal);border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);
  font-size:10px;padding:1px 6px;text-transform:lowercase;font-weight:700}
.lp-sweep{left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:6px 12px}
.lp-sweep .lp-blocks{display:flex;gap:3px}
.lp-sweep .lp-blocks i{width:14px;height:14px;border:2px solid var(--ink);display:block;background:var(--paper)}
.lp-sweep .lp-blocks i.on{background:var(--signal)}
.lp-sweep.idle{opacity:.55}.lp-sweep.idle .lp-blocks i.on{background:var(--paper)}
.lp-sweep.blink .lp-blocks i.on{background:var(--paper)}
.lp-pause{position:absolute;left:12px;top:112px;width:44px;height:44px;pointer-events:auto;cursor:pointer;font-family:Silkscreen,monospace;
  background:var(--paper);border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);font-size:14px;color:var(--ink)}
.lp-pause:active{box-shadow:none;transform:translate(2px,2px)}
.lp-pop{position:absolute;left:0;top:0;font-family:Silkscreen,monospace;font-weight:700;font-size:22px;white-space:nowrap;
  -webkit-text-stroke:2px var(--ink);paint-order:stroke fill;text-shadow:3px 3px 0 var(--ink);will-change:transform;text-transform:uppercase}
.lp-pop.coral{color:var(--coral)}.lp-pop.paper{color:var(--paper)}.lp-pop.lime{color:var(--signal)}.lp-pop.ink{color:var(--ink);-webkit-text-stroke:0;text-shadow:none}
.lp-bubble{position:absolute;left:0;top:0;background:var(--paper);border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);
  font-family:Silkscreen,monospace;font-size:10px;padding:1px 5px;white-space:nowrap;text-transform:uppercase}
.lp-br{position:absolute;left:0;top:0;width:22px;height:22px}
.lp-br i{position:absolute;width:7px;height:7px;border:0 solid var(--signal);filter:drop-shadow(0 0 0 var(--ink)) drop-shadow(1px 1px 0 var(--ink)) drop-shadow(-1px -1px 0 var(--ink))}
.lp-br i:nth-child(1){left:0;top:0;border-left-width:2px;border-top-width:2px}
.lp-br i:nth-child(2){right:0;top:0;border-right-width:2px;border-top-width:2px}
.lp-br i:nth-child(3){left:0;bottom:0;border-left-width:2px;border-bottom-width:2px}
.lp-br i:nth-child(4){right:0;bottom:0;border-right-width:2px;border-bottom-width:2px}
.lp-br.off i{border-color:transparent}
.lp-br.safety i{border-style:dotted}
.lp-br b{position:absolute;top:24px;left:50%;transform:translateX(-50%);font-family:Silkscreen,monospace;font-size:9px;color:var(--signal);
  -webkit-text-stroke:2px var(--ink);paint-order:stroke fill;white-space:nowrap}
.lp-dot{position:absolute;left:0;top:0;width:7px;height:7px;background:var(--paper);border:2px solid var(--ink)}
.lp-dot.full{background:var(--signal)}
.lp-banner{position:absolute;left:50%;top:24%;transform:translate(-50%,-50%);font-family:Silkscreen,monospace;font-weight:700;
  font-size:40px;color:var(--paper);-webkit-text-stroke:3px var(--ink);paint-order:stroke fill;text-shadow:4px 4px 0 var(--ink);
  text-transform:uppercase;white-space:nowrap}
.lp-banner.lime{color:var(--signal)}.lp-banner.coral{color:var(--coral)}
.lp-edge{position:absolute;top:0;bottom:0;width:36px;background-image:radial-gradient(var(--ink) 35%,transparent 36%);
  background-size:6px 6px;opacity:.55}
.lp-veil{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;
  background-image:radial-gradient(#1116 30%,transparent 31%);background-size:4px 4px}
.lp-modal{position:relative;background:var(--paper);border:2px solid var(--ink);box-shadow:6px 6px 0 var(--ink);padding:16px 18px;
  max-width:min(460px,calc(100% - 32px));width:100%;max-height:calc(100% - 32px);overflow:auto}
.lp-modal h2{font-family:Silkscreen,monospace;font-size:22px;margin:0 0 6px;text-transform:uppercase}
.lp-modal p{font-size:12px;margin:6px 0}
.lp-btn{min-height:44px;padding:8px 14px;font-family:Silkscreen,monospace;font-size:14px;background:var(--paper);color:var(--ink);
  border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);cursor:pointer;text-transform:uppercase;margin:6px 8px 0 0}
.lp-btn.primary{background:var(--signal)}
.lp-btn:active{box-shadow:none;transform:translate(2px,2px)}
.lp-btn:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.lp-btn[disabled]{opacity:.5;cursor:default}
.lp-res{display:flex;gap:16px;flex-wrap:wrap}
.lp-res canvas{width:128px;height:128px;image-rendering:pixelated;border:2px solid var(--ink)}
.lp-res dl{margin:0;display:grid;grid-template-columns:auto auto;gap:2px 12px;font-size:12px;align-content:start}
.lp-res dd{margin:0;font-family:Silkscreen,monospace;font-weight:700}
.lp-sim{font-size:10px;background:var(--ink);color:var(--paper);padding:0 4px;margin-left:4px}
.lp-count{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);display:flex;gap:6px}
.lp-count i{width:34px;height:34px;background:var(--ink);display:block;box-shadow:3px 3px 0 #0005}
.lp-hint{position:absolute;left:50%;bottom:64px;transform:translateX(-50%);font-size:12px;background:var(--paper);border:2px solid var(--ink);
  padding:3px 8px;box-shadow:2px 2px 0 var(--ink)}
@media (max-width:520px){.lp-score{min-width:0}.lp-score .lp-num{font-size:20px}.lp-timer .lp-num{font-size:20px}
  .lp-friend canvas{width:48px;height:48px}.lp-friend .lp-num{font-size:18px}.lp-friend .lp-meta{display:none}
  .lp-sweep .lp-blocks i{width:10px;height:10px}.lp-sweep .lp-label{display:none}.lp-pause{top:96px}.lp-banner{font-size:28px}}
`;

/** Per-frame HUD state. */
export interface HudState {
  readonly tick: number;
  readonly score: number;
  readonly chain: number;
  readonly present: number;
  readonly total: number;
  readonly pixels: Uint8Array;
  readonly loose: number;
  /** Ticks left on the most urgent loose pixel (null = none), and whether it's frozen in a Snatch beak. */
  readonly urgent: number | null;
  readonly frozen: boolean;
  readonly time: number;
  readonly paused: boolean;
}

/** A projected screen point (CSS px) or null when behind the camera. */
export type ScreenPoint = { readonly x: number; readonly y: number } | null;

interface Pop {
  el: HTMLElement;
  born: number;
  life: number;
  anchor: () => ScreenPoint;
  scale: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Options of the HUD. */
export interface HudOptions {
  readonly tokenId: string;
  /** "mask · your friend" / "on loan". */
  readonly subtitle: string;
  readonly front: Hex64;
  readonly reducedMotion: boolean;
}

/** The DOM overlay. */
export class Hud {
  readonly root: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly scoreNum: HTMLElement;
  private readonly chainChip: HTMLElement;
  private readonly pips: HTMLElement[] = [];
  private readonly timerNum: HTMLElement;
  private readonly tblocks: HTMLElement[] = [];
  private readonly pxNum: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly sil: HTMLCanvasElement;
  private readonly silCtx: CanvasRenderingContext2D | null;
  private readonly sweep: HTMLElement;
  private readonly sweepBlocksEl: HTMLElement[] = [];
  private readonly sweepSec: HTMLElement;
  readonly pauseBtn: HTMLButtonElement;
  private readonly layer: HTMLElement;
  private readonly pops: Pop[] = [];
  private readonly brackets: HTMLElement[] = [];
  private readonly dots: HTMLElement[] = [];
  private readonly bubbles = new Map<number, { el: HTMLElement; until: number }>();
  private banner: { el: HTMLElement; until: number; blink: boolean } | null = null;
  private edgeBand: HTMLElement | null = null;
  private modal: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private silKey = "";
  private last = {
    score: "",
    chain: "",
    pips: -1,
    clock: "",
    blocks: -1,
    px: "",
    pill: "",
    sweep: -1,
    sec: "",
    cls: "",
  };
  reducedMotion: boolean;

  constructor(
    parent: HTMLElement,
    private readonly opts: HudOptions,
  ) {
    this.reducedMotion = opts.reducedMotion;
    this.style = el("style");
    this.style.textContent = CSS;
    this.root = el("div", "lp-hud");
    this.root.setAttribute("data-venue", "loose-pixels");
    this.root.append(this.style);

    const score = el("div", "lp-card lp-score");
    score.append(el("div", "lp-label", "score"));
    this.scoreNum = el("div", "lp-num", "0");
    const chainRow = el("div", "lp-label", "chain");
    this.chainChip = el("span", "lp-chip", "×1");
    chainRow.append(this.chainChip);
    const pips = el("div", "lp-pips");
    for (let i = 0; i < 10; i++) {
      const p = el("i");
      this.pips.push(p);
      pips.append(p);
    }
    score.append(this.scoreNum, chainRow, pips);

    const timer = el("div", "lp-card lp-timer");
    timer.setAttribute("role", "timer");
    this.timerNum = el("div", "lp-num", "1:00");
    const tbar = el("div", "lp-tbar");
    for (let i = 0; i < TIMER_BLOCKS; i++) {
      const b = el("i");
      this.tblocks.push(b);
      tbar.append(b);
    }
    timer.append(this.timerNum, tbar);

    const friend = el("div", "lp-card lp-friend");
    this.sil = el("canvas");
    this.sil.width = 64;
    this.sil.height = 64;
    this.silCtx = this.sil.getContext("2d");
    const meta = el("div");
    const id = el("div", "lp-label lp-meta");
    id.innerHTML = "";
    id.append(el("b", "", `#${opts.tokenId}`), el("br"), document.createTextNode(opts.subtitle));
    this.pxNum = el("div", "lp-num", "");
    this.pill = el("span", "lp-pill", "");
    this.pill.style.visibility = "hidden";
    meta.append(id, this.pxNum, this.pill);
    friend.append(this.sil, meta);

    this.sweep = el("div", "lp-card lp-sweep idle");
    this.sweep.append(el("span", "lp-label", "sweep back"));
    const blocks = el("div", "lp-blocks");
    for (let i = 0; i < SWEEP_BLOCKS; i++) {
      const b = el("i");
      this.sweepBlocksEl.push(b);
      blocks.append(b);
    }
    this.sweepSec = el("span", "lp-num", "0.00");
    this.sweepSec.style.fontSize = "12px";
    this.sweep.append(blocks, this.sweepSec);

    this.pauseBtn = el("button", "lp-pause", "II");
    this.pauseBtn.type = "button";
    this.pauseBtn.setAttribute("aria-label", "pause");

    this.layer = el("div");
    this.layer.style.cssText = "position:absolute;inset:0";
    this.root.append(this.layer, score, timer, friend, this.sweep, this.pauseBtn);
    parent.append(this.root);
  }

  /** Updates cards; writes the DOM only when a value changes. */
  update(s: HudState): void {
    const L = this.last;
    const score = formatScore(s.score);
    if (score !== L.score) this.scoreNum.textContent = L.score = score;
    const chain = chainLabel(s.chain);
    if (chain !== L.chain) this.chainChip.textContent = L.chain = chain;
    const pips = chainPips(s.chain);
    if (pips !== L.pips) {
      L.pips = pips;
      this.pips.forEach((p, i) => p.classList.toggle("on", i < pips));
    }
    const clock = formatClock(s.tick);
    if (clock !== L.clock) this.timerNum.textContent = L.clock = clock;
    const blocks = timerBlocks(s.tick);
    if (blocks !== L.blocks) {
      L.blocks = blocks;
      this.tblocks.forEach((b, i) => b.classList.toggle("on", i < blocks));
    }
    const px = formatPx(s.present, s.total);
    if (px !== L.px) this.pxNum.textContent = L.px = px;
    const pill = looseLabel(s.loose);
    if (pill !== L.pill) {
      L.pill = pill;
      this.pill.textContent = pill;
      this.pill.style.visibility = pill ? "visible" : "hidden";
    }
    const sb = sweepBlocks(s.urgent);
    const sec = formatSeconds(s.urgent);
    // Last 0.5 s blinks at 8 Hz; a frozen (carried) pixel blinks too.
    const blink =
      !this.reducedMotion && ((s.urgent !== null && s.urgent <= 30) || s.frozen) && Math.floor(s.time * 8) % 2 === 1;
    const cls = s.loose > 0 ? (blink ? "blink" : "") : "idle";
    if (sb !== L.sweep) {
      L.sweep = sb;
      this.sweepBlocksEl.forEach((b, i) => b.classList.toggle("on", i < sb));
    }
    if (sec !== L.sec) this.sweepSec.textContent = L.sec = sec;
    if (cls !== L.cls) {
      L.cls = cls;
      this.sweep.className = `lp-card lp-sweep ${cls}`;
    }
    this.drawSil(s.pixels, s.time);
  }

  private drawSil(pixels: Uint8Array, time: number): void {
    const ctx = this.silCtx;
    if (!ctx) return;
    const blink = !this.reducedMotion && Math.floor(time * 4) % 2 === 1;
    const loose = new Set<number>();
    const lostIdx: number[] = [];
    let key = blink ? "b" : "n";
    for (let i = 0; i < 256; i++) {
      const v = pixels[i] ?? 0;
      if (v === PX.loose) loose.add(i);
      else if (v === PX.lost || v === PX.oldScar || v === PX.safety) lostIdx.push(i);
      if (v) key += `${i.toString(36)}${v}`;
    }
    if (key === this.silKey) return;
    this.silKey = key;
    ctx.fillStyle = "#eeeeee";
    ctx.fillRect(0, 0, 64, 64);
    const lost = lostIdx.length ? fromIndices(lostIdx) : EMPTY_MASK;
    drawSilhouette(ctx, 0, 0, 4, this.opts.front, lost, loose, blink);
  }

  /** A stepped pop-up callout that follows `anchor` and rises in 4 steps over its life (ms). */
  callout(c: Callout, anchor: () => ScreenPoint, now: number, life = 750): void {
    const e = el("div", `lp-pop ${c.tone}`, c.text);
    this.layer.append(e);
    this.pops.push({ el: e, born: now, life, anchor, scale: c.scale ?? 1 });
    if (this.pops.length > 14) this.pops.shift()?.el.remove();
  }

  /** A speech bubble over a creature ("mine!", "pardon!"); one per id. */
  bubble(id: number, text: string, at: ScreenPoint, now: number, ms = 700): void {
    let b = this.bubbles.get(id);
    if (!b) {
      b = { el: el("div", "lp-bubble"), until: 0 };
      this.layer.append(b.el);
      this.bubbles.set(id, b);
    }
    b.el.textContent = text;
    b.until = now + ms;
    this.place(b.el, at, 0, -34);
  }

  /** Moves live bubbles with their creatures (positions by id; missing = hide). */
  moveBubbles(pos: (id: number) => ScreenPoint, now: number): void {
    for (const [id, b] of this.bubbles) {
      if (now > b.until) {
        b.el.remove();
        this.bubbles.delete(id);
        continue;
      }
      this.place(b.el, pos(id), 0, -34);
    }
  }

  /** Brackets on loose pixels: screen point, whether blinking off, safety-stitched, and an optional tag ("edge!"). */
  setBrackets(items: readonly { p: ScreenPoint; off: boolean; safety: boolean; tag: string }[]): void {
    while (this.brackets.length < items.length) {
      const b = el("div", "lp-br");
      b.append(el("i"), el("i"), el("i"), el("i"), el("b"));
      this.layer.append(b);
      this.brackets.push(b);
    }
    this.brackets.forEach((b, i) => {
      const it = items[i];
      if (!it || !it.p) {
        b.style.display = "none";
        return;
      }
      b.style.display = "";
      b.className = `lp-br${it.off ? " off" : ""}${it.safety ? " safety" : ""}`;
      const tag = b.lastElementChild;
      if (tag && tag.textContent !== it.tag) tag.textContent = it.tag;
      this.place(b, it.p, -11, -11);
    });
  }

  /** Aim preview dots (null hides them); the last pulses lime at full power. */
  setAim(points: readonly ScreenPoint[] | null, full: boolean, time: number): void {
    const n = points?.length ?? 0;
    while (this.dots.length < n) {
      const d = el("div", "lp-dot");
      this.layer.append(d);
      this.dots.push(d);
    }
    this.dots.forEach((d, i) => {
      const p = points?.[i] ?? null;
      if (!p) {
        d.style.display = "none";
        return;
      }
      d.style.display = "";
      const last = i === n - 1;
      d.classList.toggle("full", last && full && Math.floor(time * 6) % 2 === 0);
      this.place(d, p, -5, -5);
    });
  }

  /** Big centre banner ("snack time", "gulp!") for `ms`; `blink` = 2 blinks. */
  showBanner(text: string, tone: "paper" | "lime" | "coral", now: number, ms = 1100, blink = false): void {
    this.banner?.el.remove();
    const e = el("div", `lp-banner ${tone === "paper" ? "" : tone}`, text);
    this.root.append(e);
    this.banner = { el: e, until: now + ms, blink };
  }

  /** Screen-edge dither band on one side (the Gulp warning); null removes it. */
  setEdgeBand(side: "left" | "right" | null): void {
    if (!side) {
      this.edgeBand?.remove();
      this.edgeBand = null;
      return;
    }
    if (!this.edgeBand) {
      this.edgeBand = el("div", "lp-edge");
      this.root.insertBefore(this.edgeBand, this.layer);
    }
    this.edgeBand.style.left = side === "left" ? "0" : "";
    this.edgeBand.style.right = side === "right" ? "0" : "";
  }

  /** Shows the stepped "3-2-1" blocks (n = 3..1) or hides them (0). */
  setCountdown(n: number): void {
    if (n <= 0) {
      this.countEl?.remove();
      this.countEl = null;
      return;
    }
    if (!this.countEl) {
      this.countEl = el("div", "lp-count");
      this.root.append(this.countEl);
    }
    if (this.countEl.childElementCount !== n) this.countEl.replaceChildren(...Array.from({ length: n }, () => el("i")));
  }

  /** Per-frame: moves callouts along their anchors in 4 rise steps; expires banners. */
  frame(now: number): void {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      if (!p) continue;
      const age = now - p.born;
      if (age > p.life) {
        p.el.remove();
        this.pops.splice(i, 1);
        continue;
      }
      const step = Math.min(3, Math.floor((age / p.life) * 4));
      const pt = p.anchor();
      // Appear in 2 frames: half size then full (stepped), then rise 6 px per step.
      const grow = age < 50 && !this.reducedMotion ? 0.6 : 1;
      this.place(p.el, pt, 0, -40 - step * 6, p.scale * grow, true);
    }
    if (this.banner) {
      const left = this.banner.until - now;
      if (left <= 0) {
        this.banner.el.remove();
        this.banner = null;
      } else if (this.banner.blink && !this.reducedMotion) {
        this.banner.el.style.visibility = Math.floor(left / 180) % 2 ? "hidden" : "visible";
      }
    }
  }

  private place(e: HTMLElement, p: ScreenPoint, dx: number, dy: number, scale = 1, center = false): void {
    if (!p) {
      e.style.visibility = "hidden";
      return;
    }
    e.style.visibility = "";
    const x = Math.round(p.x + dx);
    const y = Math.round(p.y + dy);
    e.style.transform = `translate(${x}px,${y}px)${center ? " translate(-50%,-50%)" : ""}${scale !== 1 ? ` scale(${scale})` : ""}`;
  }

  /** Opens a modal card (start / pause / results); returns its body element. Closes any previous one. */
  openModal(title: string): HTMLElement {
    this.closeModal();
    const veil = el("div", "lp-veil");
    const card = el("div", "lp-modal");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", title);
    card.append(el("h2", "", title));
    veil.append(card);
    this.root.append(veil);
    this.modal = veil;
    return card;
  }

  /** Closes the open modal. */
  closeModal(): void {
    this.modal?.remove();
    this.modal = null;
  }

  /** A button inside a modal body. The first primary button gets focus (keyboard parity). */
  button(parent: HTMLElement, label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const b = el("button", `lp-btn${primary ? " primary" : ""}`, label);
    b.type = "button";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    parent.append(b);
    if (primary) queueMicrotask(() => b.focus({ preventScroll: true }));
    return b;
  }

  /** A short hint chip above the sweep bar (null hides it). */
  hint(text: string | null): void {
    let h = this.root.querySelector<HTMLElement>(".lp-hint");
    if (!text) {
      h?.remove();
      return;
    }
    if (!h) {
      h = el("div", "lp-hint");
      this.root.append(h);
    }
    h.textContent = text;
  }

  /** Stepped iris to results: 4 steps over ~260 ms, then `done`. Under reduced motion it cuts. */
  iris(done: () => void): void {
    if (this.reducedMotion) {
      done();
      return;
    }
    // A transparent hole with a huge ink box-shadow: stepping its size closes the frame like an iris.
    const e = el("div", "lp-iris");
    e.style.cssText =
      "position:absolute;left:50%;top:45%;border-radius:50%;background:transparent;box-shadow:0 0 0 200vmax #111;transform:translate(-50%,-50%)";
    this.root.append(e);
    const sizes = [140, 90, 45, 0];
    let i = 0;
    const stepFn = (): void => {
      const v = `${sizes[i] ?? 0}vmax`;
      e.style.width = v;
      e.style.height = v;
      i++;
      if (i < sizes.length) setTimeout(stepFn, 65);
      else
        setTimeout(() => {
          done();
          e.remove();
        }, 90);
    };
    stepFn();
  }

  /** Removes the overlay. */
  dispose(): void {
    this.root.remove();
  }
}
