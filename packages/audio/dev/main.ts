/** Dev-only audition page for @pl/audio. Run with `npm run dev -w @pl/audio`. */
import { AudioEngine, CUES, CUE_NAMES, LAYERS, STINGER_NAMES, renderPatch } from "../src/index";
import type { Bus, CueGroup, CueName, PlayParams, ThemeName } from "../src/index";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const engine = new AudioEngine();
engine.unlockOnGesture(window);

const status = el<HTMLSpanElement>("status");
const voices = el<HTMLSpanElement>("voices");
const params: PlayParams = { x: 0.5, step: 0, gain: 1 };

// ── Global controls ─────────────────────────────────────────────────────────
el<HTMLButtonElement>("unlock").addEventListener("click", () => {
  void engine.unlock().then((ok) => {
    if (ok) void engine.prewarmInBackground();
  });
});

const mute = el<HTMLInputElement>("mute");
mute.addEventListener("change", () => engine.setMuted(mute.checked));
window.addEventListener("keydown", (e) => {
  if (e.key === "m" && !(e.target instanceof HTMLInputElement && e.target.type === "text")) {
    mute.checked = !mute.checked;
    engine.setMuted(mute.checked);
  }
});
const reduced = el<HTMLInputElement>("reduced");
reduced.checked = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
engine.setReducedAudio(reduced.checked);
reduced.addEventListener("change", () => engine.setReducedAudio(reduced.checked));
for (const bus of ["master", "music", "sfx"] as Bus[]) {
  const input = el<HTMLInputElement>(`vol-${bus}`);
  input.value = String(engine.volume(bus));
  input.addEventListener("input", () => engine.setVolume(bus, Number(input.value)));
}

function bindRange(id: string, apply: (v: number) => void, digits = 2): void {
  const input = el<HTMLInputElement>(id);
  const out = el<HTMLSpanElement>(`${id}-v`);
  const update = (): void => {
    const v = Number(input.value);
    out.textContent = v.toFixed(digits);
    apply(v);
  };
  input.addEventListener("input", update);
  update();
}
bindRange("p-x", (v) => (params.x = v));
bindRange("p-step", (v) => (params.step = v), 0);
bindRange("p-gain", (v) => (params.gain = v));
const autoStep = el<HTMLInputElement>("p-auto");

function play(cue: CueName): void {
  engine.play(cue, params);
  if (autoStep.checked) {
    const next = ((params.step ?? 0) + 1) % 11;
    params.step = next;
    el<HTMLInputElement>("p-step").value = String(next);
    el<HTMLSpanElement>("p-step-v").textContent = String(next);
  }
}

// ── Cue grid ────────────────────────────────────────────────────────────────
function drawWave(canvas: HTMLCanvasElement, cue: CueName): void {
  const pcm = renderPatch(CUES[cue].patch, 8000);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = (canvas.width = 160);
  const h = (canvas.height = 28);
  ctx.fillStyle = getComputedStyle(document.body).color;
  const per = Math.max(1, Math.floor(pcm.length / w));
  for (let x = 0; x < w; x++) {
    let peak = 0;
    for (let i = x * per; i < (x + 1) * per && i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i] ?? 0));
    const bar = Math.max(1, Math.round(peak * h));
    ctx.fillRect(x, (h - bar) / 2, 1, bar);
  }
}

const groups = new Map<CueGroup, CueName[]>();
for (const name of CUE_NAMES) {
  const g = CUES[name].group;
  groups.set(g, [...(groups.get(g) ?? []), name]);
}
const cuesRoot = el<HTMLDivElement>("cues");
for (const [group, names] of groups) {
  const card = document.createElement("div");
  card.className = `card group-${group}`;
  const title = document.createElement("h2");
  title.textContent = group;
  title.style.marginTop = "0";
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const name of names) {
    const def = CUES[name];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cue";
    const flags = [
      def.step !== "none" ? `step:${def.step}` : "",
      def.essential ? "" : "non-essential",
      def.duck ? `duck ${def.duck.db}dB` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    button.innerHTML = `<span class="name"></span><span class="label"></span><canvas aria-hidden="true"></canvas><span class="label"></span>`;
    const [nameEl, labelEl, canvas, flagsEl] = Array.from(button.children) as [
      HTMLElement,
      HTMLElement,
      HTMLCanvasElement,
      HTMLElement,
    ];
    nameEl.textContent = name;
    labelEl.textContent = def.label;
    flagsEl.textContent = `p${def.priority} · max ${def.maxVoices}${flags ? ` · ${flags}` : ""}`;
    button.addEventListener("click", () => play(name));
    if ("requestIdleCallback" in window) window.requestIdleCallback(() => drawWave(canvas, name));
    else drawWave(canvas, name);
    grid.append(button);
  }
  card.append(title, grid);
  cuesRoot.append(card);
}

// ── Sequences (gameplay-shaped demos) ───────────────────────────────────────
const seq: PlayParams = {};
function sequence(label: string, run: () => void): void {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", run);
  el<HTMLDivElement>("sequences").append(b);
}
sequence("fling: charge 0→7 + release", () => {
  for (let s = 0; s < 8; s++) {
    seq.step = s;
    seq.delay = s * 0.1;
    seq.gain = 1;
    seq.x = 0.5;
    engine.play("fling.charge", seq);
  }
  seq.step = 0;
  seq.delay = 0.85;
  engine.play("fling.release", seq);
});
sequence("combo ×6 smash (pans left→right)", () => {
  const cast: CueName[] = ["smash.nib", "smash.pogo", "smash.nib", "smash.clank", "smash.fizz", "smash.snatch"];
  cast.forEach((cue, i) => {
    seq.step = i;
    seq.delay = i * 0.14;
    seq.x = i / 5;
    engine.play(cue, seq);
  });
});
sequence("bite → 3 px pop → sweep-back ×3 + clutch", () => {
  seq.x = 0.5;
  seq.step = 0;
  seq.delay = 0;
  engine.play("bite", seq);
  engine.play("slowmo.in", seq);
  engine.music.setSlowmo(1);
  for (let i = 0; i < 3; i++) {
    seq.delay = 0.05 + i * 0.05;
    seq.x = 0.3 + i * 0.2;
    engine.play("pixel.pop", seq);
  }
  window.setTimeout(() => engine.music.setSlowmo(0.5), 400);
  window.setTimeout(() => {
    engine.music.setSlowmo(0);
    seq.delay = 0;
    engine.play("slowmo.out", seq);
  }, 560);
  for (let i = 0; i < 3; i++) {
    seq.step = i;
    seq.delay = 0.9 + i * 0.12;
    engine.play("pixel.sweep", seq);
  }
  seq.step = 0;
  seq.delay = 1.3;
  engine.play("pixel.clutch", seq);
});
sequence("fizz fuse 4→12 Hz", () => {
  let t = 0;
  for (let i = 0; i < 12; i++) {
    const hz = 4 + (8 * i) / 11;
    seq.delay = t;
    seq.step = Math.floor(i / 3);
    engine.play("tele.fizz", seq);
    t += 1 / hz;
  }
  seq.delay = t;
  seq.step = 0;
  engine.play("smash.fizz", seq);
});
sequence("old gulp event", () => {
  seq.x = 0.5;
  seq.delay = 0;
  seq.step = 0;
  engine.music.setMood("gulp");
  el<HTMLInputElement>("m-gulp").checked = true;
  engine.play("gulp.rumble", seq);
  seq.delay = 2;
  engine.play("gulp.bite", seq);
  for (let i = 0; i < 3; i++) {
    seq.step = i;
    seq.delay = 3 + i * 0.8;
    engine.play("gulp.tooth", seq);
  }
  seq.step = 0;
  seq.delay = 5.6;
  engine.play("gulp.burp", seq);
  window.setTimeout(() => {
    engine.music.setMood("normal");
    engine.music.stinger("burp");
    el<HTMLInputElement>("m-gulp").checked = false;
  }, 5600);
});
sequence("regrow 12 px + mend", () => {
  for (let i = 0; i < 12; i++) {
    seq.step = i % 11;
    seq.delay = i * 0.09;
    seq.x = 0.5;
    engine.play("regrow.sparkle", seq);
  }
  seq.step = 0;
  seq.delay = 1.3;
  engine.play("mend.chime", seq);
});
sequence("hub walk (8 steps)", () => {
  for (let i = 0; i < 8; i++) {
    seq.delay = i * 0.26;
    seq.x = i % 2 === 0 ? 0.45 : 0.55;
    seq.step = 0;
    engine.play("hub.step", seq);
  }
});

// ── Music ───────────────────────────────────────────────────────────────────
const theme = el<HTMLSelectElement>("m-theme");
const seed = el<HTMLInputElement>("m-seed");
el<HTMLButtonElement>("m-play").addEventListener("click", () => {
  void engine.unlock().then(() => engine.music.play(theme.value as ThemeName, seed.value));
});
el<HTMLButtonElement>("m-stop").addEventListener("click", () => engine.music.stop());
el<HTMLButtonElement>("m-stop-bar").addEventListener("click", () => {
  engine.music.stinger("fill");
  engine.music.stop({ at: "bar" });
});
const gulp = el<HTMLInputElement>("m-gulp");
gulp.addEventListener("change", () => engine.music.setMood(gulp.checked ? "gulp" : "normal"));
const intensity = el<HTMLInputElement>("m-int");
bindRange("m-int", (v) => engine.music.setIntensity(v));
bindRange("m-slow", (v) => engine.music.setSlowmo(v));

const phases: [string, number][] = [
  ["drop-in", 0.05],
  ["wave 1", 0.3],
  ["wave 2", 0.6],
  ["frenzy", 0.9],
];
for (const [label, value] of phases) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", () => {
    intensity.value = String(value);
    intensity.dispatchEvent(new Event("input"));
  });
  el<HTMLSpanElement>("m-phases").append(b);
}
for (const name of STINGER_NAMES) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = `stinger: ${name}`;
  b.addEventListener("click", () => engine.music.stinger(name));
  el<HTMLDivElement>("m-stingers").append(b);
}
const meters = LAYERS.map((layer) => {
  const m = document.createElement("div");
  m.className = "meter";
  m.innerHTML = `<span class="cap"></span><div class="fill"></div>`;
  const cap = m.querySelector<HTMLSpanElement>(".cap");
  if (cap) cap.textContent = layer;
  el<HTMLDivElement>("m-meters").append(m);
  return m.querySelector<HTMLDivElement>(".fill");
});

function frame(): void {
  status.textContent = engine.status + (engine.music.playing ? ` · ${engine.music.theme ?? ""}` : "");
  voices.textContent = String(engine.activeVoices());
  el<HTMLSpanElement>("m-bar").textContent = engine.music.bar >= 0 ? String(engine.music.bar) : "–";
  const levels = engine.music.layerTargets;
  meters.forEach((fill, i) => {
    if (fill) fill.style.height = `${Math.round((engine.music.playing ? (levels[i] ?? 0) : 0) * 100)}%`;
  });
  requestAnimationFrame(frame);
}
frame();
