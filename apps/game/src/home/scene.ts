import {
  EMPTY_LAYOUT,
  EMPTY_MASK,
  frontMask,
  FRIEND_SPOT,
  HOME_GRID,
  homeTerraces,
  placementCells,
  type BeltId,
  type FriendAppearance,
  type Hex64,
  type HomeLayout,
} from "@pl/shared";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector2,
  Vector3,
  type Object3D,
} from "three";
import { buildFriendModel, type FriendModel } from "../friend";
import { untagged } from "../post/tags";
import { HUB_POSE, type OrbitPose } from "../stage/camera-rig";
import { PALETTE } from "../stage/palette";
import type { SharedStage } from "../stage/stage";
import { buildIsland, type IslandModel } from "../world/island";
import { DecorLibrary } from "./decor";
import { HomeEditor, type HomeEditEvent } from "./editor";
import {
  ISLAND_CELL,
  TERRACE_RADIUS_CELLS,
  TILE,
  cellCenter,
  pickTile,
  placementCenter,
  terraceOrigin,
  type Tile,
} from "./grid";
import { buildBelt, buildHat, type Wearable } from "./wearables";

/** The Friend shown on its isle, in its real state. */
export interface HomeFriend {
  readonly appearance: FriendAppearance;
  readonly lost?: Hex64;
  readonly gold?: number;
  readonly stitched?: Hex64;
  readonly glowCracks?: number;
  /** Worn hat (catalog hat id) or null. */
  readonly hat?: string | null;
  /** Current Fling Belt or null. */
  readonly belt?: BeltId | null;
}

/** Isle size and the ownership edits are checked against. */
export interface HomeSceneOptions {
  /** On-chain generation (sets base terraces). Default: unknown → 1 terrace, unless `terraces` is given. */
  readonly generation?: number;
  readonly plots?: number;
  /** Explicit terrace count (e.g. `HomeView.terraces` from the server); overrides generation + plots. */
  readonly terraces?: number;
  /** Copies owned per item id; omit to skip ownership checks (visitors never edit). */
  readonly owned?: Readonly<Record<string, number>>;
}

/** The home island scene mounted on the shared stage. */
export interface HomeScene {
  /** Root object (added to `stage.scene`). */
  readonly object: Group;
  readonly terraces: number;
  /** The layout on screen (the editor's, while editing). */
  readonly layout: HomeLayout;
  /** Edit mode: tap/keys → place, move, rotate, remove, with a callback API (`editor.on`). */
  readonly editor: HomeEditor;
  /** Replaces the rendered layout (e.g. a saved or remote layout); resets the editor to it. */
  setLayout(layout: HomeLayout, owned?: Readonly<Record<string, number>>): void;
  /** Swaps the Friend (or its state: scars, gold, hat, belt). */
  setFriend(friend: HomeFriend): void;
  /** Eases (or snaps) the camera to a terrace. */
  focusTerrace(t: number, snap?: boolean): void;
  /** Tile under a normalised screen position (NDC −1..1), or null. */
  tileAt(ndcX: number, ndcY: number): Tile | null;
  /** Enters edit mode (grid overlay on, taps and keys edit). */
  beginEdit(): void;
  /** Leaves edit mode and returns the edited layout (the host saves it with `PUT /api/home`). */
  endEdit(): HomeLayout;
  /** Removes everything from the stage and frees GPU resources; restores the camera settings it changed. */
  dispose(): void;
}

const HOME_POSE: OrbitPose = { ...HUB_POSE, pitch: 34 };
const SELECT_COLOR = PALETTE.signal;

function disposeLines(obj: Object3D): void {
  obj.traverse((o) => {
    if (o instanceof LineSegments) o.geometry.dispose();
  });
}

/** A 12×12 dotted grid outline for one terrace (edit mode only). */
function gridLines(material: LineBasicMaterial): LineSegments {
  const pts: number[] = [];
  const h = HOME_GRID / 2;
  for (let i = 0; i <= HOME_GRID; i++) {
    const v = (i - h) * TILE;
    pts.push(-h * TILE, 0.02, v, h * TILE, 0.02, v, v, 0.02, -h * TILE, v, 0.02, h * TILE);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
  const lines = new LineSegments(g, material);
  untagged(lines);
  return lines;
}

/**
 * Builds a Friend's home island on the shared stage (GDD §12.3, art bible §4 "home isles"): one world-kit island per
 * terrace, the placed decor from the catalog models, and the Friend idling on its spot with its hat and belt band.
 * Edit mode draws the grid, a cursor and the selection, and routes stage taps and keys (arrows / Enter / R / Delete /
 * PageUp-PageDown for terraces / Escape) into the `HomeEditor`; the host listens with `scene.editor.on(...)`.
 */
export function createHomeScene(
  stage: SharedStage,
  layout: HomeLayout,
  friend: HomeFriend,
  options: HomeSceneOptions = {},
): HomeScene {
  const terraces =
    options.terraces !== undefined
      ? Math.max(1, Math.floor(options.terraces))
      : homeTerraces(options.generation ?? 0, options.plots ?? 0);
  const root = new Group();
  root.name = "home-isle";
  stage.scene.add(root);

  const seed = Number(BigInt.asUintN(31, BigInt(friend.appearance.tokenId || "1")));
  const islands: IslandModel[] = [];
  for (let t = 0; t < terraces; t++) {
    const o = terraceOrigin(t);
    const island = buildIsland({
      radius: TERRACE_RADIUS_CELLS,
      cell: ISLAND_CELL,
      seed: seed + t * 101,
      underside: 12,
      scatter: { tufts: 60, flowers: 30 },
    });
    island.object.position.set(o.x, o.y, o.z);
    root.add(island.object);
    islands.push(island);
  }

  // ── Decor ──
  const library = new DecorLibrary();
  const decorRoot = new Group();
  decorRoot.name = "home-decor";
  root.add(decorRoot);
  let decorObjects: Object3D[] = [];
  let shown: HomeLayout = EMPTY_LAYOUT;

  const renderDecor = (l: HomeLayout): void => {
    for (const o of decorObjects) decorRoot.remove(o);
    decorObjects = [];
    shown = l;
    for (const p of l.items) {
      const c = placementCenter(p);
      const obj = library.instance(p.item);
      if (!c || !obj || p.t >= terraces) {
        decorObjects.push(new Group());
        continue;
      }
      obj.position.set(c.x, c.y, c.z);
      obj.rotation.y = (p.r * Math.PI) / 2;
      decorRoot.add(obj);
      decorObjects.push(obj);
    }
  };

  // ── Friend + wearables ──
  let model: FriendModel | null = null;
  let worn: Wearable[] = [];
  const spot = cellCenter(FRIEND_SPOT.t, FRIEND_SPOT.x, FRIEND_SPOT.z);
  const setFriend = (f: HomeFriend): void => {
    for (const w of worn) w.dispose();
    worn = [];
    if (model) {
      root.remove(model.object);
      model.dispose();
    }
    model = buildFriendModel(f.appearance, f.lost ?? EMPTY_MASK, {
      gold: f.gold ?? 0,
      lod: 0,
      ...(f.stitched ? { stitched: f.stitched } : {}),
      ...(f.glowCracks !== undefined ? { glowCracks: f.glowCracks } : {}),
    });
    model.setPose("down", false, 0);
    // The 2×2 Friend spot is centred between its four cells.
    model.object.position.set(spot.x + TILE / 2, spot.y, spot.z + TILE / 2);
    const front = frontMask(f.appearance);
    const hat = f.hat ? buildHat(f.hat, front) : null;
    const belt = f.belt ? buildBelt(f.belt, front) : null;
    for (const w of [hat, belt]) {
      if (!w) continue;
      model.object.add(w.object);
      worn.push(w);
    }
    root.add(model.object);
  };

  // ── Edit overlay ──
  const overlay = new Group();
  overlay.name = "home-edit-overlay";
  overlay.visible = false;
  root.add(overlay);
  const lineMaterial = new LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.35 });
  for (let t = 0; t < terraces; t++) {
    const o = terraceOrigin(t);
    const lines = gridLines(lineMaterial);
    lines.position.set(o.x, o.y, o.z);
    overlay.add(lines);
  }
  const cursorMaterial = new MeshBasicMaterial({ color: PALETTE.paper, transparent: true, opacity: 0.55 });
  const selectMaterial = new MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.5 });
  const tileGeometry = new BoxGeometry(TILE * 0.96, 0.04, TILE * 0.96);
  const cursor = new Mesh(tileGeometry, cursorMaterial);
  untagged(cursor);
  overlay.add(cursor);
  const selection = new Group();
  overlay.add(selection);

  const editor = new HomeEditor(layout, { terraces, ...(options.owned ? { owned: options.owned } : {}) });

  const showCursor = (tile: Tile): void => {
    const c = cellCenter(tile.t, tile.x, tile.z);
    cursor.position.set(c.x, c.y + 0.03, c.z);
  };
  const showSelection = (): void => {
    selection.clear();
    const i = editor.selected;
    const p = i === null ? undefined : editor.layout.items[i];
    if (!p) return;
    // One highlighted tile per footprint cell.
    for (const [x, z] of placementCells(p) ?? []) {
      const c = cellCenter(p.t, x, z);
      const mark = new Mesh(tileGeometry, selectMaterial);
      untagged(mark);
      mark.position.set(c.x, c.y + 0.04, c.z);
      selection.add(mark);
    }
  };

  const unsubscribeEditor = editor.on((e: HomeEditEvent) => {
    if (e.type === "change") renderDecor(e.layout);
    if (e.type === "cursor") showCursor(e.tile);
    if (e.type === "select") {
      if (e.tile) showCursor(e.tile);
      showSelection();
    }
  });

  // ── Camera ──
  const rig = stage.rig;
  const saved = { pose: rig.pose, min: rig.minVisibleWidth, rate: rig.followRate };
  rig.pose = { ...HOME_POSE };
  rig.minVisibleWidth = HOME_GRID * TILE + 2;
  const focusTerrace = (t: number, snap = false): void => {
    const o = terraceOrigin(Math.min(terraces - 1, Math.max(0, Math.floor(t))));
    const target = new Vector3(o.x, o.y, o.z);
    if (snap) rig.snap(target);
    else rig.follow(target);
  };
  focusTerrace(0, true);

  // ── Picking and input ──
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const inv = new Vector3();
  const tileAt = (ndcX: number, ndcY: number): Tile | null => {
    ndc.set(ndcX, ndcY);
    stage.camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, stage.camera);
    root.updateWorldMatrix(true, false);
    // Into island-local space (the root may be moved by the host).
    const origin = root.worldToLocal(inv.copy(raycaster.ray.origin));
    const far = root.worldToLocal(raycaster.ray.origin.clone().add(raycaster.ray.direction));
    const dir = far.sub(origin);
    return pickTile({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z }, terraces);
  };

  const KEY_STEPS: Readonly<Record<string, readonly [number, number, number]>> = {
    ArrowLeft: [-1, 0, 0],
    ArrowRight: [1, 0, 0],
    ArrowUp: [0, -1, 0],
    ArrowDown: [0, 1, 0],
    PageUp: [0, 0, 1],
    PageDown: [0, 0, -1],
  };
  const unsubscribeInput = stage.input.on((e) => {
    if (!editor.active) return;
    if (e.type === "tap") {
      const tile = tileAt(e.at.ndcX, e.at.ndcY);
      if (tile) editor.tap(tile);
      return;
    }
    if (e.type !== "key" || !e.down) return;
    const step = KEY_STEPS[e.code];
    if (step) {
      const before = editor.cursor.t;
      const tile = editor.moveCursor(step[0], step[1], step[2]);
      if (tile.t !== before) focusTerrace(tile.t);
      return;
    }
    if (e.action === "confirm") editor.tap(editor.cursor);
    else if (e.code === "KeyR") editor.rotate();
    else if (e.code === "Delete" || e.code === "Backspace") editor.remove();
    else if (e.action === "cancel") {
      if (editor.armed !== null) editor.arm(null);
    }
  });

  setFriend(friend);
  renderDecor(layout);
  showCursor(editor.cursor);

  let disposed = false;
  return {
    object: root,
    terraces,
    get layout() {
      return editor.active ? editor.layout : shown;
    },
    editor,
    setLayout(l, owned) {
      editor.reset(l, { terraces, ...(owned ? { owned } : options.owned ? { owned: options.owned } : {}) });
      renderDecor(l);
      showSelection();
    },
    setFriend,
    focusTerrace,
    tileAt,
    beginEdit() {
      editor.begin();
      overlay.visible = true;
      showCursor(editor.cursor);
    },
    endEdit() {
      editor.end();
      overlay.visible = false;
      selection.clear();
      return editor.layout;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeInput();
      unsubscribeEditor();
      stage.scene.remove(root);
      for (const w of worn) w.dispose();
      model?.dispose();
      for (const i of islands) i.dispose();
      library.dispose();
      disposeLines(overlay);
      lineMaterial.dispose();
      cursorMaterial.dispose();
      selectMaterial.dispose();
      tileGeometry.dispose();
      rig.pose = saved.pose;
      rig.minVisibleWidth = saved.min;
      rig.followRate = saved.rate;
    },
  };
}
