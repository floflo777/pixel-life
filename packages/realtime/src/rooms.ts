import { ROOMS, type RoomSlug } from "@pl/shared";
import { chamferRect, ngon, rect, type Vec2 } from "./geometry.js";
import type { HubDoor, HubNavmesh } from "./navmesh.js";

/*
 * Hub room maps (GDD §11.1, art bible §4.1). Units: centimetres, 1 u = 100. +x east, +z south (toward the camera).
 *
 *              pixel-arena        seed-booth          Each satellite isle is ≈ 30 × 24 u; bridges are 6 u wide.
 *                   ╲                ╱                Every room is its own sharded map, so a bridge is a stub that
 *   sky-docks ═══  PLAZA (Ø 40 u)                     ends in a door zone; walking onto it switches room and the
 *                      ║                              Friend arrives on the matching stub of the other map.
 *                  daily-gate
 *
 * Simple convex-ish polygons on purpose: the art team dresses them; gameplay only needs "can I stand here".
 */

const BRIDGE_HALF = 300;
const STUB = 1100;

function roomDoor(id: string, target: RoomSlug, area: readonly Vec2[], spawn: Vec2): HubDoor {
  return { id, kind: "room", target, area, spawn };
}

// ── Plaza: 40 u disc, fountain in the middle, four bridge stubs. ─────────────────────────────────────────────────
const PLAZA_R = 2000;
const plaza: HubNavmesh = {
  room: "plaza",
  version: 1,
  areas: [
    ngon(0, 0, PLAZA_R, 24, Math.PI / 24),
    rect(-800 - BRIDGE_HALF, -PLAZA_R - STUB, -800 + BRIDGE_HALF, -PLAZA_R + 400), // NW stub → pixel-arena
    rect(800 - BRIDGE_HALF, -PLAZA_R - STUB, 800 + BRIDGE_HALF, -PLAZA_R + 400), // NE stub → seed-booth
    rect(-PLAZA_R - STUB, -BRIDGE_HALF, -PLAZA_R + 400, BRIDGE_HALF), // W stub → sky-docks
    rect(-BRIDGE_HALF, PLAZA_R - 400, BRIDGE_HALF, PLAZA_R + STUB), // S stub → daily-gate
  ],
  holes: [
    ngon(0, 0, 320, 8, Math.PI / 8), // fountain
    rect(500, 850, 800, 950), // daily stone
    rect(1250, -450, 1550, -350), // notice board
  ],
  spawns: ngon(0, 0, 700, 8, 0),
  doors: [
    roomDoor("to-pixel-arena", "pixel-arena", rect(-1100, -3100, -500, -2800), [-800, -1700]),
    roomDoor("to-seed-booth", "seed-booth", rect(500, -3100, 1100, -2800), [800, -1700]),
    roomDoor("to-sky-docks", "sky-docks", rect(-3100, -300, -2800, 300), [-1700, 0]),
    roomDoor("to-daily-gate", "daily-gate", rect(-300, 2800, 300, 3100), [0, 1700]),
  ],
  landmarks: [
    { id: "fountain", at: [0, 0] },
    { id: "daily-stone", at: [650, 900] },
    { id: "notice-board", at: [1400, -400] },
    { id: "emote-stage", at: [-900, 900] },
  ],
};

// ── Satellite isles: 30 × 24 u chamfered slabs. ──────────────────────────────────────────────────────────────────
const ISLE = chamferRect(-1500, -1200, 1500, 1200, 400);
const SOUTH_STUB = rect(-BRIDGE_HALF, 900, BRIDGE_HALF, 1200 + STUB);
const SOUTH_EXIT = rect(-300, 2000, 300, 2300);
const NORTH_DOOR = rect(-300, -1200, 300, -950);

const pixelArena: HubNavmesh = {
  room: "pixel-arena",
  version: 1,
  areas: [ISLE, SOUTH_STUB],
  holes: [ngon(-700, -200, 250, 8, Math.PI / 8), rect(700, 200, 1000, 500)], // fling statue, big-ring plinth
  spawns: [
    [0, 300],
    [-300, 500],
    [300, 500],
    [0, 700],
  ],
  doors: [
    roomDoor("to-plaza", "plaza", SOUTH_EXIT, [0, 900]),
    { id: "venue-pixel-life", kind: "venue", target: "pixel-life", area: NORTH_DOOR, spawn: [0, -700] },
  ],
  landmarks: [
    { id: "fling-statue", at: [-700, -200] },
    { id: "pixel-life-door", at: [0, -1200] },
  ],
};

const seedBooth: HubNavmesh = {
  room: "seed-booth",
  version: 1,
  areas: [ISLE, SOUTH_STUB],
  holes: [rect(400, -700, 1100, -200), ngon(-800, 300, 200, 8, Math.PI / 8)], // greenhouse booth, seed planter
  spawns: [
    [0, 300],
    [-300, 500],
    [300, 500],
    [0, 700],
  ],
  doors: [
    roomDoor("to-plaza", "plaza", SOUTH_EXIT, [0, 900]),
    { id: "venue-seed-pack", kind: "venue", target: "seed-pack", area: NORTH_DOOR, spawn: [0, -700] },
  ],
  landmarks: [
    { id: "greenhouse", at: [750, -450] },
    { id: "seed-pack-door", at: [0, -1200] },
  ],
};

const skyDocks: HubNavmesh = {
  room: "sky-docks",
  version: 1,
  areas: [ISLE, rect(1300, -BRIDGE_HALF, 1500 + STUB, BRIDGE_HALF)],
  holes: [ngon(-200, 0, 350, 12, Math.PI / 12), rect(-1100, -900, -700, -800)], // Mend Well, Mend board
  spawns: [
    [700, 0],
    [600, -400],
    [600, 400],
    [300, 700],
  ],
  doors: [roomDoor("to-plaza", "plaza", rect(2300, -300, 2600, 300), [1200, 0])],
  landmarks: [
    { id: "mend-well", at: [-200, 0] },
    { id: "mend-board", at: [-900, -850] },
  ],
};

const dailyGate: HubNavmesh = {
  room: "daily-gate",
  version: 1,
  areas: [ISLE, rect(-BRIDGE_HALF, -1200 - STUB, BRIDGE_HALF, -900)],
  holes: [rect(-600, 500, 600, 700)], // board cliff leaderboard
  spawns: [
    [0, -300],
    [-300, -500],
    [300, -500],
    [0, 0],
  ],
  doors: [
    roomDoor("to-plaza", "plaza", rect(-300, -2300, 300, -2000), [0, -900]),
    {
      id: "venue-daily",
      kind: "venue",
      target: "pixel-life",
      mode: "daily",
      area: rect(-300, 950, 300, 1200),
      spawn: [0, 300],
    },
  ],
  landmarks: [
    { id: "daily-board", at: [0, 600] },
    { id: "daily-door", at: [0, 1200] },
  ],
};

/** The navmesh of every hub room, keyed by slug (D-09 room list). */
export const HUB_NAVMESHES: Readonly<Record<RoomSlug, HubNavmesh>> = Object.freeze({
  plaza,
  "pixel-arena": pixelArena,
  "seed-booth": seedBooth,
  "sky-docks": skyDocks,
  "daily-gate": dailyGate,
});

/** True when `slug` is a hub room slug. */
export function isRoomSlug(slug: string): slug is RoomSlug {
  return (ROOMS as readonly string[]).includes(slug);
}
