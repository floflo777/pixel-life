/**
 * Bump Sumo HUD, a DOM overlay in the art bible's 1-bit card language: round card with winner pips, four fighter cards
 * (live pixel silhouette = health = weight), projected callouts and the charge meter, big stepped banners
 * ("FIGHT!", "RING OUT!"), touch controls (drag stick + SHOVE button), and the start / pause / results cards. It is
 * dumb: the venue computes strings and screen points and pushes them in. Motion is stepped (no easing).
 */
import { SumoPx } from "@pl/shared";
import { FIGHTER_CSS } from "./format";

const CSS = `
.bs-hud{position:absolute;inset:0;pointer-events:none;font-family:'Sometype Mono','Courier New',monospace;color:#111;
  --ink:#111;--paper:#eee;--signal:#CCFF00;--coral:#ED927E;user-select:none;-webkit-user-select:none;overflow:hidden;z-index:5;
  -webkit-touch-callout:none}
.bs-hud *{box-sizing:border-box}
.bs-num{font-family:Silkscreen,'Courier New',monospace;font-weight:700;line-height:1}
.bs-top{position:absolute;left:0;right:0;top:10px;display:flex;flex-direction:column;align-items:center;gap:6px;padding:0 60px}
.bs-round{background:var(--ink);color:var(--paper);padding:5px 14px;box-shadow:3px 3px 0 #0006;display:flex;align-items:center;gap:10px}
.bs-round .bs-num{font-size:18px;text-transform:uppercase}
.bs-pips{display:flex;gap:3px}.bs-pips i{width:12px;height:12px;border:2px solid var(--paper);display:block}
.bs-cards{display:flex;gap:6px;flex-wrap:nowrap}
.bs-card{width:94px;background:var(--paper);border:2px solid var(--ink);box-shadow:3px 3px 0 var(--ink);padding:0 0 4px;position:relative}
.bs-card b{display:block;height:5px}
.bs-card .bs-row{display:flex;gap:5px;align-items:center;padding:4px 5px 0}
.bs-card canvas{width:30px;height:30px;image-rendering:pixelated;border:1px solid var(--ink);background:var(--paper);flex:none}
.bs-card .bs-name{font-size:10px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bs-card .bs-px{font-size:13px;white-space:nowrap}
.bs-card .bs-wins{display:flex;gap:2px;padding:3px 5px 0}.bs-card .bs-wins i{width:8px;height:5px;border:1px solid var(--ink);display:block}
.bs-card .bs-wins i.on{background:var(--ink)}
.bs-card.out{opacity:.45}.bs-card.out::after{content:'OUT';position:absolute;right:4px;top:8px;font-family:Silkscreen,monospace;
  font-size:10px;background:var(--coral);border:1px solid var(--ink);padding:0 2px}
.bs-card.me{outline:2px solid var(--ink);outline-offset:1px}
.bs-pause{position:absolute;left:10px;top:10px;width:44px;height:44px;pointer-events:auto;cursor:pointer;font-family:Silkscreen,monospace;
  background:var(--paper);border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);font-size:14px;color:var(--ink)}
.bs-pause:active{box-shadow:none;transform:translate(2px,2px)}
.bs-pause:focus-visible,.bs-btn:focus-visible,.bs-shove:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.bs-pop{position:absolute;left:0;top:0;font-family:Silkscreen,monospace;font-weight:700;font-size:18px;white-space:nowrap;
  -webkit-text-stroke:2px var(--ink);paint-order:stroke fill;text-shadow:2px 2px 0 var(--ink);text-transform:uppercase}
.bs-pop.coral{color:var(--coral)}.bs-pop.paper{color:var(--paper)}.bs-pop.lime{color:var(--signal)}
.bs-meter{position:absolute;left:0;top:0;display:flex;gap:2px;transform:translate(-50%,-100%)}
.bs-meter i{width:9px;height:9px;border:2px solid var(--ink);background:var(--paper);display:block}
.bs-meter i.on{background:var(--signal)}.bs-meter.full i.on{background:var(--coral)}
.bs-banner{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);font-family:Silkscreen,monospace;font-weight:700;
  font-size:52px;color:var(--paper);-webkit-text-stroke:3px var(--ink);paint-order:stroke fill;text-shadow:5px 5px 0 var(--ink);
  text-transform:uppercase;white-space:nowrap;text-align:center}
.bs-banner.lime{color:var(--signal)}.bs-banner.coral{color:var(--coral)}
.bs-banner small{display:block;font-size:16px;-webkit-text-stroke:2px var(--ink);text-shadow:2px 2px 0 var(--ink);margin-top:6px}
.bs-hint{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);font-size:12px;background:var(--paper);border:2px solid var(--ink);
  padding:3px 8px;box-shadow:2px 2px 0 var(--ink);white-space:nowrap}
.bs-chip{position:absolute;left:50%;bottom:48px;transform:translateX(-50%);font-size:11px;background:var(--ink);color:var(--signal);padding:2px 8px}
.bs-shove{position:absolute;right:18px;bottom:22px;width:92px;height:92px;pointer-events:auto;touch-action:none;cursor:pointer;
  font-family:Silkscreen,monospace;font-weight:700;font-size:15px;background:var(--signal);color:var(--ink);border:3px solid var(--ink);
  box-shadow:4px 4px 0 var(--ink);display:none;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.bs-shove.on{display:flex}.bs-shove.held{box-shadow:none;transform:translate(4px,4px)}
.bs-shove .bs-blocks{display:flex;gap:2px}.bs-shove .bs-blocks i{width:8px;height:8px;border:2px solid var(--ink);background:var(--paper);display:block}
.bs-shove .bs-blocks i.on{background:var(--ink)}
.bs-stick{position:absolute;width:88px;height:88px;border:2px dashed var(--ink);border-radius:50%;transform:translate(-50%,-50%);display:none}
.bs-stick i{position:absolute;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;background:var(--ink);display:block}
.bs-veil{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;
  background-image:radial-gradient(#1116 30%,transparent 31%);background-size:4px 4px}
.bs-modal{position:relative;background:var(--paper);border:2px solid var(--ink);box-shadow:6px 6px 0 var(--ink);padding:16px 18px;
  max-width:min(480px,calc(100% - 32px));width:100%;max-height:calc(100% - 32px);overflow:auto}
.bs-modal h2{font-family:Silkscreen,monospace;font-size:24px;margin:0 0 6px;text-transform:uppercase}
.bs-modal p{font-size:12px;margin:6px 0;line-height:1.4}
.bs-modal ul{font-size:12px;margin:6px 0;padding-left:18px;line-height:1.45}
.bs-btn{min-height:44px;padding:8px 14px;font-family:Silkscreen,monospace;font-size:14px;background:var(--paper);color:var(--ink);
  border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink);cursor:pointer;text-transform:uppercase;margin:8px 8px 0 0}
.bs-btn.primary{background:var(--signal)}.bs-btn:active{box-shadow:none;transform:translate(2px,2px)}
.bs-roster{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0}
.bs-roster>div{border:2px solid var(--ink);padding:4px;font-size:10px;text-align:center;line-height:1.25}
.bs-roster canvas{width:48px;height:48px;image-rendering:pixelated;display:block;margin:2px auto}
.bs-res dl{margin:6px 0;display:grid;grid-template-columns:auto auto;gap:3px 14px;font-size:12px}
.bs-res dd{margin:0;font-family:Silkscreen,monospace;font-weight:700}
.bs-tag{font-size:10px;background:var(--ink);color:var(--paper);padding:0 4px;margin-left:4px}
@media (max-width:520px){.bs-top{padding:0 8px;gap:20px}.bs-round{margin-left:40px}.bs-cards{gap:4px}
  .bs-card{width:min(80px,calc((100vw - 28px) / 4))}.bs-card .bs-row{padding:3px 3px 0;gap:3px}
  .bs-card canvas{width:22px;height:22px}.bs-card .bs-px{font-size:11px}.bs-card .bs-name{font-size:9px}.bs-banner{font-size:34px}.bs-round .bs-num{font-size:14px}.bs-hint{font-size:10px;white-space:normal;width:calc(100% - 140px);left:12px;transform:none}}
`;

/** A projected screen point (CSS px) or null when off-screen. */
export type ScreenPoint = { readonly x: number; readonly y: number } | null;

/** Per-fighter card data. */
export interface CardState {
  readonly present: number;
  readonly total: number;
  readonly wins: number;
  readonly out: boolean;
  readonly pixels: Uint8Array;
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

/** Draws a 16×16 pixel state map (body ink, loose lime, gone coral, scar lilac) into a canvas. */
export function drawPixels(c: HTMLCanvasElement, pixels: Uint8Array, scale = 2): void {
  c.width = 16 * scale;
  c.height = 16 * scale;
  const g = c.getContext("2d");
  if (!g) return;
  g.fillStyle = "#eeeeee";
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 256; i++) {
    const s = pixels[i];
    if (!s) continue;
    g.fillStyle =
      s === SumoPx.Body ? "#111111" : s === SumoPx.Loose ? "#CCFF00" : s === SumoPx.Gone ? "#ED927E" : "#B3A0D8";
    g.fillRect((i & 15) * scale, (i >> 4) * scale, scale, scale);
  }
}

/** The Bump Sumo overlay. */
export class SumoHud {
  readonly root: HTMLElement;
  private readonly style: HTMLStyleElement;
  private readonly roundNum: HTMLElement;
  private readonly roundPips: HTMLElement[] = [];
  private readonly cards: {
    el: HTMLElement;
    canvas: HTMLCanvasElement;
    px: HTMLElement;
    wins: HTMLElement[];
    key: string;
  }[] = [];
  private readonly meter: HTMLElement;
  private readonly meterBlocks: HTMLElement[] = [];
  private readonly banner: HTMLElement;
  private bannerUntil = 0;
  private readonly hintEl: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly pops: Pop[] = [];
  private modal: HTMLElement | null = null;
  readonly pauseBtn: HTMLButtonElement;
  readonly shoveBtn: HTMLButtonElement;
  private readonly shoveBlocks: HTMLElement[] = [];
  private readonly stick: HTMLElement;
  private readonly stickKnob: HTMLElement;

  constructor(
    parent: HTMLElement,
    labels: readonly { name: string; family: string; trait: string }[],
    private readonly reducedMotion: boolean,
  ) {
    this.style = el("style");
    this.style.textContent = CSS;
    document.head.append(this.style);
    this.root = el("div", "bs-hud");
    this.root.setAttribute("aria-live", "polite");
    const top = el("div", "bs-top");
    const round = el("div", "bs-round");
    this.roundNum = el("span", "bs-num", "round 1/3");
    const pips = el("span", "bs-pips");
    for (let i = 0; i < 3; i++) {
      const p = el("i");
      this.roundPips.push(p);
      pips.append(p);
    }
    round.append(this.roundNum, pips);
    const cards = el("div", "bs-cards");
    labels.forEach((l, slot) => {
      const card = el("div", `bs-card${slot === 0 ? " me" : ""}`);
      card.setAttribute("aria-label", `${l.name}, ${l.family}, ${l.trait}`);
      const strip = el("b");
      strip.style.background = FIGHTER_CSS[slot] ?? "#eee";
      const row = el("div", "bs-row");
      const canvas = el("canvas");
      const txt = el("div");
      const name = el("div", "bs-name", l.name);
      const px = el("div", "bs-num bs-px", "0px");
      txt.append(name, px);
      row.append(canvas, txt);
      const wins = el("div", "bs-wins");
      const winEls: HTMLElement[] = [];
      for (let i = 0; i < 3; i++) {
        const w = el("i");
        winEls.push(w);
        wins.append(w);
      }
      card.append(strip, row, wins);
      cards.append(card);
      this.cards.push({ el: card, canvas, px, wins: winEls, key: "" });
    });
    top.append(round, cards);
    this.pauseBtn = el("button", "bs-pause", "II");
    this.pauseBtn.type = "button";
    this.pauseBtn.setAttribute("aria-label", "pause");
    this.meter = el("div", "bs-meter");
    for (let i = 0; i < 6; i++) {
      const b = el("i");
      this.meterBlocks.push(b);
      this.meter.append(b);
    }
    this.meter.style.display = "none";
    this.banner = el("div", "bs-banner");
    this.banner.style.display = "none";
    this.hintEl = el("div", "bs-hint");
    this.hintEl.style.display = "none";
    this.chip = el("div", "bs-chip");
    this.chip.style.display = "none";
    this.shoveBtn = el("button", "bs-shove");
    this.shoveBtn.type = "button";
    this.shoveBtn.setAttribute("aria-label", "shove: hold to charge, release to shove, tap to dodge");
    const blocks = el("span", "bs-blocks");
    for (let i = 0; i < 6; i++) {
      const b = el("i");
      this.shoveBlocks.push(b);
      blocks.append(b);
    }
    this.shoveBtn.append(el("span", "", "shove"), blocks);
    this.stick = el("div", "bs-stick");
    this.stickKnob = el("i");
    this.stick.append(this.stickKnob);
    this.root.append(top, this.pauseBtn, this.meter, this.banner, this.hintEl, this.chip, this.stick, this.shoveBtn);
    parent.append(this.root);
  }

  /** Shows touch controls (the SHOVE button) once a coarse pointer is seen. */
  setTouch(on: boolean): void {
    this.shoveBtn.classList.toggle("on", on);
  }

  /** Round label and winner pips (winner slot per finished round). */
  setRound(round: number, winners: readonly number[]): void {
    this.roundNum.textContent = `round ${Math.min(3, round + 1)}/3`;
    this.roundPips.forEach((p, i) => {
      const w = winners[i];
      p.style.background = w === undefined ? "transparent" : w < 0 ? "#555" : (FIGHTER_CSS[w] ?? "#eee");
    });
  }

  /** Updates the four fighter cards (silhouettes redraw only when their pixels change). */
  setCards(states: readonly CardState[]): void {
    states.forEach((s, i) => {
      const c = this.cards[i];
      if (!c) return;
      c.px.textContent = `${s.present}px`;
      c.el.classList.toggle("out", s.out);
      c.wins.forEach((w, k) => w.classList.toggle("on", k < s.wins));
      let key = "";
      for (let p = 0; p < 256; p++) key += String(s.pixels[p] ?? 0);
      if (key !== c.key) {
        c.key = key;
        drawPixels(c.canvas, s.pixels, 2);
      }
    });
  }

  /** The player's charge meter above its head (null hides it); `steps` 0..6. */
  setMeter(at: ScreenPoint, steps: number): void {
    const show = at !== null && steps > 0;
    this.meter.style.display = show ? "flex" : "none";
    this.meterBlocks.forEach((b, i) => b.classList.toggle("on", i < steps));
    this.shoveBlocks.forEach((b, i) => b.classList.toggle("on", i < steps));
    this.meter.classList.toggle("full", steps >= 6);
    if (show && at) this.meter.style.transform = `translate(${Math.round(at.x - 36)}px,${Math.round(at.y)}px)`;
  }

  /** A big stepped banner for `ms`; `sub` is a smaller second line. */
  showBanner(text: string, tone: "paper" | "lime" | "coral", now: number, ms = 1000, sub?: string): void {
    this.banner.className = `bs-banner ${tone}`;
    this.banner.textContent = text;
    if (sub) this.banner.append(el("small", "", sub));
    this.banner.style.display = "block";
    this.bannerUntil = now + ms;
    this.bannerBorn = now;
  }

  private bannerBorn = 0;

  /** A floating callout following `anchor` for `life` ms. */
  callout(text: string, tone: "paper" | "lime" | "coral", anchor: () => ScreenPoint, now: number, life = 800): void {
    const e = el("div", `bs-pop ${tone}`, text);
    this.root.append(e);
    this.pops.push({ el: e, born: now, life, anchor });
    while (this.pops.length > 10) this.pops.shift()?.el.remove();
  }

  /** Bottom hint (null hides). */
  hint(text: string | null): void {
    this.hintEl.style.display = text ? "block" : "none";
    if (text) this.hintEl.textContent = text;
  }

  /** Small status chip above the hint (null hides). */
  setChip(text: string | null): void {
    this.chip.style.display = text ? "block" : "none";
    if (text) this.chip.textContent = text;
  }

  /** Touch stick ring at its press point with the knob offset (null hides). */
  setStick(at: ScreenPoint, dx = 0, dy = 0): void {
    this.stick.style.display = at ? "block" : "none";
    if (!at) return;
    this.stick.style.left = `${at.x}px`;
    this.stick.style.top = `${at.y}px`;
    const l = Math.hypot(dx, dy);
    const k = l > 30 ? 30 / l : 1;
    this.stickKnob.style.transform = `translate(${Math.round(dx * k)}px,${Math.round(dy * k)}px)`;
  }

  /** Press state of the SHOVE button. */
  setShoveHeld(held: boolean): void {
    this.shoveBtn.classList.toggle("held", held);
  }

  /** Per-frame: banner timing and stepped scale, callouts rising in steps. */
  frame(now: number): void {
    if (this.banner.style.display !== "none") {
      if (now > this.bannerUntil) this.banner.style.display = "none";
      else {
        // Stepped pop-in: 1.3 → 1.0 over 3 steps.
        const k = this.reducedMotion ? 1 : ([1.3, 1.12, 1][Math.min(2, Math.floor((now - this.bannerBorn) / 50))] ?? 1);
        this.banner.style.transform = `translate(-50%,-50%) scale(${k})`;
      }
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      if (!p) continue;
      const age = now - p.born;
      const at = p.anchor();
      if (age > p.life || !at) {
        p.el.remove();
        this.pops.splice(i, 1);
        continue;
      }
      const rise = this.reducedMotion ? 0 : Math.floor((age / p.life) * 4) * 8;
      p.el.style.transform = `translate(${Math.round(at.x)}px,${Math.round(at.y - rise)}px) translate(-50%,-100%)`;
    }
  }

  /** Opens a modal card titled `title`; returns its body. */
  openModal(title: string): HTMLElement {
    this.closeModal();
    const veil = el("div", "bs-veil");
    const card = el("div", "bs-modal");
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

  /** True while a modal is open. */
  get modalOpen(): boolean {
    return this.modal !== null;
  }

  /** A button in a modal body; the primary one takes focus (keyboard parity). */
  button(parent: HTMLElement, label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const b = el("button", `bs-btn${primary ? " primary" : ""}`, label);
    b.type = "button";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    parent.append(b);
    if (primary) queueMicrotask(() => b.focus({ preventScroll: true }));
    return b;
  }

  /** Removes the overlay and its stylesheet. */
  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}
