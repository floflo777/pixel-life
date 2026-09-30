import { BoxGeometry, Group, Mesh, Vector3 } from "three";
import friends from "../../../docs/design/data/friends.json";
import { createBandMaterial } from "../src/post/band-material";
import { tagHalo, type HaloTint } from "../src/post/tags";
import { PALETTE } from "../src/stage/palette";
import { buildClouds } from "../src/world/clouds";
import { buildIsland, type IslandModel } from "../src/world/island";
import { attachProjectedShadow, type ProjectedShadow } from "../src/world/projected-shadow";
import type { PropSpec } from "../src/world/props";

/** Where Friends stand in frame 2, with their halo tint (streak tiers) and whether it's "you". */
export const FRIEND_SPOTS: readonly {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  halo: HaloTint;
  label?: string;
}[] = [
  { x: 0.4, y: 0.06, z: 2.0, w: 11, h: 13, halo: "sun", label: "you" },
  { x: -2.6, y: 0, z: 0.2, w: 11, h: 9, halo: "lilac", label: "#63675" },
  { x: 3.0, y: 0, z: 0.4, w: 10, h: 12, halo: "coral", label: "#65040" },
  { x: -4.6, y: 0, z: 2.5, w: 14, h: 10, halo: "halo" },
  { x: 4.9, y: 0.7, z: 2.3, w: 8, h: 8, halo: "halo" },
  { x: -0.95, y: 0.1, z: -1.75, w: 10, h: 12, halo: "halo", label: "#344034" },
  { x: 1.5, y: 0, z: -1.2, w: 7, h: 10, halo: "halo" },
];

interface FriendFixture {
  readonly tokenId: string;
  readonly frames: readonly (readonly string[])[];
}

function maskIcon(): readonly string[] | undefined {
  const list = friends as unknown as readonly FriendFixture[];
  return list.find((f) => f.tokenId === "344030")?.frames[0];
}

/** Everything the playground scene owns, so it can be disposed. */
export interface Plaza {
  readonly root: Group;
  readonly main: IslandModel;
  readonly islands: readonly IslandModel[];
  readonly placeholders: readonly Mesh[];
  readonly triangles: number;
  dispose(): void;
}

/**
 * Recreates the frame-2 Sky Hub plaza with the world kit: plaza island with venue, landmarks,
 * trees, lamps, benches, a pond and a bridge; neighbour and background islands; clouds; and ink
 * placeholder slabs (with halo + projected shadow) where Friends stand.
 */
export function buildPlaza(): Plaza {
  const root = new Group();
  const cell = 0.24;
  const icon = maskIcon();
  const props: PropSpec[] = [
    { kind: "venue", x: 0, z: -5.3, name: "pixel-life", popPixel: [8, 12], ...(icon ? { icon } : {}) },
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
  const east = buildIsland({
    radius: 12,
    cell,
    seed: 33,
    underside: 9,
    scatter: { tufts: 20, flowers: 16 },
    props: [{ kind: "door", x: 0.6, z: -1.2, name: "next-venue" }],
  });
  east.object.position.set(13.2, -0.3, -0.6);
  const far = buildIsland({ radius: 10, cell: 0.3, seed: 34, underside: 7, bakeShadows: false });
  far.object.position.set(-14, 1.8, -14);
  const far2 = buildIsland({ radius: 7, cell: 0.3, seed: 35, underside: 6, bakeShadows: false });
  far2.object.position.set(9, 3.5, -18);
  const islands = [main, east, far, far2];
  for (const i of islands) root.add(i.object);

  const clouds = buildClouds([
    { x: -9, y: -3.2, z: 4, width: 3, seed: 11 },
    { x: 10, y: -3.8, z: 5, width: 2.6, seed: 12 },
    { x: -2, y: 4.6, z: -20, width: 3, seed: 13 },
  ]);
  root.add(clouds.mesh);

  // Placeholder ink slabs where Friends go (the voxel Friend is built elsewhere).
  const slabMat = createBandMaterial({ color: PALETTE.body, lightMix: 0.26 });
  const geoms: BoxGeometry[] = [];
  const shadows: ProjectedShadow[] = [];
  const placeholders: Mesh[] = [];
  const cam = new Vector3(0.3, 11.6, 16.9);
  for (const s of FRIEND_SPOTS) {
    const px = 0.15;
    const g = new BoxGeometry(s.w * px, s.h * px, 1.5 * px);
    g.translate(0, (s.h * px) / 2, 0);
    geoms.push(g);
    const m = new Mesh(g, slabMat);
    m.name = `friend-placeholder${s.label ? `-${s.label}` : ""}`;
    m.position.set(s.x, s.y, s.z);
    m.rotation.set(-0.5, Math.atan2(cam.x - s.x, cam.z - s.z) * 0.9, 0, "YXZ");
    tagHalo(m, s.halo);
    root.add(m);
    shadows.push(attachProjectedShadow(m, { groundY: 0 }));
    placeholders.push(m);
  }

  const triangles = islands.reduce((n, i) => n + i.stats.triangles, 0) + clouds.triangles + placeholders.length * 12;
  return {
    root,
    main,
    islands,
    placeholders,
    triangles,
    dispose() {
      for (const s of shadows) s.dispose();
      for (const i of islands) i.dispose();
      clouds.dispose();
      for (const g of geoms) g.dispose();
      slabMat.dispose();
      root.removeFromParent();
    },
  };
}
