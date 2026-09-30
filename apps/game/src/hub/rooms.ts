/**
 * The five hub rooms dressed with the world kit (art bible §4.1, frame 2). Gameplay geometry is the `@pl/realtime`
 * navmesh (server authority); this file only decorates it: islands sized to cover the walkable area, props placed in
 * the navmesh holes, bridges over the door stubs, gate arches on room doors, labels for the DOM overlay, resting
 * spots on the island edges. The plaza also gets the Loose Pixels hall of frame 2 with a client-side venue doormat.
 */
import { Group, Mesh, Vector3, type BufferGeometry } from "three";
import { HUB_NAVMESHES, Navmesh, centroid, rect, type HubNavmesh } from "@pl/realtime";
import type { RoomSlug } from "@pl/shared";
import { createBandMaterial } from "../post/band-material";
import { PALETTE } from "../stage/palette";
import { SUN_DIRECTION } from "../stage/lights";
import { buildClouds, type CloudSpec } from "../world/clouds";
import { buildIsland, islandCells, type IslandModel, type IslandSpec } from "../world/island";
import type { PropSpec } from "../world/props";
import { VoxelMesher } from "../world/voxel-mesher";
import type { FocusBounds } from "./camera";
import { toWorld, WORLD_PER_WIRE, type GroundPoint } from "./coords";
import type { DoorZone } from "./doors";
import { fountain, gateArch, mendWell, planter, stageDisc, statue, wideBridge } from "./room-kit";
import { ROOM_BLURB, ROOM_NAMES } from "./status";

/** The sign icon of the Loose Pixels hall (venue id `pixel-life`): #344030 Mismir (frame 2), with its right arm pixel popping out. */
export const PIXEL_LIFE_ICON: readonly string[] = [
  "................",
  ".....#....#.....",
  ".....##..##.....",
  ".....######.....",
  "....##.##.##....",
  "....###..###....",
  ".....######.....",
  ".......##.......",
  "...##########...",
  "...####..####...",
  "....########....",
  "...##########...",
  ".....##..##.....",
  ".....##..##.....",
  "....###..###....",
  "................",
];

/** A DOM label pinned to the room (inverted marquee, lime door pill, paper sign, gate card). */
export interface RoomLabel {
  readonly id: string;
  readonly kind: "marquee" | "pill" | "sign" | "gate";
  readonly title: string;
  readonly sub?: string;
  readonly at: Vector3;
  /** Door this label opens when tapped (walks there). */
  readonly doorId?: string;
  /** Venue whose live count the pill shows. */
  readonly venueId?: string;
  /** Live content: `daily` = the Daily countdown. */
  readonly live?: "daily";
}

/** A built room: static geometry plus the data the scene and overlay need. */
export interface RoomView {
  readonly slug: RoomSlug;
  readonly root: Group;
  readonly navmesh: Navmesh;
  /** Every door zone: the navmesh doors plus client venue doormats (wire units). */
  readonly zones: readonly (DoorZone & { readonly spawn: readonly [number, number] })[];
  readonly labels: readonly RoomLabel[];
  /** Where offline Friends rest (world units, on the island edge, never on a door or path). */
  readonly restingSpots: readonly GroundPoint[];
  /** Mend Well bubbles anchor (sky docks). */
  readonly wellAnchor: Vector3 | null;
  readonly bounds: FocusBounds;
  readonly triangles: number;
  dispose(): void;
}

interface Bridge {
  readonly from: GroundPoint;
  readonly to: GroundPoint;
}

interface Layout {
  readonly island: Omit<IslandSpec, "props" | "seed"> & { readonly seed: number };
  /** Points (world) the island must cover: the walkable area and building footprints. */
  readonly cover: readonly GroundPoint[];
  readonly props: readonly PropSpec[];
  readonly extras: (m: VoxelMesher) => void;
  readonly bridges: readonly Bridge[];
  readonly venueZones: readonly (DoorZone & { readonly spawn: readonly [number, number] })[];
  readonly labels: (island: IslandModel) => RoomLabel[];
  readonly background: readonly { x: number; y: number; z: number; radius: number; seed: number }[];
  readonly clouds: readonly CloudSpec[];
  readonly bounds: FocusBounds;
  readonly restRadius: { readonly rx: number; readonly rz: number };
  readonly well?: GroundPoint;
}

const W = (wx: number, wz: number): GroundPoint => toWorld(wx, wz);

/** Island-local anchor of a kit prop (the room island sits at the origin), lifted by `dy`. */
function anchor(island: IslandModel, name: string, dy = 0): Vector3 {
  const a = island.anchors.find((x) => x.name === name);
  return a ? a.position.clone().setY(a.position.y + dy) : new Vector3(0, 2, 0);
}
const BRIDGE_HALF = 300 * WORLD_PER_WIRE;

/** Samples a navmesh's walkable area on a grid (world points) so the island is proven to cover it. */
function walkableSamples(mesh: HubNavmesh, stepWire = 150): GroundPoint[] {
  const nm = new Navmesh(mesh);
  const out: GroundPoint[] = [];
  const xs = mesh.areas.flat().map((p) => p[0]);
  const zs = mesh.areas.flat().map((p) => p[1]);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += stepWire)
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += stepWire)
      if (nm.contains([x, z]) && !nm.doorAt([x, z])) out.push(W(x, z));
  return out;
}

/** Only the part of the walkable area that must stand on land (bridge stubs may hang over the void). */
function landSamples(mesh: HubNavmesh, keep: (p: GroundPoint) => boolean): GroundPoint[] {
  return walkableSamples(mesh).filter(keep);
}

/**
 * First seed from `seed` whose noisy island covers every `cover` point (deterministic: the same room always gets the
 * same island). Falls back to `seed` if none of the next 64 do (tests assert coverage for the shipped layouts).
 */
export function coveringSeed(
  spec: Pick<IslandSpec, "radius" | "squash" | "cell">,
  seed: number,
  cover: readonly GroundPoint[],
): number {
  const cell = spec.cell ?? 0.24;
  for (let s = seed; s < seed + 64; s++) {
    const cells = islandCells({
      radius: spec.radius,
      seed: s,
      ...(spec.squash !== undefined ? { squash: spec.squash } : {}),
    });
    const ok = cover.every((p) => {
      const i = Math.round(p.x / cell);
      const j = Math.round(p.z / cell);
      const c = cells.get(`${i},${j}`);
      return c !== undefined && c.edge >= 1;
    });
    if (ok) return s;
  }
  return seed;
}

// ── Plaza ────────────────────────────────────────────────────────────────────────────────────────────────────────
const PLAZA_HALL_Z = -9.3;
const plaza: Layout = {
  island: {
    radius: 48,
    seed: 21,
    squash: 1,
    underside: 14,
    plaza: {
      radius: 23,
      paths: [
        { toward: "-x", halfWidth: 4 },
        { toward: "+z", halfWidth: 4 },
        { toward: "-z", halfWidth: 2 },
      ],
    },
    pond: { i: 30, j: 26, r: 5 },
    scatter: { tufts: 140, flowers: 170 },
  },
  cover: [
    ...landSamples(HUB_NAVMESHES.plaza, (p) => Math.sqrt(p.x * p.x + p.z * p.z) < 8.2),
    ...[-2, 0, 2].flatMap((x) => [PLAZA_HALL_Z - 0.9, PLAZA_HALL_Z, PLAZA_HALL_Z + 0.8].map((z) => ({ x, z }))),
  ],
  props: [
    { kind: "venue", x: 0, z: PLAZA_HALL_Z, name: "pixel-life", icon: PIXEL_LIFE_ICON, popPixel: [8, 12] },
    { kind: "board", x: 2.6, z: 3.6, name: "daily-stone" },
    { kind: "board", x: 5.6, z: -1.6, name: "notice-board", facing: 3 },
    { kind: "tree", x: -3.7, z: -9.6, canopy: "meadow", radius: 0.75, trunk: 6, seed: 7 },
    { kind: "tree", x: 4.7, z: -8.6, canopy: "paper", radius: 0.8, trunk: 5, seed: 8 },
    { kind: "tree", x: -8.6, z: -3.6, canopy: "paper", radius: 0.85, trunk: 5, seed: 3 },
    { kind: "tree", x: 8.9, z: -3.3, canopy: "meadow", radius: 0.75, trunk: 5, seed: 4 },
    { kind: "tree", x: -9.1, z: 3.6, canopy: "sun", radius: 0.65, trunk: 4, seed: 5 },
    { kind: "tree", x: 8.7, z: 4.4, canopy: "paper", radius: 0.7, trunk: 4, seed: 6 },
    { kind: "tree", x: -5.4, z: 8.0, canopy: "sun", radius: 0.6, trunk: 4, seed: 9 },
    { kind: "tree", x: 6.0, z: 7.6, canopy: "meadow", radius: 0.6, trunk: 4, seed: 10 },
    { kind: "bench", x: -2.8, z: 8.5 },
    { kind: "bench", x: 3.0, z: 8.4 },
    { kind: "bench", x: -8.3, z: 1.6, facing: 1 },
    { kind: "lamp", x: -2.1, z: 5.2 },
    { kind: "lamp", x: 2.2, z: 5.2 },
    { kind: "lamp", x: -5.3, z: -1.4 },
    { kind: "lamp", x: 5.2, z: 1.3 },
  ],
  extras: (m) => {
    fountain(m, 0, 0, 1.25);
    stageDisc(m, -3.6, 3.6, 1.2);
  },
  bridges: [
    { from: W(-800, -1900), to: W(-800, -3150) },
    { from: W(800, -1900), to: W(800, -3150) },
    { from: W(-1900, 0), to: W(-3150, 0) },
    { from: W(0, 1900), to: W(0, 3150) },
  ],
  venueZones: [
    {
      id: "venue-plaza-pixel-life",
      kind: "venue",
      target: "pixel-life",
      area: rect(-180, -1985, 180, -1810),
      spawn: [0, -1500],
    },
  ],
  labels: (i) => [
    { id: "pl-marquee", kind: "marquee", title: "LOOSE PIXELS", at: anchor(i, "pixel-life:marquee") },
    {
      id: "pl-pill",
      kind: "pill",
      title: "enter",
      at: anchor(i, "pixel-life:pill"),
      doorId: "venue-plaza-pixel-life",
      venueId: "pixel-life",
    },
    { id: "daily", kind: "sign", title: "DAILY STONE", sub: "", live: "daily", at: anchor(i, "daily-stone:label") },
    { id: "notice", kind: "sign", title: "NOTICE BOARD", sub: "open isles", at: anchor(i, "notice-board:label") },
  ],
  background: [
    { x: -9, y: -1.6, z: -22, radius: 16, seed: 41 },
    { x: 10, y: -1.2, z: -23, radius: 16, seed: 42 },
    { x: -25, y: -1.8, z: 1, radius: 16, seed: 43 },
    { x: 0, y: -2.2, z: 24, radius: 14, seed: 44 },
    { x: 24, y: 3.5, z: -18, radius: 8, seed: 45 },
  ],
  clouds: [
    { x: -14, y: -3.4, z: 8, width: 3.2, seed: 11 },
    { x: 15, y: -4.0, z: 6, width: 2.8, seed: 12 },
    { x: 18, y: -2.5, z: -10, width: 2.4, seed: 14 },
  ],
  bounds: { minX: -5.5, maxX: 5.5, minZ: -6.2, maxZ: 6.5 },
  restRadius: { rx: 10.1, rz: 10.1 },
};

// ── Satellites: 30 × 24 u isles (12 × 9.6 world) ────────────────────────────────────────────────────────────────
const SAT_ISLAND = { radius: 36, squash: 1.22, underside: 11, scatter: { tufts: 70, flowers: 80 } } as const;
const onIsle = (p: GroundPoint): boolean => Math.abs(p.x) <= 6.05 && Math.abs(p.z) <= 4.85;
const satCover = (slug: RoomSlug, extra: GroundPoint[] = []): GroundPoint[] => [
  ...landSamples(HUB_NAVMESHES[slug], onIsle),
  ...extra,
];
const satBounds: FocusBounds = { minX: -2.8, maxX: 2.8, minZ: -2.6, maxZ: 2.4 };
const satBackground = [
  { x: 0, y: -2, z: 22, radius: 20, seed: 51 },
  { x: -18, y: 2.5, z: -16, radius: 8, seed: 52 },
  { x: 17, y: -1.5, z: -12, radius: 9, seed: 53 },
];
const satClouds: CloudSpec[] = [
  { x: -11, y: -3.2, z: 5, width: 2.8, seed: 21 },
  { x: 11, y: -3.6, z: 4, width: 2.6, seed: 22 },
];
const southBridge: Bridge = { from: W(0, 1000), to: W(0, 2350) };

const pixelArena: Layout = {
  island: {
    ...SAT_ISLAND,
    seed: 61,
    plaza: {
      radius: 11,
      paths: [
        { toward: "+z", halfWidth: 4 },
        { toward: "-z", halfWidth: 3 },
      ],
    },
  },
  cover: satCover("pixel-arena", [W(-950, -1400), W(950, -1400), W(0, -1600)]),
  props: [
    { kind: "venue", x: 0, z: -5.7, name: "pixel-life", icon: PIXEL_LIFE_ICON, popPixel: [8, 12] },
    { kind: "tree", x: -5.6, z: -3.4, canopy: "meadow", radius: 0.7, trunk: 5, seed: 71 },
    { kind: "tree", x: 5.5, z: -3.2, canopy: "meadow", radius: 0.65, trunk: 5, seed: 72 },
    { kind: "lamp", x: -1.6, z: 2.8 },
    { kind: "lamp", x: 1.6, z: 2.8 },
  ],
  extras: (m) => {
    statue(m, -2.8, -0.8, PIXEL_LIFE_ICON, 0.12);
    // The big ring on its plinth (rect 700..1000 × 200..500 cm).
    for (let i = -3; i <= 3; i++)
      for (let k = -3; k <= 3; k++) m.box([3.4 + i * 0.2, 0.1, 1.4 + k * 0.2], [0.2, 0.2, 0.2], PALETTE.stone);
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      m.box(
        [3.4 + Math.cos(t) * 0.55, 0.85 + Math.sin(t) * 0.55, 1.4],
        [0.18, 0.18, 0.18],
        a % 2 ? PALETTE.coral : PALETTE.coralDark,
      );
    }
  },
  bridges: [southBridge],
  venueZones: [],
  labels: (i) => [
    { id: "pl-marquee", kind: "marquee", title: "LOOSE PIXELS", at: anchor(i, "pixel-life:marquee") },
    {
      id: "pl-pill",
      kind: "pill",
      title: "enter",
      at: anchor(i, "pixel-life:pill"),
      doorId: "venue-pixel-life",
      venueId: "pixel-life",
    },
    {
      id: "statue",
      kind: "sign",
      title: "FLING STATUE",
      sub: "hold your friend to fling",
      at: new Vector3(-2.8, 2.7, -0.8),
    },
  ],
  background: satBackground,
  clouds: satClouds,
  bounds: satBounds,
  restRadius: { rx: 7.4, rz: 6.0 },
};

const seedBooth: Layout = {
  island: {
    ...SAT_ISLAND,
    seed: 81,
    plaza: {
      radius: 10,
      paths: [
        { toward: "+z", halfWidth: 4 },
        { toward: "-z", halfWidth: 3 },
      ],
    },
  },
  cover: satCover("seed-booth", [W(-950, -1400), W(950, -1400), W(0, -1600)]),
  props: [
    { kind: "venue", x: 0, z: -5.7, name: "seed-pack", roof: PALETTE.sun, roofDark: 0xd9b050, icon: SEED_ICON() },
    { kind: "kiosk", x: 3.0, z: -1.8, name: "greenhouse" },
    { kind: "tree", x: -5.5, z: -3.0, canopy: "sun", radius: 0.7, trunk: 5, seed: 91 },
    { kind: "tree", x: 5.9, z: 1.9, canopy: "sun", radius: 0.6, trunk: 4, seed: 92 },
    { kind: "lamp", x: -1.6, z: 2.8 },
    { kind: "lamp", x: 1.6, z: 2.8 },
  ],
  extras: (m) => planter(m, -3.2, 1.2, 0.8),
  bridges: [southBridge],
  venueZones: [],
  labels: (i) => [
    { id: "sp-marquee", kind: "marquee", title: "SEED PACK", at: anchor(i, "seed-pack:marquee") },
    {
      id: "sp-pill",
      kind: "pill",
      title: "enter",
      at: anchor(i, "seed-pack:pill"),
      doorId: "venue-seed-pack",
      venueId: "seed-pack",
    },
    { id: "gh", kind: "sign", title: "GREENHOUSE", sub: "regrow · seeds", at: anchor(i, "greenhouse:label") },
  ],
  background: satBackground,
  clouds: satClouds,
  bounds: satBounds,
  restRadius: { rx: 7.4, rz: 6.0 },
};

const skyDocks: Layout = {
  island: { ...SAT_ISLAND, seed: 101, pond: { i: 18, j: -12, r: 3 } },
  cover: satCover("sky-docks"),
  props: [
    { kind: "board", x: -3.6, z: -3.4, name: "mend-board" },
    { kind: "tree", x: -5.6, z: 2.8, canopy: "paper", radius: 0.7, trunk: 5, seed: 111 },
    { kind: "tree", x: 2.9, z: -4.2, canopy: "paper", radius: 0.65, trunk: 5, seed: 112 },
    { kind: "bench", x: 1.6, z: 3.2 },
    { kind: "lamp", x: 0.9, z: -1.9 },
  ],
  extras: (m) => mendWell(m, -0.8, 0, 1.3),
  bridges: [{ from: W(1400, 0), to: W(2650, 0) }],
  venueZones: [],
  labels: (i) => [
    { id: "well", kind: "sign", title: "MEND WELL", sub: "tap a bubble to mend", at: new Vector3(-0.8, 1.2, 1.4) },
    {
      id: "mend-board",
      kind: "sign",
      title: "MEND BOARD",
      sub: "stitches last 7 days",
      at: anchor(i, "mend-board:label"),
    },
  ],
  background: satBackground,
  clouds: satClouds,
  bounds: satBounds,
  restRadius: { rx: 7.4, rz: 6.0 },
  well: { x: -0.8, z: 0 },
};

const dailyGate: Layout = {
  island: { ...SAT_ISLAND, seed: 121, plaza: { radius: 9, paths: [{ toward: "-z", halfWidth: 4 }] } },
  cover: satCover("daily-gate", [W(0, 1300)]),
  props: [
    { kind: "board", x: -1.0, z: 2.4, name: "daily-board" },
    { kind: "board", x: 1.0, z: 2.4, name: "weekly-board" },
    { kind: "door", x: 0, z: 5.05, name: "daily", facing: 2 },
    { kind: "tree", x: -5.4, z: 1.8, canopy: "meadow", radius: 0.7, trunk: 5, seed: 131 },
    { kind: "tree", x: 5.4, z: 2.0, canopy: "sun", radius: 0.6, trunk: 4, seed: 132 },
  ],
  extras: () => undefined,
  bridges: [{ from: W(0, -1000), to: W(0, -2350) }],
  venueZones: [],
  labels: (i) => [
    { id: "daily", kind: "sign", title: "DAILY RUN", sub: "", live: "daily", at: anchor(i, "daily-board:label") },
    { id: "weekly", kind: "sign", title: "WEEKLY BOARD", sub: "top friends", at: anchor(i, "weekly-board:label") },
    {
      id: "daily-pill",
      kind: "pill",
      title: "daily",
      at: anchor(i, "daily:pill"),
      doorId: "venue-daily",
      venueId: "pixel-life",
    },
  ],
  background: satBackground,
  clouds: satClouds,
  bounds: satBounds,
  restRadius: { rx: 7.4, rz: 6.0 },
};

function SEED_ICON(): readonly string[] {
  return [
    "................",
    "................",
    "........##......",
    ".......####.....",
    "......##..##....",
    "..###..####.....",
    ".#####..##......",
    ".######.##......",
    "..#####.##......",
    "....##..##......",
    "......####......",
    ".....######.....",
    "....########....",
    "....########....",
    ".....######.....",
    "................",
  ];
}

const LAYOUTS: Readonly<Record<RoomSlug, Layout>> = {
  plaza,
  "pixel-arena": pixelArena,
  "seed-booth": seedBooth,
  "sky-docks": skyDocks,
  "daily-gate": dailyGate,
};

/** The layout data of a room (exported for tests: coverage, zones, labels). */
export function roomLayout(slug: RoomSlug): Layout {
  return LAYOUTS[slug];
}

/** Door zones of a room: navmesh doors plus the layout's client venue doormats. */
export function roomZones(slug: RoomSlug): RoomView["zones"] {
  return [
    ...HUB_NAVMESHES[slug].doors.map((d) => ({
      id: d.id,
      kind: d.kind,
      target: d.target,
      area: d.area,
      spawn: d.spawn,
      ...(d.mode !== undefined ? { mode: d.mode } : {}),
    })),
    ...LAYOUTS[slug].venueZones,
  ];
}

/** Candidate resting spots on an ellipse ring, kept where the island is meadow and away from doors and props. */
function restingSpots(slug: RoomSlug, island: IslandModel, ring: { rx: number; rz: number }): GroundPoint[] {
  const nm = new Navmesh(HUB_NAVMESHES[slug]);
  const zones = roomZones(slug).map((z) => toWorld(...centroid(z.area)));
  const out: GroundPoint[] = [];
  for (let k = 0; k < 48; k++) {
    // Front half first: resting Friends read best facing the camera across the plaza.
    const t = ((k * 7) % 48) / 48;
    const a = Math.PI * 2 * t;
    for (const scale of [1, 0.92, 1.06]) {
      const p = { x: Math.sin(a) * ring.rx * scale, z: Math.cos(a) * ring.rz * scale };
      if (island.surfaceAt(p.x, p.z) !== "meadow" || !island.isWalkable(p.x, p.z)) continue;
      if (zones.some((z) => Math.hypot(z.x - p.x, z.z - p.z) < 2.6)) continue;
      if (nm.contains([p.x / WORLD_PER_WIRE, p.z / WORLD_PER_WIRE])) continue;
      if (out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 1.3)) continue;
      out.push(p);
      break;
    }
  }
  return out;
}

/** Builds a room's static world (islands, props, extras, bridges, gates, clouds) and its overlay data. */
export function buildRoom(slug: RoomSlug): RoomView {
  const L = LAYOUTS[slug];
  const root = new Group();
  root.name = `hub-room-${slug}`;
  const seed = coveringSeed(L.island, L.island.seed, L.cover);
  const island = buildIsland({ ...L.island, seed, props: L.props });
  root.add(island.object);
  const islands: IslandModel[] = [island];
  for (const b of L.background) {
    const bg = buildIsland({
      radius: b.radius,
      cell: 0.3,
      seed: b.seed,
      underside: 7,
      bakeShadows: false,
      scatter: { tufts: 8, flowers: 6 },
    });
    bg.object.position.set(b.x, b.y, b.z);
    root.add(bg.object);
    islands.push(bg);
  }
  const clouds = buildClouds([...L.clouds]);
  root.add(clouds.mesh);

  // Extras: one mesh for fountain/bridges/gates/statues.
  const m = new VoxelMesher();
  L.extras(m);
  for (const b of L.bridges) wideBridge(m, b.from, b.to, BRIDGE_HALF);
  const zones = roomZones(slug);
  const labels: RoomLabel[] = L.labels(island);
  for (const z of zones) {
    if (z.kind !== "room") continue;
    const c = toWorld(...centroid(z.area));
    // Arch faces along the stub: horizontal stubs get a yaw of 90°.
    const horizontal = Math.abs(c.x) > Math.abs(c.z);
    gateArch(m, c.x, c.z, BRIDGE_HALF + 0.1, horizontal ? Math.PI / 2 : 0);
    const target = z.target as RoomSlug;
    labels.push({
      id: `gate-${z.id}`,
      kind: "gate",
      title: `→ ${ROOM_NAMES[target] ?? target}`,
      sub: ROOM_BLURB[target] ?? "",
      at: new Vector3(c.x, 2.35, c.z),
      doorId: z.id,
    });
  }
  let extrasGeo: BufferGeometry | null = null;
  const extrasMat = createBandMaterial({ vertexColors: true, bandAttribute: true });
  let extraTris = 0;
  if (!m.empty) {
    const built = m.build({ sun: SUN_DIRECTION.clone(), maxDistance: 6 });
    extrasGeo = built.geometry;
    extraTris = built.triangles;
    const mesh = new Mesh(built.geometry, extrasMat);
    mesh.name = "hub-extras";
    root.add(mesh);
  }

  return {
    slug,
    root,
    navmesh: new Navmesh(HUB_NAVMESHES[slug]),
    zones,
    labels,
    restingSpots: restingSpots(slug, island, L.restRadius),
    wellAnchor: L.well ? new Vector3(L.well.x, 1.9, L.well.z) : null,
    bounds: L.bounds,
    triangles: islands.reduce((n, i) => n + i.stats.triangles, 0) + clouds.triangles + extraTris,
    dispose() {
      for (const i of islands) i.dispose();
      clouds.dispose();
      extrasGeo?.dispose();
      extrasMat.dispose();
      root.removeFromParent();
    },
  };
}
