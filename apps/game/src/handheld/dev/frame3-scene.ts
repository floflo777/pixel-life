/**
 * A hand-placed run view that restages art-bible frame 3 (left screen) through the real renderer: #344030 mid-fling
 * with its frame-3 scars, 4 loose pixels in brackets, a Clank, a Snatch overhead, a Nib at the rim and an impact star.
 * Used by `render.ts` to compare our pixels against `docs/design/art/frame3.png`.
 */
import { frontMask, getBit, type FriendView } from "@pl/shared";
import { PX_PER_U, PZ_PER_U, ISLAND_CX, ISLAND_CY } from "../project.js";
import type { RunFx } from "../screens.js";
import { PX, type HandheldView } from "../view.js";

/** World (x, z) of a screen ground point, with an optional height for a given screen y. */
function world(sx: number, groundY: number, sy = groundY): { x: number; z: number; y: number } {
  return { x: (sx - ISLAND_CX) / PX_PER_U, z: (groundY - ISLAND_CY) / PZ_PER_U, y: (groundY - sy) / PX_PER_U };
}

/** The frame 3 scene for `friend` (whose current scars become pre-run scars). */
export function frame3Scene(friend: FriendView): { view: HandheldView; fx: RunFx } {
  const front = frontMask(friend.appearance);
  const pixels = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    if (!getBit(front, i)) continue;
    pixels[i] = getBit(friend.pub.scars.lost, i) ? PX.scar : PX.body;
  }
  const f = world(60, 78);
  const loose = [
    [80, 40, 22],
    [96, 60, 44],
    [98, 98, 98],
    [118, 92, 82],
  ].map(([sx = 0, gy = 0, sy = 0], k) => {
    const w = world(sx, gy, sy);
    return { pid: 300 + k, x: w.x, y: w.y, z: w.z, left: 60 + k * 10, window: 120 };
  });
  const clank = world(96, 75);
  const snatch = world(13, 66, 25);
  const nib = world(16, 69);
  const view: HandheldView = {
    tick: 60 * 19,
    score: 3410,
    done: false,
    arena: { a: 36, b: 24, bumpers: [], pondA: 0, pondB: 0 },
    friend: {
      bodies: [{ x: f.x, z: f.z, vx: -44, vz: 4, flying: true }],
      pixels,
      ready: false,
      invulnerable: false,
      ringout: 0,
      chain: 15,
    },
    debris: loose,
    creatures: [
      { id: 1, kind: 2, ...clank, facing: 2048, telegraph: false, stun: 0, spawning: 0 },
      { id: 2, kind: 3, ...snatch, facing: 0, telegraph: false, stun: 0, spawning: 0 },
      { id: 3, kind: 0, ...nib, facing: 0, telegraph: false, stun: 0, spawning: 0 },
    ],
    stats: { recovered: 3, smashed: 7, lost: 1 },
  };
  const fx: RunFx = {
    frame: 0,
    aim: 12,
    charge: 0,
    timeLeftTicks: 41 * 60,
    lastGain: 120,
    gainAge: 0,
    impacts: [{ x: 40, y: 58, age: 3 }],
    callouts: [],
    bonk: null,
    inverse: null,
    reducedMotion: false,
    shake: { dx: 0, dy: 0 },
    paused: false,
    drag: null,
  };
  return { view, fx };
}
