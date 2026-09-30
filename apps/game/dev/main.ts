import { Vector3 } from "three";
import { anchorWorld } from "../src/world/island";
import { createStage, type SharedStage } from "../src/stage/stage";
import type { QualityTier } from "../src/stage/quality";
import { buildPlaza } from "./plaza";

const q = new URLSearchParams(location.search);
const tierParam = q.get("quality");
const quality: QualityTier | undefined =
  tierParam === "high" || tierParam === "medium" || tierParam === "low" ? tierParam : undefined;
const reducedMotion = q.get("rm") === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLDivElement;
const statsEl = document.getElementById("stats") as HTMLDivElement;

let stage: SharedStage;
try {
  stage = createStage(canvas, { reducedMotion, ...(quality ? { quality } : {}) });
} catch (e) {
  document.body.textContent = `stage unavailable: ${String(e)}`;
  throw e;
}

const plaza = buildPlaza();
stage.scene.add(plaza.root);
stage.post.haloWidth = 1;
stage.post.glowGain = 1.1;
stage.rig.pose = { yaw: 0.8, pitch: 28, distance: 21, fov: 30 };
stage.rig.baseYaw = 0.8;
stage.rig.minVisibleWidth = 19;
stage.rig.snap(new Vector3(0, 1.75, -1.6));

// DOM overlays pinned to island anchors (the real HUD belongs to the hub scene; these check anchors).
const pin = (html: string, cls: string, anchor: string): { el: HTMLDivElement; anchor: string } => {
  const el = document.createElement("div");
  el.className = `card ${cls}`;
  el.innerHTML = html;
  ui.appendChild(el);
  return { el, anchor };
};
const pins = [
  pin("PIXEL LIFE", "inv", "pixel-life:marquee"),
  pin("● 6 playing · enter", "pill", "pixel-life:pill"),
  pin("DAILY STONE", "", "daily-stone:label"),
  pin("GREENHOUSE", "", "greenhouse:label"),
];
const tmp = new Vector3();
const placePins = (): void => {
  const r = canvas.getBoundingClientRect();
  for (const p of pins) {
    const w = anchorWorld(plaza.main, p.anchor, tmp);
    if (!w) continue;
    w.project(stage.camera);
    p.el.style.left = `${Math.round(((w.x + 1) / 2) * r.width)}px`;
    p.el.style.top = `${Math.round(((1 - w.y) / 2) * r.height)}px`;
  }
};

// Interaction: drag orbits within the yaw clamp, tap = local burst, I = impact frame, space = dip, S = shake.
let dragYaw = 0;
stage.input.on((e) => {
  if (e.type === "drag") stage.rig.pose.yaw = dragYaw - e.vector.x * 0.08;
  if (e.type === "dragstart") dragYaw = stage.rig.pose.yaw;
  if (e.type === "tap") {
    const { width, height } = stage.post.internalSize;
    stage.post.impacts.requestBurst((e.at.ndcX * 0.5 + 0.5) * width, (e.at.ndcY * 0.5 + 0.5) * height);
    stage.rig.shake(0.3);
  }
  if (e.type === "key" && e.down) {
    if (e.code === "KeyI") stage.post.impacts.requestFrame(performance.now(), 2);
    if (e.code === "Space") stage.rig.dip(400);
    if (e.code === "KeyS") stage.rig.shake(0.6);
    if (e.code === "KeyP") statsEl.style.display = statsEl.style.display === "block" ? "none" : "block";
  }
});

let fpsT = 0;
let fpsN = 0;
let fps = 0;
stage.onFrame((dt) => {
  fpsT += dt;
  fpsN++;
  if (fpsT >= 0.5) {
    fps = fpsN / fpsT;
    fpsT = 0;
    fpsN = 0;
  }
  placePins();
  const s = stage.post.stats;
  statsEl.textContent = [
    `tier ${stage.quality}  ${fps.toFixed(0)} fps`,
    `internal ${s.internalWidth}×${s.internalHeight}`,
    `scene calls ${s.sceneCalls}  mask ${s.maskCalls}  total ${s.totalCalls}`,
    `scene tris ${s.sceneTriangles}`,
  ].join("\n");
});
if (q.get("stats") === "1") statsEl.style.display = "block";

const burstAt = q.get("burst");
if (burstAt) {
  const [bx, by] = burstAt.split(",").map(Number);
  if (bx !== undefined && by !== undefined) setTimeout(() => stage.post.impacts.requestBurst(bx, by), 300);
}

declare global {
  interface Window {
    __pl?: { ready: boolean; stage: SharedStage; triangles: number };
  }
}
// Signal readiness after a few frames so the capture never sees a half-uploaded scene.
let frames = 0;
const off = stage.onFrame(() => {
  if (++frames < 6) return;
  off();
  window.__pl = { ready: true, stage, triangles: plaza.triangles };
});
