/** Node benchmark for the PR: `npx tsx apps/game/src/friend/dev/measure.ts`. Prints LOD0/LOD1 tris and setLost timings (240 cache-missing
 * updates per Friend: every call re-meshes). */
import {
  EMPTY_MASK,
  familyName,
  fromIndices,
  frontMask,
  getBit,
  regrowthOrder,
  type FriendAppearance,
} from "@pl/shared";
import { buildDetachableFriend } from "../detachable.js";
import { buildFriendModel } from "../model.js";
import { FIXTURE_FRIENDS } from "./fixtures.js";

const scars = (a: FriendAppearance, n: number, skip = 0): string =>
  fromIndices(
    regrowthOrder(a.tokenId)
      .filter((i) => getBit(frontMask(a), i))
      .slice(skip, skip + n),
  );
const pct = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)] ?? 0;

const rows = FIXTURE_FRIENDS.map((a) => {
  const whole = buildFriendModel(a, EMPTY_MASK, { gold: 0, lod: 0 });
  const adorned = buildFriendModel(a, scars(a, 8), { gold: 2, glowCracks: 3, stitched: scars(a, 6, 8), lod: 0 });
  const lod1 = buildFriendModel(a, scars(a, 8), { gold: 2, stitched: scars(a, 6, 8), lod: 1 });
  const venue = buildDetachableFriend(a, EMPTY_MASK, { gold: 2 });
  const miss: number[] = [];
  const v: number[] = [];
  for (let round = 0; round < 20; round++) {
    for (let k = 1; k <= 12; k++) {
      const lost = scars(a, k, 20 + round);
      let t = performance.now();
      adorned.setLost(lost);
      miss.push(performance.now() - t);
      t = performance.now();
      venue.setLost(lost);
      v.push(performance.now() - t);
    }
  }
  const r = {
    friend: `#${a.tokenId} ${familyName(a.familyId)}`,
    lod0: whole.triangles,
    lod0Adorned: adorned.triangles,
    lod1Adorned: lod1.triangles,
    setLostP50ms: +pct(miss, 0.5).toFixed(3),
    setLostP99ms: +pct(miss, 0.99).toFixed(3),
    venueSetLostP50ms: +pct(v, 0.5).toFixed(3),
    venueSetLostP99ms: +pct(v, 0.99).toFixed(3),
  };
  for (const m of [whole, adorned, lod1]) m.dispose();
  venue.dispose();
  return r;
});
console.table(rows);
