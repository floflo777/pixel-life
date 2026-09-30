/**
 * Dev gallery: every fixture Friend in all 4 facings plus the scar / gold / stitch / halo-tier / eye-glow / LOD /
 * venue variants, rendered at pixel-scale 2 with nearest upscaling (art bible §3). Used for visual review and the
 * Playwright screenshot in `tools/assets` (`npm run gallery:shot -w @pl/assets`). Sets `window.__galleryReady`.
 */
import * as THREE from "three";
import {
  EMPTY_MASK,
  familyName,
  fromIndices,
  frontMask,
  getBit,
  regrowthOrder,
  type FriendAppearance,
  type Hex64,
} from "@pl/shared";
import { buildDetachableFriend } from "../detachable.js";
import { buildFriendModel, friendCacheStats, type FriendModel } from "../model.js";
import { HALO_TIERS } from "../palette.js";
import { FIXTURE_FRIENDS } from "./fixtures.js";

declare global {
  interface Window {
    __galleryReady?: boolean;
    __galleryStats?: unknown;
  }
}

const SCALE = 2; // pixel-scale 2: render px → 2 CSS px
const CELL_W = 108;
const CELL_H = 116;
const HEAD = 14; // render px of column labels
const PITCH = THREE.MathUtils.degToRad(30);
const TILT = THREE.MathUtils.degToRad(18); // plate pitched back: front face 12° off the view vector (≤ 20°)
const PIXEL = 0.15;
const DIST = 5.6;

interface Column {
  label: string;
  make: (a: FriendAppearance) => { object: THREE.Object3D; dispose(): void; after?: () => void };
}

function scars(a: FriendAppearance, n: number, skip = 0): Hex64 {
  const front = frontMask(a);
  return fromIndices(
    regrowthOrder(a.tokenId)
      .filter((i) => getBit(front, i))
      .slice(skip, skip + n),
  );
}

const facingCol = (facing: "down" | "up" | "left" | "right"): Column => ({
  label: facing,
  make: (a) => {
    const m = buildFriendModel(a, EMPTY_MASK, { gold: 0, lod: 0, pixelSize: PIXEL });
    m.setPose(facing, false, 0);
    return m;
  },
});

const COLUMNS: Column[] = [
  facingCol("down"),
  facingCol("up"),
  facingCol("left"),
  facingCol("right"),
  { label: "scars", make: (a) => buildFriendModel(a, scars(a, 7), { gold: 0, lod: 0, pixelSize: PIXEL }) },
  {
    label: "gold+crack",
    make: (a) => buildFriendModel(a, EMPTY_MASK, { gold: 2, glowCracks: 2, lod: 0, pixelSize: PIXEL }),
  },
  {
    label: "stitched",
    make: (a) => buildFriendModel(a, EMPTY_MASK, { gold: 0, stitched: scars(a, 6, 3), lod: 0, pixelSize: PIXEL }),
  },
  {
    label: "all · sun",
    make: (a) =>
      buildFriendModel(a, scars(a, 4), {
        gold: 1,
        stitched: scars(a, 4, 6),
        lod: 0,
        pixelSize: PIXEL,
        halo: { color: HALO_TIERS.sun },
      }),
  },
  {
    label: "eye glow",
    make: (a) => {
      const m = buildFriendModel(a, EMPTY_MASK, {
        gold: 0,
        lod: 0,
        pixelSize: PIXEL,
        halo: { color: HALO_TIERS.lilac },
      });
      m.setEyeGlow(true);
      return m;
    },
  },
  {
    label: "walk r f3",
    make: (a) => withPose(buildFriendModel(a, scars(a, 4), { gold: 1, lod: 0, pixelSize: PIXEL })),
  },
  { label: "lod1", make: (a) => buildFriendModel(a, scars(a, 4), { gold: 1, lod: 1, pixelSize: PIXEL }) },
  { label: "lod2", make: (a) => buildFriendModel(a, scars(a, 4), { gold: 1, lod: 2, pixelSize: PIXEL }) },
  {
    label: "venue",
    make: (a) => {
      const d = buildDetachableFriend(a, scars(a, 3), { gold: 1, pixelSize: PIXEL });
      const loose = d.pixels.filter((p) => !getBit(scars(a, 3), p)).slice(-3);
      return {
        object: d.object,
        dispose: d.dispose,
        after: () => {
          loose.forEach((p, k) => {
            d.detach(p);
            const home = d.homeWorld(p, new THREE.Vector3());
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5 * k, 0.7, 0.4 + k));
            d.setDetachedWorld(p, home.add(new THREE.Vector3(0.9 - 0.5 * k, 0.35 + 0.25 * k, 0.6)), q);
          });
        },
      };
    },
  },
];

function withPose(m: FriendModel): FriendModel {
  m.setPose("right", true, 3);
  return m;
}

function ground(): THREE.Mesh {
  const side = new THREE.MeshBasicMaterial({ color: 0xed927e });
  const top = new THREE.MeshBasicMaterial({ color: 0xb9d984 });
  const under = new THREE.MeshBasicMaterial({ color: 0xb3a0d8 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.24, 2.2), [side, side, top, under, side, side]);
  m.position.set(0, -0.12, -0.4);
  return m;
}

const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById("gl") as HTMLCanvasElement,
  antialias: false,
});
const W = CELL_W * COLUMNS.length;
const H = HEAD + CELL_H * FIXTURE_FRIENDS.length;
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.domElement.style.width = `${W * SCALE}px`;
renderer.domElement.style.height = `${H * SCALE}px`;
renderer.setScissorTest(true);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, CELL_W / CELL_H, 0.5, 60);
const wrap = document.getElementById("wrap") as HTMLElement;
const label = (text: string, x: number, y: number, cls = ""): void => {
  const el = document.createElement("div");
  el.className = `lbl ${cls}`;
  el.textContent = text;
  el.style.left = `${x * SCALE}px`;
  el.style.top = `${y * SCALE}px`;
  wrap.appendChild(el);
};

const cells: { target: THREE.Vector3; x: number; y: number }[] = [];
const afters: (() => void)[] = [];
FIXTURE_FRIENDS.forEach((a, r) => {
  label(`#${a.tokenId} ${familyName(a.familyId).toLowerCase()}`, 2, HEAD + r * CELL_H + 2);
  COLUMNS.forEach((col, c) => {
    const at = new THREE.Vector3(c * 20, 0, r * 20);
    const g = ground();
    g.position.add(at);
    scene.add(g);
    const made = col.make(a);
    made.object.position.copy(at);
    made.object.rotation.x = -TILT;
    scene.add(made.object);
    if (made.after) afters.push(made.after);
    cells.push({ target: at, x: c * CELL_W, y: HEAD + r * CELL_H });
  });
});
COLUMNS.forEach((col, c) => label(col.label, c * CELL_W + 2, 1, "col"));
scene.updateMatrixWorld(true);
for (const f of afters) f();

function render(): void {
  renderer.setScissor(0, 0, W, H);
  renderer.setViewport(0, 0, W, H);
  renderer.setClearColor(0xeeeeee);
  renderer.clear();
  for (const cell of cells) {
    const y = H - cell.y - CELL_H; // GL origin is bottom-left
    renderer.setScissor(cell.x + 1, y + 1, CELL_W - 2, CELL_H - 2);
    renderer.setViewport(cell.x, y, CELL_W, CELL_H);
    renderer.setClearColor(0xc5deea);
    renderer.clear();
    const look = cell.target.clone().add(new THREE.Vector3(0, 1.05, 0));
    camera.position.copy(look).add(new THREE.Vector3(0, Math.sin(PITCH) * DIST, Math.cos(PITCH) * DIST));
    camera.lookAt(look);
    renderer.render(scene, camera);
  }
}

/** Per-Friend numbers for the PR: LOD0 / LOD1 triangles (whole and fully adorned) and setLost timings. */
function measure(): Record<string, number | string>[] {
  const rows: Record<string, number | string>[] = [];
  for (const a of FIXTURE_FRIENDS) {
    const whole = buildFriendModel(a, EMPTY_MASK, { gold: 0, lod: 0 });
    const adorned = buildFriendModel(a, scars(a, 8), { gold: 2, glowCracks: 3, stitched: scars(a, 6, 8), lod: 0 });
    const lod1 = buildFriendModel(a, scars(a, 8), { gold: 2, stitched: scars(a, 6, 8), lod: 1 });
    const times: number[] = [];
    for (let k = 1; k <= 12; k++) {
      const t = performance.now();
      adorned.setLost(scars(a, k, 20));
      times.push(performance.now() - t);
    }
    const venue = buildDetachableFriend(a, EMPTY_MASK, { gold: 2 });
    const vt: number[] = [];
    for (let k = 1; k <= 12; k++) {
      const t = performance.now();
      venue.setLost(scars(a, k));
      vt.push(performance.now() - t);
    }
    const med = (xs: number[]): number => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)] ?? 0;
    rows.push({
      friend: `#${a.tokenId} ${familyName(a.familyId)}`,
      "lod0 tris": whole.triangles,
      "lod0 adorned": adorned.triangles,
      "lod1 adorned": lod1.triangles,
      "setLost ms (median)": +med(times).toFixed(3),
      "setLost ms (max)": +Math.max(...times).toFixed(3),
      "venue setLost ms": +med(vt).toFixed(3),
    });
    for (const m of [whole, adorned, lod1]) m.dispose();
    venue.dispose();
  }
  return rows;
}

render();
const stats = measure();
const table = document.getElementById("stats") as HTMLTableElement;
const keys = Object.keys(stats[0] ?? {});
table.innerHTML =
  `<tr>${keys.map((k) => `<th>${k}</th>`).join("")}</tr>` +
  stats.map((r) => `<tr>${keys.map((k) => `<td>${r[k]}</td>`).join("")}</tr>`).join("");
window.__galleryStats = { rows: stats, cache: friendCacheStats(), drawCalls: renderer.info.render.calls };
window.__galleryReady = true;
