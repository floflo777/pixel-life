/**
 * The Sky plaza built from the `@pl/game` world kit (the style-frame-2 layout of `apps/game/dev/plaza.ts`): the live
 * landing hero and the hub placeholder until `createHubScene` lands. Real voxel Friends stand in it: "you" (the loaner or
 * your own Friend, scars and all) plus a few loaners as ambient visitors.
 */
import {
  attachProjectedShadow,
  buildClouds,
  buildFriendModel,
  buildIsland,
  type FriendModel,
  type HaloTint,
  PALETTE,
  POSE_FPS,
  type ProjectedShadow,
  type PropSpec,
  type SharedStage as GameStage,
  tagHalo,
} from "@pl/game";
import { effectiveLost, type FriendView, FRAMES_PER_FACING } from "@pl/shared";
import { Group, Vector3 } from "three";
import { streakTier } from "../meta/streak.js";

/** Where Friends stand (frame 2): index 0 is "you". */
const SPOTS: readonly { x: number; y: number; z: number }[] = [
  { x: 0.4, y: 0.06, z: 2.0 },
  { x: -2.6, y: 0, z: 0.2 },
  { x: 3.0, y: 0, z: 0.4 },
  { x: -4.6, y: 0, z: 2.5 },
  { x: -0.95, y: 0.1, z: -1.75 },
  { x: 1.5, y: 0, z: -1.2 },
];
/** Camera position of the hub framing, used to turn Friends' front faces toward the viewer. */
const CAM = new Vector3(0.3, 11.6, 16.9);
/** Art bible §2: the body is pitched back by the camera pitch so the front face reads. */
const TILT = 0.5;

/** A plaza mounted on a stage. */
export interface PlazaScene {
  /** Places (or replaces) "you"; null removes it. */
  setYou(view: FriendView | null): void;
  /** Ambient visitors (at most 5). */
  setCrowd(views: readonly FriendView[]): void;
  /** Screen position (CSS px, relative to the canvas) of the top of "you", for DOM tags. */
  youAnchor(out: { x: number; y: number }): boolean;
  dispose(): void;
}

interface Placed {
  model: FriendModel;
  shadow: ProjectedShadow;
  view: FriendView;
  phase: number;
}

/** Builds the plaza into `stage.scene`, frames the camera and animates idle poses (stepped, off in reduced motion). */
export function buildPlazaScene(stage: GameStage): PlazaScene {
  const root = new Group();
  const cell = 0.24;
  const props: PropSpec[] = [
    { kind: "venue", x: 0, z: -5.3, name: "pixel-life", popPixel: [8, 12] },
    { kind: "kiosk", x: 4.3, z: -2.9, name: "greenhouse" },
    { kind: "board", x: -4.6, z: -3.1, name: "daily-stone" },
    { kind: "tree", x: -5.8, z: -1.2, canopy: "paper", radius: 0.8, trunk: 5, seed: 3 },
    { kind: "tree", x: 6.2, z: -0.9, canopy: "meadow", radius: 0.75, trunk: 5, seed: 4 },
    { kind: "tree", x: -6.6, z: 1.9, canopy: "sun", radius: 0.6, trunk: 4, seed: 5 },
    { kind: "tree", x: 5.9, z: 2.6, canopy: "paper", radius: 0.65, trunk: 4, seed: 6 },
    { kind: "tree", x: -2.9, z: -5.6, canopy: "meadow", radius: 0.7, trunk: 6, seed: 7 },
    { kind: "tree", x: 3.2, z: -5.8, canopy: "paper", radius: 0.7, trunk: 5, seed: 8 },
    { kind: "bench", x: -2.6, z: 1.9 },
    { kind: "bench", x: 2.6, z: 2.1 },
    { kind: "lamp", x: -3.2, z: -0.3 },
    { kind: "lamp", x: 3.3, z: -0.2 },
    { kind: "lamp", x: -1.4, z: 3.4 },
    { kind: "lamp", x: 1.6, z: 3.3 },
    { kind: "bridge", x: 6.9, z: 0, planks: 18 },
    { kind: "signpost", x: 6.4, z: 1.3, name: "sky-docks", color: PALETTE.pond },
  ];
  const main = buildIsland({
    radius: 28,
    cell,
    seed: 21,
    squash: 1.12,
    underside: 12,
    pond: { i: -19, j: 6, r: 4.5 },
    plaza: {
      radius: 13,
      paths: [
        { toward: "-z", halfWidth: 2 },
        { toward: "+x", halfWidth: 1 },
      ],
    },
    scatter: { tufts: 60, flowers: 80 },
    props,
  });
  const east = buildIsland({ radius: 12, cell, seed: 33, underside: 9, scatter: { tufts: 20, flowers: 16 } });
  east.object.position.set(13.2, -0.3, -0.6);
  const far = buildIsland({ radius: 10, cell: 0.3, seed: 34, underside: 7, bakeShadows: false });
  far.object.position.set(-14, 1.8, -14);
  const islands = [main, east, far];
  for (const i of islands) root.add(i.object);
  const clouds = buildClouds([
    { x: -9, y: -3.2, z: 4, width: 3, seed: 11 },
    { x: 10, y: -3.8, z: 5, width: 2.6, seed: 12 },
    { x: -2, y: 4.6, z: -20, width: 3, seed: 13 },
  ]);
  root.add(clouds.mesh);
  stage.scene.add(root);

  stage.post.haloWidth = 1;
  stage.rig.pose = { yaw: 0.8, pitch: 28, distance: 21, fov: 30 };
  stage.rig.baseYaw = 0.8;
  stage.rig.minVisibleWidth = 19;
  stage.rig.snap(new Vector3(0, 1.75, -1.6));

  const placed: (Placed | null)[] = SPOTS.map(() => null);
  const place = (slot: number, view: FriendView | null): void => {
    const old = placed[slot];
    if (old) {
      old.shadow.dispose();
      old.model.object.removeFromParent();
      old.model.dispose();
      placed[slot] = null;
    }
    const spot = SPOTS[slot];
    if (!view || !spot) return;
    const lost = effectiveLost(view.pub.scars, Date.now(), view.appearance.tokenId);
    const model = buildFriendModel(view.appearance, lost, {
      gold: view.loaned ? 0 : view.pub.goldHeld,
      glowCracks: view.pub.glowCracks,
      lod: 1,
      halo: false,
      ...(view.pub.stitched ? { stitched: view.pub.stitched } : {}),
    });
    const o = model.object;
    o.position.set(spot.x, spot.y, spot.z);
    o.rotation.set(-TILT, Math.atan2(CAM.x - spot.x, CAM.z - spot.z) * 0.9, 0, "YXZ");
    tagHalo(o, streakTier(view.pub.streak) as HaloTint);
    root.add(o);
    placed[slot] = { model, shadow: attachProjectedShadow(o, { groundY: 0 }), view, phase: slot * 3 };
  };

  // Idle: stepped 12 fps pose frames; a slow yaw drift of the camera. Both off under reduced motion.
  let t = 0;
  const off = stage.onFrame((dt) => {
    if (stage.reducedMotion) return;
    t += dt;
    const frame = Math.floor(t * POSE_FPS);
    for (const p of placed) if (p) p.model.setPose("down", false, (frame + p.phase) % FRAMES_PER_FACING);
    stage.rig.pose.yaw = 0.8 + Math.sin(t * 0.12) * 6;
  });

  const tmp = new Vector3();
  return {
    setYou: (view) => place(0, view),
    setCrowd(views) {
      for (let i = 1; i < SPOTS.length; i++) place(i, views[i - 1] ?? null);
    },
    youAnchor(out) {
      const you = placed[0];
      if (!you) return false;
      you.model.object.getWorldPosition(tmp);
      tmp.y += you.model.height + 0.2;
      tmp.project(stage.camera);
      const el = stage.renderer.domElement;
      out.x = ((tmp.x + 1) / 2) * el.clientWidth;
      out.y = ((1 - tmp.y) / 2) * el.clientHeight;
      return tmp.z < 1;
    },
    dispose() {
      off();
      for (let i = 0; i < placed.length; i++) place(i, null);
      for (const i of islands) i.dispose();
      clouds.dispose();
      root.removeFromParent();
    },
  };
}
