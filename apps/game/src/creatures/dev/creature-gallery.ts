/**
 * Dev gallery for the Munchies and Old Gulp, rendered through the real stage (banded materials, keylines, dot bloom).
 *
 *   ?view=grid   every kind × its states (default)
 *   ?view=frame  the style-frame-1 composition: Friend, bonked Nib, Snatch carrying a pixel ("MINE!"), Slurp's tongue
 *   ?view=gulp   Old Gulp on the rim, teeth out, one tooth lit, plus its shadow wedge; &phase=&mood=&t=
 *
 * Screenshots: `npx tsx apps/game/src/creatures/dev/shoot.ts`. Sets `window.__creatures` when a frame is ready.
 */
import { BoxGeometry, Mesh, Vector3, type Object3D } from "three";
import { EMPTY_MASK } from "@pl/shared";
import { buildFriendModel } from "../../friend/model";
import { FIXTURE_FRIENDS } from "../../friend/dev/fixtures";
import { createBandMaterial } from "../../post/band-material";
import { tagHalo } from "../../post/tags";
import { createStage } from "../../stage/stage";
import { PALETTE } from "../../stage/palette";
import { buildClouds } from "../../world/clouds";
import { buildIsland } from "../../world/island";
import { attachProjectedShadow } from "../../world/projected-shadow";
import "./creature-gallery-types";
import { createGulpView, type GulpView } from "../gulp";
import { createGulpWedge } from "../gulp-wedge";
import { SpeechBubbles, type SpeechLine } from "../speech";
import { CREATURE_KINDS, type CreatureKind } from "../sprites";
import type { CreatureState, GulpMood, GulpPhase } from "../states";
import { createCreatureView, type CreatureView } from "../view";

const q = new URLSearchParams(location.search);
const mode = q.get("view") ?? "grid";
const animate = q.get("animate") === "1";
/** Stills keep every bubble up; animated mode uses the real 1.2 s. */
const hold = (line: SpeechLine): SpeechLine => (animate ? line : { ...line, duration: 1e6 });
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLDivElement;
const stage = createStage(canvas, { reducedMotion: false, quality: "high", preserveDrawingBuffer: true });
const bubbles = new SpeechBubbles(ui, stage.camera);
const views: CreatureView[] = [];
const gulps: GulpView[] = [];
const labels: { el: HTMLDivElement; at: Object3D; dy: number }[] = [];
const stats: Record<string, unknown> = { mode };
let clock = 0;

const label = (text: string, at: Object3D, dy = 0, cls = ""): void => {
  const el = document.createElement("div");
  el.className = `lbl ${cls}`;
  el.textContent = text;
  ui.appendChild(el);
  labels.push({ el, at, dy });
};
const tmp = new Vector3();
const placeLabels = (): void => {
  const r = canvas.getBoundingClientRect();
  for (const l of labels) {
    l.at.getWorldPosition(tmp);
    tmp.y += l.dy;
    tmp.project(stage.camera);
    l.el.style.left = `${Math.round(((tmp.x + 1) / 2) * r.width)}px`;
    l.el.style.top = `${Math.round(((1 - tmp.y) / 2) * r.height)}px`;
  }
};

const addView = (kind: CreatureKind, state: CreatureState, t: number, seed: number): CreatureView => {
  const v = createCreatureView(kind, { seed });
  v.onSpeak((line) => bubbles.show(hold(line), clock));
  v.setState(state, 0);
  v.update(t);
  attachProjectedShadow(v.object, { groundY: 0 });
  views.push(v);
  return v;
};

/** An ink Friend pixel (loose or carried). */
const pixelMat = createBandMaterial({ color: PALETTE.body, lightMix: 0.26 });
const pixelGeo = new BoxGeometry(0.12, 0.12, 0.18);
const pixel = (at: Vector3, parent?: Object3D): Mesh => {
  const m = new Mesh(pixelGeo, pixelMat);
  m.position.copy(at);
  m.rotation.set(0.5, 0.7, 0.3);
  tagHalo(m);
  (parent ?? stage.scene).add(m);
  return m;
};

function grid(): void {
  // Per kind: the columns that matter (telegraph and attack always), each frozen at a telling moment.
  const COLS: readonly { title: string; state: (k: CreatureKind) => CreatureState; t: number; fx?: "hit" | "smash" }[] =
    [
      { title: "idle", state: (k) => (k === "slurp" ? "sleep" : "idle"), t: 0 },
      { title: "move", state: (k) => (k === "pogo" ? "airborne" : k === "slurp" ? "idle" : "move"), t: 0.1 },
      { title: "telegraph", state: () => "telegraph", t: 0.2 },
      { title: "attack", state: () => "attack", t: 0.1 },
      {
        title: "special",
        state: (k) =>
          k === "snatch"
            ? "carry"
            : k === "fizz"
              ? "projectile"
              : k === "nib"
                ? "flee"
                : k === "pogo"
                  ? "flee"
                  : "flee",
        t: 0.1,
      },
      { title: "stunned", state: () => "stunned", t: 0 },
      { title: "spawn", state: () => "spawn", t: 0.2 },
      { title: "hit", state: (k) => (k === "slurp" ? "idle" : "idle"), t: 0, fx: "hit" },
      { title: "smash", state: () => "idle", t: 0, fx: "smash" },
    ];
  const only = q.get("kind") as CreatureKind | null;
  const kinds = only && CREATURE_KINDS.includes(only) ? [only] : CREATURE_KINDS;
  const dx = only ? 2.3 : 1.9;
  const dz = 2.4;
  const ground = new Mesh(
    new BoxGeometry(COLS.length * dx + 1, 0.24, kinds.length * dz + 1),
    createBandMaterial({ color: PALETTE.meadow }),
  );
  ground.position.set(0, -0.12, 0);
  stage.scene.add(ground);
  const x0 = (-(COLS.length - 1) * dx) / 2;
  const z0 = (-(kinds.length - 1) * dz) / 2;
  const tris: Record<string, number> = {};
  kinds.forEach((kind, r) => {
    COLS.forEach((col, c) => {
      const v = addView(kind, col.state(kind), col.t, r * 10 + c);
      v.object.position.set(x0 + c * dx, kind === "snatch" ? 0.35 : 0, z0 + r * dz);
      if (kind === "slurp" && col.title === "attack")
        v.setTarget(new Vector3(x0 + c * dx + 0.2, 0.05, z0 + r * dz + 0.8));
      if (col.fx === "hit") {
        v.playHit();
        v.update(0.02);
      }
      if (col.fx === "smash") {
        v.playSmash();
        v.update(0.17);
      }
      if (kind === "snatch" && col.title === "special") pixel(new Vector3(0, 0, 0), v.carryAnchor);
      stage.scene.add(v.object);
      tris[kind] = Math.max(tris[kind] ?? 0, v.triangles);
    });
    const anchor = new Mesh();
    anchor.position.set(x0 - dx * 0.85, 0.2, z0 + r * dz);
    stage.scene.add(anchor);
    label(kind, anchor, 0, "head");
  });
  COLS.forEach((col, c) => {
    const anchor = new Mesh();
    anchor.position.set(x0 + c * dx, 0, z0 - dz * 0.9);
    stage.scene.add(anchor);
    label(col.title, anchor);
  });
  stats["maxTrianglesByKind"] = tris;
  stage.rig.pose = { yaw: 0, pitch: only ? 24 : 36, distance: only ? 11 : 31, fov: 30 };
  stage.rig.snap(new Vector3(0, only ? 0.6 : 0.3, 0.4));
}

function island(): void {
  const isl = buildIsland({ radius: 20, cell: 0.24, seed: 5, underside: 10, scatter: { tufts: 30, flowers: 40 } });
  stage.scene.add(isl.object);
  const clouds = buildClouds([
    { x: -8, y: -2.5, z: 3, width: 2.6, seed: 11 },
    { x: 8, y: -3, z: 4, width: 2.2, seed: 12 },
  ]);
  stage.scene.add(clouds.mesh);
  const mask = FIXTURE_FRIENDS.find((f) => f.tokenId === "344030") ?? FIXTURE_FRIENDS[0];
  if (mask) {
    const f = buildFriendModel(mask, EMPTY_MASK, { gold: 0, lod: 0, pixelSize: 0.13, halo: false });
    f.object.position.set(0.1, 0, 0.4);
    f.object.rotation.x = -0.35;
    tagHalo(f.object);
    stage.scene.add(f.object);
    attachProjectedShadow(f.object, { groundY: 0 });
  }
}

function frame(): void {
  island();
  const nib = addView("nib", "stunned", 0, 1);
  nib.object.position.set(-1.9, 0.25, 1.1);
  nib.object.rotation.z = 0.45;
  nib.setFacing(0.3, 1);
  nib.update(0.1);
  stage.scene.add(nib.object);

  const snatch = addView("snatch", "carry", 0, 2);
  snatch.object.position.set(-3.1, 2.4, 0.2);
  snatch.setFacing(0.2, 1);
  stage.scene.add(snatch.object);
  pixel(new Vector3(0, 0, 0), snatch.carryAnchor);

  const slurp = addView("slurp", "attack", 0, 3);
  slurp.object.position.set(2.3, 0, -0.9);
  slurp.setFacing(-0.4, 1);
  const loose = new Vector3(1.4, 0.06, 0.4);
  pixel(loose);
  slurp.setTarget(loose);
  slurp.update(0.17);
  stage.scene.add(slurp.object);

  pixel(new Vector3(0.9, 1.6, 1.1));
  pixel(new Vector3(-0.6, 0.06, 2.2));
  stage.rig.pose = { yaw: 0, pitch: 30, distance: 13, fov: 30 };
  stage.rig.snap(new Vector3(-0.3, 0.9, 0.4));
}

function gulp(): void {
  island();
  const phase = (q.get("phase") ?? "teeth") as GulpPhase;
  const mood = (q.get("mood") ?? "hungry") as GulpMood;
  const t = Number(q.get("t") ?? "3");
  const g = createGulpView({ mood });
  // On the rim, local −x pointing at the island centre: rotation.y = atan2(dir.z, −dir.x) for dir = centre − rim.
  const rim = new Vector3(2.9, 0, -3.3);
  g.object.position.copy(rim);
  g.object.rotation.y = Math.atan2(-rim.z, rim.x);
  g.onSpeak((line) => bubbles.show(hold(line), clock));
  g.setState(phase, 0);
  g.setTeeth(1, [true, false, false]);
  g.update(t);
  stage.scene.add(g.object);
  gulps.push(g);
  const wedge = createGulpWedge({ radius: 4.6, halfAngle: Math.PI / 4 });
  wedge.object.rotation.y = g.object.rotation.y;
  wedge.setTime(Number(q.get("wedge") ?? "1.6"));
  stage.scene.add(wedge.object);
  stats["gulpTriangles"] = g.triangles;
  const nib = addView("nib", "flee", 0.1, 5);
  nib.object.position.set(-2.4, 0, 1.4);
  nib.setFacing(-1, 0.3);
  stage.scene.add(nib.object);
  stage.rig.pose = { yaw: 0, pitch: 30, distance: 19, fov: 30 };
  stage.rig.snap(new Vector3(0.6, 0.8, -0.8));
}

if (mode === "frame") frame();
else if (mode === "gulp") gulp();
else grid();

stage.onFrame((dt) => {
  clock += dt;
  if (animate) {
    for (const v of views) v.update(dt);
    for (const g of gulps) g.update(dt);
  }
  placeLabels();
  bubbles.update(clock);
});

let frames = 0;
const off = stage.onFrame(() => {
  if (++frames < 6) return;
  off();
  stats["drawCalls"] = stage.post.stats;
  window.__creatures = { ready: true, stage, stats };
});
