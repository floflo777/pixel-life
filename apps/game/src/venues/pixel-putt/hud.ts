/**
 * Pixel Putt's DOM overlay (art bible §6 UI kit): the hole card top-left, strokes as an inverted card top-centre, the
 * 9-cell scorecard strip top-right, projected callouts ("birdie!", "+1 nib"), aim dots, a power meter, banners and the
 * start / pause / results cards. Dumb by design: the venue pushes strings and screen points in. UI motion is stepped.
 */
import { formatToPar, scorecardCells, type PuttTone } from "./format";

const CSS = `
.pp-hud{position:absolute;inset:0;pointer-events:none;font-family:'Sometype Mono','Courier New',monospace;color:#111;
  --ink:#111;--paper:#eee;--signal:#CCFF00;--coral:#ED927E;--meadow:#B9D984;user-select:none;-webkit-user-select:none;
  overflow:hidden;z-index:5}
.pp-hud *{box-sizing:border-box}
.pp-card{position:absolute;background:var(--paper);border:2px solid var(--ink);box-shadow:4px 4px 0 var(--ink);padding:8px 12px}
.pp-num{font-family:Silkscreen,'Courier New',monospace;font-weight:700;line-height:1}
.pp-label{font-size:11px;text-transform:lowercase;letter-spacing:.02em}
.pp-hole{left:12px;top:12px;min-width:132px}
.pp-hole .pp-num{font-size:26px;margin:2px 0 4px}
.pp-chip{display:inline-block;background:var(--ink);color:var(--signal);padding:1px 5px;font-size:11px;margin-left:6px}
.pp-strokes{left:50%;top:12px;transform:translateX(-50%);background:var(--ink);color:var(--paper);box-shadow:4px 4px 0 #0006;
  padding:6px 18px;text-align:center;min-width:96px}
.pp-strokes .pp-num{font-size:28px}
.pp-score{right:12px;top:12px;text-align:right}
.pp-score .pp-num{font-size:24px}
.pp-strip{display:flex;gap:2px;margin-top:6px;justify-content:flex-end}
.pp-strip i{width:14px;height:14px;border:2px solid var(--ink);display:block;font-style:normal;font-size:8px;line-height:10px;
  text-align:center;font-family:Silkscreen,monospace;background:var(--paper)}
.pp-strip i.lime{background:var(--signal)}.pp-strip i.coral{background:var(--coral)}.pp-strip i.now{background:var(--ink)}
.pp-pause{position:absolute;left:12px;top:104px;width:44px;height:44px;pointer-events:auto;cursor:pointer;font-family:Silkscreen,monospace;
  background:var(--paper);border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);font-size:14px;color:var(--ink)}
.pp-pause:active{box-shadow:none;transform:translate(2px,2px)}
.pp-pause:focus-visible,.pp-btn:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.pp-pop{position:absolute;left:0;top:0;font-family:Silkscreen,monospace;font-weight:700;font-size:22px;white-space:nowrap;
  -webkit-text-stroke:2px var(--ink);paint-order:stroke fill;text-shadow:3px 3px 0 var(--ink);text-transform:uppercase}
.pp-pop.coral{color:var(--coral)}.pp-pop.paper{color:var(--paper)}.pp-pop.lime{color:var(--signal)}
.pp-dot{position:absolute;left:0;top:0;width:7px;height:7px;background:var(--paper);border:2px solid var(--ink)}
.pp-dot.full{background:var(--signal)}.pp-dot.drop{background:var(--coral)}.pp-dot.land{width:11px;height:11px}
.pp-power{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:6px 12px}
.pp-power .pp-blocks{display:flex;gap:3px}
.pp-power .pp-blocks i{width:14px;height:14px;border:2px solid var(--ink);display:block;background:var(--paper)}
.pp-power .pp-blocks i.on{background:var(--signal)}
.pp-banner{position:absolute;left:50%;top:26%;transform:translate(-50%,-50%);font-family:Silkscreen,monospace;font-weight:700;
  font-size:40px;color:var(--paper);-webkit-text-stroke:3px var(--ink);paint-order:stroke fill;text-shadow:4px 4px 0 var(--ink);
  text-transform:uppercase;white-space:nowrap;text-align:center}
.pp-banner small{display:block;font-size:14px;-webkit-text-stroke:0;text-shadow:none;color:var(--ink);background:var(--paper);
  border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);padding:2px 8px;margin:10px auto 0;width:max-content;font-family:'Sometype Mono',monospace;text-transform:lowercase}
.pp-banner.lime{color:var(--signal)}.pp-banner.coral{color:var(--coral)}
.pp-veil{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;
  background-image:radial-gradient(#1116 30%,transparent 31%);background-size:4px 4px}
.pp-modal{position:relative;background:var(--paper);border:2px solid var(--ink);box-shadow:6px 6px 0 var(--ink);padding:16px 18px;
  max-width:min(480px,calc(100% - 32px));width:100%;max-height:calc(100% - 32px);overflow:auto}
.pp-modal h2{font-family:Silkscreen,monospace;font-size:22px;margin:0 0 6px;text-transform:uppercase}
.pp-modal p{font-size:12px;margin:6px 0}
.pp-btn{min-height:44px;padding:8px 14px;font-family:Silkscreen,monospace;font-size:14px;background:var(--paper);color:var(--ink);
  border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);cursor:pointer;text-transform:uppercase;margin:6px 8px 0 0}
.pp-btn.primary{background:var(--signal)}
.pp-btn:active{box-shadow:none;transform:translate(2px,2px)}
.pp-table{border-collapse:collapse;margin:8px 0;font-size:11px;width:100%}
.pp-table th,.pp-table td{border:2px solid var(--ink);padding:2px 0;text-align:center;font-family:Silkscreen,monospace;min-width:22px}
.pp-table th{font-weight:400;font-family:'Sometype Mono',monospace}
.pp-table td.lime{background:var(--signal)}.pp-table td.coral{background:var(--coral)}
.pp-big{font-family:Silkscreen,monospace;font-weight:700;font-size:34px}
.pp-sim{font-size:10px;background:var(--ink);color:var(--paper);padding:0 4px;margin-left:4px}
.pp-hint{position:absolute;left:50%;bottom:64px;transform:translateX(-50%);font-size:12px;background:var(--paper);border:2px solid var(--ink);
  padding:3px 8px;box-shadow:2px 2px 0 var(--ink);white-space:nowrap}
.pp-count{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);display:flex;gap:6px}
.pp-count i{width:34px;height:34px;background:var(--ink);display:block;box-shadow:3px 3px 0 #0005}
@media (max-width:520px){.pp-hole{min-width:0;padding:6px 8px}.pp-hole .pp-num{font-size:18px}.pp-hole .pp-name{display:none}
  .pp-strokes{padding:4px 10px;min-width:0}.pp-strokes .pp-num{font-size:20px}.pp-score .pp-num{font-size:18px}
  .pp-strip i{width:10px;height:10px;font-size:0}.pp-pause{top:84px}.pp-banner{font-size:26px}
  .pp-power .pp-blocks i{width:10px;height:10px}.pp-power .pp-label{display:none}.pp-hint{font-size:11px}}
`;

/** A projected screen point (CSS px) or null when off-screen/behind the camera. */
export type ScreenPoint = { readonly x: number; readonly y: number } | null;

/** One aim-preview dot: where, and whether it marks the landing or a drop off the course. */
export interface AimDot {
  readonly p: ScreenPoint;
  readonly kind: "air" | "land" | "drop";
}

interface Pop {
  el: HTMLElement;
  born: number;
  life: number;
  anchor: () => ScreenPoint;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Number of blocks in the power meter. */
export const POWER_BLOCKS = 10;

/** The DOM overlay. */
export class PuttHud {
  readonly root: HTMLDivElement;
  readonly pauseBtn: HTMLButtonElement;
  private readonly style: HTMLStyleElement;
  private readonly holeNum: HTMLElement;
  private readonly holeName: HTMLElement;
  private readonly parChip: HTMLElement;
  private readonly strokesNum: HTMLElement;
  private readonly toPar: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly power: HTMLElement;
  private readonly powerBlocks: HTMLElement[] = [];
  private readonly layer: HTMLElement;
  private readonly dots: HTMLElement[] = [];
  private readonly pops: Pop[] = [];
  private readonly live: HTMLElement;
  private hintEl: HTMLElement | null = null;
  private bannerEl: { el: HTMLElement; until: number } | null = null;
  private modal: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private lastStrip = "";
  private lastPower = -1;
  private readonly cards: HTMLElement[];

  constructor(
    parent: HTMLElement,
    private readonly reducedMotion: boolean,
  ) {
    this.style = el("style");
    this.style.textContent = CSS;
    this.root = el("div", "pp-hud");
    this.root.setAttribute("data-venue", "pixel-putt");
    this.root.append(this.style);

    const hole = el("div", "pp-card pp-hole");
    hole.append(el("div", "pp-label", "hole"));
    this.holeNum = el("div", "pp-num", "1/9");
    hole.append(this.holeNum);
    const meta = el("div", "pp-label");
    this.holeName = el("span", "pp-name", "");
    this.parChip = el("span", "pp-chip", "par 3");
    meta.append(this.holeName, this.parChip);
    hole.append(meta);

    const strokes = el("div", "pp-card pp-strokes");
    this.strokesNum = el("div", "pp-num", "0");
    strokes.append(this.strokesNum, el("div", "pp-label", "strokes"));

    const score = el("div", "pp-card pp-score");
    score.append(el("div", "pp-label", "to par"));
    this.toPar = el("div", "pp-num", "E");
    this.strip = el("div", "pp-strip");
    score.append(this.toPar, this.strip);

    this.pauseBtn = el("button", "pp-pause", "II");
    this.pauseBtn.type = "button";
    this.pauseBtn.setAttribute("aria-label", "pause");

    this.power = el("div", "pp-card pp-power");
    this.power.append(el("span", "pp-label", "power"));
    const blocks = el("div", "pp-blocks");
    for (let i = 0; i < POWER_BLOCKS; i++) {
      const b = el("i");
      blocks.append(b);
      this.powerBlocks.push(b);
    }
    this.power.append(blocks);
    this.power.style.display = "none";

    this.layer = el("div");
    this.layer.style.cssText = "position:absolute;inset:0";
    // Screen-reader channel for hole results and round state (the canvas has no text).
    this.live = el("div");
    this.live.setAttribute("aria-live", "polite");
    this.live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
    this.cards = [hole, strokes, score, this.pauseBtn];
    this.root.append(this.layer, hole, strokes, score, this.pauseBtn, this.power, this.live);
    parent.append(this.root);
  }

  /** Shows the in-round cards (hole, strokes, scorecard, pause) only while a round is on. */
  setPlaying(on: boolean): void {
    for (const c of this.cards) c.style.visibility = on ? "" : "hidden";
  }

  /** Announces a line to assistive tech. */
  announce(text: string): void {
    this.live.textContent = text;
  }

  /** Shows the current hole card. */
  setHole(n: number, of: number, name: string, par: number): void {
    this.holeNum.textContent = `${n}/${of}`;
    this.holeName.textContent = name;
    this.parChip.textContent = `par ${par}`;
  }

  /** Strokes on the current hole. */
  setStrokes(n: number): void {
    const s = String(n);
    if (this.strokesNum.textContent !== s) this.strokesNum.textContent = s;
  }

  /** Scorecard strip + to-par total (finished holes only). */
  setCard(card: readonly number[], pars: readonly number[], current: number): void {
    const key = `${card.join(",")}|${current}`;
    if (key === this.lastStrip) return;
    this.lastStrip = key;
    const cells = scorecardCells(card, pars);
    this.strip.replaceChildren(
      ...cells.map((c, i) => {
        const cell = el("i", c ? c.tone : i === current ? "now" : "", c ? String(c.strokes) : "");
        return cell;
      }),
    );
    const total = card.reduce((a, b) => a + b, 0);
    const par = pars.slice(0, card.length).reduce((a, b) => a + b, 0);
    this.toPar.textContent = formatToPar(total, par);
  }

  /** Power meter (0..1) or hidden (null); stepped in `POWER_BLOCKS`. */
  setPower(p: number | null): void {
    const n = p === null ? -1 : Math.round(Math.max(0, Math.min(1, p)) * POWER_BLOCKS);
    if (n === this.lastPower) return;
    this.lastPower = n;
    this.power.style.display = n < 0 ? "none" : "";
    this.powerBlocks.forEach((b, i) => b.classList.toggle("on", i < n));
  }

  /** Aim preview dots (null hides them). */
  setAim(dots: readonly AimDot[] | null, full: boolean): void {
    const list = dots ?? [];
    while (this.dots.length < list.length) {
      const d = el("div", "pp-dot");
      this.layer.append(d);
      this.dots.push(d);
    }
    this.dots.forEach((d, i) => {
      const a = list[i];
      if (!a || !a.p) {
        d.style.display = "none";
        return;
      }
      d.style.display = "";
      const size = a.kind === "land" ? 11 : 7;
      d.className = `pp-dot${a.kind === "drop" ? " drop" : full ? " full" : ""}${a.kind === "land" ? " land" : ""}`;
      d.style.transform = `translate(${Math.round(a.p.x - size / 2)}px,${Math.round(a.p.y - size / 2)}px)`;
    });
  }

  /** A projected callout that follows `anchor` and floats up in 4 steps. */
  callout(text: string, tone: PuttTone, anchor: () => ScreenPoint, now: number, life = 900): void {
    const e = el("div", `pp-pop ${tone}`, text);
    this.layer.append(e);
    this.pops.push({ el: e, born: now, life, anchor });
  }

  /** A big centred banner, with an optional sub-line card. */
  banner(text: string, tone: PuttTone, now: number, ms: number, sub?: string): void {
    this.bannerEl?.el.remove();
    const e = el("div", `pp-banner ${tone}`, text);
    if (sub) e.append(el("small", "", sub));
    this.root.append(e);
    this.bannerEl = { el: e, until: now + ms };
  }

  /** Bottom hint card (null hides it). */
  hint(text: string | null): void {
    if (text === null) {
      this.hintEl?.remove();
      this.hintEl = null;
      return;
    }
    if (!this.hintEl) {
      this.hintEl = el("div", "pp-hint");
      this.root.append(this.hintEl);
    }
    this.hintEl.textContent = text;
  }

  /** Resume countdown blocks (0 hides). */
  setCountdown(n: number): void {
    if (n <= 0) {
      this.countEl?.remove();
      this.countEl = null;
      return;
    }
    if (!this.countEl) {
      this.countEl = el("div", "pp-count");
      this.root.append(this.countEl);
    }
    if (this.countEl.childElementCount !== n) this.countEl.replaceChildren(...Array.from({ length: n }, () => el("i")));
  }

  /** Opens a modal card (closing any other) and returns its body. Focus moves to the first button added. */
  openModal(title: string): HTMLElement {
    this.closeModal();
    const veil = el("div", "pp-veil");
    const card = el("div", "pp-modal");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
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

  /** True while a modal is open. */
  get modalOpen(): boolean {
    return this.modal !== null;
  }

  /** Adds a 44 px button; the first primary button of a modal takes focus. */
  button(parent: HTMLElement, label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const b = el("button", `pp-btn${primary ? " primary" : ""}`, label);
    b.type = "button";
    b.addEventListener("click", onClick);
    parent.append(b);
    if (primary) queueMicrotask(() => b.focus({ preventScroll: true }));
    return b;
  }

  /** Per-frame: moves callouts (stepped rise), expires banners. */
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
      const at = p.anchor();
      if (!at) {
        p.el.style.display = "none";
        continue;
      }
      p.el.style.display = "";
      const step = this.reducedMotion ? 0 : Math.min(3, Math.floor((age / p.life) * 4));
      const w = p.el.offsetWidth;
      p.el.style.transform = `translate(${Math.round(at.x - w / 2)}px,${Math.round(at.y - 28 - step * 8)}px)`;
    }
    if (this.bannerEl && now > this.bannerEl.until) {
      this.bannerEl.el.remove();
      this.bannerEl = null;
    }
  }

  /** Removes the overlay. */
  dispose(): void {
    this.root.remove();
  }
}
